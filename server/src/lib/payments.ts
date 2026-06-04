import type { PlanTier } from '@prisma/client';
import { prisma } from '../db';
import { TIER_LIMITS } from './subscriptionLimits';

// ─── Pricing ────────────────────────────────────────────────────────────────
// Per-plan price in Telegram Stars (XTR, integer) and TON.
// FREE is not purchasable.
export interface PlanPrice { stars: number; ton: number; }

export const PLAN_PRICING: Record<Exclude<PlanTier, 'FREE'>, PlanPrice> = {
  STARTER:    { stars: 350,  ton: 3  },
  CREATOR:    { stars: 1100, ton: 7  },
  STUDIO_PRO: { stars: 7000, ton: 50 },
};

// Paid plans grant access for this many days.
export const GRANT_DURATION_DAYS = 30;

export type PaidTier = Exclude<PlanTier, 'FREE'>;

export function isPaidTier(t: unknown): t is PaidTier {
  return t === 'STARTER' || t === 'CREATOR' || t === 'STUDIO_PRO';
}

// ─── Grant ──────────────────────────────────────────────────────────────────
// Shared by Stars, TON (and conceptually promo): upsert the subscription to the
// purchased tier, reset usage counters, set the monthly anchor and expiry.

interface GrantedSub {
  tier: PlanTier;
  aiPostsLimit: number;
  aiPostsUsed: number;
  aiCreatesLimit: number | null;
  aiCreatesUsed: number;
  expiresAt: Date | null;
}

export async function grantSubscription(userId: string, tier: PaidTier, durationDays = GRANT_DURATION_DAYS): Promise<GrantedSub> {
  const limits = TIER_LIMITS[tier];
  const now = new Date();
  const expiresAt = new Date(now);    expiresAt.setDate(expiresAt.getDate() + durationDays);
  const quotaResetAt = new Date(now); quotaResetAt.setMonth(quotaResetAt.getMonth() + 1);

  const common = {
    tier,
    aiPostsLimit:   limits.aiPostsLimit,
    aiCreatesLimit: limits.aiCreatesLimit,
    aiPostsUsed:    0,
    aiCreatesUsed:  0,
    quotaResetAt,
    expiresAt,
  };

  return prisma.subscription.upsert({
    where:  { userId },
    update: common,
    create: { userId, ...common },
    select: { tier: true, aiPostsLimit: true, aiPostsUsed: true, aiCreatesLimit: true, aiCreatesUsed: true, expiresAt: true },
  });
}

/** Maps a granted subscription to the frontend response shape. */
export function serializeSub(sub: GrantedSub) {
  return {
    tier:           sub.tier,
    aiPostsLimit:   sub.aiPostsLimit,
    aiPostsUsed:    sub.aiPostsUsed,
    aiCreatesLimit: sub.aiCreatesLimit,
    aiCreatesUsed:  sub.aiCreatesUsed,
    expiresAt:      sub.expiresAt?.toISOString() ?? null,
  };
}
