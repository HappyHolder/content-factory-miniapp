import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Send, Calendar, RefreshCw, Layers, Image as ImageIcon, Link as LinkIcon, Loader2, Trash2, Upload, Undo2, Type } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatusChip, SourceChip } from '@/components/ui/StatusChip'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { VariantSelector } from '@/components/posts/VariantSelector'
import { PostTextEditor } from '@/components/posts/PostTextEditor'
import { BannerPreview } from '@/components/posts/BannerPreview'
import { LinkButtonsPreview } from '@/components/posts/LinkButtonsPreview'
import { ScheduleSheet } from '@/components/posts/ScheduleSheet'
import { brandKitService } from '@/services/brandKitService'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'

interface PostDetailsScreenProps {
  postId: string
  onBack: () => void
}

type Section = 'variants' | 'editor' | 'banner' | 'buttons'

// Per-post regeneration caps — must match server lib/subscriptionLimits.ts
const MAX_TEXT_REGENS = 3
const MAX_IMAGE_REGENS = 3

export function PostDetailsScreen({ postId, onBack }: PostDetailsScreenProps) {
  const { state, selectVariant, publishPost, schedulePost, showToast, canSchedulePosts, t, authStatus, updatePost, updateVariantBannerUrl, deletePost } = useApp()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [openSection, setOpenSection] = useState<Section>('variants')
  const [isPublishing, setIsPublishing] = useState(false)
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
  // Cover is a post-level asset — show it regardless of which text variant is selected
  const displayBannerUrl = selectedVariant?.bannerUrl || post.variants.find(v => v.bannerUrl)?.bannerUrl || null
  const brandKit = brandKitService.getByChannelId(post.channelId)
  const allLinkButtons = brandKit?.linkKit.links.filter(l =>
    l.usage === 'button' || l.usage === 'always'
  ) || []

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
        variants: { id: string; label: string; text: string; isSelected: boolean; bannerUrl: string | null }[]
        selectedVariantId: string
        textRegensUsed: number
      }
      updatePost(post.id, {
        variants: data.variants.map(v => ({
          id: v.id, label: v.label, text: v.text, isSelected: v.isSelected, bannerUrl: v.bannerUrl,
        })),
        selectedVariantId: data.selectedVariantId,
        textRegensUsed:    data.textRegensUsed,
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
      updateVariantBannerUrl(post.id, selectedVariant.id, data.bannerUrl)
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
        {/* Source block */}
        <GlassCard padding="sm" className="flex items-center gap-2.5">
          <SourceChip source={post.sourceType} className="shrink-0" />
          {post.sourceSummary && (
            <p className="text-[12px] text-[#66666E] leading-snug line-clamp-1 flex-1">
              {post.sourceSummary}
            </p>
          )}
        </GlassCard>

        {/* Accordion sections */}
        <GlassCard padding="none" className="overflow-hidden divide-y divide-white/6">
          {/* Variants */}
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

          {/* Editor */}
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

          {/* Visual — always shown; upload from files if no image yet */}
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
                      className="w-full rounded-[14px] object-cover"
                      style={{ aspectRatio: '1 / 1' }}
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
                    {/* Edit the cover headline text — re-renders over the clean base */}
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

          {/* Link buttons */}
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
        </GlassCard>

        {/* Actions — new post */}
        {post.status === 'new' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button variant="primary" size="lg" onClick={handlePublish} disabled={isPublishing} fullWidth>
                <Send size={16} /> {isPublishing ? t('common.loading') : t('postDetails.publish')}
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
              >
                <Calendar size={16} />
              </Button>
            </div>
          </div>
        )}

        {/* Actions — scheduled post */}
        {post.status === 'scheduled' && (
          <div className="space-y-2">
            <Button variant="primary" size="lg" onClick={handlePublish} disabled={isPublishing} fullWidth>
              <Send size={16} /> {isPublishing ? t('common.loading') : t('postDetails.publish')}
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
            Deletes the post from Content Factory only.
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

      <ScheduleSheet
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSchedule={handleSchedulePost}
      />
    </motion.div>
  )
}
