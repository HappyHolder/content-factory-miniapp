import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Loader2, Sparkles, ArrowLeft, ChevronDown, CalendarClock, Layers, Play, Check, MoreVertical, Plus, Trash2, MessageSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Sheet } from '@/components/ui/Sheet'
import { ChatMarkdown } from '@/lib/chatMarkdown'

export interface ChatSession {
  id: string
  title: string
  channelId: string | null
  updatedAt: string
}

export interface ContentPlanItem {
  id: string
  orderIndex: number
  scheduledAt: string
  rubricId: string | null
  rubricName: string | null
  workingTitle: string
  angle: string
  searchQuery: string
}

export interface ContentPlan {
  id: string
  channelId: string
  topic: string
  postsPerDay: number
  days: number
  startDate: string
  source: string
  status: string   // DRAFT | GENERATING | SCHEDULED | FAILED | CANCELLED
  totalPosts: number
  items: ContentPlanItem[]
  /** Live progress while GENERATING (finished items) — set by the poller. */
  processed?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Present when the assistant produced a content-series plan (renders a card). */
  plan?: ContentPlan
  /** Server-set: the reply is publishable post material → show «Отправить в Create». */
  createWorthy?: boolean
}

const SUGGESTIONS = [
  'Придумай 5 идей для постов',
  'Напиши промпт для обложки',
  'Как улучшить вовлечённость?',
  'Сделай контент-план на неделю',
]

const SOURCE_LABELS: Record<string, string> = {
  web: 'Веб-поиск', uploads: 'Материалы проекта', both: 'Веб + материалы',
}


function formatStartDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })
}

/** Compact plan summary card + «Приступить» button, rendered under an assistant reply. */
function PlanCard({ plan, onConfirm, onCancel, confirming }: {
  plan: ContentPlan
  onConfirm?: (plan: ContentPlan) => void
  onCancel?: (plan: ContentPlan) => void
  confirming: boolean
}) {
  const rubricNames = [...new Set(plan.items.map(i => i.rubricName).filter(Boolean))] as string[]
  const times = [...new Set(plan.items.map(i =>
    new Date(i.scheduledAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })))]
    .filter(Boolean).slice(0, 4)
  const status = plan.status
  const isDraft = status === 'DRAFT'
  const isDone = status === 'SCHEDULED'
  const isGenerating = status === 'GENERATING'
  const isFailed = status === 'FAILED' || status === 'CANCELLED'

  return (
    <div className="w-full max-w-[82%] mt-1 rounded-2xl rounded-bl-sm bg-[rgba(255,106,0,0.06)] border border-[rgba(255,106,0,0.20)] overflow-hidden">
      <div className="px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Layers size={13} className="text-[#FF6A00]" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#FF6A00]">Контент-план</span>
        </div>
        <p className="text-[13.5px] font-semibold text-white leading-snug">{plan.topic}</p>

        <div className="mt-2.5 space-y-1.5 text-[12px] text-[#C7C7CE]">
          <div className="flex items-center gap-2">
            <Layers size={12} className="text-[#8A8A92] shrink-0" />
            <span>{plan.totalPosts} постов · {plan.postsPerDay}/день · {plan.days} дн.</span>
          </div>
          <div className="flex items-center gap-2">
            <CalendarClock size={12} className="text-[#8A8A92] shrink-0" />
            <span>Старт {formatStartDate(plan.startDate)}{times.length ? ` · в ${times.join(', ')}` : ''}</span>
          </div>
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="text-[#8A8A92] shrink-0" />
            <span>{SOURCE_LABELS[plan.source] ?? plan.source}{rubricNames.length ? ` · ${rubricNames.join(', ')}` : ''}</span>
          </div>
        </div>

        {/* First few working titles as a preview */}
        <ul className="mt-2.5 space-y-1">
          {plan.items.slice(0, 4).map((it, i) => (
            <li key={it.id} className="flex gap-1.5 text-[11.5px] text-[#9A9AA2] leading-snug">
              <span className="text-[#55555D] tabular-nums">{i + 1}.</span>
              <span className="truncate">{it.workingTitle}</span>
            </li>
          ))}
          {plan.items.length > 4 && (
            <li className="text-[11px] text-[#55555D] pl-4">…и ещё {plan.items.length - 4}</li>
          )}
        </ul>
      </div>

      <button
        onClick={() => isDraft && onConfirm?.(plan)}
        disabled={!isDraft || confirming}
        className={cn(
          'w-full flex items-center justify-center gap-1.5 py-2.5 text-[13px] font-semibold border-t transition-colors',
          isDone
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 cursor-default'
            : isFailed
              ? 'bg-red-500/10 border-red-500/20 text-red-400 cursor-default'
            : isDraft
              ? 'bg-[#FF6A00] border-transparent text-white hover:bg-[#ff7a1a] active:bg-[#e55f00] disabled:opacity-60'
              : 'bg-white/[0.04] border-white/[0.06] text-[#8A8A92] cursor-default',
        )}
      >
        {confirming
          ? <><Loader2 size={14} className="animate-spin" /> Запускаю…</>
          : isDone
            ? <><Check size={14} /> В Отложке</>
            : isGenerating
              ? <><Loader2 size={14} className="animate-spin" /> Генерирую {plan.processed ?? 0}/{plan.totalPosts}…</>
            : isFailed
              ? <>{status === 'CANCELLED' ? 'Отменён' : 'Ошибка генерации'}</>
            : isDraft
              ? <><Play size={13} /> Приступить</>
              : <>Генерация…</>}
      </button>

      {(isDraft || isGenerating) && onCancel && (
        <button
          onClick={() => onCancel(plan)}
          className="w-full py-1.5 text-[11.5px] text-[#8A8A92] hover:text-red-400 border-t border-white/[0.06] transition-colors"
        >
          {isDraft ? 'Отклонить план' : 'Отменить генерацию'}
        </button>
      )}
    </div>
  )
}

interface ChatScreenProps {
  messages: ChatMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  historyLoaded: boolean
  setHistoryLoaded: React.Dispatch<React.SetStateAction<boolean>>
  /** Active chat session id (null = a fresh chat; the server creates one on first message). */
  sessionId: string | null
  setSessionId: (id: string | null) => void
  onSend: (text: string) => void
  /** Hand an assistant reply to the Create flow (generates a post from it). */
  onSendToCreate?: (text: string) => void
  /** Start generating a content-series plan (the «Приступить» button). */
  onConfirmPlan?: (plan: ContentPlan) => void
  /** Cancel a draft/generating plan. */
  onCancelPlan?: (plan: ContentPlan) => void
  /** Plan id currently being confirmed (button shows a spinner). */
  confirmingPlanId?: string | null
  loading: boolean
  /** True while the AI tab is the visible one. The screen stays mounted (hidden)
   *  when other tabs are active, so we use this to re-pin to the bottom on entry. */
  active: boolean
  onBack: () => void
  onScrollBtnChange: (visible: boolean, scrollFn: () => void) => void
}

export function ChatScreen({ messages, setMessages, historyLoaded, setHistoryLoaded, sessionId, setSessionId, onSend, onSendToCreate, onConfirmPlan, onCancelPlan, confirmingPlanId, loading, active, onBack, onScrollBtnChange }: ChatScreenProps) {
  const { activeChannel, authStatus, state, setActiveChannel } = useApp()
  const bottomRef    = useRef<HTMLDivElement>(null)
  const scrollRef    = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [channelListOpen, setChannelListOpen] = useState(false)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    const initData = getTelegramInitData()
    if (!initData) return
    setSessionsLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/chat/sessions?initData=${encodeURIComponent(initData)}`)
      const d = await r.json() as { sessions?: ChatSession[] }
      setSessions(d.sessions ?? [])
    } catch { /* list stays as-is */ } finally { setSessionsLoading(false) }
  }, [])

  useEffect(() => { if (menuOpen) void loadSessions() }, [menuOpen, loadSessions])

  const startNewChat = useCallback(() => {
    setSessionId(null)
    setMessages([])
    setMenuOpen(false)
  }, [setMessages, setSessionId])

  const openSession = useCallback(async (target: ChatSession) => {
    const initData = getTelegramInitData()
    if (!initData) return
    try {
      const r = await fetch(`${API_BASE}/api/chat/history?initData=${encodeURIComponent(initData)}&sessionId=${encodeURIComponent(target.id)}`)
      const d = await r.json() as { sessionId?: string | null; messages?: ChatMessage[] }
      setMessages(Array.isArray(d.messages) ? d.messages : [])
      setSessionId(target.id)
      if (target.channelId && target.channelId !== activeChannel?.id) setActiveChannel(target.channelId)
      setMenuOpen(false)
    } catch { /* keep the current chat on failure */ }
  }, [activeChannel?.id, setActiveChannel, setMessages, setSessionId])

  const deleteSession = useCallback(async (target: ChatSession) => {
    const initData = getTelegramInitData()
    if (!initData || deletingId) return
    setDeletingId(target.id)
    try {
      await fetch(`${API_BASE}/api/chat/sessions/${target.id}?initData=${encodeURIComponent(initData)}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.id !== target.id))
      if (sessionId === target.id) { setSessionId(null); setMessages([]) }
    } catch { /* leave list unchanged */ } finally { setDeletingId(null) }
  }, [deletingId, sessionId, setMessages, setSessionId])

  const switchChannel = useCallback(async (channelId: string) => {
    if (channelId === activeChannel?.id) { setMenuOpen(false); return }
    setActiveChannel(channelId)
    const initData = getTelegramInitData()
    if (!initData) { setMenuOpen(false); return }
    try {
      const r = await fetch(`${API_BASE}/api/chat/history?initData=${encodeURIComponent(initData)}&channelId=${encodeURIComponent(channelId)}`)
      const d = await r.json() as { sessionId?: string | null; messages?: ChatMessage[] }
      const found = d.sessionId && Array.isArray(d.messages)
      setMessages(found ? d.messages! : [])
      setSessionId(found ? d.sessionId! : null)
    } catch {
      setMessages([]); setSessionId(null)
    }
    setMenuOpen(false)
  }, [activeChannel?.id, setActiveChannel, setMessages, setSessionId])

  const scrollToBottom = useCallback((smooth = true) => {
    if (smooth) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else {
      // Direct scrollTop is reliable even in older webviews where
      // scrollIntoView({behavior:'instant'}) is a no-op.
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [])

  // Show/hide scroll-to-bottom button based on scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const visible = distanceFromBottom > 120
    setShowScrollBtn(visible)
    onScrollBtnChange(visible, () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }))
  }, [onScrollBtnChange])

  // Load history from DB once
  useEffect(() => {
    if (historyLoaded || authStatus === 'checking') return
    const initData = getTelegramInitData()
    if (!initData) { setHistoryLoaded(true); return }

    const channelParam = activeChannel?.id ? `&channelId=${encodeURIComponent(activeChannel.id)}` : ''
    fetch(`${API_BASE}/api/chat/history?initData=${encodeURIComponent(initData)}${channelParam}`)
      .then(r => r.json())
      .then((data: { sessionId?: string | null; messages?: ChatMessage[] }) => {
        if (data.sessionId && Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(data.messages)
          setSessionId(data.sessionId)
        }
      })
      .catch(() => {})
      .finally(() => {
        setHistoryLoaded(true)
        // Scroll to bottom without animation after history loads
        setTimeout(() => scrollToBottom(false), 50)
      })
  }, [authStatus, historyLoaded, setHistoryLoaded, setMessages, scrollToBottom])

  // Re-pin to the bottom whenever the AI tab becomes visible. The screen is kept
  // mounted but display:none while other tabs are active, so its scroll position
  // isn't restored on return — and a hidden container can't be measured. Two rAFs
  // wait for layout after it becomes visible, then jump to the latest message.
  useEffect(() => {
    if (!active || !historyLoaded) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => scrollToBottom(false))
    })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }, [active, historyLoaded, scrollToBottom])

  // Auto-scroll on new message / loading indicator
  useEffect(() => {
    if (!historyLoaded) return
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    // Only auto-scroll if already near the bottom (user hasn't scrolled up)
    if (distanceFromBottom < 200) scrollToBottom()
  }, [messages, loading, historyLoaded, scrollToBottom])

  const isEmpty = messages.length === 0 && historyLoaded

  return (
    <div className="relative flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 pt-4 pb-3 border-b border-white/[0.06]">
        <motion.button
          onClick={onBack}
          whileTap={{ scale: 0.88 }}
          className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0 text-[#ABABAB] hover:text-white transition-colors"
        >
          <ArrowLeft size={15} />
        </motion.button>

        <div className="w-7 h-7 rounded-full bg-[rgba(255,106,0,0.15)] flex items-center justify-center flex-shrink-0">
          <Bot size={14} className="text-[#FF6A00]" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white">AI Ассистент</p>
          {activeChannel && (
            <p className="text-[10px] text-[#55555D] truncate">
              {activeChannel.username ? `@${activeChannel.username}` : activeChannel.title}
            </p>
          )}
        </div>

        <motion.button
          onClick={() => setMenuOpen(true)}
          whileTap={{ scale: 0.88 }}
          aria-label="Меню ассистента"
          className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0 text-[#ABABAB] hover:text-white transition-colors"
        >
          <MoreVertical size={15} />
        </motion.button>
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-3 space-y-3 no-scrollbar"
          style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}
        >
        {!historyLoaded && (
          <div className="flex justify-center pt-10">
            <Loader2 size={16} className="text-[#FF6A00] animate-spin" />
          </div>
        )}

        {isEmpty && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-full gap-5 pb-4"
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[rgba(255,106,0,0.12)] flex items-center justify-center">
                <Sparkles size={22} className="text-[#FF6A00]" />
              </div>
              <p className="text-[13px] font-semibold text-white">Чем могу помочь?</p>
              <p className="text-[11px] text-[#55555D] leading-relaxed max-w-[220px]">
                Идеи постов, промпты для обложек, контент-стратегия и редактура
              </p>
            </div>

            <div className="w-full space-y-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  className="w-full text-left px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] text-[12px] text-[#ABABAB] hover:bg-white/[0.07] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              {msg.role === 'assistant' ? (
                <div className="max-w-[82%] flex flex-col items-start gap-1.5">
                  <div className="px-3 py-2 rounded-2xl rounded-bl-sm text-[13px] leading-relaxed bg-white/[0.06] text-[#E0E0E0]">
                    <ChatMarkdown text={msg.content} />
                  </div>
                  {msg.plan ? (
                    <PlanCard
                      plan={msg.plan}
                      onConfirm={onConfirmPlan}
                      onCancel={onCancelPlan}
                      confirming={confirmingPlanId === msg.plan.id}
                    />
                  ) : onSendToCreate && msg.createWorthy === true && (
                    <button
                      onClick={() => onSendToCreate(msg.content)}
                      disabled={loading}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.25)] text-[11px] font-medium text-[#FF6A00] hover:bg-[rgba(255,106,0,0.18)] disabled:opacity-50 transition-colors"
                    >
                      <Sparkles size={11} /> Отправить в Create
                    </button>
                  )}
                </div>
              ) : (
                <div className="max-w-[82%] px-3 py-2 rounded-2xl rounded-br-sm text-[13px] leading-relaxed whitespace-pre-wrap bg-[#FF6A00] text-white">
                  {msg.content}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && !(messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-white/[0.06] px-3 py-2.5 rounded-2xl rounded-bl-sm">
              <Loader2 size={14} className="text-[#FF6A00] animate-spin" />
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
        </div> {/* end scrollable div */}
      </div> {/* end relative wrapper */}

      {/* Scroll button is rendered in App.tsx as sibling of BottomNav to avoid transform stacking context issues */}

      {/* Assistant menu: channel switcher + chat history */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Ассистент" height="full">
        <div className="space-y-5">
          {/* Channel switcher — one collapsed row; tap to expand the rest */}
          {activeChannel && (
            <section>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#66666E]">Канал</p>
              <button
                onClick={() => setChannelListOpen(v => !v)}
                aria-expanded={channelListOpen}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border bg-[rgba(255,106,0,0.08)] border-[rgba(255,106,0,0.25)] text-left"
              >
                {activeChannel.avatarUrl
                  ? <img src={activeChannel.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                  : <div className="w-7 h-7 rounded-full bg-white/[0.08] flex items-center justify-center flex-shrink-0 text-[11px] text-[#8A8A92]">{(activeChannel.title || activeChannel.username || '?').slice(0, 1).toUpperCase()}</div>}
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium text-white truncate">{activeChannel.title || `@${activeChannel.username}`}</span>
                  {activeChannel.username && <span className="block text-[10.5px] text-[#66666E] truncate">@{activeChannel.username}</span>}
                </span>
                <ChevronDown size={15} className={cn('text-[#8A8A92] flex-shrink-0 transition-transform', channelListOpen && 'rotate-180')} />
              </button>
              <AnimatePresence initial={false}>
                {channelListOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-1.5 space-y-1.5">
                      {state.channels.filter(ch => ch.id !== activeChannel.id).map(ch => (
                        <button
                          key={ch.id}
                          onClick={() => { setChannelListOpen(false); void switchChannel(ch.id) }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border bg-white/[0.03] border-white/[0.07] hover:bg-white/[0.06] text-left transition-colors"
                        >
                          {ch.avatarUrl
                            ? <img src={ch.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                            : <div className="w-7 h-7 rounded-full bg-white/[0.08] flex items-center justify-center flex-shrink-0 text-[11px] text-[#8A8A92]">{(ch.title || ch.username || '?').slice(0, 1).toUpperCase()}</div>}
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-medium text-white truncate">{ch.title || `@${ch.username}`}</span>
                            {ch.username && <span className="block text-[10.5px] text-[#66666E] truncate">@{ch.username}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          )}

          {/* New chat */}
          <button
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#FF6A00] text-white text-[13px] font-semibold hover:bg-[#ff7a1a] active:bg-[#e55f00] transition-colors"
          >
            <Plus size={15} /> Новый чат
          </button>

          {/* Session history */}
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#66666E]">История чатов</p>
            {sessionsLoading ? (
              <div className="flex justify-center py-6"><Loader2 size={16} className="text-[#FF6A00] animate-spin" /></div>
            ) : sessions.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-[#55555D]">Пока нет сохранённых чатов</p>
            ) : (
              <div className="space-y-1.5">
                {sessions.map(s => {
                  const ch = state.channels.find(c => c.id === s.channelId)
                  const isCurrent = s.id === sessionId
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'flex items-center gap-2 rounded-xl border transition-colors',
                        isCurrent ? 'bg-[rgba(255,106,0,0.06)] border-[rgba(255,106,0,0.20)]' : 'bg-white/[0.03] border-white/[0.07]',
                      )}
                    >
                      <button onClick={() => void openSession(s)} className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 text-left">
                        <MessageSquare size={14} className={cn('flex-shrink-0', isCurrent ? 'text-[#FF6A00]' : 'text-[#66666E]')} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[12.5px] text-white truncate">{s.title}</span>
                          <span className="block text-[10px] text-[#55555D] truncate">
                            {ch ? (ch.username ? `@${ch.username}` : ch.title) + ' · ' : ''}
                            {new Date(s.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => void deleteSession(s)}
                        disabled={deletingId !== null}
                        aria-label="Удалить чат"
                        className="w-9 h-9 mr-1 flex items-center justify-center rounded-lg text-[#66666E] hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                      >
                        {deletingId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </Sheet>
    </div>
  )
}
