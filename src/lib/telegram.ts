import { API_BASE } from './api'

// Safe Telegram Mini App helpers for the frontend.
// All functions work in plain browser dev mode — when window.Telegram is absent
// they return null / no-op silently. Never throw outside the Telegram environment.

interface TelegramWebApp {
  initData: string
  initDataUnsafe?: { user?: { id?: number } }
  version?: string
  platform?: string
  ready?: () => void
  openInvoice?: (url: string, callback: (status: string) => void) => void
  shareMessage?: (msgId: string, callback?: (sent: boolean) => void) => void
  switchInlineQuery?: (query: string, chooseChatTypes?: Array<'users' | 'bots' | 'groups' | 'channels'>) => void
  onEvent?: (eventType: string, eventHandler: (eventData?: unknown) => void) => void
  offEvent?: (eventType: string, eventHandler: (eventData?: unknown) => void) => void
}

interface TelegramGlobal {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}

function getWebApp(): TelegramWebApp | undefined {
  return (window as unknown as TelegramGlobal).Telegram?.WebApp
}

/**
 * Returns the raw initData string provided by Telegram, or null when running
 * outside the Telegram Mini App environment (e.g. plain browser dev mode).
 */
export function getTelegramInitData(): string | null {
  const initData = getWebApp()?.initData
  return typeof initData === 'string' && initData.trim().length > 0
    ? initData
    : null
}

/**
 * Returns the current Telegram user's numeric id (as a string), or null outside
 * Telegram. Used to tag TON payments with a comment so the backend can bind a
 * deposit to the paying account.
 */
export function getTelegramUserId(): string | null {
  const id = getWebApp()?.initDataUnsafe?.user?.id
  return typeof id === 'number' && Number.isFinite(id) ? String(id) : null
}

/**
 * Signals to Telegram that the Mini App finished loading and is ready to be
 * displayed. Safe to call outside Telegram — becomes a no-op.
 */
export function notifyTelegramReady(): void {
  try {
    getWebApp()?.ready?.()
  } catch {
    // not in Telegram environment — ignore
  }
}

/**
 * Opens the native Telegram Stars invoice. Returns false (no-op) when not running
 * inside Telegram or the method is unavailable, so callers can show a fallback.
 */
export function openTelegramInvoice(url: string, callback: (status: string) => void): boolean {
  const wa = getWebApp()
  if (!wa?.openInvoice) return false
  wa.openInvoice(url, callback)
  return true
}

export function isTelegramIOS(): boolean {
  return getWebApp()?.platform?.toLowerCase() === 'ios'
}

/**
 * Opens Telegram's regular chat selector and then inline results in the chosen
 * chat. Used on iOS because its prepared-message preview doesn't scroll for
 * long Rich Messages.
 */
export function switchTelegramInlineShare(query: string): boolean {
  const wa = getWebApp()
  if (typeof wa?.switchInlineQuery !== 'function') return false
  try {
    wa.switchInlineQuery(query, ['users', 'groups', 'channels'])
    return true
  } catch {
    return false
  }
}

/**
 * Opens Telegram's native share dialog for a prepared inline message (Fast Share).
 * `preparedMessageId` comes from the backend's savePreparedInlineMessage call.
 * Returns false (no-op) when the running Telegram client is too old to support
 * shareMessage, so callers can show a fallback message.
 */
export type TelegramShareResult =
  | { status: 'sent' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string }

export function shareTelegramMessage(preparedMessageId: string, callback?: (result: TelegramShareResult) => void): boolean {
  const wa = getWebApp()
  if (typeof wa?.shareMessage !== 'function') return false

  let finished = false
  let sentHandler: ((eventData?: unknown) => void) | undefined
  let failedHandler: ((eventData?: unknown) => void) | undefined
  const cleanup = () => {
    if (sentHandler) wa.offEvent?.('shareMessageSent', sentHandler)
    if (failedHandler) wa.offEvent?.('shareMessageFailed', failedHandler)
  }
  const finish = (result: TelegramShareResult) => {
    if (finished) return
    finished = true
    cleanup()
    callback?.(result)
  }

  try {
    if (typeof wa.onEvent === 'function' && typeof wa.offEvent === 'function') {
      sentHandler = () => finish({ status: 'sent' })
      failedHandler = eventData => {
        const error = eventData && typeof eventData === 'object' && 'error' in eventData
          ? String((eventData as { error?: unknown }).error ?? 'UNKNOWN_ERROR')
          : 'UNKNOWN_ERROR'
        finish(error === 'USER_DECLINED' ? { status: 'cancelled' } : { status: 'failed', error })
      }
      wa.onEvent('shareMessageSent', sentHandler)
      wa.onEvent('shareMessageFailed', failedHandler)
      wa.shareMessage(preparedMessageId)
    } else {
      wa.shareMessage(preparedMessageId, sent => finish(sent ? { status: 'sent' } : { status: 'cancelled' }))
    }
    return true
  } catch {
    cleanup()
    return false
  }
}
let moderatorSessionPromise: Promise<{ token: string; expiresAtMs: number }> | null = null

async function moderatorSessionToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) moderatorSessionPromise = null
  if (!moderatorSessionPromise) {
    moderatorSessionPromise = (async () => {
      const initData = getTelegramInitData()
      if (!initData) throw new Error('Откройте Publium внутри Telegram')
      const response = await fetch(`${API_BASE}/api/auth/moderator-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      })
      const data = await response.json() as { token?: string; expiresAt?: string; error?: string }
      if (response.status === 401 && data.error === 'initData has expired') {
        throw new Error('Сессия Telegram устарела. Полностью закройте Publium и откройте его снова через бота.')
      }
      if (!response.ok || !data.token || !data.expiresAt) throw new Error(data.error ?? 'Не удалось открыть безопасную сессию Moderator')
      return { token: data.token, expiresAtMs: Date.parse(data.expiresAt) }
    })().catch(error => {
      moderatorSessionPromise = null
      throw error
    })
  }
  const session = await moderatorSessionPromise
  if (!Number.isFinite(session.expiresAtMs) || session.expiresAtMs <= Date.now() + 30_000) {
    return moderatorSessionToken(true)
  }
  return session.token
}

/** Authenticated fetch for Community/Moderator APIs. Raw initData is exchanged once and never put in URLs or mutation bodies. */
export async function moderatorFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const request = async (forceRefresh = false) => {
    const token = await moderatorSessionToken(forceRefresh)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers })
  }
  const response = await request()
  if (response.status !== 401) return response
  return request(true)
}