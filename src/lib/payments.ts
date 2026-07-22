import type { PlanTier } from '@/types'

// Public receiving wallet (safe to ship in the client). Must match the backend
// TON_RECEIVING_WALLET that verification checks against.
export const TON_RECEIVING_WALLET = 'UQCP9v_ALOuDm-EkXSoWHqvvER9Il4-yKiZOzc1Fd732VfHZ'

// Per-plan prices (display + transaction amount). Must match server PLAN_PRICING.
// `ton` is the on-chain TON amount sent (the UI labels it "Gram").
export const PLAN_PRICING: Record<Exclude<PlanTier, 'free'>, { usd: number; stars: number; ton: number }> = {
  starter:    { usd: 30,  stars: 2_310,  ton: 20  }, // Blogger
  creator:    { usd: 60,  stars: 4_620,  ton: 40  }, // Business
  studio_pro: { usd: 250, stars: 19_240, ton: 167 }, // Agency
}


/** Maps the frontend planTier ('studio_pro') to the server enum ('STUDIO_PRO'). */
export function tierToServer(tier: PlanTier): string {
  return tier.toUpperCase()
}

/** TON → nano-TON string for sendTransaction. */
export function tonToNano(ton: number): string {
  return BigInt(Math.round(ton * 1e9)).toString()
}
