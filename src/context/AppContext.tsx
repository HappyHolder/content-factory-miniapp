import React, { createContext, useContext, useState, useCallback } from 'react'
import type { AppState, GeneratedPost, Channel, BrandKit } from '@/types'
import { mockInitialState } from '@/data/mockData'
import { postService } from '@/services/postService'
import { brandKitService } from '@/services/brandKitService'
import { channelService } from '@/services/channelService'

interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

interface AppContextValue {
  state: AppState
  activeChannel: Channel | undefined
  canSchedulePosts: boolean
  addPost: (post: GeneratedPost) => void
  updatePost: (id: string, updates: Partial<GeneratedPost>) => void
  publishPost: (id: string) => void
  schedulePost: (id: string, at: Date) => void
  cancelSchedule: (id: string) => void
  selectVariant: (postId: string, variantId: string) => void
  updateVariantText: (postId: string, variantId: string, text: string) => void
  setActiveChannel: (id: string) => void
  updateBrandKit: (channelId: string, kit: Partial<BrandKit>) => void
  toasts: Toast[]
  showToast: (message: string, type?: Toast['type']) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(() => {
    postService.init(mockInitialState.posts)
    brandKitService.init(mockInitialState.brandKits)
    channelService.init(mockInitialState.channels)
    return mockInitialState
  })
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = `t-${Date.now()}`
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])

  const refreshPosts = useCallback(() => {
    setState(prev => ({ ...prev, posts: postService.getAll() }))
  }, [])

  const addPost = useCallback((post: GeneratedPost) => {
    postService.add(post)
    refreshPosts()
  }, [refreshPosts])

  const updatePost = useCallback((id: string, updates: Partial<GeneratedPost>) => {
    postService.update(id, updates)
    refreshPosts()
  }, [refreshPosts])

  const publishPost = useCallback((id: string) => {
    postService.publish(id)
    refreshPosts()
    showToast('Post published successfully')
  }, [refreshPosts, showToast])

  const schedulePost = useCallback((id: string, at: Date) => {
    postService.schedule(id, at)
    refreshPosts()
    showToast('Post scheduled')
  }, [refreshPosts, showToast])

  const cancelSchedule = useCallback((id: string) => {
    postService.cancelSchedule(id)
    refreshPosts()
    showToast('Schedule cancelled')
  }, [refreshPosts, showToast])

  const selectVariant = useCallback((postId: string, variantId: string) => {
    postService.selectVariant(postId, variantId)
    refreshPosts()
  }, [refreshPosts])

  const updateVariantText = useCallback((postId: string, variantId: string, text: string) => {
    postService.updateVariantText(postId, variantId, text)
    refreshPosts()
  }, [refreshPosts])

  const setActiveChannel = useCallback((id: string) => {
    setState(prev => ({ ...prev, activeChannelId: id }))
  }, [])

  const updateBrandKit = useCallback((channelId: string, updates: Partial<BrandKit>) => {
    brandKitService.update(channelId, updates)
    setState(prev => ({
      ...prev,
      brandKits: brandKitService.getAll(),
    }))
    showToast('Brand Kit saved')
  }, [showToast])

  const activeChannel = state.channels.find(c => c.id === state.activeChannelId)

  // STARTER cannot schedule posts; CREATOR and STUDIO_PRO can
  const canSchedulePosts = state.user.subscription.planTier !== 'starter'

  return (
    <AppContext.Provider value={{
      state,
      activeChannel,
      canSchedulePosts,
      addPost,
      updatePost,
      publishPost,
      schedulePost,
      cancelSchedule,
      selectVariant,
      updateVariantText,
      setActiveChannel,
      updateBrandKit,
      toasts,
      showToast,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
