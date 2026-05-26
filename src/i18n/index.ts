import { en, type Dict } from './en'
import { ru } from './ru'

// Re-export Dict so consumers can import from '@/i18n' only
export type { Dict }

// ── Language type ─────────────────────────────────────────────────────────────

export type Language = 'ru' | 'en'

// ── Type-safe dot-notation key derivation ─────────────────────────────────────
//
// PathsOf<Dict> automatically derives every valid key from the Dict shape.
// e.g. 'nav.posts' | 'nav.create' | 'common.back' | 'language.title' | …
// When new keys are added to Dict, TranslationKey updates automatically.

type PathsOf<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? (Prefix extends '' ? K : `${Prefix}.${K}`)
    : PathsOf<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>
}[keyof T & string]

export type TranslationKey = PathsOf<Dict>

// ── Dictionaries ──────────────────────────────────────────────────────────────

const dictionaries: Record<Language, Dict> = { en, ru }

// ── localStorage persistence ──────────────────────────────────────────────────

const STORAGE_KEY = 'content-factory-language'

export function getStoredLanguage(): Language | null {
  try {
    const val = localStorage.getItem(STORAGE_KEY)
    if (val === 'ru' || val === 'en') return val
  } catch {
    // localStorage may be unavailable (SSR, strict private mode)
  }
  return null
}

export function setStoredLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {}
}

// ── Language detection ────────────────────────────────────────────────────────

function detectLanguage(): Language {
  // 1. Persisted user choice always wins
  const stored = getStoredLanguage()
  if (stored) return stored

  // 2. Telegram WebApp user language
  try {
    const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } }).Telegram?.WebApp
    const code = tg?.initDataUnsafe?.user?.language_code
    if (typeof code === 'string' && code.toLowerCase().startsWith('ru')) return 'ru'
  } catch {}

  // 3. Browser language
  try {
    if (navigator.language.toLowerCase().startsWith('ru')) return 'ru'
  } catch {}

  // 4. Fallback
  return 'en'
}

export function getInitialLanguage(): Language {
  return detectLanguage()
}

// ── Path resolver ─────────────────────────────────────────────────────────────

function resolvePath(obj: unknown, path: string): string {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return path
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : path
}

// ── createTranslator ─────────────────────────────────────────────────────────
//
// Usage:
//   const t = createTranslator('ru')
//   t('nav.posts')  // → 'Посты'
//   t('common.back') // → 'Назад'
//
// Keys are fully type-checked — typos are compile errors.

export function createTranslator(lang: Language) {
  const dict = dictionaries[lang]
  return function t(key: TranslationKey): string {
    return resolvePath(dict, key)
  }
}
