import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Send, Calendar, RefreshCw, Layers, Image as ImageIcon, Link as LinkIcon, Loader2, Trash2, Upload, Undo2, Type, Tag, ChevronDown } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import type { PostBlock } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatusChip, SourceChip } from '@/components/ui/StatusChip'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { VariantSelector } from '@/components/posts/VariantSelector'
import { PostTextEditor } from '@/components/posts/PostTextEditor'
import { BannerPreview } from '@/components/posts/BannerPreview'
import { RichPostEditor } from '@/components/posts/RichPostEditor'
import { LinkButtonsPreview } from '@/components/posts/LinkButtonsPreview'
import { ScheduleSheet } from '@/components/posts/ScheduleSheet'
import { SharePostSheet } from '@/components/posts/SharePostSheet'
import { brandKitService } from '@/services/brandKitService'
import { getTelegramInitData, shareTelegramMessage, type TelegramShareResult } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import { isWithinEditWindow } from '@/lib/postEditWindow'
import { cn } from '@/lib/utils'

interface PostDetailsScreenProps {
  postId: string
  onBack: () => void
}

type Section = 'format' | 'variants' | 'editor' | 'banner' | 'buttons'

// Per-post regeneration caps — must match server lib/subscriptionLimits.ts
const MAX_TEXT_REGENS = 3
const MAX_IMAGE_REGENS = 3

export function PostDetailsScreen({ postId, onBack }: PostDetailsScreenProps) {
  const { state, selectVariant, publishPost, schedulePost, showToast, canSchedulePosts, t, language, authStatus, updatePost, deletePost } = useApp()
  const isRu = language === 'ru'
  const [isSettingRubric, setIsSettingRubric] = useState(false)
  const [rubricMenuOpen, setRubricMenuOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [openSection, setOpenSection] = useState<Section>('variants')
  const [isPublishing, setIsPublishing] = useState(false)
  const [isRepublishing, setIsRepublishing] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [isRegeneratingText, setIsRegeneratingText] = useState(false)
  const [isRegeneratingVisual, setIsRegeneratingVisual] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  // Session-only history of previous cover URLs (for the "restore previous cover"
  // undo). Old blob images are never deleted, so a prior URL stays valid. Resets
  // when the post detail screen is closed.
  const [bannerHistory, setBannerHistory] = useState<string[]>([])
  const [isRestoringBanner, setIsRestoringBanner] = useState(false)
  // Custom cover headline (null = not edited yet → shows the post title).
  const [coverText, setCoverText] = useState<string | null>(null)
  const [isSettingCoverText, setIsSettingCoverText] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const post = state.posts.find(p => p.id === postId)
  if (!post) return null

  const selectedVariant = post.variants.find(v => v.id === post.selectedVariantId) || post.variants[0]
  // Formatted post = the selected variant carries structured blocks. Those posts
  // get the new composer (hero preview + block editor); legacy posts keep the
  // old text+banner accordion.
  // A manually built post ("from scratch") is block-based even with zero blocks:
  // the user writes every block by hand. It has a single empty-text variant, so the
  // variant selector / text-regeneration is hidden and the block editor is its only
  // surface. Detected by sourceType so it holds even before any block is added.
  const isManual = post.sourceType === 'manual'
  const isBlockPost = post.editorMode === 'rich'
  // Published posts stay fully editable and re-publishable (edited in place in the
  // channel) for a 5-hour window, after which they're purged server-side.
  const withinEditWindow = post.status === 'published' && isWithinEditWindow(post.publishedAt)
  const channel = state.channels.find(c => c.id === post.channelId)
  // Cover is a post-level asset — show it regardless of which text variant is selected
  const displayBannerUrl = selectedVariant?.bannerUrl || post.variants.find(v => v.bannerUrl)?.bannerUrl || null
  const brandKit = brandKitService.getByChannelId(post.channelId)
  const allLinkButtons = brandKit?.linkKit.links.filter(l =>
    l.usage === 'button' || l.usage === 'always'
  ) || []
  // Rubrics the channel defines — drive the post's cover. Override re-renders only
  // the cover. Hidden for manual posts and when the channel has no rubrics.
  const channelRubrics = (brandKit?.visualKit?.rubrics ?? []).filter(r => r.name && r.name.trim())
  // HTML / AI+HTML cover modes → visual regeneration (Flux) and the cover-text
  // overlay editor are disabled (the cover is composed, not a Flux+sharp overlay).
  const effectiveCoverMode = post.coverMode ?? brandKit?.visualKit?.coverMode ?? 'ai'
  const isHtmlCoverMode = effectiveCoverMode === 'html' || effectiveCoverMode === 'ai_html'
  const coverAspectRatio = post.coverAspectRatio ?? brandKit?.visualKit?.aspectRatio ?? '1:1'
  const coverCssAspectRatio = coverAspectRatio.replace(':', ' / ')

  // Per-post regeneration remaining counts
  const textRegensLeft  = Math.max(0, MAX_TEXT_REGENS  - (post.textRegensUsed  ?? 0))
  const imageRegensLeft = Math.max(0, MAX_IMAGE_REGENS - (post.imageRegensUsed ?? 0))

  const handlePublish = async () => {
    if (isPublishing) return

    if (authStatus !== 'authenticated') {
      // Dev / mock path — keep existing local-only behaviour
      publishPost(post.id)
      onBack()
      return
    }

    // Real backend path
    setIsPublishing(true)
    try {
      const initData = getTelegramInitData()!
      const res = await fetch(`${API_BASE}/api/posts/publish`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, postId: post.id }),
      })
      if (!res.ok) {
        const errData = await res.json() as { error?: string }
        showToast(errData.error ?? t('postDetails.publishFailed'), 'error')
        return
      }
      const data = await res.json() as { post: { status: string; publishedAt: string } }
      updatePost(post.id, {
        status:      'published',
        publishedAt: new Date(data.post.publishedAt),
      })
      onBack()
    } catch {
      showToast(t('postDetails.publishFailed'), 'error')
    } finally {
      setIsPublishing(false)
    }
  }

  // Re-publish: push the (edited) published post to the channel IN PLACE — edits
  // the original message so views/reactions/position survive and no new
  // notification is sent. Only valid inside the 5-hour window.
  const handleRepublish = async () => {
    if (isRepublishing) return
    const initData = getTelegramInitData()
    if (!initData) { showToast(t('postDetails.updateInChannelFailed'), 'error'); return }
    setIsRepublishing(true)
    try {
      const res = await fetch(`${API_BASE}/api/posts/${post.id}/republish`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        showToast(errData.error ?? t('postDetails.updateInChannelFailed'), 'error')
        return
      }
      showToast(t('postDetails.updatedInChannel'))
    } catch {
      showToast(t('postDetails.updateInChannelFailed'), 'error')
    } finally {
      setIsRepublishing(false)
    }
  }

  // Prepares the selected post, then hands recipient selection to Telegram.
  // The user sends the native Rich Message on their own behalf.
  const handleShareResult = (result: TelegramShareResult) => {
    setIsSharing(false)
    if (result.status === 'sent') {
      showToast(t('postDetails.shareSent'))
      return
    }
    if (result.status === 'cancelled') return
    if (result.error === 'UNSUPPORTED') showToast(t('postDetails.fastShareUnsupported'), 'error')
    else if (result.error === 'MESSAGE_EXPIRED') showToast(t('postDetails.shareExpired'), 'error')
    else showToast(t('postDetails.shareSendFailed'), 'error')
  }

  const handleFastShare = async () => {
    if (isSharing) return
    const initData = getTelegramInitData()
    if (!initData) { showToast(t('postDetails.publishFailed'), 'error'); return }
    setIsSharing(true)
    let handedToTelegram = false
    try {
      const res = await fetch(`${API_BASE}/api/posts/${post.id}/prepare-share`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData }),
        signal:  AbortSignal.timeout(50_000),
      })
      const data = await res.json().catch(() => ({})) as { preparedMessageId?: string; error?: string; code?: string }
      if (!res.ok || !data.preparedMessageId) {
        showToast(data.code === 'PREPARE_SHARE_FAILED' ? t('postDetails.fastShareFailed') : (data.error ?? t('postDetails.fastShareFailed')), 'error')
        return
      }
      handedToTelegram = shareTelegramMessage(data.preparedMessageId, handleShareResult)
      if (!handedToTelegram) { showToast(t('postDetails.fastShareUnsupported'), 'error'); return }
      setSendOpen(false)
      setIsSharing(false)
    } catch {
      showToast(t('postDetails.fastShareFailed'), 'error')
    } finally {
      if (!handedToTelegram) setIsSharing(false)
    }
  }
  const handleSchedulePost = async (date: Date) => {
    if (authStatus !== 'authenticated') {
      // Dev / mock mode — local-only
      schedulePost(post.id, date)
      return
    }

    // Optimistic local update so the UI responds immediately
    schedulePost(post.id, date)

    // Persist to DB
    try {
      const initData = getTelegramInitData()!
      const res = await fetch(`${API_BASE}/api/posts/schedule`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, postId: post.id, scheduledAt: date.toISOString() }),
      })
      if (!res.ok) {
        const errData = await res.json() as { error?: string }
        showToast(errData.error ?? t('postDetails.scheduleFailed'), 'error')
      }
    } catch {
      showToast(t('postDetails.scheduleFailed'), 'error')
    }
  }

  const handleDelete = async () => {
    if (isDeleting) return
    if (!window.confirm(t('postDetails.deletePostConfirm'))) return

    const initData = getTelegramInitData()

    if (authStatus === 'authenticated') {
      if (!initData) return
      setIsDeleting(true)
      try {
        const res = await fetch(`${API_BASE}/api/posts/delete`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ initData, postId: post.id }),
        })
        if (!res.ok) {
          showToast(t('postDetails.deleteFailed'), 'error')
          return
        }
      } catch {
        showToast(t('postDetails.deleteFailed'), 'error')
        return
      } finally {
        setIsDeleting(false)
      }
    }

    // Remove from local state and navigate back regardless of auth mode
    deletePost(post.id)
    showToast(t('postDetails.deletePostSuccess'))
    onBack()
  }

  const handleRegenerateText = async () => {
    if (isRegeneratingText) return
    if (textRegensLeft <= 0) {
      showToast(t('postDetails.textRegenLimit'), 'info')
      return
    }
    const initData = getTelegramInitData()
    if (!initData) {
      showToast('Доступно только в Telegram', 'error')
      return
    }
    setIsRegeneratingText(true)
    try {
      const res = await fetch(`${API_BASE}/api/posts/regenerate-text`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, postId: post.id }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { code?: string; error?: string }
        showToast(
          errData.code === 'TEXT_REGENS_LIMIT_REACHED'
            ? t('postDetails.textRegenLimit')
            : (errData.error ?? t('postDetails.textRegenerateFailed')),
          'error',
        )
        return
      }
      const data = await res.json() as {
        variants: { id: string; label: string; text: string; isSelected: boolean; bannerUrl: string | null; blocks: import('@/types').PostBlock[] | null }[]
        selectedVariantId: string
        textRegensUsed: number
      }
      updatePost(post.id, {
        variants: data.variants.map(v => ({
          id: v.id, label: v.label, text: v.text, isSelected: v.isSelected, bannerUrl: v.bannerUrl, blocks: v.blocks,
        })),
        selectedVariantId: data.selectedVariantId,
        textRegensUsed:    data.textRegensUsed,
        editorMode:          'rich',
      })
      showToast(t('postDetails.textRegenerated'))
    } catch {
      showToast(t('postDetails.textRegenerateFailed'), 'error')
    } finally {
      setIsRegeneratingText(false)
    }
  }

  const handleRegenerateVisual = async () => {
    if (isRegeneratingVisual || !selectedVariant) return
    if (imageRegensLeft <= 0) {
      showToast(t('postDetails.visualRegenLimit'), 'info')
      return
    }
    const initData = getTelegramInitData()
    if (!initData) return

    setIsRegeneratingVisual(true)
    try {
      const res = await fetch(`${API_BASE}/api/posts/regenerate-visual`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, postId: post.id, variantId: selectedVariant.id }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { code?: string; error?: string }
        showToast(
          errData.code === 'IMAGE_REGENS_LIMIT_REACHED'
            ? t('postDetails.visualRegenLimit')
            : t('postDetails.visualRegenerateFailed'),
          'error',
        )
        return
      }
      const data = await res.json() as { bannerUrl: string; imageRegensUsed?: number }
      // Remember the cover we're replacing so it can be restored (session undo).
      if (displayBannerUrl && displayBannerUrl !== data.bannerUrl) {
        setBannerHistory(h => [...h, displayBannerUrl])
      }
      // Cover is post-level — apply to all variants so switching text keeps it
      updatePost(post.id, {
        variants: post.variants.map(v => ({ ...v, bannerUrl: data.bannerUrl })),
        ...(typeof data.imageRegensUsed === 'number' ? { imageRegensUsed: data.imageRegensUsed } : {}),
      })
      showToast(t('postDetails.visualRegenerated'))
    } catch {
      showToast(t('postDetails.visualRegenerateFailed'), 'error')
    } finally {
      setIsRegeneratingVisual(false)
    }
  }

  const handleUploadImage = async (file: File) => {
    if (!selectedVariant || isUploadingImage) return
    const initData = getTelegramInitData()
    if (!initData) {
      showToast('Доступно только в Telegram', 'error')
      return
    }
    setIsUploadingImage(true)
    try {
      const form = new FormData()
      form.append('initData', initData)
      form.append('variantId', selectedVariant.id)
      form.append('image', file)
      const res = await fetch(`${API_BASE}/api/posts/upload-image`, { method: 'POST', body: form })
      if (!res.ok) {
        showToast('Не удалось загрузить картинку', 'error')
        return
      }
      const data = await res.json() as { bannerUrl: string }
      // Remember the cover we're replacing so it can be restored (session undo).
      if (displayBannerUrl && displayBannerUrl !== data.bannerUrl) {
        setBannerHistory(h => [...h, displayBannerUrl])
      }
      updatePost(post.id, {
        variants: post.variants.map(v => ({ ...v, bannerUrl: data.bannerUrl })),
      })
      showToast('Картинка прикреплена!')
      setOpenSection('banner')
    } catch {
      showToast('Ошибка загрузки', 'error')
    } finally {
      setIsUploadingImage(false)
    }
  }

  const handleRestoreBanner = async () => {
    if (isRestoringBanner || bannerHistory.length === 0) return
    const prev = bannerHistory[bannerHistory.length - 1]!
    setIsRestoringBanner(true)
    try {
      // Persist the restored cover so publish/scheduler use it (real backend only).
      if (authStatus === 'authenticated') {
        const initData = getTelegramInitData()
        if (initData) {
          const res = await fetch(`${API_BASE}/api/posts/set-banner`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ initData, postId: post.id, bannerUrl: prev }),
          })
          if (!res.ok) {
            showToast(t('postDetails.visualRestoreFailed'), 'error')
            return
          }
        }
      }
      updatePost(post.id, { variants: post.variants.map(v => ({ ...v, bannerUrl: prev })) })
      setBannerHistory(h => h.slice(0, -1))
      showToast(t('postDetails.visualRestored'))
    } catch {
      showToast(t('postDetails.visualRestoreFailed'), 'error')
    } finally {
      setIsRestoringBanner(false)
    }
  }

  const handleSetCoverText = async () => {
    if (isSettingCoverText) return
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }
    const value = coverText ?? post.title
    setIsSettingCoverText(true)
    try {
      const res = await fetch(`${API_BASE}/api/posts/set-cover-text`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, postId: post.id, text: value }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { code?: string; error?: string }
        showToast(
          err.code === 'NO_COVER_BASE'
            ? t('postDetails.coverTextNeedsRegen')
            : (err.error ?? t('postDetails.coverTextFailed')),
          'error',
        )
        return
      }
      const data = await res.json() as { bannerUrl: string }
      // Add the replaced cover to the undo stack.
      if (displayBannerUrl && displayBannerUrl !== data.bannerUrl) {
        setBannerHistory(h => [...h, displayBannerUrl])
      }
      updatePost(post.id, { variants: post.variants.map(v => ({ ...v, bannerUrl: data.bannerUrl })) })
      showToast(t('postDetails.coverTextApplied'))
    } catch {
      showToast(t('postDetails.coverTextFailed'), 'error')
    } finally {
      setIsSettingCoverText(false)
    }
  }

  // Override the post's rubric → re-render only the cover under the new recipe.
  const handleSetRubric = async (rubricId: string) => {
    if (isSettingRubric) return
    const initData = getTelegramInitData()
    if (!initData) { showToast(isRu ? 'Доступно только в Telegram' : 'Telegram only', 'error'); return }
    setRubricMenuOpen(false)
    setIsSettingRubric(true)
    try {
      const res = await fetch(`${API_BASE}/api/posts/set-rubric`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, postId: post.id, rubricId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        showToast(err.error ?? (isRu ? 'Не удалось сменить рубрику' : 'Could not change rubric'), 'error')
        return
      }
      const data = await res.json() as {
        bannerUrl: string; coverMode: 'ai' | 'html' | 'ai_html'
        rubricId: string | null; rubricName: string | null; blocks: PostBlock[] | null
      }
      const selId = post.selectedVariantId ?? post.variants[0]?.id
      updatePost(post.id, {
        rubricId:   data.rubricId,
        rubricName: data.rubricName,
        coverMode:  data.coverMode,
        variants:   post.variants.map(v =>
          v.id === selId
            ? { ...v, bannerUrl: data.bannerUrl, ...(data.blocks ? { blocks: data.blocks } : {}) }
            : { ...v, bannerUrl: data.bannerUrl }),
      })
      showToast(isRu ? 'Рубрика обновлена' : 'Rubric updated')
    } catch {
      showToast(isRu ? 'Ошибка' : 'Error', 'error')
    } finally {
      setIsSettingRubric(false)
    }
  }

  const sectionLabel = (id: Section, icon: React.ReactNode, label: string, badge?: string) => (
    <button
      onClick={() => setOpenSection(openSection === id ? 'variants' : id)}
      className={`flex items-center gap-2 px-4 py-2.5 w-full text-left transition-colors duration-150 ${
        openSection === id ? 'text-white' : 'text-[#A1A1AA] hover:text-white'
      }`}
    >
      <span className={`w-6 h-6 flex items-center justify-center rounded-[7px] ${
        openSection === id ? 'bg-[rgba(255,106,0,0.12)] text-[#FF6A00]' : 'bg-white/[0.05] text-[#55555D]'
      }`}>
        {icon}
      </span>
      <span className="text-[13px] font-medium flex-1">{label}</span>
      {badge && (
        <span className="text-[10px] text-[#55555D] bg-white/[0.05] px-1.5 py-px rounded-full">{badge}</span>
      )}
      <span className={`text-[#44444C] transition-transform duration-200 ${openSection === id ? 'rotate-90' : ''}`}>›</span>
    </button>
  )

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.24, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <PageHeader
        title={post.title}
        onBack={onBack}
        chip={<StatusChip status={post.status} />}
      />

      <div className="px-4 space-y-2 mt-1">
        {/* Source block + rubric chip */}
        <GlassCard padding="sm" className="flex items-center gap-2.5">
          <SourceChip source={post.sourceType} className="shrink-0" />
          {post.sourceSummary && (
            <p className="text-[12px] text-[#66666E] leading-snug line-clamp-1 flex-1">
              {post.sourceSummary}
            </p>
          )}
          {!isManual && channelRubrics.length > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={() => setRubricMenuOpen(o => !o)}
                disabled={isSettingRubric}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-[11px] text-[#D4D4D8] hover:border-[#FF6A00]/40 disabled:opacity-50"
              >
                {isSettingRubric
                  ? <Loader2 size={11} className="animate-spin" />
                  : <Tag size={11} className="text-[#FF6A00]" />}
                <span className="font-medium max-w-[90px] truncate">{post.rubricName ?? (isRu ? 'Разное' : 'General')}</span>
                <ChevronDown size={11} className="text-[#55555D]" />
              </button>
              {rubricMenuOpen && (
                <div className="absolute z-20 mt-1 right-0 min-w-[170px] max-h-[240px] overflow-y-auto rounded-[12px] bg-[#16161A] border border-white/[0.1] shadow-xl py-1">
                  {[...channelRubrics.map(r => ({ id: r.id, name: r.name })), { id: 'misc', name: isRu ? 'Разное' : 'General' }].map(r => {
                    const active = (post.rubricId ?? 'misc') === r.id || post.rubricName === r.name
                    return (
                      <button
                        key={r.id}
                        onClick={() => handleSetRubric(r.id)}
                        className={cn('w-full text-left px-3 py-2 text-[12.5px] hover:bg-white/[0.05] flex items-center gap-2',
                          active ? 'text-[#FF6A00]' : 'text-[#D4D4D8]')}
                      >
                        <Tag size={11} className={active ? 'text-[#FF6A00]' : 'text-[#55555D]'} />{r.name || '—'}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </GlassCard>

        {/* Formatted post — hero composer (preview + block editor). The post IS
            the blocks; this is the main surface for formatted posts. */}
        {isBlockPost && selectedVariant && (
          <RichPostEditor
            key={`${selectedVariant.id}:${selectedVariant.bannerUrl ?? ''}`}
            postId={post.id}
            variantId={selectedVariant.id}
            blocks={selectedVariant.blocks ?? []}
            channelName={channel?.title}
            channelHandle={post.channelUsername}
            avatarUrl={channel?.avatarUrl}
            enableButtons
          />
        )}

        {/* Accordion sections */}
        <GlassCard padding="none" className="overflow-hidden divide-y divide-white/6">
          {/* Variants — hidden for a manual post (one empty-text variant, no regen) */}
          {!isManual && (
          <div>
            {sectionLabel('variants', <Layers size={15} />, t('postDetails.variants'), `${post.variants.length}`)}
            {openSection === 'variants' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="px-3 pb-3 overflow-hidden"
              >
                <VariantSelector
                  variants={post.variants}
                  selectedId={post.selectedVariantId}
                  onSelect={id => selectVariant(post.id, id)}
                />
                {post.status !== 'published' && (
                  <div className="mt-2.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleRegenerateText}
                      disabled={isRegeneratingText || textRegensLeft <= 0}
                      fullWidth
                    >
                      {isRegeneratingText
                        ? <><Loader2 size={13} className="animate-spin" />{t('postDetails.regeneratingText')}</>
                        : <><RefreshCw size={13} />{t('postDetails.regenerateText')} · {textRegensLeft}/{MAX_TEXT_REGENS}</>
                      }
                    </Button>
                  </div>
                )}
              </motion.div>
            )}
          </div>
          )}

          {/* Editor (legacy plain posts only — formatted posts are edited in the composer above) */}
          {!isBlockPost && (
          <div>
            {sectionLabel('editor', <span className="text-[13px] font-bold">Aa</span>, t('postDetails.editText'))}
            {openSection === 'editor' && selectedVariant && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                transition={{ duration: 0.22 }}
                className="px-3 pb-3 overflow-hidden"
              >
                <PostTextEditor
                  key={selectedVariant.id}
                  postId={post.id}
                  variantId={selectedVariant.id}
                  text={selectedVariant.text}
                />
              </motion.div>
            )}
          </div>
          )}

          {/* Visual (legacy plain posts only — formatted posts manage images in the composer) */}
          {!isBlockPost && (
          <div>
            {/* hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleUploadImage(file)
                e.target.value = ''
              }}
            />
            {sectionLabel('banner', <ImageIcon size={15} />, t('postDetails.visual'))}
            {openSection === 'banner' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                transition={{ duration: 0.22 }}
                className="px-3 pb-3 overflow-hidden"
              >
                {displayBannerUrl ? (
                  <div className="space-y-2">
                    <img
                      src={displayBannerUrl}
                      alt={post.title}
                      className="w-full rounded-[14px] object-contain bg-black"
                      style={{ aspectRatio: coverCssAspectRatio }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingImage}
                      fullWidth
                    >
                      {isUploadingImage
                        ? <><Loader2 size={13} className="animate-spin" />Загружаем…</>
                        : <><Upload size={13} />Заменить картинку</>
                      }
                    </Button>
                    {/* Visual regeneration is AI/Flux-only — hidden in HTML cover
                        mode, where covers are composed from channel templates. */}
                    {!isHtmlCoverMode && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleRegenerateVisual}
                        disabled={isRegeneratingVisual || imageRegensLeft <= 0}
                        fullWidth
                      >
                        {isRegeneratingVisual
                          ? <><Loader2 size={13} className="animate-spin" />{t('postDetails.regeneratingVisual')}</>
                          : <><RefreshCw size={13} />{t('postDetails.regenerateVisual')} · {imageRegensLeft}/{MAX_IMAGE_REGENS}</>
                        }
                      </Button>
                    )}
                    {bannerHistory.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRestoreBanner}
                        disabled={isRestoringBanner}
                        fullWidth
                      >
                        {isRestoringBanner
                          ? <><Loader2 size={13} className="animate-spin" />{t('common.loading')}</>
                          : <><Undo2 size={13} />{t('postDetails.restorePrevCover')}</>
                        }
                      </Button>
                    )}
                    {/* Edit the cover headline text — re-renders the sharp overlay
                        over the clean base. Only for AI/Flux covers; hidden in HTML
                        mode where the headline lives inside the template. */}
                    {!isHtmlCoverMode && (
                      <div className="pt-1.5 space-y-1.5">
                        <input
                          value={coverText ?? post.title}
                          onChange={e => setCoverText(e.target.value)}
                          placeholder={t('postDetails.coverTextPlaceholder')}
                          className="glass-input w-full px-3 py-2 text-sm"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleSetCoverText}
                          disabled={isSettingCoverText}
                          fullWidth
                        >
                          {isSettingCoverText
                            ? <><Loader2 size={13} className="animate-spin" />{t('common.loading')}</>
                            : <><Type size={13} />{t('postDetails.coverTextApply')}</>
                          }
                        </Button>
                      </div>
                    )}
                  </div>
                ) : post.banner ? (
                  <BannerPreview
                    banner={post.banner}
                    onRegenerate={() => showToast(t('postDetails.regenerateVisual') + '…')}
                    onChangeTemplate={() => showToast(t('postDetails.template') + '…')}
                    onRemove={() => showToast(t('postDetails.visual') + '…')}
                  />
                ) : (
                  // No image yet — offer upload from files
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingImage}
                    className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-[14px] border-2 border-dashed border-white/[0.10] text-[#55555D] hover:border-[#FF6A00]/40 hover:text-[#FF6A00] transition-colors duration-200 disabled:opacity-50"
                  >
                    {isUploadingImage ? (
                      <Loader2 size={22} className="animate-spin text-[#FF6A00]" />
                    ) : (
                      <Upload size={22} />
                    )}
                    <span className="text-[12px] font-medium">
                      {isUploadingImage ? 'Загружаем…' : 'Прикрепить картинку из файлов'}
                    </span>
                    <span className="text-[10px] text-[#3A3A42]">JPEG, PNG, WebP, GIF · до 10 МБ</span>
                  </button>
                )}
              </motion.div>
            )}
          </div>
          )}

          {/* Link buttons — legacy plain posts only. Block posts (manual, AI, bot)
              manage buttons inside the composer's button editor above. */}
          {!isBlockPost && (
          <div>
            {sectionLabel(
              'buttons',
              <LinkIcon size={15} />,
              t('postDetails.linksButtons'),
              allLinkButtons.length > 0 ? `${allLinkButtons.length}` : undefined
            )}
            {openSection === 'buttons' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                transition={{ duration: 0.22 }}
                className="px-3 pb-3 overflow-hidden"
              >
                <LinkButtonsPreview
                  buttons={post.linkButtons}
                  allButtons={allLinkButtons}
                />
              </motion.div>
            )}
          </div>
          )}
        </GlassCard>

        {/* Actions: choose direct channel publish or Telegram sharing. */}
        {post.status === 'new' && (
          <div className="flex gap-2">
            <Button variant="primary" size="lg" onClick={() => setSendOpen(true)} disabled={isPublishing || isSharing} fullWidth>
              {(isPublishing || isSharing) ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {t('postDetails.send')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                if (!canSchedulePosts) {
                  showToast(t('postDetails.scheduleUpgradeToast'), 'info')
                  return
                }
                setScheduleOpen(true)
              }}
              className="min-w-[48px]"
            >
              <Calendar size={16} />
            </Button>
          </div>
        )}
        {/* Actions: scheduled post. */}
        {post.status === 'scheduled' && (
          <div className="space-y-2">
            <Button variant="primary" size="lg" onClick={() => setSendOpen(true)} disabled={isPublishing || isSharing} fullWidth>
              {(isPublishing || isSharing) ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {t('postDetails.send')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                if (!canSchedulePosts) {
                  showToast(t('postDetails.scheduleUpgradeToast'), 'info')
                  return
                }
                setScheduleOpen(true)
              }}
              fullWidth
            >
              <Calendar size={14} /> {t('postDetails.changeSchedule')}
            </Button>
          </div>
        )}
        {/* Actions — published post */}
        {post.status === 'published' && (
          <div className="space-y-2">
            {/* Within the 5-hour window: push edits to the same channel message. */}
            {withinEditWindow && (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleRepublish}
                  disabled={isRepublishing}
                  fullWidth
                >
                  {isRepublishing
                    ? <><Loader2 size={16} className="animate-spin" />{t('common.loading')}</>
                    : <><RefreshCw size={16} />{t('postDetails.updateInChannel')}</>}
                </Button>
                <p className="text-[11px] text-[#66666E] text-center leading-snug px-2">
                  {t('postDetails.editWindowHint')}
                </p>
              </>
            )}
            <Button
              variant="secondary"
              size="lg"
              onClick={() => window.open('https://t.me/' + post.channelUsername, '_blank')}
              fullWidth
            >
              {t('postDetails.openInTelegram')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => showToast(t('postDetails.createSimilar') + '…')}
              fullWidth
            >
              {t('postDetails.createSimilar')}
            </Button>
          </div>
        )}

        {/* Delete — available for all statuses.
            Deletes the post from Publium only.
            Published posts are NOT removed from the Telegram channel
            because message IDs are not stored. */}
        <Button
          variant="danger"
          size="sm"
          onClick={handleDelete}
          disabled={isDeleting}
          fullWidth
        >
          {isDeleting
            ? <><Loader2 size={13} className="animate-spin" />{t('postDetails.deleting')}</>
            : <><Trash2 size={13} />{t('postDetails.deletePost')}</>
          }
        </Button>
      </div>

      <SharePostSheet
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        channelTitle={channel?.title}
        channelUsername={channel?.username ?? post.channelUsername}
        channelAvatarUrl={channel?.avatarUrl}
        channelConnected={channel?.isConnected === true}
        publishing={isPublishing}
        sharing={isSharing}
        onPublish={handlePublish}
        onShare={handleFastShare}
      />
      <ScheduleSheet
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSchedule={handleSchedulePost}
      />
    </motion.div>
  )
}
