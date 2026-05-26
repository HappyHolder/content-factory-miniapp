import { motion } from 'framer-motion'
import {
  User, Bot, Globe, HelpCircle, ChevronRight, Check, Settings, CreditCard
} from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import type { Channel } from '@/types'

interface ProfileScreenProps {
  onOpenBrandKit: (channelId: string, channelUsername: string) => void
  onOpenPlans: () => void
}

export function ProfileScreen({ onOpenBrandKit, onOpenPlans }: ProfileScreenProps) {
  const { state, setActiveChannel, showToast } = useApp()
  const { user, channels, activeChannelId } = state
  const { subscription } = user

  const isPaidPlan = true // all plans are paid (no free tier)

  return (
    <div>
      <PageHeader title="Profile" />

      <div className="px-4 mt-2 space-y-2.5">

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
              {subscription.planName.toUpperCase()}
            </div>
          </GlassCard>
        </motion.div>

        {/* Current Plan card */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.22 }}>
          <GlassCard>
            <div className="mb-3">
              <div className="flex items-center gap-1.5 mb-1">
                <CreditCard size={13} className="text-[#FF6A00]" />
                <span className="text-[13px] font-semibold text-white">Current plan</span>
              </div>
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-[20px] font-bold text-white leading-none">
                  {subscription.planName}
                </p>
                <span className="text-[11px] font-semibold text-[#FF6A00] bg-[rgba(255,106,0,0.10)] border border-[rgba(255,106,0,0.22)] px-2 py-px rounded-full">
                  Active
                </span>
              </div>
              <p className="text-[12px] text-[#55555D]">
                {subscription.billingPeriod.charAt(0).toUpperCase() + subscription.billingPeriod.slice(1)}
                {' · '}Renews {subscription.renewsAt}
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={onOpenPlans} fullWidth>
              Manage plan
            </Button>
          </GlassCard>
        </motion.div>

        {/* Channels */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.22 }}>
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-xs font-semibold text-[#66666E] uppercase tracking-wide">Channels</p>
            <Button variant="ghost" size="sm" onClick={() => showToast('Add channel flow coming soon')}>
              + Add
            </Button>
          </div>
          <div className="space-y-2">
            {channels.map((ch, i) => (
              <ChannelCard
                key={ch.id}
                channel={ch}
                isActive={ch.id === activeChannelId}
                onSetDefault={() => setActiveChannel(ch.id)}
                onOpenBrandKit={() => onOpenBrandKit(ch.id, ch.username)}
                index={i}
              />
            ))}
          </div>
        </motion.div>

        {/* Settings list */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.22 }}>
          <GlassCard padding="none" className="overflow-hidden divide-y divide-white/6">
            {[
              { icon: Bot, label: 'Bot settings', sub: 'Configure Telegram bot' },
              { icon: Globe, label: 'Language', sub: 'English' },
              { icon: Settings, label: 'App settings', sub: 'Notifications, display' },
              { icon: HelpCircle, label: 'Support', sub: 'Help & feedback' },
            ].map(({ icon: Icon, label, sub }) => (
              <button
                key={label}
                onClick={() => showToast(`${label} — coming soon`)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
              >
                <div className="w-7 h-7 rounded-[8px] bg-white/[0.05] flex items-center justify-center">
                  <Icon size={13} className="text-[#66666E]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white">{label}</p>
                  <p className="text-[11px] text-[#55555D]">{sub}</p>
                </div>
                <ChevronRight size={13} className="text-[#44444C]" />
              </button>
            ))}
          </GlassCard>
        </motion.div>

        <div className="pb-2 text-center">
          <p className="text-[11px] text-[#66666E]">Content Factory v0.1.0 · MVP prototype</p>
        </div>
      </div>
    </div>
  )
}

function ChannelCard({ channel, isActive, onSetDefault, onOpenBrandKit, index }: {
  channel: Channel
  isActive: boolean
  onSetDefault: () => void
  onOpenBrandKit: () => void
  index: number
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
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold text-white">@{channel.username}</p>
              {channel.isDefault && (
                <span className="text-[10px] font-semibold text-[#FF6A00] bg-[rgba(255,106,0,0.10)] border border-[rgba(255,106,0,0.22)] px-1.5 py-px rounded-full">
                  Default
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#55555D]">{channel.subscribersCount.toLocaleString()} subscribers</p>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-[#66666E] bg-white/[0.04] border border-white/[0.07] px-2 py-px rounded-full">
            <div className="w-1 h-1 rounded-full bg-[#FF6A00]" />
            Connected
          </div>
        </div>

        <div className="flex gap-1.5">
          {!channel.isDefault && (
            <Button variant="ghost" size="sm" onClick={onSetDefault} className="flex-1">
              <Check size={11} /> Set default
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onOpenBrandKit} className="flex-1">
            Brand Kit →
          </Button>
        </div>
      </GlassCard>
    </motion.div>
  )
}
