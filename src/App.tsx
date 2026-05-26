import { useState } from 'react'
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
  const { toasts } = useApp()
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
