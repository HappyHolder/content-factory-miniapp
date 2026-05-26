import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import type { PlanTier } from '@/types'

interface PlansScreenProps {
  onBack: () => void
}

interface PlanDef {
  tier: PlanTier
  name: string
  price: string
  priceDetail: string
  features: string[]
}

const PLANS: PlanDef[] = [
  {
    tier: 'free',
    name: 'Free',
    price: 'Free',
    priceDetail: 'forever',
    features: [
      '1 channel',
      '10 AI posts / month',
      'Basic Brand Kit',
      'Manual create only',
    ],
  },
  {
    tier: 'creator',
    name: 'Creator',
    price: '$12',
    priceDetail: '/ month',
    features: [
      '3 channels',
      '300 AI posts / month',
      'Brand Kit',
      'Emoji Pack',
      'Link Kit',
      'Scheduled posts',
    ],
  },
  {
    tier: 'studio_pro',
    name: 'Studio Pro',
    price: '$39',
    priceDetail: '/ month',
    features: [
      '10 channels',
      '1,500 AI posts / month',
      'Advanced Brand Kit',
      'Priority generation',
      'Analytics & team features',
    ],
  },
]

export function PlansScreen({ onBack }: PlansScreenProps) {
  const { state, showToast } = useApp()
  const currentTier = state.user.subscription.planTier

  return (
    <div>
      <PageHeader
        title="Plans"
        subtitle="Choose the plan that fits your channel workflow"
        onBack={onBack}
      />

      <div className="px-4 mt-2 space-y-3">
        {PLANS.map((plan, i) => {
          const isCurrent = plan.tier === currentTier
          const isUpgrade =
            (currentTier === 'free' && (plan.tier === 'creator' || plan.tier === 'studio_pro')) ||
            (currentTier === 'creator' && plan.tier === 'studio_pro')
          const isDowngrade = !isCurrent && !isUpgrade

          return (
            <motion.div
              key={plan.tier}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, duration: 0.25 }}
            >
              <div
                className={`rounded-[18px] border p-4 ${
                  isCurrent
                    ? 'bg-[#111114] border-[rgba(255,106,0,0.30)] shadow-[0_0_28px_rgba(255,106,0,0.07)]'
                    : 'bg-[rgba(255,255,255,0.03)] border-white/[0.07]'
                }`}
              >
                {/* Plan header */}
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h2 className="text-[17px] font-bold text-white">{plan.name}</h2>
                    {isCurrent && (
                      <span className="text-[10px] font-semibold text-[#FF6A00] bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.25)] px-2 py-px rounded-full">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-[22px] font-bold leading-none ${isCurrent ? 'text-[#FF6A00]' : 'text-white'}`}>
                      {plan.price}
                    </span>
                    <span className="text-[12px] text-[#55555D]">{plan.priceDetail}</span>
                  </div>
                </div>

                {/* Divider */}
                <div className={`h-px mb-3 ${isCurrent ? 'bg-[rgba(255,106,0,0.12)]' : 'bg-white/[0.06]'}`} />

                {/* Feature list */}
                <ul className="space-y-2 mb-4">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                        isCurrent
                          ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00]'
                          : 'bg-white/[0.06] text-[#55555D]'
                      }`}>
                        <Check size={9} strokeWidth={2.5} />
                      </div>
                      <span className="text-[13px] text-[#A1A1AA]">{f}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {isCurrent ? (
                  <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[12px] bg-[rgba(255,106,0,0.08)] border border-[rgba(255,106,0,0.20)] text-[13px] font-semibold text-[#FF6A00]">
                    <Check size={13} strokeWidth={2.5} />
                    Current plan
                  </div>
                ) : isUpgrade ? (
                  <Button
                    variant="primary"
                    size="md"
                    fullWidth
                    onClick={() => showToast(`Upgrade to ${plan.name} — coming soon`)}
                  >
                    Upgrade to {plan.name}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="md"
                    fullWidth
                    onClick={() => showToast(`Downgrade to ${plan.name} — coming soon`)}
                  >
                    {plan.tier === 'free' ? 'Start free' : `Switch to ${plan.name}`}
                  </Button>
                )}
              </div>
            </motion.div>
          )
        })}

        <div className="pb-2 text-center">
          <p className="text-[11px] text-[#44444C]">All plans include mock data · Payments not implemented</p>
        </div>
      </div>
    </div>
  )
}
