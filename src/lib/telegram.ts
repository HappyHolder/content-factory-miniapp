// Safe Telegram Mini App helpers for the frontend.
// All functions work in plain browser dev mode — when window.Telegram is absent
// they return null / no-op silently. Never throw outside the Telegram environment.

interface TelegramWebApp {
  initData: string
  ready?: () => void
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
