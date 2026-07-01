// Safe Telegram Mini App helpers for the frontend.
// All functions work in plain browser dev mode — when window.Telegram is absent
// they return null / no-op silently. Never throw outside the Telegram environment.

interface TelegramWebApp {
  initData: string
  initDataUnsafe?: { user?: { id?: number } }
  version?: string
  ready?: () => void
  openInvoice?: (url: string, callback: (status: string) => void) => void
  shareMessage?: (msgId: string, callback?: (sent: boolean) => void) => void
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

/**
 * Opens Telegram's native share dialog for a prepared inline message (Fast Share).
 * `preparedMessageId` comes from the backend's savePreparedInlineMessage call.
 * Returns false (no-op) when the running Telegram client is too old to support
 * shareMessage, so callers can show a fallback message.
 */
export function shareTelegramMessage(preparedMessageId: string, callback?: (sent: boolean) => void): boolean {
  const wa = getWebApp()
  if (typeof wa?.shareMessage !== 'function') return false
  try {
    wa.shareMessage(preparedMessageId, callback)
    return true
  } catch {
    return false
  }
}
