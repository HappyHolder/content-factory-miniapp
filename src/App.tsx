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
import { ProfileScreen } from '@/screens/ProfileScreen'
import { PostDetailsScreen } from '@/screens/PostDetailsScreen'
import { BrandKitScreen } from '@/screens/BrandKitScreen'
import { PlansScreen } from '@/screens/PlansScreen'
import { AdminPromoScreen } from '@/screens/AdminPromoScreen'
import { OnboardingSlides } from '@/screens/OnboardingSlides'
import { ChatScreen, type ChatMessage } from '@/screens/ChatScreen'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'

type MainTab = 'posts' | 'create' | 'ai' | 'profile'

type ModalScreen =
  | { type: 'none' }
  | { type: 'post_detail'; postId: string }
  | { type: 'brand_kit'; channelId: string; channelUsername: string }
  | { type: 'plans' }
  | { type: 'admin_promo' }

function AppContent() {
  const { toasts, authStatus, activeChannel, canUseAiAssistant, t } = useApp()
  const { step: wtStep, start: startWalkthrough, notifyStyleOpened } = useWalkthrough()
  const [activeTab, setActiveTab]             = useState<MainTab>('posts')
  const [modal, setModal]                     = useState<ModalScreen>({ type: 'none' })
  const [chatMessages, setChatMessages]       = useState<ChatMessage[]>([])
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !localStorage.getItem('cf_onboarded') } catch { return true }
  })
  const dismissOnboarding = useCallback(() => {
    try { localStorage.setItem('cf_onboarded', '1') } catch {}
    setShowOnboarding(false)
    startWalkthrough()   // kick off the guided walkthrough after the slides
  }, [startWalkthrough])
  const [chatHistoryLoaded, setChatHistoryLoaded] = useState(false)
  const [chatLoading, setChatLoading]         = useState(false)
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
        }),
      })
      const data = await res.json() as { reply?: string; error?: string }
      const reply = data.reply ?? data.error ?? 'Ошибка'
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Ошибка соединения' }])
    } finally {
      setChatLoading(false)
    }
  }, [activeChannel, chatLoading])

  const handleOpenPost = (id: string) => setModal({ type: 'post_detail', postId: id })
  const handlePostCreated = (id: string) => { setActiveTab('posts'); setModal({ type: 'post_detail', postId: id }) }
  const handleOpenBrandKit = (channelId: string, channelUsername: string) => setModal({ type: 'brand_kit', channelId, channelUsername })
  const handleOpenPlans = () => setModal({ type: 'plans' })
  const handleOpenAdmin = () => setModal({ type: 'admin_promo' })
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
            {modal.type === 'plans' && <PlansScreen onBack={handleBack} />}
            {modal.type === 'admin_promo' && <AdminPromoScreen onBack={handleBack} />}
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
                  onSend={sendChatMessage}
                  loading={chatLoading}
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
                {activeTab === 'create' && <CreateScreen onPostCreated={handlePostCreated} />}
                {activeTab === 'profile' && <ProfileScreen onOpenBrandKit={handleOpenBrandKit} onOpenPlans={handleOpenPlans} onOpenAdmin={handleOpenAdmin} />}
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
