import { useState, useCallback, useRef, useEffect } from 'react'
import { Loader2, ChevronDown, Bot } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { AppProvider, useApp } from '@/context/AppContext'
import { WalkthroughProvider, useWalkthrough } from '@/context/WalkthroughContext'
import { AppShell } from '@/components/layout/AppShell'
import { BottomNav } from '@/components/layout/BottomNav'
import { ToastContainer } from '@/components/ui/Toast'
import { PostsScreen } from '@/screens/PostsScreen'
import { CreateScreen } from '@/screens/CreateScreen'
import { StylesScreen } from '@/screens/StylesScreen'
import { ProfileScreen } from '@/screens/ProfileScreen'
import { CommunityScreen } from '@/screens/CommunityScreen'
import { PostDetailsScreen } from '@/screens/PostDetailsScreen'
import { BrandKitScreen } from '@/screens/BrandKitScreen'
import { PlansScreen } from '@/screens/PlansScreen'
import { AdminPanelScreen } from '@/screens/AdminPanelScreen'
import { OnboardingSlides } from '@/screens/OnboardingSlides'
import { ChatScreen, type ChatMessage, type ContentPlan } from '@/screens/ChatScreen'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'

type MainTab = 'posts' | 'create' | 'ai' | 'styles' | 'profile'

type ModalScreen =
  | { type: 'none' }
  | { type: 'post_detail'; postId: string }
  | { type: 'brand_kit'; channelId: string; channelUsername: string }
  | { type: 'community'; channelId: string; channelUsername: string }
  | { type: 'plans' }
  | { type: 'admin' }

function AppContent() {
  const { toasts, authStatus, activeChannel, canUseAiAssistant, t } = useApp()
  const { step: wtStep, start: startWalkthrough, notifyStyleOpened } = useWalkthrough()
  const [activeTab, setActiveTab]             = useState<MainTab>('posts')
  const [modal, setModal]                     = useState<ModalScreen>({ type: 'none' })
  const [chatMessages, setChatMessages]       = useState<ChatMessage[]>([])
  const [createPrefill, setCreatePrefill]     = useState<{ text: string; nonce: number } | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !localStorage.getItem('cf_onboarded') } catch { return true }
  })
  const dismissOnboarding = useCallback(() => {
    try { localStorage.setItem('cf_onboarded', '1') } catch {}
    setShowOnboarding(false)
    startWalkthrough()   // kick off the guided walkthrough after the slides
  }, [startWalkthrough])
  const [chatHistoryLoaded, setChatHistoryLoaded] = useState(false)
  const [chatSessionId, setChatSessionId]     = useState<string | null>(null)
  const [chatLoading, setChatLoading]         = useState(false)
  const [confirmingPlanId, setConfirmingPlanId] = useState<string | null>(null)
  const [showChatScrollBtn, setShowChatScrollBtn] = useState(false)
  const chatScrollFn = useRef<(() => void) | null>(null)

  const sendChatMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || chatLoading) return

    setChatMessages(prev => [...prev, { role: 'user', content: trimmed }])
    setChatLoading(true)

    try {
      const initData = getTelegramInitData() ?? 'mock'
      const res = await fetch(`${API_BASE}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          initData,
          channelId: activeChannel?.id ?? '',
          message:   trimmed,
          stream:    true,
          ...(chatSessionId ? { sessionId: chatSessionId } : {}),
        }),
      })

      const ctype = res.headers.get('content-type') ?? ''
      if (res.ok && ctype.includes('text/event-stream') && res.body) {
        // Streaming path: grow the assistant bubble as chunks arrive.
        setChatMessages(prev => [...prev, { role: 'assistant', content: '' }])
        const updateLast = (content: string, plan?: ContentPlan) =>
          setChatMessages(prev => {
            const copy = [...prev]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content, ...(plan ? { plan } : {}) }
            return copy
          })
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let acc = ''
        let donePlan: ContentPlan | undefined
        let failed = false
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let sep: number
          while ((sep = buf.indexOf('\n\n')) >= 0) {
            const rawEvent = buf.slice(0, sep)
            buf = buf.slice(sep + 2)
            const dataStr = rawEvent.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
            if (!dataStr) continue
            try {
              const evt = JSON.parse(dataStr) as { type?: string; text?: string; sessionId?: string; plan?: ContentPlan }
              if (evt.type === 'chunk' && typeof evt.text === 'string') { acc += evt.text; updateLast(acc) }
              else if (evt.type === 'done') { if (evt.sessionId) setChatSessionId(evt.sessionId); donePlan = evt.plan }
              else if (evt.type === 'error') failed = true
            } catch { /* skip malformed event */ }
          }
        }
        if (failed && !acc) updateLast('Не удалось получить ответ. Попробуй ещё раз.')
        else if (donePlan) updateLast(acc, donePlan)
      } else {
        // JSON path: errors (quota, auth) or a non-streaming server.
        const data = await res.json() as { reply?: string; error?: string; plan?: ContentPlan; sessionId?: string }
        if (data.sessionId) setChatSessionId(data.sessionId)
        const reply = data.reply ?? data.error ?? 'Ошибка'
        setChatMessages(prev => [...prev, { role: 'assistant', content: reply, plan: data.plan }])
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Ошибка соединения' }])
    } finally {
      setChatLoading(false)
    }
  }, [activeChannel, chatLoading, chatSessionId])

  // Live progress poller for a generating plan. Updates the card's status +
  // n/N until the plan reaches a terminal state (SCHEDULED/FAILED/CANCELLED).
  const planTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pollPlan = useCallback((planId: string) => {
    let attempts = 0
    const tick = async () => {
      attempts++
      try {
        const initData = getTelegramInitData() ?? 'mock'
        const res = await fetch(`${API_BASE}/api/content-plan/${planId}?initData=${encodeURIComponent(initData)}`)
        if (res.ok) {
          const data = await res.json() as { status?: string; processed?: number }
          if (data.status) {
            setChatMessages(prev => prev.map(m =>
              m.plan?.id === planId ? { ...m, plan: { ...m.plan, status: data.status!, processed: data.processed } } : m))
            if (data.status !== 'GENERATING') { delete planTimers.current[planId]; return } // terminal
          }
        }
      } catch { /* transient — keep polling */ }
      if (attempts < 200) {   // hard cap ~13 min at 4s
        planTimers.current[planId] = setTimeout(tick, 4000)
      } else {
        delete planTimers.current[planId]
      }
    }
    void tick()
  }, [])

  // Clear any active plan pollers on unmount.
  useEffect(() => () => { for (const t of Object.values(planTimers.current)) clearTimeout(t) }, [])

  // «Приступить» — confirm a content-series plan; the worker fills Отложка.
  const handleConfirmPlan = useCallback(async (plan: ContentPlan) => {
    if (confirmingPlanId) return
    setConfirmingPlanId(plan.id)
    const setPlanStatus = (status: string) =>
      setChatMessages(prev => prev.map(m =>
        m.plan?.id === plan.id ? { ...m, plan: { ...m.plan, status } } : m))
    try {
      const initData = getTelegramInitData() ?? 'mock'
      const res = await fetch(`${API_BASE}/api/content-plan/${plan.id}/confirm`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        setChatMessages(prev => [...prev, { role: 'assistant', content: err.error ?? 'Не удалось запустить план.' }])
        return
      }
      setPlanStatus('GENERATING')
      pollPlan(plan.id)
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Ошибка соединения при запуске плана.' }])
    } finally {
      setConfirmingPlanId(null)
    }
  }, [confirmingPlanId, pollPlan])

  // Cancel a draft (discard) or generating (stop worker) plan.
  const handleCancelPlan = useCallback(async (plan: ContentPlan) => {
    const timer = planTimers.current[plan.id]
    if (timer) { clearTimeout(timer); delete planTimers.current[plan.id] }
    setChatMessages(prev => prev.map(m =>
      m.plan?.id === plan.id ? { ...m, plan: { ...m.plan, status: 'CANCELLED' } } : m))
    try {
      const initData = getTelegramInitData() ?? 'mock'
      await fetch(`${API_BASE}/api/content-plan/${plan.id}/cancel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData }),
      })
    } catch { /* best-effort — card already reflects cancellation */ }
  }, [])

  const handleOpenPost = (id: string) => setModal({ type: 'post_detail', postId: id })
  const handlePostCreated = (id: string) => { setActiveTab('posts'); setModal({ type: 'post_detail', postId: id }) }
  const handleOpenBrandKit = (channelId: string, channelUsername: string) => setModal({ type: 'brand_kit', channelId, channelUsername })
  const handleOpenCommunity = (channelId: string, channelUsername: string) => setModal({ type: 'community', channelId, channelUsername })
  const handleOpenPlans = () => setModal({ type: 'plans' })
  const handleOpenAdmin = () => setModal({ type: 'admin' })
  // AI assistant → Create handoff: prefill Create with a reply and switch tabs.
  const handleSendToCreate = useCallback((text: string) => {
    setCreatePrefill({ text, nonce: Date.now() })
    setModal({ type: 'none' })
    setActiveTab('create')
  }, [])
  const handleBack = () => {
    // Closing the channel-style screen during the walkthrough advances step 2 → 3
    if (wtStep === 'style' && modal.type === 'brand_kit') notifyStyleOpened()
    setModal({ type: 'none' })
  }

  // Drive the user to the right screen for the active walkthrough step.
  useEffect(() => {
    if (wtStep === 'connect' || wtStep === 'style') {
      setModal({ type: 'none' })
      setActiveTab('profile')
    } else if (wtStep === 'create') {
      setModal({ type: 'none' })
      setActiveTab('create')
    }
  }, [wtStep])

  const isModalOpen = modal.type !== 'none'

  if (authStatus === 'checking') {
    return (
      <div className="flex flex-col h-full bg-[#070708] items-center justify-center gap-3">
        <Loader2 size={22} className="animate-spin text-[#FF6A00]" />
        <p className="text-[12px] text-[#55555D]">Loading…</p>
      </div>
    )
  }

  if (authStatus === 'failed') {
    return (
      <div className="flex flex-col h-full bg-[#070708] items-center justify-center px-8">
        <div className="text-center space-y-2">
          <p className="text-[14px] font-semibold text-white">Could not connect</p>
          <p className="text-[12px] text-[#55555D] leading-relaxed">Close and reopen the app to try again.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#070708] overflow-hidden">
      <ToastContainer toasts={toasts} />

      {showOnboarding && <OnboardingSlides onDone={dismissOnboarding} />}

      <AnimatePresence mode="wait" initial={false}>
        {isModalOpen ? (
          <div key="modal" className="flex-1 min-h-0 overflow-y-auto page-content no-scrollbar">
            {modal.type === 'post_detail' && <PostDetailsScreen postId={modal.postId} onBack={handleBack} />}
            {modal.type === 'brand_kit' && (
              <BrandKitScreen channelId={modal.channelId} channelUsername={modal.channelUsername} onBack={handleBack} />
            )}
            {modal.type === 'community' && (
              <CommunityScreen channelId={modal.channelId} channelUsername={modal.channelUsername} onBack={handleBack} />
            )}
            {modal.type === 'plans' && <PlansScreen onBack={handleBack} />}
            {modal.type === 'admin' && <AdminPanelScreen onBack={handleBack} />}
          </div>
        ) : (
          <>
            {canUseAiAssistant ? (
              <div className={activeTab === 'ai' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
                <ChatScreen
                  messages={chatMessages}
                  setMessages={setChatMessages}
                  historyLoaded={chatHistoryLoaded}
                  setHistoryLoaded={setChatHistoryLoaded}
                  sessionId={chatSessionId}
                  setSessionId={setChatSessionId}
                  onSend={sendChatMessage}
                  onSendToCreate={handleSendToCreate}
                  onConfirmPlan={handleConfirmPlan}
                  onCancelPlan={handleCancelPlan}
                  confirmingPlanId={confirmingPlanId}
                  loading={chatLoading}
                  active={activeTab === 'ai'}
                  onBack={() => { setActiveTab('posts'); setShowChatScrollBtn(false) }}
                  onScrollBtnChange={(visible, fn) => { setShowChatScrollBtn(visible); chatScrollFn.current = fn }}
                />
              </div>
            ) : activeTab === 'ai' ? (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-8 text-center gap-4">
                <div className="w-14 h-14 rounded-full bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.22)] flex items-center justify-center">
                  <Bot size={26} className="text-[#FF6A00]" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[16px] font-bold text-white">{t('aiGate.title')}</p>
                  <p className="text-[13px] text-[#A1A1AA] leading-relaxed">
                    {t('aiGate.text')}
                  </p>
                </div>
                <button
                  onClick={handleOpenPlans}
                  className="mt-1 px-5 py-2.5 rounded-[12px] bg-[#FF6A00] text-white text-[13px] font-semibold hover:bg-[#ff7a1a] transition-colors orange-glow"
                >
                  {t('aiGate.cta')}
                </button>
              </div>
            ) : null}
            {activeTab !== 'ai' && (
              <AppShell key={activeTab} pageKey={activeTab}>
                {activeTab === 'posts' && <PostsScreen onOpenPost={handleOpenPost} />}
                {activeTab === 'create' && <CreateScreen onPostCreated={handlePostCreated} prefill={createPrefill} onPrefillConsumed={() => setCreatePrefill(null)} />}
                {activeTab === 'styles' && <StylesScreen />}
                {activeTab === 'profile' && <ProfileScreen onOpenBrandKit={handleOpenBrandKit} onOpenCommunity={handleOpenCommunity} onOpenPlans={handleOpenPlans} onOpenAdmin={handleOpenAdmin} />}
              </AppShell>
            )}
          </>
        )}
      </AnimatePresence>

      <BottomNav
        active={activeTab}
        onChange={tab => { setModal({ type: 'none' }); setActiveTab(tab) }}
        onAISend={sendChatMessage}
        aiLoading={chatLoading}
        aiEnabled={canUseAiAssistant}
        showScrollBtn={activeTab === 'ai' && showChatScrollBtn}
        onScrollToBottom={() => chatScrollFn.current?.()}
      />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <WalkthroughProvider>
        <AppContent />
      </WalkthroughProvider>
    </AppProvider>
  )
}
