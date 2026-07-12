import { useCallback, useEffect, useState } from 'react'
import { Bot, Check, ChevronRight, Loader2, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { ModeratorRichWelcomeEditor } from '@/components/moderator/ModeratorRichWelcomeEditor'
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
      <PageHeader title="Сообщество" subtitle={`@${channelUsername}`} onBack={onBack} />

      <div className="px-4 pt-2 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-[#66666E]">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : (
          <>
            <GlassCard strong className="relative overflow-hidden">
              <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[rgba(255,106,0,0.08)] blur-2xl" />
              <div className="relative flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[rgba(255,106,0,0.20)] bg-[rgba(255,106,0,0.11)] text-[#FF6A00]">
                  <ShieldCheck size={21} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-semibold text-white">Moderator</h2>
                    {community?.moderatorChat && (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Подключён</span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-[#777780]">
                    Защита группы и порядок в стиле вашего канала.
                  </p>
                </div>
              </div>

              {community?.moderatorChat ? (
                <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-white/[0.07] bg-white/[0.035] px-3 py-3">
                  <Users size={16} className="text-[#8A8A93]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-white">{community.moderatorChat.title}</p>
                    <p className="mt-0.5 text-[11px] text-[#62626A]">Настройка блоков откроется следующим этапом</p>
                  </div>
                  <Check size={16} className="text-emerald-400" />
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <Button variant="primary" size="sm" onClick={addBot} fullWidth>
                    Добавить @{botUsername}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setRefreshing(true); void loadState() }}
                    disabled={refreshing}
                    className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[12px] text-[12px] font-medium text-[#8A8A93] transition-colors hover:bg-white/[0.04] hover:text-white disabled:cursor-wait"
                  >
                    <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                    Я добавил бота — обновить
                  </button>
                </div>
              )}
            </GlassCard>

            {community?.moderator?.id && (
              <ModeratorRichWelcomeEditor moderatorId={community.moderator.id} />
            )}

            {!community && chats.length > 0 && (
              <section aria-labelledby="available-groups-title">
                <h3 id="available-groups-title" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#66666E]">Доступные группы</h3>
                <div className="space-y-2">
                  {chats.map(chat => (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => void connect(chat)}
                      disabled={connectingId !== null}
                      className="flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-[16px] border border-white/[0.08] bg-[#121214] px-4 py-3 text-left transition-colors hover:border-[rgba(255,106,0,0.24)] hover:bg-[#151517] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00] disabled:cursor-wait disabled:opacity-60"
                    >
                      <Bot size={17} className="text-[#FF6A00]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-white">{chat.title}</span>
                        <span className="mt-0.5 block text-[11px] text-[#62626A]">Подключить к @{channelUsername}</span>
                      </span>
                      {connectingId === chat.id ? <Loader2 size={15} className="animate-spin text-[#FF6A00]" /> : <ChevronRight size={15} className="text-[#55555D]" />}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <GlassCard className="opacity-60">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-white/[0.05] text-[#777780]">
                  <Sparkles size={18} />
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-white">Community Manager</p>
                  <p className="mt-0.5 text-[11px] text-[#62626A]">ИИ-персоны, события и награды</p>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#62626A]">Скоро</span>
              </div>
            </GlassCard>

            {error && <p role="alert" className="rounded-[12px] border border-red-400/15 bg-red-400/[0.07] px-3 py-2.5 text-[12px] leading-relaxed text-red-300">{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
