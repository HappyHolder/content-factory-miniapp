import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { TIER_LIMITS } from '../lib/subscriptionLimits';
import type { PlanTier } from '@prisma/client';

const router = Router();

// ─── Simple in-memory rate limiter ──────────────────────────────────────────
// Per-user attempt cap to slow promo-code brute forcing. In-memory only:
// resets on restart and is per-instance, which is acceptable for this MVP
// (a real deployment behind multiple instances would move this to Redis).
const RL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RL_MAX_ATTEMPTS = 6;           // attempts per window per user
const attempts = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(userId) ?? []).filter(t => now - t < RL_WINDOW_MS);
  recent.push(now);
  attempts.set(userId, recent);
  return recent.length > RL_MAX_ATTEMPTS;
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

function addOneMonth(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

// ─── POST /api/promo/redeem ───────────────────────────────────────────────────
// Redeems a single-use promo code and grants its tier to the caller.
//
// Request body: { initData, code }
// Response 200: { subscription: { tier, aiPostsLimit, aiPostsUsed, aiCreatesLimit, aiCreatesUsed, expiresAt } }
// Response 400: missing fields / invalid or already-used code
// Response 401: invalid initData / user not found
// Response 429: too many attempts

router.post('/redeem', async (req: Request, res: Response): Promise<void> => {
  const { initData, code } = req.body as { initData?: unknown; code?: unknown };

  // ── 1. Validate input ─────────────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' }); return;
  }
  if (typeof code !== 'string' || !code.trim()) {
    res.status(400).json({ error: 'Введите промокод' }); return;
  }

  // ── 2. Authenticate ───────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return;
  }
  const telegramId = String(parsed.user.id);
  const dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } }).catch(() => null);
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' }); return;
  }

  // ── 3. Rate limit (per user) ──────────────────────────────────────────────
  if (rateLimited(dbUser.id)) {
    res.status(429).json({ error: 'Слишком много попыток. Подождите немного и попробуйте снова.' });
    return;
  }

  // Normalize: codes are stored uppercased, matched case-insensitively.
  const normalized = code.trim().toUpperCase();

  // ── 4. Atomic burn + grant in a transaction ──────────────────────────────
  // The conditional updateMany (WHERE redeemedAt IS NULL) is a single SQL
  // UPDATE — only one concurrent request can flip it, preventing double-redeem.
  const now = new Date();
  let granted: { tier: PlanTier; aiPostsLimit: number; aiPostsUsed: number; aiCreatesLimit: number | null; aiCreatesUsed: number; expiresAt: Date | null } | null = null;

  try {
    granted = await prisma.$transaction(async (tx) => {
      const burn = await tx.promoCode.updateMany({
        where: { code: normalized, redeemedAt: null },
        data:  { redeemedAt: now, redeemedById: dbUser.id },
      });
      if (burn.count === 0) {
        // Either nonexistent or already used — generic message (no enumeration).
        throw new Error('INVALID_CODE');
      }

      const promo = await tx.promoCode.findUnique({
        where:  { code: normalized },
        select: { tier: true, durationDays: true },
      });
      if (!promo) throw new Error('INVALID_CODE'); // unreachable, defensive

      const limits    = TIER_LIMITS[promo.tier];
      const expiresAt = addDays(now, promo.durationDays);

      const sub = await tx.subscription.upsert({
        where:  { userId: dbUser.id },
        update: {
          tier:           promo.tier,
          aiPostsLimit:   limits.aiPostsLimit,
          aiCreatesLimit: limits.aiCreatesLimit,
          aiPostsUsed:    0,
          aiCreatesUsed:  0,
          quotaResetAt:   addOneMonth(now),
          expiresAt,
        },
        create: {
          userId:         dbUser.id,
          tier:           promo.tier,
          aiPostsLimit:   limits.aiPostsLimit,
          aiCreatesLimit: limits.aiCreatesLimit,
          aiPostsUsed:    0,
          aiCreatesUsed:  0,
          quotaResetAt:   addOneMonth(now),
          expiresAt,
        },
        select: { tier: true, aiPostsLimit: true, aiPostsUsed: true, aiCreatesLimit: true, aiCreatesUsed: true, expiresAt: true },
      });
      return sub;
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_CODE') {
      res.status(400).json({ error: 'Промокод недействителен или уже использован.', code: 'INVALID_CODE' });
      return;
    }
    console.error('[promo/redeem] DB error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  res.json({
    subscription: {
      tier:           granted!.tier,
      aiPostsLimit:   granted!.aiPostsLimit,
      aiPostsUsed:    granted!.aiPostsUsed,
      aiCreatesLimit: granted!.aiCreatesLimit,
      aiCreatesUsed:  granted!.aiCreatesUsed,
      expiresAt:      granted!.expiresAt?.toISOString() ?? null,
    },
  });
});

export default router;
