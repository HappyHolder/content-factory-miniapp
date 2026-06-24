import { API_BASE } from '@/lib/api'
import { getTelegramInitData } from '@/lib/telegram'
import type {
  MarketStyle, VisualKit, CoverBgStyle, CoverBgDetail, LogoUsage,
} from '@/types'

// ─── Public catalog ────────────────────────────────────────────────────────────

export interface StylesCatalog {
  styles: MarketStyle[]
  owned:  string[]   // style ids the user has purchased (FREE styles are owned implicitly)
}

/** Fetches the published style catalog + the caller's owned style ids. */
export async function fetchStyles(): Promise<StylesCatalog> {
  const initData = getTelegramInitData() ?? undefined
  const res = await fetch(`${API_BASE}/api/styles/list`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ initData }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<StylesCatalog>
}

/** True when the user can apply a style: it's free, or they own it. */
export function isStyleOwned(style: MarketStyle, owned: string[]): boolean {
  return style.priceKind === 'FREE' || owned.includes(style.id)
}

// ─── Purchase ──────────────────────────────────────────────────────────────────

/** Creates a Telegram Stars invoice for a style. Returns the invoice URL. */
export async function createStyleStarsInvoice(styleId: string): Promise<string> {
  const initData = getTelegramInitData()
  const res = await fetch(`${API_BASE}/api/payments/stars/create-style-invoice`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ initData, styleId }),
  })
  const data = await res.json().catch(() => ({})) as { invoiceUrl?: string; error?: string }
  if (!res.ok || !data.invoiceUrl) throw new Error(data.error ?? 'Failed to create invoice')
  return data.invoiceUrl
}

/** Verifies a TON (Gram) payment for a style after sendTransaction. */
export async function verifyStyleTon(styleId: string, senderWallet: string): Promise<void> {
  const initData = getTelegramInitData()
  const res = await fetch(`${API_BASE}/api/payments/ton/verify-style`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ initData, styleId, senderWallet }),
  })
  const data = await res.json().catch(() => ({})) as { owned?: boolean; error?: string }
  if (!res.ok || !data.owned) throw new Error(data.error ?? 'Payment not found')
}

// ─── Apply ─────────────────────────────────────────────────────────────────────

/**
 * Merges a style into a channel's VisualKit. Cover-related fields are REPLACED
 * by the style; the channel's own logo (logoUrl) and unrelated fields are kept.
 */
export function applyStyleToVisualKit(style: MarketStyle, current: VisualKit): VisualKit {
  return {
    ...current,
    coverMode:        style.recommendedMode,
    brandColors:      style.palette,
    visualCoverStyle: style.visualCoverStyle || current.visualCoverStyle,
    htmlTemplates:    style.templates.map(t => ({ name: t.name, url: t.url })),
    coverBgStyle:     (style.bgStyle as CoverBgStyle | null) ?? current.coverBgStyle,
    coverBgDetail:    (style.bgDetail as CoverBgDetail | null) ?? current.coverBgDetail,
    visualFontPreset: (style.fontPreset as VisualKit['visualFontPreset']) ?? current.visualFontPreset,
    logoUsage:        (style.logoUsage as LogoUsage | null) ?? current.logoUsage,
    // logoUrl, aspectRatio, watermark, textOnCover, references, avoidList — preserved.
  }
}

// ─── Admin ─────────────────────────────────────────────────────────────────────

interface AdminListResp { styles: MarketStyle[] }

export async function adminListStyles(): Promise<MarketStyle[]> {
  const initData = getTelegramInitData()
  const res = await fetch(`${API_BASE}/api/admin/styles/list`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json() as AdminListResp).styles
}

export async function adminUpsertStyle(style: Partial<MarketStyle>): Promise<MarketStyle> {
  const initData = getTelegramInitData()
  const res = await fetch(`${API_BASE}/api/admin/styles/upsert`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData, style }),
  })
  const data = await res.json().catch(() => ({})) as { style?: MarketStyle; error?: string }
  if (!res.ok || !data.style) throw new Error(data.error ?? 'Save failed')
  return data.style
}

export async function adminDeleteStyle(id: string): Promise<void> {
  const initData = getTelegramInitData()
  const res = await fetch(`${API_BASE}/api/admin/styles/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData, id }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? 'Delete failed')
  }
}

export async function adminUploadTemplate(file: File): Promise<string> {
  const initData = getTelegramInitData()
  const form = new FormData()
  form.append('initData', initData ?? '')
  form.append('file', file)
  const res = await fetch(`${API_BASE}/api/admin/styles/upload-template`, { method: 'POST', body: form })
  const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
  if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed')
  return data.url
}

export async function adminRenderPreviews(id: string, aspectRatio = '16:9'): Promise<MarketStyle> {
  const initData = getTelegramInitData()
  const res = await fetch(`${API_BASE}/api/admin/styles/render-previews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData, id, aspectRatio }),
  })
  const data = await res.json().catch(() => ({})) as { style?: MarketStyle; error?: string }
  if (!res.ok || !data.style) throw new Error(data.error ?? 'Render failed')
  return data.style
}
