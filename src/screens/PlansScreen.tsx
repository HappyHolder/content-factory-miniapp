import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Ticket, Loader2 } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import type { PlanTier } from '@/types'
import type { TranslationKey } from '@/i18n'

interface PlansScreenProps {
  onBack: () => void
}

// Tier order for upgrade/downgrade detection
const TIER_RANK: Record<PlanTier, number> = { free: 0, starter: 1, creator: 2, studio_pro: 3 }

// Static per-plan config — keys resolved via t() inside the component
interface PlanConfig {
  tier: PlanTier
  price: string
  nameKey: TranslationKey
  featureKeys: TranslationKey[]
  upgradeKey: TranslationKey | null   // null = lowest tier, can never upgrade to it
  downgradeKey: TranslationKey | null // null = highest tier, can never downgrade to it
}

const PLAN_CONFIG: PlanConfig[] = [
  {
    tier: 'free',
    price: '$0',
    nameKey: 'plans.free',
    featureKeys: ['plans.posts5', 'plans.creates5', 'plans.channel1', 'plans.noAiAssistant'],
    upgradeKey: null,
    downgradeKey: 'plans.switchToFree',
  },
  {
    tier: 'starter',
    price: '$5',
    nameKey: 'plans.starter',
    featureKeys: ['plans.posts30', 'plans.creates20', 'plans.channel1', 'plans.aiAssistant'],
    upgradeKey: 'plans.upgradeToStarter',
    downgradeKey: 'plans.switchToStarter',
  },
  {
    tier: 'creator',
    price: '$20',
    nameKey: 'plans.creator',
    featureKeys: ['plans.posts150', 'plans.creates60', 'plans.channels3', 'plans.scheduledPosts', 'plans.aiAssistant', 'plans.storiesPostingSoon'],
    upgradeKey: 'plans.upgradeToCreator',
    downgradeKey: 'plans.switchToCreator',
  },
  {
    tier: 'studio_pro',
    price: '$70',
    nameKey: 'plans.studioPro',
    featureKeys: ['plans.posts700', 'plans.createsUnlimited', 'plans.channels10', 'plans.scheduledPosts', 'plans.aiAssistant', 'plans.storiesPostingSoon', 'plans.postPromotionSoon', 'plans.videoGenerationSoon', 'plans.chatActivityBot'],
    upgradeKey: 'plans.upgradeToPro',
    downgradeKey: null,
  },
]

export function PlansScreen({ onBack }: PlansScreenProps) {
  const { state, showToast, t, applyServerSubscription } = useApp()
  const currentTier = state.user.subscription.planTier

  const [promo, setPromo] = useState('')
  const [redeeming, setRedeeming] = useState(false)

  const handleRedeem = async () => {
    const code = promo.trim()
    if (!code || redeeming) return
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }

    setRedeeming(true)
    try {
      const res = await fetch(`${API_BASE}/api/promo/redeem`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, code }),
      })
      const data = await res.json().catch(() => ({})) as {
        subscription?: { tier: string; aiPostsLimit: number; aiPostsUsed: number; aiCreatesLimit: number | null; aiCreatesUsed: number }
        error?: string
      }
      if (!res.ok || !data.subscription) {
        showToast(data.error ?? 'Не удалось применить промокод', 'error')
        return
      }
      applyServerSubscription(data.subscription)
      setPromo('')
      showToast('Промокод применён! Тариф обновлён.')
    } catch {
      showToast('Ошибка соединения', 'error')
    } finally {
      setRedeeming(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('plans.title')}
        subtitle={t('plans.subtitle')}
        onBack={onBack}
      />

      <div className="px-4 mt-2 space-y-3">
        {/* Promo code */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="rounded-[18px] border border-white/[0.07] bg-[rgba(255,255,255,0.03)] p-3"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Ticket size={13} className="text-[#FF6A00]" />
            <span className="text-[12px] font-semibold text-white">{t('plans.havePromo')}</span>
          </div>
          <div className="flex gap-2">
            <input
              value={promo}
              onChange={e => setPromo(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') handleRedeem() }}
              placeholder="CF-XXXX-XXXX"
              className="glass-input flex-1 px-3 py-2.5 text-sm tracking-wider"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            />
            <Button variant="primary" size="md" onClick={handleRedeem} disabled={redeeming || !promo.trim()}>
              {redeeming ? <Loader2 size={15} className="animate-spin" /> : t('plans.applyPromo')}
            </Button>
          </div>
        </motion.div>

        {PLAN_CONFIG.map((plan, i) => {
          const isCurrent  = plan.tier === currentTier
          const isUpgrade  = !isCurrent && TIER_RANK[plan.tier] > TIER_RANK[currentTier]

          const planName = t(plan.nameKey)
          const priceDetail = t('plans.month')

          // Resolve CTA label
          const ctaKey = isUpgrade ? plan.upgradeKey : plan.downgradeKey
          const ctaLabel = ctaKey ? t(ctaKey) : ''

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
                    <h2 className="text-[17px] font-bold text-white">{planName}</h2>
                    {plan.tier === 'studio_pro' && !isCurrent && (
                      <span className="text-[10px] font-semibold text-[#A1A1AA] bg-white/[0.07] border border-white/[0.10] px-2 py-px rounded-full">
                        Soon
                      </span>
                    )}
                    {isCurrent && (
                      <span className="text-[10px] font-semibold text-[#FF6A00] bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.25)] px-2 py-px rounded-full">
                        {t('plans.active')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-[22px] font-bold leading-none ${isCurrent ? 'text-[#FF6A00]' : 'text-white'}`}>
                      {plan.price}
                    </span>
                    <span className="text-[12px] text-[#55555D]">{priceDetail}</span>
                  </div>
                </div>

                {/* Divider */}
                <div className={`h-px mb-3 ${isCurrent ? 'bg-[rgba(255,106,0,0.12)]' : 'bg-white/[0.06]'}`} />

                {/* Feature list */}
                <ul className="space-y-2 mb-4">
                  {plan.featureKeys.map(key => (
                    <li key={key} className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                        isCurrent
                          ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00]'
                          : 'bg-white/[0.06] text-[#55555D]'
                      }`}>
                        <Check size={9} strokeWidth={2.5} />
                      </div>
                      <span className="text-[13px] text-[#A1A1AA]">{t(key)}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {isCurrent ? (
                  <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[12px] bg-[rgba(255,106,0,0.08)] border border-[rgba(255,106,0,0.20)] text-[13px] font-semibold text-[#FF6A00]">
                    <Check size={13} strokeWidth={2.5} />
                    {t('plans.currentPlan')}
                  </div>
                ) : isUpgrade ? (
                  <Button
                    variant="primary"
                    size="md"
                    fullWidth
                    onClick={() => showToast(`${planName} — coming soon`)}
                  >
                    {ctaLabel}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="md"
                    fullWidth
                    onClick={() => showToast(`${planName} — coming soon`)}
                  >
                    {ctaLabel}
                  </Button>
                )}
              </div>
            </motion.div>
          )
        })}

        <div className="pb-2 text-center">
          <p className="text-[11px] text-[#44444C]">{t('plans.footer')}</p>
        </div>
      </div>
    </div>
  )
}
