import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Globe, HelpCircle, ChevronRight, Check, Settings, CreditCard, Radio, Ticket, Trash2, MoreVertical, Users
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
import { ConnectChatSheet } from '@/components/profile/ConnectChatSheet'
import type { TranslationKey } from '@/i18n'
import type { Channel, Chat, PlanTier } from '@/types'

// Map planTier to translation key for plan names
const PLAN_NAME_KEY: Record<PlanTier, 'plans.free' | 'plans.starter' | 'plans.creator' | 'plans.studioPro'> = {
  free:       'plans.free',
  starter:    'plans.starter',
  creator:    'plans.creator',
  studio_pro: 'plans.studioPro',
}

interface ProfileScreenProps {
  onOpenBrandKit: (channelId: string, channelUsername: string) => void
  onOpenChatStyle: (chatId: string, chatTitle: string) => void
  onOpenCommunity: (chatId: string, chatTitle: string) => void
  onOpenPlans: () => void
  onOpenAdmin: () => void
}

export function ProfileScreen({ onOpenBrandKit, onOpenChatStyle, onOpenCommunity, onOpenPlans, onOpenAdmin }: ProfileScreenProps) {
  const { state, setActiveChannel, connectChat, disconnectChannel, disconnectChat, setChatLinkedChannel, showToast, language, setLanguage, t, authStatus } = useApp()
  const { step: wtStep } = useWalkthrough()
  const { user, channels, chats, activeChannelId } = state
  const { subscription } = user

  const isPaidPlan = subscription.planTier !== 'free'
  const [langSheetOpen,    setLangSheetOpen]    = useState(false)
  const [connectSheetOpen, setConnectSheetOpen] = useState(false)
  const [connectChatOpen,  setConnectChatOpen]  = useState(false)
  const [settingsOpen,     setSettingsOpen]     = useState(false)
  const [entityTab, setEntityTab] = useState<'channels' | 'chats'>(() => { try { return localStorage.getItem('profileEntityTab') === 'chats' ? 'chats' : 'channels' } catch { return 'channels' } })

  const langLabel = language === 'ru' ? t('language.russian') : t('language.english')
  const planNameKey = PLAN_NAME_KEY[subscription.planTier]
  const publicationChannels = channels

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

  const handleDisconnectChat = async (chatId: string) => {
    if (!window.confirm('Отключить этот чат от Publium?')) return
    if (authStatus === 'authenticated') {
      const initData = getTelegramInitData(); if (!initData) return
      try { const res = await fetch(`${API_BASE}/api/chats/${chatId}/disconnect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) }); if (!res.ok) throw new Error() }
      catch { showToast(t('profile.disconnectFailed'), 'error'); return }
    }
    disconnectChat(chatId); showToast('Чат отключён')
  }

  const handleChatLink = async (chat: Chat, channel: Channel | null) => {
    const initData=getTelegramInitData();if(authStatus==='authenticated'&&!initData)return
    try {
      if(authStatus==='authenticated'){
        const endpoint=channel?'link-channel':'unlink-channel',channelId=channel?.id??chat.linkedChannel?.id
        const res=await fetch(`${API_BASE}/api/chats/${chat.id}/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData,channelId})})
        if(!res.ok)throw new Error()
      }
      setChatLinkedChannel(chat.id,channel);showToast(channel?`Чат связан с @${channel.username}`:'Связь удалена')
    }catch{showToast('Не удалось изменить связь','error')}
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

        <div className="grid grid-cols-2 rounded-[14px] border border-white/[0.08] bg-white/[0.035] p-1" role="tablist" aria-label="Каналы и чаты">
          {(['channels','chats'] as const).map(tab => <button key={tab} type="button" role="tab" aria-selected={entityTab===tab} onClick={()=>{setEntityTab(tab);try{localStorage.setItem('profileEntityTab',tab)}catch{}}} className={`min-h-11 rounded-[11px] px-3 text-[13px] font-semibold transition-colors ${entityTab===tab?'bg-[#262629] text-white shadow-sm':'text-[#777780] hover:text-white'}`}>{tab==='channels'?`Каналы · ${channels.length}`:`Чаты · ${chats.length}`}</button>)}
        </div>

        {entityTab === 'channels' && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.22 }}>
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-xs font-semibold text-[#66666E] uppercase tracking-wide">{t('profile.channels')}</p>
            <Button variant="ghost" size="sm" onClick={() => setConnectSheetOpen(true)}>
              {t('profile.add')}
            </Button>
          </div>
          {wtStep === 'style' && publicationChannels.length > 0 && (
            <div className="mb-2.5">
              <Coachmark
                stepLabel={t('onboarding.step2')}
                title={t('onboarding.styleTitle')}
                text={t('onboarding.styleText')}
              />
            </div>
          )}
          <div className="space-y-2">
            {publicationChannels.length === 0 ? (
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
              publicationChannels.map((ch, i) => (
                <ChannelCard
                  key={ch.id}
                  channel={ch}
                  isActive={ch.id === activeChannelId}
                  onSetDefault={() => setActiveChannel(ch.id)}
                  onOpenBrandKit={() => onOpenBrandKit(ch.id, channelLabel(ch))}
                  onDisconnect={() => handleDisconnect(ch.id)}
                  highlightStyle={wtStep === 'style' && i === 0}
                  index={i}
                  t={t}
                />
              ))
            )}
          </div>
        </motion.div>}

        {entityTab === 'chats' && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.22 }}>
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#66666E]">Чаты</p>
            <Button variant="ghost" size="sm" onClick={()=>setConnectChatOpen(true)}>Добавить</Button>
          </div>
          <div className="space-y-2">
            {chats.length===0?<GlassCard className="flex items-center gap-3 py-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05]"><Users size={18} className="text-[#55555D]"/></div><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-white">Нет подключённых чатов</p><p className="mt-0.5 text-[11px] leading-relaxed text-[#55555D]">Можно подключить публичную или приватную Telegram-группу без канала.</p></div></GlassCard>:chats.map((chat,i)=><ChatCard key={chat.id} chat={chat} channels={channels} onLink={channel=>void handleChatLink(chat,channel)} onOpenStyle={()=>onOpenChatStyle(chat.id,chat.title)} onOpenCommunity={()=>onOpenCommunity(chat.id,chat.title)} onDisconnect={()=>void handleDisconnectChat(chat.id)} index={i}/>)}
          </div>
        </motion.div>}

        <div className="pb-2 text-center">
          <p className="text-[11px] text-[#66666E]">Publium v0.1.0</p>
        </div>
      </div>

      {/* Connect channel sheet */}
      <ConnectChannelSheet
        open={connectSheetOpen}
        onClose={() => setConnectSheetOpen(false)}
      />
      <ConnectChatSheet
        open={connectChatOpen}
        onClose={()=>setConnectChatOpen(false)}
        onConnected={chat=>{connectChat(chat);showToast('Чат подключён')}}
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

function ChannelCard({ channel, isActive, onSetDefault, onOpenBrandKit, onDisconnect, highlightStyle, index, t }: {
  channel: Channel
  isActive: boolean
  onSetDefault: () => void
  onOpenBrandKit: () => void
  onDisconnect: () => void
  highlightStyle?: boolean
  index: number
  t: (key: TranslationKey) => string
}) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const countLabel = channel.subscribersCount == null
    ? `— ${t('profile.subscribers')}`
    : `${channel.subscribersCount.toLocaleString()} ${t('profile.subscribers')}`

  return (
    <>
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
                <p className="text-[11px] tabular-nums text-[#66666E]">{countLabel}</p>
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
                onClick={() => setActionsOpen(true)}
                aria-label={`${t('profile.disconnect')}: ${channelLabel(channel)}`}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-[#62626A] transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]"
              >
                <MoreVertical size={16} />
              </button>
            </div>
          </div>

          <div>
            <HighlightRing active={!!highlightStyle}>
              <Button variant="secondary" size="sm" onClick={onOpenBrandKit} fullWidth>
                {t('profile.channelStyle')}
              </Button>
            </HighlightRing>
          </div>
        </GlassCard>
      </motion.div>

      <Sheet open={actionsOpen} onClose={() => setActionsOpen(false)} title={channelLabel(channel)}>
        <Button
          variant="danger"
          size="lg"
          onClick={() => { setActionsOpen(false); onDisconnect() }}
          fullWidth
        >
          <Trash2 size={16} /> {t('profile.disconnect')}
        </Button>
      </Sheet>
    </>
  )
}

function ChatCard({ chat, channels, onLink, onOpenStyle, onOpenCommunity, onDisconnect, index }: { chat: Chat; channels: Channel[]; onLink: (channel: Channel | null) => void; onOpenStyle: () => void; onOpenCommunity: () => void; onDisconnect: () => void; index: number }) {
  const [actionsOpen,setActionsOpen]=useState(false)
  const count=chat.membersCount==null?'— участников':chat.membersCount.toLocaleString()+' участников'
  return <>
    <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:index*.06,duration:.2}}><GlassCard>
      <div className="mb-2.5 flex items-center gap-2.5"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(255,106,0,0.18)] bg-[rgba(255,106,0,0.11)] text-sm font-bold text-[#FF6A00]">{chat.title[0]}</div><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-white">{chat.title}</p><p className="mt-0.5 text-[11px] tabular-nums text-[#66666E]">{count}</p>{chat.linkedChannel&&<p className="mt-0.5 truncate text-[10px] text-[#55555D]">Связан с @{chat.linkedChannel.username}</p>}</div><button type="button" onClick={()=>setActionsOpen(true)} aria-label="Действия с чатом" className="flex h-11 w-11 items-center justify-center rounded-full text-[#62626A] hover:bg-white/[0.06] hover:text-white"><MoreVertical size={16}/></button></div>
      <div className="grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" onClick={onOpenStyle} fullWidth>Стиль чата</Button><Button variant="secondary" size="sm" onClick={onOpenCommunity} fullWidth>Управление</Button></div>
    </GlassCard></motion.div>
    <Sheet open={actionsOpen} onClose={()=>setActionsOpen(false)} title={chat.title}><div className="space-y-3">
      <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#66666E]">Связанный канал</p><div className="space-y-2">{channels.map(channel=><button key={channel.id} type="button" onClick={()=>{onLink(channel);setActionsOpen(false)}} className="flex min-h-11 w-full items-center justify-between rounded-[12px] border border-white/[0.08] bg-white/[0.035] px-3 text-left text-[12px] text-white"><span className="truncate">@{channel.username}</span>{chat.linkedChannel?.id===channel.id&&<Check size={14} className="text-[#FF6A00]"/>}</button>)}{chat.linkedChannel&&<button type="button" onClick={()=>{onLink(null);setActionsOpen(false)}} className="min-h-11 w-full rounded-[12px] border border-white/[0.08] text-[12px] text-[#A1A1AA]">Убрать связь с каналом</button>}{!channels.length&&<p className="text-[12px] text-[#66666E]">Сначала подключите канал. Чат может работать и без него.</p>}</div></div>
      <Button variant="danger" size="lg" onClick={()=>{setActionsOpen(false);onDisconnect()}} fullWidth><Trash2 size={16}/> Отключить</Button>
    </div></Sheet>
  </>
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
