import type { PlanTier } from '@/types'

// Public receiving wallet (safe to ship in the client). Must match the backend
// TON_RECEIVING_WALLET that verification checks against.
export const TON_RECEIVING_WALLET = 'UQCP9v_ALOuDm-EkXSoWHqvvER9Il4-yKiZOzc1Fd732VfHZ'

// Per-plan prices (display + transaction amount). Must match server PLAN_PRICING.
// `ton` is the on-chain TON amount sent (the UI labels it "Gram").
export const PLAN_PRICING: Record<Exclude<PlanTier, 'free'>, { stars: number; ton: number }> = {
  starter:    { stars: 650,   ton: 5  },  // Blogger
  creator:    { stars: 1800,  ton: 15 },  // Business
  studio_pro: { stars: 10000, ton: 80 },  // Agency
}

/** Maps the frontend planTier ('studio_pro') to the server enum ('STUDIO_PRO'). */
export function tierToServer(tier: PlanTier): string {
  return tier.toUpperCase()
}

/** TON → nano-TON string for sendTransaction. */
export function tonToNano(ton: number): string {
  return BigInt(Math.round(ton * 1e9)).toString()
}
