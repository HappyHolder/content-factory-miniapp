import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react'
import type { AppState, GeneratedPost, Channel, BrandKit } from '@/types'
import { mockInitialState } from '@/data/mockData'
import { postService } from '@/services/postService'
import { brandKitService } from '@/services/brandKitService'
import { channelService } from '@/services/channelService'
import {
  type Language,
  type TranslationKey,
  getInitialLanguage,
  setStoredLanguage,
  createTranslator,
} from '@/i18n'
import { getTelegramInitData, notifyTelegramReady } from '@/lib/telegram'

// Use VITE_API_BASE_URL if set (local dev pointing at localhost:8787),
// otherwise fall back to empty string so relative /api paths work in production.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

interface AppContextValue {
  state: AppState
  activeChannel: Channel | undefined
  canSchedulePosts: boolean
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey) => string
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
  const [language, setLanguageState] = useState<Language>(getInitialLanguage)

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    setStoredLanguage(lang)
  }, [])

  const t = useMemo(() => createTranslator(language), [language])

  const showToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = `t-${Date.now()}`
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])

  // ── Telegram auth ─────────────────────────────────────────────────────────
  // Fires once at mount. Calls ready() so Telegram shows the app immediately.
  //
  // Dev / browser mode  (no initData):
  //   → keep mock state as-is, no fetch.
  //
  // Real Telegram mode (initData present), auth succeeds:
  //   → replace user, channels, brandKits, posts, activeChannelId with backend data.
  //   → channels is [] until GET /api/channels is implemented; posts are [] for new users.
  //   → real users must not see @my_channel / @tech_digest or their mock posts.
  //
  // Real Telegram mode, auth fails (network error / 401):
  //   → keep mock state, do not crash.
  useEffect(() => {
    notifyTelegramReady()
    const initData = getTelegramInitData()
    if (!initData) return  // dev / plain-browser mode — keep mock state

    interface TelegramAuthResponse {
      user: {
        id: string
        name: string | null
        telegramId: string
        username: string | null
      }
      channels: Channel[]   // [] until GET /api/channels is wired
      subscription: null
    }

    fetch(`${API_BASE}/api/auth/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
      .then(res => (res.ok ? res.json() as Promise<TelegramAuthResponse> : null))
      .then((data: TelegramAuthResponse | null) => {
        if (!data?.user) return  // unexpected shape — keep mock state

        const realChannels: Channel[] = data.channels ?? []

        // Re-initialise in-memory services to match real user's data
        channelService.init(realChannels)
        postService.init([])       // no posts yet for a new real user
        brandKitService.init([])   // no brand kits yet

        setState(prev => ({
          ...prev,
          user: {
            ...prev.user,            // preserve subscription + avatarUrl (not in auth response)
            id:       data.user.id,
            name:     data.user.name     ?? prev.user.name,
            username: data.user.username ?? prev.user.username,
          },
          channels:        realChannels,
          brandKits:       [],
          posts:           [],
          activeChannelId: realChannels[0]?.id ?? '',
        }))
      })
      .catch(() => { /* network / auth error — keep mock state, do not crash */ })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    showToast(t('channelStyle.saved'))
  }, [showToast, t])

  const activeChannel = state.channels.find(c => c.id === state.activeChannelId)

  // STARTER cannot schedule posts; CREATOR and STUDIO_PRO can
  const canSchedulePosts = state.user.subscription.planTier !== 'starter'

  return (
    <AppContext.Provider value={{
      state,
      activeChannel,
      canSchedulePosts,
      language,
      setLanguage,
      t,
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
