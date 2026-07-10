import { useState } from 'react'
import { Check, Loader2, Star, Sparkles } from 'lucide-react'
import { useTonConnectUI } from '@tonconnect/ui-react'
import { beginCell } from '@ton/core'
import { GramMark } from '@/components/icons/GramMark'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import { getTelegramUserId, openTelegramInvoice } from '@/lib/telegram'
import { TON_RECEIVING_WALLET, tonToNano } from '@/lib/payments'
import {
  createStyleStarsInvoice, verifyStyleTon, isStyleOwned, applyStyleToVisualKit,
} from '@/lib/styles'
import type { MarketStyle, VisualKit } from '@/types'

interface StyleDetailSheetProps {
  style: MarketStyle | null
  owned: string[]
  onClose: () => void
  /** Called after a successful purchase so the parent can mark the style owned. */
  onPurchased: (styleId: string) => void
}

const EMPTY_VISUAL_KIT: VisualKit = {
  primaryColor: '', backgroundStyle: 'dark', cardStyle: 'minimal',
  watermark: false, bannerTemplate: 'minimal',
}

export function StyleDetailSheet({ style, owned, onClose, onPurchased }: StyleDetailSheetProps) {
  const { state, activeChannel, updateBrandKit, showToast, language, t } = useApp()
  const [tonConnectUI] = useTonConnectUI()
  const [busy, setBusy] = useState<null | 'stars' | 'gram' | 'apply'>(null)

  const isRu = language === 'ru'
  if (!style) return null

  const ownedNow = isStyleOwned(style, owned)
  const name = isRu ? style.nameRu : style.nameEn
  const desc = isRu ? style.descRu : style.descEn
  const gallery = style.heroPreview
    ? [style.heroPreview, ...style.previews.filter(p => p !== style.heroPreview)]
    : style.previews

  const tplCount = style.templates.length
  const tplWord = tplCount === 1 ? t('styles.templatesOne') : t('styles.templatesMany')
  const modeLabel = style.recommendedMode === 'ai' ? t('styles.modeAi')
    : style.recommendedMode === 'ai_html' ? t('styles.modeAiHtml')
    : t('styles.modeHtml')

  // ── Apply ──────────────────────────────────────────────────────────────────
  const handleApply = () => {
    if (!activeChannel) { showToast(t('styles.needChannel'), 'error'); return }
    setBusy('apply')
    try {
      const current = state.brandKits.find(k => k.channelId === activeChannel.id)?.visualKit ?? EMPTY_VISUAL_KIT
      updateBrandKit(activeChannel.id, { visualKit: applyStyleToVisualKit(style, current) })
      showToast(t('styles.applyDone'))
      onClose()
    } finally {
      setBusy(null)
    }
  }

  // ── Buy with Stars ───────────────────────────────────────────────────────────
  const handleBuyStars = async () => {
    if (busy) return
    setBusy('stars')
    try {
      const invoiceUrl = await createStyleStarsInvoice(style.id)
      const opened = openTelegramInvoice(invoiceUrl, (status: string) => {
        setBusy(null)
        if (status === 'paid') { onPurchased(style.id); showToast(t('styles.purchaseDone')) }
      })
      if (!opened) { showToast(t('plans.payStarsOnly'), 'error'); setBusy(null) }
    } catch (err) {
      showToast((err as Error).message || t('plans.payFailed'), 'error')
      setBusy(null)
    }
  }

  // ── Buy with Gram (TON) ──────────────────────────────────────────────────────
  const handleBuyGram = async () => {
    if (busy) return
    if (!tonConnectUI.account) {
      try { await tonConnectUI.openModal() } catch { /* ignore */ }
      showToast(t('plans.connectWalletFirst'))
      return
    }
    const uid = getTelegramUserId()
    if (!uid) { showToast(t('plans.payStarsOnly'), 'error'); return }
    setBusy('gram')
    try {
      const commentPayload = beginCell().storeUint(0, 32).storeStringTail(uid).endCell().toBoc().toString('base64')
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{ address: TON_RECEIVING_WALLET, amount: tonToNano(style.priceGram ?? 0), payload: commentPayload }],
      })
      const sender = tonConnectUI.account?.address
      if (!sender) { showToast(t('plans.payFailed'), 'error'); setBusy(null); return }
      showToast(t('plans.payTonChecking'))
      await verifyStyleTon(style.id, sender)
      onPurchased(style.id)
      showToast(t('styles.purchaseDone'))
    } catch (err) {
      const msg = (err as Error)?.message || ''
      if (/reject|cancel|abort|declin|user.*close/i.test(msg)) showToast(t('plans.payCancelled'))
      else showToast(msg || t('plans.payFailed'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet open={!!style} onClose={() => { if (!busy) onClose() }} height="full" title={name}>
      <div className="space-y-5 pb-2">
        {/* Gallery */}
        {gallery.length > 0 && (
          <div className="-mx-1 flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {gallery.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`${name} ${i + 1}`}
                className="h-44 rounded-[14px] border border-white/[0.08] object-cover shrink-0"
              />
            ))}
          </div>
        )}

        {/* Tags + adaptivity */}
        <div className="flex flex-wrap gap-1.5">
          {style.tags.map(tag => (
            <span key={tag} className="px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[11px] text-[#A1A1AA]">
              {tag}
            </span>
          ))}
          <span className="px-2.5 py-0.5 rounded-full bg-[rgba(255,106,0,0.10)] border border-[rgba(255,106,0,0.22)] text-[11px] text-[#FF6A00]">
            {style.brandAdaptive ? t('styles.brandAdaptive') : t('styles.fixedPalette')}
          </span>
        </div>

        {/* Description */}
        {desc && <p className="text-[13px] text-[#A1A1AA] leading-relaxed">{desc}</p>}

        {/* What's included */}
        <div className="rounded-[14px] bg-white/[0.03] border border-white/[0.06] p-4 space-y-2">
          <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider">{t('styles.included')}</p>
          <div className="flex items-center gap-2 text-[13px] text-white">
            <Check size={13} className="text-[#FF6A00]" /> {tplCount} {tplWord}
          </div>
          <div className="flex items-center gap-2 text-[13px] text-white">
            <Check size={13} className="text-[#FF6A00]" /> {modeLabel}
          </div>
          {style.carouselTemplate && (
            <div className="flex items-center gap-2 text-[13px] text-white">
              <Check size={13} className="text-[#FF6A00]" /> {isRu ? 'Карусель · универсальный слайд' : 'Carousel · universal slide'}
            </div>
          )}
          {style.visualCoverStyle && (
            <div className="flex items-center gap-2 text-[13px] text-white">
              <Check size={13} className="text-[#FF6A00]" /> {t('styles.aiStyleNote')}
            </div>
          )}
        </div>

        {/* Carousel — full sequence (cover → items → outro), separate from rubric covers */}
        {style.carouselTemplate?.previews && style.carouselTemplate.previews.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider mb-2">{isRu ? 'Карусель · последовательность' : 'Carousel · sequence'}</p>
            <div className="-mx-1 flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {style.carouselTemplate.previews.map((src, i) => (
                <img key={i} src={src} alt={`carousel ${i + 1}`} className="h-44 rounded-[14px] border border-white/[0.08] object-cover shrink-0" />
              ))}
            </div>
          </div>
        )}

        {/* Palette */}
        {style.palette.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider mb-2">{t('styles.colors')}</p>
            <div className="flex flex-wrap gap-2">
              {style.palette.map((c, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-[10px] bg-white/[0.03] border border-white/[0.06]">
                  <span className="w-5 h-5 rounded-[6px] border border-white/10" style={{ background: c.hex }} />
                  <span className="text-[12px] text-[#A1A1AA]">{c.name || c.hex}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-1 bg-gradient-to-t from-[#0E0E10] via-[#0E0E10] to-transparent space-y-2">
        {ownedNow ? (
          <Button variant="primary" size="md" fullWidth onClick={handleApply} disabled={busy === 'apply'}>
            {busy === 'apply'
              ? <><Loader2 size={14} className="animate-spin" /> {t('styles.applying')}</>
              : t('styles.apply')}
            {activeChannel && busy !== 'apply' && (
              <span className="opacity-70 ml-1">· @{activeChannel.username}</span>
            )}
          </Button>
        ) : (
          <>
            {style.priceStars != null && style.priceStars > 0 && (
              <button
                onClick={handleBuyStars}
                disabled={!!busy}
                className="w-full flex items-center justify-between px-4 py-3.5 rounded-[14px] bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] transition-colors disabled:opacity-50"
              >
                <span className="flex items-center gap-2.5">
                  {busy === 'stars' ? <Loader2 size={18} className="text-[#FF6A00] animate-spin" /> : <Star size={18} className="text-[#FF6A00]" fill="#FF6A00" />}
                  <span className="text-[14px] font-medium text-white">Telegram Stars</span>
                </span>
                <span className="text-[14px] font-bold text-white">{style.priceStars} ⭐</span>
              </button>
            )}
            {style.priceGram != null && style.priceGram > 0 && (
              <button
                onClick={handleBuyGram}
                disabled={!!busy}
                className="w-full flex items-center justify-between px-4 py-3.5 rounded-[14px] bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] transition-colors disabled:opacity-50"
              >
                <span className="flex items-center gap-2.5">
                  {busy === 'gram' ? <Loader2 size={18} className="text-[#FF6A00] animate-spin" /> : <GramMark size={18} />}
                  <span className="text-[14px] font-medium text-white">Gram</span>
                </span>
                <span className="text-[14px] font-bold text-white">{style.priceGram} Gram</span>
              </button>
            )}
            <p className="text-center text-[11px] text-[#55555D] pt-0.5 flex items-center justify-center gap-1">
              <Sparkles size={11} className="text-[#55555D]" /> {isRu ? 'Разовая покупка — навсегда' : 'One-time purchase — yours forever'}
            </p>
          </>
        )}
      </div>
    </Sheet>
  )
}
