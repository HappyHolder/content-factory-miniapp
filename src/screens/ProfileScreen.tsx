import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Globe, HelpCircle, ChevronRight, Check, Settings, CreditCard, Radio, Ticket, Trash2
} from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import { channelLabel } from '@/lib/utils'
import { useWalkthrough } from '@/context/WalkthroughContext'
import { Coachmark, HighlightRing } from '@/components/onboarding/Coachmark'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { ConnectChannelSheet } from '@/components/profile/ConnectChannelSheet'
import type { TranslationKey } from '@/i18n'
import type { Channel, PlanTier } from '@/types'

// Map planTier to translation key for plan names
const PLAN_NAME_KEY: Record<PlanTier, 'plans.free' | 'plans.starter' | 'plans.creator' | 'plans.studioPro'> = {
  free:       'plans.free',
  starter:    'plans.starter',
  creator:    'plans.creator',
  studio_pro: 'plans.studioPro',
}

interface ProfileScreenProps {
  onOpenBrandKit: (channelId: string, channelUsername: string) => void
  onOpenCommunity: (channelId: string, channelUsername: string) => void
  onOpenPlans: () => void
  onOpenAdmin: () => void
}

export function ProfileScreen({ onOpenBrandKit, onOpenCommunity, onOpenPlans, onOpenAdmin }: ProfileScreenProps) {
  const { state, setActiveChannel, disconnectChannel, showToast, language, setLanguage, t, authStatus } = useApp()
  const { step: wtStep } = useWalkthrough()
  const { user, channels, activeChannelId } = state
  const { subscription } = user

  const isPaidPlan = subscription.planTier !== 'free'
  const [langSheetOpen,    setLangSheetOpen]    = useState(false)
  const [connectSheetOpen, setConnectSheetOpen] = useState(false)
  const [settingsOpen,     setSettingsOpen]     = useState(false)

  const langLabel = language === 'ru' ? t('language.russian') : t('language.english')
  const planNameKey = PLAN_NAME_KEY[subscription.planTier]

  // Billing period display
  const billingLabel = t('profile.monthly')
  const expiryLabel = subscription.expiresAt ? new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(subscription.expiresAt)) : null

  // Disconnect a channel: delete it on the server (cascades posts / style / plans)
  // then trim it from local state. Confirmed first — this is irreversible.
  const handleDisconnect = async (channelId: string) => {
    if (!window.confirm(t('profile.disconnectConfirm'))) return

    if (authStatus === 'authenticated') {
      const initData = getTelegramInitData()
      if (!initData) return
      try {
        const res = await fetch(`${API_BASE}/api/channels/disconnect`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ initData, channelId }),
        })
        if (!res.ok) { showToast(t('profile.disconnectFailed'), 'error'); return }
      } catch {
        showToast(t('profile.disconnectFailed'), 'error')
        return
      }
    }

    disconnectChannel(channelId)
    showToast(t('profile.disconnectSuccess'))
  }

  return (
    <div>
      <div className="flex justify-end px-4 pt-3 pb-1">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setSettingsOpen(true)}
          aria-label={t('profile.appSettings')}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-[#8A8A93] transition-colors duration-200 hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]"
        >
          <Settings size={17} />
        </motion.button>
      </div>

      <div className="px-4 space-y-2.5">

        {/* Account card */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          <GlassCard strong className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[rgba(255,106,0,0.25)] to-[rgba(255,106,0,0.06)] border border-[rgba(255,106,0,0.20)] flex items-center justify-center text-base font-bold text-[#FF6A00]">
              {user.name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-white">{user.name}</p>
              <p className="text-[12px] text-[#55555D]">@{user.username}</p>
            </div>
            <div className={`px-2 py-px rounded-full text-[11px] font-semibold ${
              isPaidPlan
                ? 'bg-[rgba(255,106,0,0.11)] text-[#FF6A00] border border-[rgba(255,106,0,0.22)]'
                : 'bg-white/[0.05] text-[#66666E] border border-white/[0.07]'
            }`}>
              {t(planNameKey).toUpperCase()}
            </div>
          </GlassCard>
        </motion.div>

        {/* Current Plan card */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.22 }}>
          <GlassCard>
            <div className="mb-3">
              <div className="flex items-center gap-1.5 mb-1">
                <CreditCard size={13} className="text-[#FF6A00]" />
                <span className="text-[13px] font-semibold text-white">{t('profile.currentPlan')}</span>
              </div>
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-[20px] font-bold text-white leading-none">
                  {t(planNameKey)}
                </p>
                <span className="text-[11px] font-semibold text-[#FF6A00] bg-[rgba(255,106,0,0.10)] border border-[rgba(255,106,0,0.22)] px-2 py-px rounded-full">
                  {t('profile.active')}
                </span>
              </div>
              <p className="text-[12px] text-[#55555D]">
                {billingLabel}{expiryLabel ? ` · действует до ${expiryLabel}` : ' · без оплаты'}
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={onOpenPlans} fullWidth>
              {t('profile.managePlan')}
            </Button>
          </GlassCard>
        </motion.div>

        {/* Channels */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.22 }}>
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-xs font-semibold text-[#66666E] uppercase tracking-wide">{t('profile.channels')}</p>
            <Button variant="ghost" size="sm" onClick={() => setConnectSheetOpen(true)}>
              {t('profile.add')}
            </Button>
          </div>
          {wtStep === 'style' && channels.length > 0 && (
            <div className="mb-2.5">
              <Coachmark
                stepLabel={t('onboarding.step2')}
                title={t('onboarding.styleTitle')}
                text={t('onboarding.styleText')}
              />
            </div>
          )}
          <div className="space-y-2">
            {channels.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-2.5"
              >
                {wtStep === 'connect' && (
                  <Coachmark
                    stepLabel={t('onboarding.step1')}
                    title={t('onboarding.connectTitle')}
                    text={t('onboarding.connectText')}
                  />
                )}
                <HighlightRing active={wtStep === 'connect'}>
                  <GlassCard className="flex flex-col items-center text-center gap-3 py-5">
                    <div className="w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
                      <Radio size={18} className="text-[#44444C]" />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-white mb-0.5">{t('profile.noChannels')}</p>
                      <p className="text-[11px] text-[#55555D] leading-relaxed">{t('profile.noChannelsSub')}</p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => setConnectSheetOpen(true)}>
                      {t('profile.noChannelsAction')}
                    </Button>
                  </GlassCard>
                </HighlightRing>
              </motion.div>
            ) : (
              channels.map((ch, i) => (
                <ChannelCard
                  key={ch.id}
                  channel={ch}
                  isActive={ch.id === activeChannelId}
                  onSetDefault={() => setActiveChannel(ch.id)}
                  onOpenBrandKit={() => onOpenBrandKit(ch.id, channelLabel(ch))}
                  onOpenCommunity={() => onOpenCommunity(ch.id, channelLabel(ch))}
                  onDisconnect={() => handleDisconnect(ch.id)}
                  highlightStyle={wtStep === 'style' && i === 0}
                  index={i}
                  t={t}
                />
              ))
            )}
          </div>
        </motion.div>

        <div className="pb-2 text-center">
          <p className="text-[11px] text-[#66666E]">Publium v0.1.0</p>
        </div>
      </div>

      {/* Connect channel sheet */}
      <ConnectChannelSheet
        open={connectSheetOpen}
        onClose={() => setConnectSheetOpen(false)}
      />

      <Sheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={t('profile.appSettings')}
      >
        <div className="overflow-hidden rounded-[16px] border border-white/[0.07] bg-white/[0.025] divide-y divide-white/[0.06]">
          {user.isAdmin && (
            <SettingsRow
              icon={Ticket}
              title={t('admin.panelTitle')}
              subtitle={t('admin.panelSubtitle')}
              accent
              onClick={() => { setSettingsOpen(false); onOpenAdmin() }}
            />
          )}
          <SettingsRow
            icon={Globe}
            title={t('profile.language')}
            subtitle={langLabel}
            onClick={() => { setSettingsOpen(false); setLangSheetOpen(true) }}
          />
          <SettingsRow
            icon={HelpCircle}
            title={t('profile.support')}
            subtitle={t('profile.supportSubtitle')}
            onClick={() => showToast(t('profile.support') + ' — coming soon')}
          />
        </div>
      </Sheet>

      {/* Language picker sheet */}
      <Sheet
        open={langSheetOpen}
        onClose={() => setLangSheetOpen(false)}
        title={t('profile.language')}
      >
        <div className="space-y-2 pt-1">
          {(['ru', 'en'] as const).map(lang => {
            const isActive = language === lang
            const label = lang === 'ru' ? t('language.russian') : t('language.english')
            return (
              <button
                key={lang}
                onClick={() => { setLanguage(lang); setLangSheetOpen(false) }}
                className={`w-full flex items-center justify-between px-4 py-3.5 rounded-[14px] transition-colors ${
                  isActive
                    ? 'bg-[rgba(255,106,0,0.10)] border border-[rgba(255,106,0,0.22)]'
                    : 'bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07]'
                }`}
              >
                <span className={`text-[14px] font-medium ${isActive ? 'text-white' : 'text-[#A1A1AA]'}`}>
                  {label}
                </span>
                {isActive && <Check size={15} className="text-[#FF6A00]" />}
              </button>
            )
          })}
        </div>
      </Sheet>
    </div>
  )
}

function ChannelCard({ channel, isActive, onSetDefault, onOpenBrandKit, onOpenCommunity, onDisconnect, highlightStyle, index, t }: {
  channel: Channel
  isActive: boolean
  onSetDefault: () => void
  onOpenBrandKit: () => void
  onOpenCommunity: () => void
  onDisconnect: () => void
  highlightStyle?: boolean
  index: number
  t: (key: TranslationKey) => string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.2 }}
    >
      <GlassCard className={isActive ? 'border-[rgba(255,106,0,0.22)]' : ''}>
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="w-9 h-9 rounded-full bg-[rgba(255,106,0,0.11)] flex items-center justify-center text-sm font-bold text-[#FF6A00] border border-[rgba(255,106,0,0.18)]">
            {channel.title[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-white">{channelLabel(channel)}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-[11px] text-[#55555D]">{channel.subscribersCount.toLocaleString()} {t('profile.connected')}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              aria-label={`${t('profile.makeActive')}: ${channelLabel(channel)}`}
              onClick={() => { if (!isActive) onSetDefault() }}
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]"
            >
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${isActive ? 'bg-[#FF6A00]' : 'bg-[#343439]'}`}>
                <span className={`absolute left-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200 ${isActive ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              aria-label={`${t('profile.disconnect')}: ${channelLabel(channel)}`}
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-[#62626A] transition-colors duration-200 hover:bg-red-500/[0.08] hover:text-[#FF5C67] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5C67]"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <HighlightRing active={!!highlightStyle}>
            <Button variant="secondary" size="sm" onClick={onOpenBrandKit} fullWidth>
              {t('profile.channelStyle')}
            </Button>
          </HighlightRing>
          <Button variant="secondary" size="sm" onClick={onOpenCommunity} fullWidth>
            Сообщество
          </Button>
        </div>
      </GlassCard>
    </motion.div>
  )
}


function SettingsRow({ icon: Icon, title, subtitle, onClick, accent = false }: {
  icon: React.ElementType
  title: string
  subtitle: string
  onClick: () => void
  accent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FF6A00]"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${accent ? 'bg-[rgba(255,106,0,0.12)] text-[#FF6A00]' : 'bg-white/[0.05] text-[#777780]'}`}>
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-white">{title}</span>
        <span className="mt-0.5 block text-[11px] text-[#62626A]">{subtitle}</span>
      </span>
      <ChevronRight size={14} className="text-[#45454D]" />
    </button>
  )
}
