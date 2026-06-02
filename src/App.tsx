import { useState, useCallback, useRef } from 'react'
import { Loader2, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { AppProvider, useApp } from '@/context/AppContext'
import { AppShell } from '@/components/layout/AppShell'
import { BottomNav } from '@/components/layout/BottomNav'
import { ToastContainer } from '@/components/ui/Toast'
import { PostsScreen } from '@/screens/PostsScreen'
import { CreateScreen } from '@/screens/CreateScreen'
import { ProfileScreen } from '@/screens/ProfileScreen'
import { PostDetailsScreen } from '@/screens/PostDetailsScreen'
import { BrandKitScreen } from '@/screens/BrandKitScreen'
import { PlansScreen } from '@/screens/PlansScreen'
import { ChatScreen, type ChatMessage } from '@/screens/ChatScreen'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'

type MainTab = 'posts' | 'create' | 'ai' | 'profile'

type ModalScreen =
  | { type: 'none' }
  | { type: 'post_detail'; postId: string }
  | { type: 'brand_kit'; channelId: string; channelUsername: string }
  | { type: 'plans' }

function AppContent() {
  const { toasts, authStatus, activeChannel } = useApp()
  const [activeTab, setActiveTab]             = useState<MainTab>('posts')
  const [modal, setModal]                     = useState<ModalScreen>({ type: 'none' })
  const [chatMessages, setChatMessages]       = useState<ChatMessage[]>([])
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
  const handleBack = () => setModal({ type: 'none' })

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

      <AnimatePresence mode="wait" initial={false}>
        {isModalOpen ? (
          <div key="modal" className="flex-1 min-h-0 overflow-y-auto page-content no-scrollbar">
            {modal.type === 'post_detail' && <PostDetailsScreen postId={modal.postId} onBack={handleBack} />}
            {modal.type === 'brand_kit' && (
              <BrandKitScreen channelId={modal.channelId} channelUsername={modal.channelUsername} onBack={handleBack} />
            )}
            {modal.type === 'plans' && <PlansScreen onBack={handleBack} />}
          </div>
        ) : (
          <>
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
            {activeTab !== 'ai' && (
              <AppShell key={activeTab} pageKey={activeTab}>
                {activeTab === 'posts' && <PostsScreen onOpenPost={handleOpenPost} />}
                {activeTab === 'create' && <CreateScreen onPostCreated={handlePostCreated} />}
                {activeTab === 'profile' && <ProfileScreen onOpenBrandKit={handleOpenBrandKit} onOpenPlans={handleOpenPlans} />}
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
        showScrollBtn={activeTab === 'ai' && showChatScrollBtn}
        onScrollToBottom={() => chatScrollFn.current?.()}
      />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}
