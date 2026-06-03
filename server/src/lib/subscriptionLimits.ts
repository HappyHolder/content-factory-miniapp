import type { PlanTier } from '@prisma/client';

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
