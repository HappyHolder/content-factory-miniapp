import type { PlanTier } from '@/types'

// Public receiving wallet (safe to ship in the client). Must match the backend
// TON_RECEIVING_WALLET that verification checks against.
export const TON_RECEIVING_WALLET = 'UQCP9v_ALOuDm-EkXSoWHqvvER9Il4-yKiZOzc1Fd732VfHZ'

// Per-plan prices (display + transaction amount). Must match server PLAN_PRICING.
export const PLAN_PRICING: Record<Exclude<PlanTier, 'free'>, { stars: number; ton: number }> = {
  starter:    { stars: 1,    ton: 0.1 },  // TEMP: lowered for live payment testing
  creator:    { stars: 1100, ton: 7  },
  studio_pro: { stars: 7000, ton: 50 },
}

/** Maps the frontend planTier ('studio_pro') to the server enum ('STUDIO_PRO'). */
export function tierToServer(tier: PlanTier): string {
  return tier.toUpperCase()
}

/** TON → nano-TON string for sendTransaction. */
export function tonToNano(ton: number): string {
  return BigInt(Math.round(ton * 1e9)).toString()
}
