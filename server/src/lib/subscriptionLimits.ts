import type { PlanTier } from '@prisma/client';
import { prisma } from '../db';

interface TierLimits {
  aiPostsLimit: number;
  aiCreatesLimit: number | null; // null = unlimited
  channelLimit: number;
  canSchedule: boolean;
}

export const TIER_LIMITS: Record<PlanTier, TierLimits> = {
  STARTER:    { aiPostsLimit: 30,  aiCreatesLimit: 20, channelLimit: 1,  canSchedule: false },
  CREATOR:    { aiPostsLimit: 150, aiCreatesLimit: 60, channelLimit: 3,  canSchedule: true  },
  STUDIO_PRO: { aiPostsLimit: 700, aiCreatesLimit: null, channelLimit: 10, canSchedule: true },
};

export function isCreatesLimitReached(used: number, limit: number | null): boolean {
  if (limit === null) return false; // unlimited
  return used >= limit;
}

export function isPostsLimitReached(used: number, limit: number): boolean {
  return used >= limit;
}

// ─── Monthly quota reset (lazy) ─────────────────────────────────────────────
// Called before reading/enforcing quota. If the billing period has rolled over
// (now >= quotaResetAt), zero the monthly counters and advance the anchor by one
// month. No cron needed — the reset happens on the next user action after the
// boundary. Returns the up-to-date counters so callers don't need a re-fetch.

export interface QuotaState {
  aiPostsLimit: number;
  aiPostsUsed: number;
  aiCreatesLimit: number | null;
  aiCreatesUsed: number;
}

function addOneMonth(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * Lazily resets a subscription's monthly usage counters if the period elapsed.
 * Safe to call on every quota check. Returns the effective (post-reset) counters.
 */
export async function applyMonthlyQuotaReset(sub: {
  userId: string;
  aiPostsLimit: number;
  aiPostsUsed: number;
  aiCreatesLimit: number | null;
  aiCreatesUsed: number;
  quotaResetAt: Date | null;
}): Promise<QuotaState> {
  const now = new Date();

  // First-ever check (legacy rows with null anchor): set the anchor, no reset.
  if (!sub.quotaResetAt) {
    await prisma.subscription.update({
      where: { userId: sub.userId },
      data:  { quotaResetAt: addOneMonth(now) },
    }).catch(() => {});
    return {
      aiPostsLimit: sub.aiPostsLimit, aiPostsUsed: sub.aiPostsUsed,
      aiCreatesLimit: sub.aiCreatesLimit, aiCreatesUsed: sub.aiCreatesUsed,
    };
  }

  if (now < sub.quotaResetAt) {
    // Period still active — counters unchanged.
    return {
      aiPostsLimit: sub.aiPostsLimit, aiPostsUsed: sub.aiPostsUsed,
      aiCreatesLimit: sub.aiCreatesLimit, aiCreatesUsed: sub.aiCreatesUsed,
    };
  }

  // Period rolled over — reset counters and advance the anchor.
  // Advance from the old anchor (not now) so missed periods don't drift the date.
  let nextReset = addOneMonth(sub.quotaResetAt);
  while (nextReset <= now) nextReset = addOneMonth(nextReset);

  await prisma.subscription.update({
    where: { userId: sub.userId },
    data:  { aiPostsUsed: 0, aiCreatesUsed: 0, quotaResetAt: nextReset },
  }).catch(() => {});

  return {
    aiPostsLimit: sub.aiPostsLimit, aiPostsUsed: 0,
    aiCreatesLimit: sub.aiCreatesLimit, aiCreatesUsed: 0,
  };
}

// ─── Tier expiry (lazy downgrade) ───────────────────────────────────────────
// A promo/paid grant sets expiresAt. When that passes, the user must fall back
// to STARTER. Done lazily on the next action — no cron. Returns the effective
// tier + limits after any downgrade.

export interface TierState {
  tier: PlanTier;
  aiPostsLimit: number;
  aiCreatesLimit: number | null;
  expiresAt: Date | null;
}

export async function applyTierExpiry(sub: {
  userId: string;
  tier: PlanTier;
  aiPostsLimit: number;
  aiCreatesLimit: number | null;
  expiresAt: Date | null;
}): Promise<TierState> {
  const now = new Date();
  const expired = sub.tier !== 'STARTER' && sub.expiresAt !== null && now >= sub.expiresAt;
  if (!expired) {
    return { tier: sub.tier, aiPostsLimit: sub.aiPostsLimit, aiCreatesLimit: sub.aiCreatesLimit, expiresAt: sub.expiresAt };
  }
  const l = TIER_LIMITS.STARTER;
  await prisma.subscription.update({
    where: { userId: sub.userId },
    data:  {
      tier: 'STARTER',
      aiPostsLimit:   l.aiPostsLimit,
      aiCreatesLimit: l.aiCreatesLimit,
      aiPostsUsed:    0,
      aiCreatesUsed:  0,
      expiresAt:      null,
    },
  }).catch(() => {});
  return { tier: 'STARTER', aiPostsLimit: l.aiPostsLimit, aiCreatesLimit: l.aiCreatesLimit, expiresAt: null };
}

// ─── Per-post regeneration caps ─────────────────────────────────────────────
// Flat across all tiers — these protect against hammering the neural API on a
// single post, not a plan value lever. Tracked per-post in GeneratedPost
// (textRegensUsed / imageRegensUsed).
export const MAX_TEXT_REGENS_PER_POST = 3;
export const MAX_IMAGE_REGENS_PER_POST = 3;
