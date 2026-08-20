import { useCallback, useEffect, useState } from 'react'
import { Activity, Loader2, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { ModeratorRichWelcomeEditor } from '@/components/moderator/ModeratorRichWelcomeEditor'
import { ModeratorCaptchaEditor } from '@/components/moderator/ModeratorCaptchaEditor'
import { ModeratorAntiSpamEditor } from '@/components/moderator/ModeratorAntiSpamEditor'
import { ModeratorProbationEditor } from '@/components/moderator/ModeratorProbationEditor'
import { ModeratorAiEditor } from '@/components/moderator/ModeratorAiEditor'
import { ModeratorTriggersEditor } from '@/components/moderator/ModeratorTriggersEditor'
import { ModerationLog } from '@/components/moderator/ModerationLog'
import { ModeratorWarningPolicyEditor } from '@/components/moderator/ModeratorWarningPolicyEditor'
import { ModeratorContentFiltersEditor } from '@/components/moderator/ModeratorContentFiltersEditor'
import { ModeratorExecutorSheet, type ManagedModeratorBotView } from '@/components/moderator/ModeratorExecutorSheet'
import { ModeratorHelpSheet, ModeratorInfoButton } from '@/components/moderator/ModeratorHelpSheet'
import { RoleKnowledgeDocs } from '@/components/community/RoleKnowledgeDocs'
import { CommunityManagerPanel } from '@/components/community-manager/CommunityManagerPanel'
import { CommunityCorePanel } from '@/components/community-core/CommunityCorePanel'
import { PulseTab } from '@/components/community-pulse/PulseTab'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData, moderatorFetch } from '@/lib/telegram'

interface CommunityScreenProps {
  chatId: string
  chatTitle: string
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
  moderator: { id: string; status: string; enabled: boolean; executorType: string } | null
  managedBot: ManagedModeratorBotView | null
}

export function CommunityScreen({ chatId, chatTitle, onBack }: CommunityScreenProps) {
  const [community, setCommunity] = useState<CommunityState | null>(null)
  const [botUsername, setBotUsername] = useState('publium_moder_bot')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [activeProduct, setActiveProduct] = useState<'moderator' | 'manager' | 'core' | 'pulse'>('moderator')
  const [overviewHelpOpen, setOverviewHelpOpen] = useState(false)

  const initData = getTelegramInitData()

  const loadState = useCallback(async () => {
    if (!initData) { setError('Откройте Publium внутри Telegram'); setLoading(false); return }
    try {
      const stateRes = await moderatorFetch(`${API_BASE}/api/moderator/chats/${chatId}/community`)
      const state = await stateRes.json() as { community?: CommunityState | null; botUsername?: string; error?: string }
      if (!stateRes.ok) throw new Error(state.error ?? 'Не удалось загрузить сообщество')
      setCommunity(state.community ?? null)
      setBotUsername(state.botUsername ?? 'publium_moder_bot')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить сообщество')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [chatId, initData])

  useEffect(() => { void loadState() }, [loadState])

  const addBot = () => {
    const url = `https://t.me/${botUsername}?startgroup=publium&admin=delete_messages+restrict_members`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const toggleModerator = async () => {
    if (!initData || !community?.moderator) return
    const enabled = !community.moderator.enabled
    try { const res = await moderatorFetch(`${API_BASE}/api/moderator/moderators/${community.moderator.id}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }); const data = await res.json() as { moderator?: CommunityState['moderator']; error?: string }; if (!res.ok || !data.moderator) throw new Error(data.error ?? 'Не удалось изменить состояние'); setCommunity(prev => prev ? { ...prev, moderator: data.moderator ?? prev.moderator } : prev) } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось изменить состояние') }
  }

  return (
    <div className="pb-6">
      <PageHeader title="Управление чатом" subtitle={chatTitle} onBack={onBack} />
      <div className="px-4 pt-2">
        {/* 44px touch targets (a11y floor); icons only on the active tab so four
            labels still fit on a 375px screen. */}
        <div className="flex gap-1 rounded-[12px] border border-white/[0.06] bg-white/[0.04] p-1" role="tablist" aria-label="Инструменты сообщества">
          {([
            { id: 'moderator', label: 'Moderator', Icon: ShieldCheck },
            { id: 'manager', label: 'Manager', Icon: Sparkles },
            { id: 'core', label: 'Ядро', Icon: Users },
            { id: 'pulse', label: 'Пульс', Icon: Activity },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeProduct === id}
              onClick={() => setActiveProduct(id)}
              className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1 rounded-[9px] px-1 text-[11px] font-semibold transition-colors ${activeProduct === id ? 'bg-[#FF6A00] text-white' : 'text-[#A1A1AA] hover:text-white'}`}
            >
              {activeProduct === id && <Icon size={13} />} {label}
            </button>
          ))}
        </div>
      </div>

      {activeProduct === 'pulse' ? (
        community?.id
          ? <PulseTab communityId={community.id} />
          : <div className="px-4 pt-3"><GlassCard><p className="text-[12px] leading-relaxed text-[#8A8A93]">Аналитика появится, когда к каналу будет подключена группа обсуждений — статистику мы считаем по её чату.</p></GlassCard></div>
      ) : activeProduct === 'core' ? (
        <div className="px-4 pt-3"><CommunityCorePanel chatId={chatId} /></div>
      ) : activeProduct === 'manager' ? (
        <div className="px-4 pt-3"><CommunityManagerPanel chatId={chatId} chatTitle={chatTitle} /></div>
      ) : (
        <div className="space-y-3 px-4 pt-3" role="tabpanel">
          {loading ? <div className="flex items-center justify-center py-20 text-[#66666E]"><Loader2 size={22} className="animate-spin" /></div> : <>
            <GlassCard strong className="relative overflow-hidden">
              <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[rgba(255,106,0,0.08)] blur-2xl" />
              <div className="relative flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[rgba(255,106,0,0.20)] bg-[rgba(255,106,0,0.11)] text-[#FF6A00]"><ShieldCheck size={21} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="text-[15px] font-semibold text-white">Moderator</h2>{community?.moderatorChat && <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Подключён</span>}</div><p className="mt-1 text-[12px] leading-relaxed text-[#777780]">Защита группы и порядок в стиле вашего канала.</p></div><ModeratorInfoButton onClick={() => setOverviewHelpOpen(true)} label="Открыть общую справку Moderator" /></div>
              {community?.moderatorChat ? <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-white/[0.07] bg-white/[0.035] px-3 py-3"><Users size={16} className="text-[#8A8A93]" /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-white">{community.moderatorChat.title}</p><p className="mt-0.5 text-[11px] text-[#62626A]">Настройки применяются к этой группе</p></div><button type="button" onClick={() => void toggleModerator()} className={`min-h-9 rounded-[10px] px-2.5 text-[10px] font-semibold ${community.moderator?.enabled ? 'bg-amber-400/10 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'}`}>{community.moderator?.enabled ? 'Пауза' : 'Запустить'}</button></div> : <div className="mt-4 space-y-3"><Button variant="primary" size="sm" onClick={addBot} fullWidth>Добавить @{botUsername}</Button><button type="button" onClick={() => { setRefreshing(true); void loadState() }} disabled={refreshing} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[12px] text-[12px] font-medium text-[#8A8A93] transition-colors hover:bg-white/[0.04] hover:text-white disabled:cursor-wait"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />Я добавил бота — обновить</button></div>}
              {community?.moderatorChat && community.moderator && <ModeratorExecutorSheet communityId={community.id} sharedUsername={botUsername} executorType={community.moderator.executorType} managedBot={community.managedBot} suggestedBase={chatTitle.replace(/^@/, '') || 'community'} onRefresh={loadState} />}
              <ModeratorHelpSheet kind="overview" open={overviewHelpOpen} onClose={() => setOverviewHelpOpen(false)} />
            </GlassCard>
            {community?.moderator?.id && <RoleKnowledgeDocs targetType="MODERATOR" targetId={community.moderator.id} title={'\u0420\u0435\u0433\u043b\u0430\u043c\u0435\u043d\u0442 Moderator'} description={'\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u044d\u0441\u043a\u0430\u043b\u0430\u0446\u0438\u0438, \u043f\u0440\u0438\u043c\u0435\u0440\u044b \u0441\u043f\u043e\u0440\u043d\u044b\u0445 \u0441\u043b\u0443\u0447\u0430\u0435\u0432 \u0438 \u0432\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u044f\u044f \u0438\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0438\u044f. \u0424\u0430\u0439\u043b \u043f\u043e\u043c\u043e\u0433\u0430\u0435\u0442 \u043f\u0440\u0438\u043d\u0438\u043c\u0430\u0442\u044c \u0440\u0435\u0448\u0435\u043d\u0438\u044f, \u043d\u043e \u043d\u0435 \u043c\u0435\u043d\u044f\u0435\u0442 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u043d\u044b\u0435 \u0441\u0430\u043d\u043a\u0446\u0438\u0438.'}/>}
            {community?.moderator?.id && <><ModeratorRichWelcomeEditor moderatorId={community.moderator.id} /><ModeratorCaptchaEditor moderatorId={community.moderator.id} /><ModeratorAntiSpamEditor moderatorId={community.moderator.id} /><ModeratorProbationEditor moderatorId={community.moderator.id} /><ModeratorContentFiltersEditor moderatorId={community.moderator.id} /><ModeratorWarningPolicyEditor moderatorId={community.moderator.id} /><ModeratorTriggersEditor moderatorId={community.moderator.id} /><ModeratorAiEditor moderatorId={community.moderator.id} /><ModerationLog communityId={community.id} /></>}
            {!community && <GlassCard><p className="text-[12px] text-[#8A8A93]">Чат подключён, но конфигурация управления ещё не создана. Вернитесь в профиль и подключите чат повторно.</p></GlassCard>}
            {error && <p role="alert" className="rounded-[12px] border border-red-400/15 bg-red-400/[0.07] px-3 py-2.5 text-[12px] leading-relaxed text-red-300">{error}</p>}
          </>}
        </div>
      )}
    </div>
  )
}
