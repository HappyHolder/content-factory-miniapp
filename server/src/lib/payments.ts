import type { PlanTier } from '@prisma/client';
import { prisma } from '../db';
import { limitsFor, type ModelTier } from './subscriptionLimits';

// ─── Pricing ────────────────────────────────────────────────────────────────
// Per-plan price in Telegram Stars (XTR, integer) and TON.
// FREE is not purchasable.
export interface PlanPrice { stars: number; ton: number; }

export const PLAN_PRICING: Record<Exclude<PlanTier, 'FREE'>, PlanPrice> = {
  STARTER:    { stars: 650,   ton: 5  },  // Blogger
  CREATOR:    { stars: 1800,  ton: 15 },  // Business
  STUDIO_PRO: { stars: 10000, ton: 80 },  // Agency
};

// HIGH (Premium) variant pricing — must match the frontend src/lib/payments.ts.
export const PLAN_PRICING_HIGH: Record<Exclude<PlanTier, 'FREE'>, PlanPrice> = {
  STARTER:    { stars: 900,   ton: 7   },  // Blogger Premium
  CREATOR:    { stars: 2500,  ton: 20  },  // Business Premium
  STUDIO_PRO: { stars: 13000, ton: 105 },  // Agency Premium
};

/** Price for a (tier, modelTier) pair. HIGH → premium pricing, LOW → base. */
export function pricingFor(tier: Exclude<PlanTier, 'FREE'>, modelTier: ModelTier): PlanPrice {
  return modelTier === 'HIGH' ? PLAN_PRICING_HIGH[tier] : PLAN_PRICING[tier];
}

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
  modelTier: 'LOW' | 'HIGH';
  aiPostsLimit: number;
  aiPostsUsed: number;
  aiCreatesLimit: number | null;
  aiCreatesUsed: number;
  expiresAt: Date | null;
}

export async function grantSubscription(
  userId: string,
  tier: PaidTier,
  modelTier: ModelTier = 'LOW',
  durationDays = GRANT_DURATION_DAYS,
): Promise<GrantedSub> {
  const limits = limitsFor(tier, modelTier);
  const now = new Date();
  const expiresAt = new Date(now);    expiresAt.setDate(expiresAt.getDate() + durationDays);
  const quotaResetAt = new Date(now); quotaResetAt.setMonth(quotaResetAt.getMonth() + 1);

  const common = {
    tier,
    modelTier,
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
    select: { tier: true, modelTier: true, aiPostsLimit: true, aiPostsUsed: true, aiCreatesLimit: true, aiCreatesUsed: true, expiresAt: true },
  });
}

/** Maps a granted subscription to the frontend response shape. */
export function serializeSub(sub: GrantedSub) {
  return {
    tier:           sub.tier,
    modelTier:      sub.modelTier,
    aiPostsLimit:   sub.aiPostsLimit,
    aiPostsUsed:    sub.aiPostsUsed,
    aiCreatesLimit: sub.aiCreatesLimit,
    aiCreatesUsed:  sub.aiCreatesUsed,
    expiresAt:      sub.expiresAt?.toISOString() ?? null,
  };
}
