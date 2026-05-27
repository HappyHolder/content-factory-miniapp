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
import { API_BASE } from '@/lib/api'

// ─── Default BrandKit factory ─────────────────────────────────────────────────
// The server stores BrandKit sections as nullable JSON blobs. The frontend
// interface requires non-null shaped objects. This factory fills sensible
// defaults so Channel Style forms render correctly for a freshly connected channel.
function createDefaultBrandKit(channelId: string): BrandKit {
  return {
    channelId,
    channelAbout: undefined,
    voiceProfile: {
      language:     'RU',
      addressStyle: 'ты',
      tone:         'expert',
      postLength:   'medium',
      emojiDensity: 'light',
      examplePosts:   [],
      favoriteWords:  [],
      forbiddenWords: [],
    },
    emojiPack: {
      packLink:           '',
      strictMode:         false,
      allowedEmojis:      [],
      fallbackToStandard: true,
    },
    linkKit: { links: [] },
    visualKit: {
      primaryColor:    '#FF6A00',
      secondaryColor:  '#1A0A00',
      backgroundStyle: 'dark',
      cardStyle:       'branded',
      watermark:       false,
      bannerTemplate:  'dark_glass',
      aspectRatio:     '16:9',
      textOnCover:     true,
      logoUsage:       'when_relevant',
      references:      [],
      avoidList:       [],
    },
    signature: {
      text:  '',
      usage: 'when_relevant',
    },
    postRules: {
      defaultStructure:      '',
      neverCopySource:       true,
      avoidClickbait:        true,
      shortParagraphs:       true,
      addCtaIfRelevant:      false,
      useLinkKitWhenRelevant:false,
      paragraphStyle:        'short',
      listUsage:             'when_relevant',
      ctaUsage:              'when_relevant',
      thingsToAvoid:         [],
    },
  }
}

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
  connectChannel: (channel: Channel) => void
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

        // Create default frontend BrandKits for every real channel
        // (server stores null JSON blobs; frontend needs shaped defaults)
        const realBrandKits = realChannels.map(ch => createDefaultBrandKit(ch.id))

        // Re-initialise in-memory services to match real user's data
        channelService.init(realChannels)
        postService.init([])
        brandKitService.init(realBrandKits)

        setState(prev => ({
          ...prev,
          user: {
            ...prev.user,            // preserve subscription + avatarUrl (not in auth response)
            id:       data.user.id,
            name:     data.user.name     ?? prev.user.name,
            username: data.user.username ?? prev.user.username,
          },
          channels:        realChannels,
          brandKits:       realBrandKits,
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

  const connectChannel = useCallback((channel: Channel) => {
    const newBrandKit = createDefaultBrandKit(channel.id)
    brandKitService.upsert(newBrandKit)

    setState(prev => {
      const alreadyExists = prev.channels.some(c => c.id === channel.id)

      const updatedChannels = alreadyExists
        // Re-connect of existing channel: refresh data, don't duplicate
        ? prev.channels.map(c => c.id === channel.id ? channel : c)
        // New channel: append
        : [...prev.channels, channel]

      const updatedBrandKits = alreadyExists
        ? prev.brandKits.map(k => k.channelId === channel.id ? newBrandKit : k)
        : [...prev.brandKits, newBrandKit]

      // Sync in-memory service to match new channels array
      channelService.init(updatedChannels)

      return {
        ...prev,
        channels:        updatedChannels,
        brandKits:       updatedBrandKits,
        activeChannelId: channel.id,
      }
    })
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
      connectChannel,
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
