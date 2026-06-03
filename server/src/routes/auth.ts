import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { TIER_LIMITS, applyMonthlyQuotaReset } from '../lib/subscriptionLimits';

const router = Router();

// ─── POST /api/auth/telegram ──────────────────────────────────────────────────
// Validates Telegram Mini App initData, upserts User by telegramId.
//
// Request body:  { initData: string }
// Response 200:  { user: { id, name, telegramId, username }, channels: Channel[], brandKits: BrandKit[], subscription: null }
// Response 400:  { error: string }  — missing / malformed body
// Response 401:  { error: string }  — invalid or expired initData
// Response 500:  { error: string }  — DB failure

router.post('/telegram', async (req: Request, res: Response): Promise<void> => {
  const { initData } = req.body as { initData?: unknown };

  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required and must be a string' });
    return;
  }

  // ── Validate Telegram signature ───────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid initData',
    });
    return;
  }

  const { user: tgUser } = parsed;

  // ── Build fields to persist ───────────────────────────────────────────────
  // telegramId is stored as a string (Telegram IDs can exceed JS safe int)
  const telegramId = String(tgUser.id);

  // Combine first + last name; both fields may be absent in future Telegram versions
  const nameParts = [tgUser.first_name, tgUser.last_name].filter(Boolean);
  const name = nameParts.length > 0 ? nameParts.join(' ') : null;

  // NOTE: username is NOT in the current Prisma User schema.
  // It is returned in the response from parsed initData but not persisted.
  // Add a migration with `username String? @unique` before storing it.

  // ── Upsert User ───────────────────────────────────────────────────────────
  let dbUser;
  try {
    dbUser = await prisma.user.upsert({
      where:  { telegramId },
      update: { name },         // refresh name on every auth (Telegram name may change)
      create: { telegramId, name },
    });
  } catch (err) {
    console.error('[auth/telegram] DB upsert failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  // ── Fetch this user's connected channels ──────────────────────────────────
  let dbChannels: { id: string; name: string; handle: string | null }[] = [];
  try {
    dbChannels = await prisma.channel.findMany({
      where:   { userId: dbUser.id },
      orderBy: { createdAt: 'asc' },
      select:  { id: true, name: true, handle: true },
    });
  } catch (err) {
    console.error('[auth/telegram] Channel fetch failed (non-fatal):', err);
    // Non-fatal: return empty channels rather than failing the whole auth
  }

  // ── Fetch saved BrandKit sections for all channels ────────────────────────
  // Returned as-is to the frontend. The frontend merges non-null sections over
  // createDefaultBrandKit() defaults so forms always receive shaped objects.
  let dbBrandKits: {
    channelId:    string;
    channelAbout: unknown;
    voiceProfile: unknown;
    linkKit:      unknown;
    visualKit:    unknown;
    signature:    unknown;
    postRules:    unknown;
  }[] = [];
  if (dbChannels.length > 0) {
    try {
      dbBrandKits = await prisma.brandKit.findMany({
        where:  { channelId: { in: dbChannels.map(ch => ch.id) } },
        select: {
          channelId:    true,
          channelAbout: true,
          voiceProfile: true,
          linkKit:      true,
          visualKit:    true,
          signature:    true,
          postRules:    true,
        },
      });
    } catch (err) {
      console.error('[auth/telegram] BrandKit fetch failed (non-fatal):', err);
      // Non-fatal: frontend falls back to shaped defaults for all sections
    }
  }

  // ── Upsert Subscription (create on first login, keep existing if present) ──
  let dbSubscription: {
    tier: string; aiPostsLimit: number; aiPostsUsed: number;
    aiCreatesLimit: number | null; aiCreatesUsed: number; expiresAt: Date | null;
  } | null = null;
  try {
    const existingSub = await prisma.subscription.findUnique({
      where:  { userId: dbUser.id },
      select: { tier: true, aiPostsLimit: true, aiPostsUsed: true, aiCreatesLimit: true, aiCreatesUsed: true, quotaResetAt: true, expiresAt: true },
    });
    if (existingSub) {
      // Lazily roll over monthly counters if the billing period elapsed.
      const fresh = await applyMonthlyQuotaReset({ userId: dbUser.id, ...existingSub });
      dbSubscription = { tier: existingSub.tier, expiresAt: existingSub.expiresAt, ...fresh };
    } else {
      const limits = TIER_LIMITS['STARTER'];
      const nextReset = new Date();
      nextReset.setMonth(nextReset.getMonth() + 1);
      dbSubscription = await prisma.subscription.create({
        data: {
          userId:         dbUser.id,
          tier:           'STARTER',
          aiPostsLimit:   limits.aiPostsLimit,
          aiPostsUsed:    0,
          aiCreatesLimit: limits.aiCreatesLimit,
          aiCreatesUsed:  0,
          quotaResetAt:   nextReset,
        },
        select: { tier: true, aiPostsLimit: true, aiPostsUsed: true, aiCreatesLimit: true, aiCreatesUsed: true, expiresAt: true },
      });
    }
  } catch (err) {
    console.error('[auth/telegram] Subscription upsert failed (non-fatal):', err);
  }

  // ── Response ──────────────────────────────────────────────────────────────
  res.json({
    user: {
      id:              dbUser.id,
      name:            dbUser.name,
      telegramId:      dbUser.telegramId,
      username:        tgUser.username ?? null,
      activeChannelId: dbUser.activeChannelId ?? null,
      isAdmin:         env.ADMIN_TELEGRAM_IDS.includes(telegramId),
    },
    channels: dbChannels.map((ch, i) => ({
      id:               ch.id,
      username:         ch.handle ?? '',
      title:            ch.name,
      subscribersCount: 0,
      isDefault:        i === 0,
      isConnected:      true,
    })),
    brandKits: dbBrandKits,
    subscription: dbSubscription ? {
      tier:           dbSubscription.tier,
      aiPostsLimit:   dbSubscription.aiPostsLimit,
      aiPostsUsed:    dbSubscription.aiPostsUsed,
      aiCreatesLimit: dbSubscription.aiCreatesLimit,
      aiCreatesUsed:  dbSubscription.aiCreatesUsed,
      expiresAt:      dbSubscription.expiresAt?.toISOString() ?? null,
    } : null,
  });
});

// ─── POST /api/auth/active-channel ───────────────────────────────────────────
// Persists the user's active channel selection to the DB so the bot webhook
// can use the same channel when generating drafts.
//
// Request body: { initData, channelId }
// Response 200: { ok: true }

router.post('/active-channel', async (req: Request, res: Response): Promise<void> => {
  const { initData, channelId } = req.body as { initData?: unknown; channelId?: unknown };

  if (typeof initData   !== 'string' || !initData.trim())   { res.status(400).json({ error: 'initData required' });   return; }
  if (typeof channelId  !== 'string' || !channelId.trim())  { res.status(400).json({ error: 'channelId required' });  return; }

  let parsed;
  try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch (err) { res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return; }

  const telegramId = String(parsed.user.id);
  const dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found' }); return; }

  // Verify the channel belongs to this user
  const channel = await prisma.channel.findUnique({
    where:  { id: channelId },
    select: { userId: true },
  }).catch(() => null);
  if (!channel || channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'Channel not found or access denied' }); return;
  }

  await prisma.user.update({ where: { id: dbUser.id }, data: { activeChannelId: channelId } });
  res.json({ ok: true });
});

export default router;
