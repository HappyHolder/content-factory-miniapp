import { useCallback, useEffect, useState } from 'react'
import { Bot, Check, ChevronRight, Loader2, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { ModeratorRichWelcomeEditor } from '@/components/moderator/ModeratorRichWelcomeEditor'
import { ModeratorCaptchaEditor } from '@/components/moderator/ModeratorCaptchaEditor'
import { ModeratorAntiSpamEditor } from '@/components/moderator/ModeratorAntiSpamEditor'
import { ModeratorAiEditor } from '@/components/moderator/ModeratorAiEditor'
import { ModerationLog } from '@/components/moderator/ModerationLog'
import { ModeratorWarningPolicyEditor } from '@/components/moderator/ModeratorWarningPolicyEditor'
import { ModeratorContentFiltersEditor } from '@/components/moderator/ModeratorContentFiltersEditor'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData } from '@/lib/telegram'

interface CommunityScreenProps {
  channelId: string
  channelUsername: string
  onBack: () => void
}

interface AvailableChat {
  id: string
  tgChatId: string
  title: string
  username: string | null
  botStatus: string
  grantedRights: unknown
}

interface CommunityState {
  id: string
  moderatorChat: AvailableChat | null
  moderator: { id: string; status: string; enabled: boolean } | null
}

export function CommunityScreen({ channelId, channelUsername, onBack }: CommunityScreenProps) {
  const [community, setCommunity] = useState<CommunityState | null>(null)
  const [chats, setChats] = useState<AvailableChat[]>([])
  const [botUsername, setBotUsername] = useState('publium_moder_bot')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [activeProduct, setActiveProduct] = useState<'moderator' | 'manager'>('moderator')

  const initData = getTelegramInitData()

  const loadState = useCallback(async () => {
    if (!initData) { setError('Откройте Publium внутри Telegram'); setLoading(false); return }
    try {
      const query = encodeURIComponent(initData)
      const [stateRes, chatsRes] = await Promise.all([
        fetch(`${API_BASE}/api/moderator/channels/${channelId}/community?initData=${query}`),
        fetch(`${API_BASE}/api/moderator/available-chats?initData=${query}`),
      ])
      const state = await stateRes.json() as { community?: CommunityState | null; botUsername?: string; error?: string }
      const available = await chatsRes.json() as { chats?: AvailableChat[] }
      if (!stateRes.ok) throw new Error(state.error ?? 'Не удалось загрузить сообщество')
      setCommunity(state.community ?? null)
      setBotUsername(state.botUsername ?? 'publium_moder_bot')
      setChats(available.chats ?? [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить сообщество')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [channelId, initData])

  useEffect(() => { void loadState() }, [loadState])

  const addBot = () => {
    const url = `https://t.me/${botUsername}?startgroup=publium&admin=delete_messages+restrict_members`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const toggleModerator = async () => {
    if (!initData || !community?.moderator) return
    const enabled = !community.moderator.enabled
    try { const res = await fetch(`${API_BASE}/api/moderator/moderators/${community.moderator.id}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData, enabled }) }); const data = await res.json() as { moderator?: CommunityState['moderator']; error?: string }; if (!res.ok || !data.moderator) throw new Error(data.error ?? 'Не удалось изменить состояние'); setCommunity(prev => prev ? { ...prev, moderator: data.moderator ?? prev.moderator } : prev) } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось изменить состояние') }
  }

  const connect = async (chat: AvailableChat) => {
    if (!initData || connectingId) return
    setConnectingId(chat.id)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/moderator/channels/${channelId}/community`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, moderatorChatId: chat.id }),
      })
      const data = await res.json() as { community?: CommunityState; error?: string }
      if (!res.ok || !data.community) throw new Error(data.error ?? 'Не удалось подключить группу')
      setCommunity(data.community)
      setChats(prev => prev.filter(item => item.id !== chat.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось подключить группу')
    } finally {
      setConnectingId(null)
    }
  }

  return (
    <div className="pb-6">
      <PageHeader title="Сообщество" subtitle={channelUsername} onBack={onBack} />
      <div className="px-4 pt-2">
        <div className="flex gap-1 rounded-[12px] border border-white/[0.06] bg-white/[0.04] p-1" role="tablist" aria-label="Инструменты сообщества">
          <button type="button" role="tab" aria-selected={activeProduct === 'moderator'} onClick={() => setActiveProduct('moderator')} className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[9px] px-2 text-[12.5px] font-semibold transition-colors ${activeProduct === 'moderator' ? 'bg-[#FF6A00] text-white' : 'text-[#A1A1AA]'}`}><ShieldCheck size={14} /> Moderator</button>
          <button type="button" role="tab" aria-selected={activeProduct === 'manager'} onClick={() => setActiveProduct('manager')} className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[9px] px-2 text-[12.5px] font-semibold transition-colors ${activeProduct === 'manager' ? 'bg-[#FF6A00] text-white' : 'text-[#A1A1AA]'}`}><Sparkles size={14} /> Community Manager</button>
        </div>
      </div>

      {activeProduct === 'manager' ? (
        <div className="px-4 pt-3">
          <GlassCard strong className="relative overflow-hidden">
            <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[rgba(255,106,0,0.10)] blur-3xl" />
            <div className="relative">
              <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[rgba(255,106,0,0.20)] bg-[rgba(255,106,0,0.11)] text-[#FF6A00]"><Sparkles size={20} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="text-[15px] font-semibold text-white">Community Manager</h2><span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#777780]">Скоро</span></div><p className="mt-1 text-[12px] leading-relaxed text-[#777780]">ИИ-команда для развития сообщества вокруг вашего канала.</p></div></div>
              <div className="mt-5 space-y-2.5">{[['ИИ-персоны', 'Общаются в заданном тоне и стиле канала.'], ['События', 'Запускают активности и поддерживают жизнь сообщества.'], ['Награды', 'Помогают проводить раздачи Stars и TON.']].map(([title, text]) => <div key={title} className="rounded-[13px] border border-white/[0.06] bg-white/[0.025] px-3.5 py-3"><p className="text-[12px] font-medium text-white">{title}</p><p className="mt-0.5 text-[11px] leading-relaxed text-[#66666E]">{text}</p></div>)}</div>
              <p className="mt-4 text-[11px] leading-relaxed text-[#66666E]">Тематика, правила и стиль канала останутся ядром всех сценариев.</p>
            </div>
          </GlassCard>
        </div>
      ) : (
        <div className="space-y-3 px-4 pt-3" role="tabpanel">
          {loading ? <div className="flex items-center justify-center py-20 text-[#66666E]"><Loader2 size={22} className="animate-spin" /></div> : <>
            <GlassCard strong className="relative overflow-hidden">
              <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[rgba(255,106,0,0.08)] blur-2xl" />
              <div className="relative flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[rgba(255,106,0,0.20)] bg-[rgba(255,106,0,0.11)] text-[#FF6A00]"><ShieldCheck size={21} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="text-[15px] font-semibold text-white">Moderator</h2>{community?.moderatorChat && <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Подключён</span>}</div><p className="mt-1 text-[12px] leading-relaxed text-[#777780]">Защита группы и порядок в стиле вашего канала.</p></div></div>
              {community?.moderatorChat ? <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-white/[0.07] bg-white/[0.035] px-3 py-3"><Users size={16} className="text-[#8A8A93]" /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-white">{community.moderatorChat.title}</p><p className="mt-0.5 text-[11px] text-[#62626A]">Настройки применяются к этой группе</p></div><button type="button" onClick={() => void toggleModerator()} className={`min-h-9 rounded-[10px] px-2.5 text-[10px] font-semibold ${community.moderator?.enabled ? 'bg-amber-400/10 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'}`}>{community.moderator?.enabled ? 'Пауза' : 'Запустить'}</button></div> : <div className="mt-4 space-y-3"><Button variant="primary" size="sm" onClick={addBot} fullWidth>Добавить @{botUsername}</Button><button type="button" onClick={() => { setRefreshing(true); void loadState() }} disabled={refreshing} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[12px] text-[12px] font-medium text-[#8A8A93] transition-colors hover:bg-white/[0.04] hover:text-white disabled:cursor-wait"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />Я добавил бота — обновить</button></div>}
            </GlassCard>
            {community?.moderator?.id && <><ModeratorRichWelcomeEditor moderatorId={community.moderator.id} /><ModeratorCaptchaEditor moderatorId={community.moderator.id} /><ModeratorAntiSpamEditor moderatorId={community.moderator.id} /><ModeratorContentFiltersEditor moderatorId={community.moderator.id} /><ModeratorWarningPolicyEditor moderatorId={community.moderator.id} /><ModeratorAiEditor moderatorId={community.moderator.id} /><ModerationLog communityId={community.id} /></>}
            {!community && chats.length > 0 && <section aria-labelledby="available-groups-title"><h3 id="available-groups-title" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#66666E]">Доступные группы</h3><div className="space-y-2">{chats.map(chat => <button key={chat.id} type="button" onClick={() => void connect(chat)} disabled={connectingId !== null} className="flex min-h-16 w-full items-center gap-3 rounded-[16px] border border-white/[0.08] bg-[#121214] px-4 py-3 text-left transition-colors hover:border-[rgba(255,106,0,0.24)] hover:bg-[#151517] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00] disabled:cursor-wait disabled:opacity-60"><Bot size={17} className="text-[#FF6A00]" /><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-white">{chat.title}</span><span className="mt-0.5 block text-[11px] text-[#62626A]">Подключить к {channelUsername}</span></span>{connectingId === chat.id ? <Loader2 size={15} className="animate-spin text-[#FF6A00]" /> : <ChevronRight size={15} className="text-[#55555D]" />}</button>)}</div></section>}
            {error && <p role="alert" className="rounded-[12px] border border-red-400/15 bg-red-400/[0.07] px-3 py-2.5 text-[12px] leading-relaxed text-red-300">{error}</p>}
          </>}
        </div>
      )}
    </div>
  )
}
