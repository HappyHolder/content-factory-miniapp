import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { TIER_LIMITS } from '../lib/subscriptionLimits';
import { applyMonthlyQuotaReset } from '../lib/subscriptionLimits';
import { enqueueContentPlan } from '../lib/contentWorker';

// ─── Content plans ────────────────────────────────────────────────────────────
// Confirm / poll / cancel a content-series plan built by the assistant. All
// endpoints validate initData (HMAC) + plan ownership. See the content manager
// plan in docs/content-manager-plan.md.

const router = Router();

/**
 * Resolves the authenticated user + the owned plan by id. Writes the error
 * response and returns null on any failure.
 */
async function authPlan(
  res: Response,
  initData: unknown,
  planId: string,
): Promise<{ userId: string; channelId: string; userIdOfChannel: string } | null> {
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' }); return null;
  }
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return null;
  }
  const telegramId = String(parsed.user.id);
  const dbUser = await prisma.user
    .findUnique({ where: { telegramId }, select: { id: true } })
    .catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found. Please re-open the app.' }); return null; }

  const plan = await prisma.contentPlan
    .findUnique({ where: { id: planId }, select: { channelId: true, channel: { select: { userId: true } } } })
    .catch(() => null);
  if (!plan) { res.status(404).json({ error: 'Plan not found.' }); return null; }
  if (plan.channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This plan does not belong to your account.' }); return null;
  }
  return { userId: dbUser.id, channelId: plan.channelId, userIdOfChannel: plan.channel.userId };
}

// ─── POST /api/content-plan/:id/confirm ───────────────────────────────────────
// Quota-gates, flips the plan to GENERATING, and starts the background worker.
router.post('/:id/confirm', async (req: Request, res: Response): Promise<void> => {
  const planId = req.params['id'] as string;
  const auth = await authPlan(res, req.body?.['initData'], planId);
  if (!auth) return;

  const plan = await prisma.contentPlan.findUnique({
    where:   { id: planId },
    include: { items: { select: { status: true } } },
  });
  if (!plan) { res.status(404).json({ error: 'Plan not found.' }); return; }
  if (plan.status !== 'DRAFT') {
    res.status(409).json({ error: 'Plan already started.', status: plan.status }); return;
  }

  // Feature gate — content manager is CREATOR+.
  const sub = await prisma.subscription.findUnique({
    where:  { userId: auth.userId },
    select: { tier: true, aiPostsLimit: true, aiPostsUsed: true, aiCreatesLimit: true, aiCreatesUsed: true, quotaResetAt: true },
  }).catch(() => null);
  const tier = sub?.tier ?? 'FREE';
  if (!TIER_LIMITS[tier].canUseContentManager) {
    res.status(403).json({ error: 'Контент-менеджер доступен на тарифе Creator и выше.', code: 'UPGRADE_REQUIRED' }); return;
  }

  // Quota gate — need at least N free monthly posts for the pending items.
  const pending = plan.items.filter(i => i.status !== 'DONE' && i.status !== 'SKIPPED').length;
  if (sub) {
    const q = await applyMonthlyQuotaReset({
      userId: auth.userId,
      aiPostsLimit: sub.aiPostsLimit, aiPostsUsed: sub.aiPostsUsed,
      aiCreatesLimit: sub.aiCreatesLimit, aiCreatesUsed: sub.aiCreatesUsed,
      quotaResetAt: sub.quotaResetAt,
    });
    const free = q.aiPostsLimit - q.aiPostsUsed;
    if (free < pending) {
      res.status(402).json({
        error: `Недостаточно квоты постов: нужно ${pending}, доступно ${Math.max(0, free)}.`,
        code: 'QUOTA_EXCEEDED', needed: pending, available: Math.max(0, free),
      });
      return;
    }
  }

  try {
    await prisma.contentPlan.update({ where: { id: planId }, data: { status: 'GENERATING', errorMessage: null } });
    enqueueContentPlan(planId);
    res.json({ ok: true, planId, status: 'GENERATING' });
  } catch (err) {
    console.error('[content-plan/confirm] failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/content-plan/:id ────────────────────────────────────────────────
// Polling endpoint: plan status + per-item progress (n/total).
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const planId = req.params['id'] as string;
  const auth = await authPlan(res, req.query['initData'], planId);
  if (!auth) return;

  const plan = await prisma.contentPlan.findUnique({
    where:   { id: planId },
    include: { items: { orderBy: { orderIndex: 'asc' }, select: { status: true, generatedPostId: true } } },
  });
  if (!plan) { res.status(404).json({ error: 'Plan not found.' }); return; }

  const total = plan.items.length;
  const counts = { pending: 0, researching: 0, generating: 0, done: 0, skipped: 0, failed: 0 };
  for (const it of plan.items) {
    const key = it.status.toLowerCase() as keyof typeof counts;
    if (key in counts) counts[key]++;
  }
  const processed = counts.done + counts.skipped; // finished (success or skipped)

  res.json({
    id: plan.id,
    status: plan.status,
    total,
    processed,
    done: counts.done,
    skipped: counts.skipped,
    counts,
  });
});

// ─── POST /api/content-plan/:id/cancel ────────────────────────────────────────
// Flags the plan CANCELLED (the worker stops after the current item) and pulls
// any already-scheduled, not-yet-published posts out of Отложка (ARCHIVED).
router.post('/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  const planId = req.params['id'] as string;
  const auth = await authPlan(res, req.body?.['initData'], planId);
  if (!auth) return;

  try {
    await prisma.contentPlan.update({ where: { id: planId }, data: { status: 'CANCELLED' } });

    // Un-schedule posts this plan already created that haven't published yet.
    const items = await prisma.contentPlanItem.findMany({
      where:  { planId, generatedPostId: { not: null } },
      select: { generatedPostId: true },
    });
    const postIds = items.map(i => i.generatedPostId!).filter(Boolean);
    if (postIds.length > 0) {
      await prisma.generatedPost.updateMany({
        where: { id: { in: postIds }, status: 'SCHEDULED' },
        data:  { status: 'ARCHIVED', scheduledAt: null },
      }).catch(() => {});
    }
    res.json({ ok: true, status: 'CANCELLED' });
  } catch (err) {
    console.error('[content-plan/cancel] failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/content-plan/list ──────────────────────────────────────────────
// Recent plans for a channel (owner-scoped).
router.post('/list', async (req: Request, res: Response): Promise<void> => {
  const { initData, channelId } = req.body as { initData?: unknown; channelId?: unknown };
  if (typeof initData !== 'string' || !initData.trim()) { res.status(400).json({ error: 'initData is required' }); return; }
  if (typeof channelId !== 'string' || !channelId.trim()) { res.status(400).json({ error: 'channelId is required' }); return; }

  let parsed;
  try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch (err) { res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return; }

  const dbUser = await prisma.user.findUnique({ where: { telegramId: String(parsed.user.id) }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found.' }); return; }

  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { userId: true } }).catch(() => null);
  if (!channel) { res.status(404).json({ error: 'Channel not found.' }); return; }
  if (channel.userId !== dbUser.id) { res.status(403).json({ error: 'Access denied.' }); return; }

  const plans = await prisma.contentPlan.findMany({
    where:   { channelId },
    orderBy: { createdAt: 'desc' },
    take:    20,
    select:  { id: true, topic: true, status: true, postsPerDay: true, days: true, startDate: true, createdAt: true, _count: { select: { items: true } } },
  }).catch(() => []);

  res.json({ plans: plans.map(p => ({
    id: p.id, topic: p.topic, status: p.status, postsPerDay: p.postsPerDay, days: p.days,
    startDate: p.startDate.toISOString(), createdAt: p.createdAt.toISOString(), totalPosts: p._count.items,
  })) });
});

export default router;
