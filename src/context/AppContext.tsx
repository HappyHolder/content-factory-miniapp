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

// ─── Auth status ─────────────────────────────────────────────────────────────
// 'mock'          — dev/browser mode (no initData); mock data shown immediately
// 'checking'      — Telegram mode, POST /api/auth/telegram in-flight; blank shell rendered
// 'authenticated' — auth succeeded; real user/channels/posts in state
// 'failed'        — auth or network error; minimal error screen shown, app stable
export type AuthStatus = 'mock' | 'checking' | 'authenticated' | 'failed'

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
  authStatus: AuthStatus
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
  // Detect Telegram mode synchronously before the first render.
  // getTelegramInitData() reads window.Telegram.WebApp.initData which is set
  // by the SDK script tag before any React code runs — safe to call here.
  const [authStatus, setAuthStatus] = useState<AuthStatus>(() =>
    getTelegramInitData() ? 'checking' : 'mock'
  )

  const [state, setState] = useState<AppState>(() => {
    if (getTelegramInitData()) {
      // Telegram mode — start with an empty shell so no mock data is ever
      // rendered while POST /api/auth/telegram is in-flight.
      postService.init([])
      brandKitService.init([])
      channelService.init([])
      return {
        ...mockInitialState,   // preserves subscription shape / user placeholder
        channels:        [],
        brandKits:       [],
        posts:           [],
        activeChannelId: '',
      }
    }
    // Dev / plain-browser mode — use mock data as today
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
  // Dev / browser mode (no initData):
  //   → authStatus stays 'mock'; mock state shown immediately; no fetch.
  //
  // Telegram mode (initData present), auth succeeds:
  //   → replace user, channels, brandKits, posts, activeChannelId with real data.
  //   → authStatus → 'authenticated'; real UI renders.
  //
  // Telegram mode, auth fails (network error / 401 / unexpected shape):
  //   → authStatus → 'failed'; minimal error screen shown; app stays stable.
  useEffect(() => {
    notifyTelegramReady()
    const initData = getTelegramInitData()
    if (!initData) return  // dev / plain-browser mode — authStatus stays 'mock'

    interface TelegramAuthResponse {
      user: {
        id: string
        name: string | null
        telegramId: string
        username: string | null
      }
      channels: Channel[]
      // brandKits is optional so older backend versions stay compatible
      brandKits?: {
        channelId:    string
        channelAbout: unknown
        voiceProfile: unknown
        emojiPack:    unknown
        linkKit:      unknown
        visualKit:    unknown
        signature:    unknown
        postRules:    unknown
      }[]
      subscription: null
    }

    fetch(`${API_BASE}/api/auth/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
      .then(res => (res.ok ? res.json() as Promise<TelegramAuthResponse> : null))
      .then((data: TelegramAuthResponse | null) => {
        if (!data?.user) {
          setAuthStatus('failed')   // unexpected shape / non-ok response
          return
        }

        const realChannels: Channel[] = data.channels ?? []

        // Build shaped BrandKits: start from defaults, then overwrite with
        // any non-null sections returned from the DB (saved by the user previously).
        // Null/missing sections keep the default shape so forms always render correctly.
        const dbBrandKits = data.brandKits ?? []
        const realBrandKits = realChannels.map(ch => {
          const kit = createDefaultBrandKit(ch.id)
          const dbKit = dbBrandKits.find(k => k.channelId === ch.id)
          if (!dbKit) return kit
          // Overwrite defaults with saved sections. Casting via `as any` because
          // Prisma Json? columns arrive as `unknown` but were written from the
          // same frontend interfaces — the shapes are guaranteed to match.
          const SECTIONS = [
            'channelAbout', 'voiceProfile', 'emojiPack',
            'linkKit', 'visualKit', 'signature', 'postRules',
          ] as const
          for (const key of SECTIONS) {
            if (dbKit[key] != null) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ;(kit as any)[key] = dbKit[key]
            }
          }
          return kit
        })

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
        setAuthStatus('authenticated')
      })
      .catch(() => {
        setAuthStatus('failed')   // network error — show error screen, do not crash
      })
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
    // 1. Immediate in-memory update — UI reflects changes instantly
    brandKitService.update(channelId, updates)
    setState(prev => ({
      ...prev,
      brandKits: brandKitService.getAll(),
    }))
    showToast(t('channelStyle.saved'))

    // 2. Persist to Neon — fire-and-forget; does not block UI or crash on failure
    if (authStatus === 'authenticated') {
      const initData = getTelegramInitData()
      if (initData) {
        fetch(`${API_BASE}/api/brandkits/${channelId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ initData, sections: updates }),
        }).catch(err => {
          // Non-fatal: in-memory save already succeeded; user sees no error.
          // Silent log only — do not expose initData or secrets.
          console.error('[updateBrandKit] Backend save failed:', (err as Error).message)
        })
      }
    }
  }, [showToast, t, authStatus])

  const activeChannel = state.channels.find(c => c.id === state.activeChannelId)

  // STARTER cannot schedule posts; CREATOR and STUDIO_PRO can
  const canSchedulePosts = state.user.subscription.planTier !== 'starter'

  return (
    <AppContext.Provider value={{
      state,
      authStatus,
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
