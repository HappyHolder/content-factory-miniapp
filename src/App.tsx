import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
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

type MainTab = 'posts' | 'create' | 'profile'

type ModalScreen =
  | { type: 'none' }
  | { type: 'post_detail'; postId: string }
  | { type: 'brand_kit'; channelId: string; channelUsername: string }
  | { type: 'plans' }

function AppContent() {
  const { toasts, authStatus } = useApp()
  const [activeTab, setActiveTab] = useState<MainTab>('posts')
  const [modal, setModal] = useState<ModalScreen>({ type: 'none' })

  const handleOpenPost = (id: string) => {
    setModal({ type: 'post_detail', postId: id })
  }

  const handlePostCreated = (id: string) => {
    setActiveTab('posts')
    setModal({ type: 'post_detail', postId: id })
  }

  const handleOpenBrandKit = (channelId: string, channelUsername: string) => {
    setModal({ type: 'brand_kit', channelId, channelUsername })
  }

  const handleOpenPlans = () => {
    setModal({ type: 'plans' })
  }

  const handleBack = () => {
    setModal({ type: 'none' })
  }

  const isModalOpen = modal.type !== 'none'

  // ── Auth gate ─────────────────────────────────────────────────────────────
  // Show a neutral loading screen while POST /api/auth/telegram is in-flight
  // so real Telegram users never see a flash of mock @my_channel / mock posts.
  // Dev/browser mode (authStatus === 'mock') bypasses this entirely.
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
          <p className="text-[12px] text-[#55555D] leading-relaxed">
            Close and reopen the app to try again.
          </p>
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
            {modal.type === 'post_detail' && (
              <PostDetailsScreen postId={modal.postId} onBack={handleBack} />
            )}
            {modal.type === 'brand_kit' && (
              <BrandKitScreen
                channelId={modal.channelId}
                channelUsername={modal.channelUsername}
                onBack={handleBack}
              />
            )}
            {modal.type === 'plans' && (
              <PlansScreen onBack={handleBack} />
            )}
          </div>
        ) : (
          <AppShell key={activeTab} pageKey={activeTab}>
            {activeTab === 'posts' && <PostsScreen onOpenPost={handleOpenPost} />}
            {activeTab === 'create' && <CreateScreen onPostCreated={handlePostCreated} />}
            {activeTab === 'profile' && <ProfileScreen onOpenBrandKit={handleOpenBrandKit} onOpenPlans={handleOpenPlans} />}
          </AppShell>
        )}
      </AnimatePresence>

      <BottomNav active={activeTab} onChange={tab => { setModal({ type: 'none' }); setActiveTab(tab) }} />
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
