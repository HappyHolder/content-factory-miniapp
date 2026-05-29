import { useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Calendar, RefreshCw, Layers, Image as ImageIcon, Link as LinkIcon, Loader2 } from 'lucide-react'
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

export function PostDetailsScreen({ postId, onBack }: PostDetailsScreenProps) {
  const { state, selectVariant, publishPost, schedulePost, showToast, canSchedulePosts, t, authStatus, updatePost, updateVariantBannerUrl } = useApp()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [openSection, setOpenSection] = useState<Section>('variants')
  const [isPublishing, setIsPublishing] = useState(false)
  const [isRegeneratingVisual, setIsRegeneratingVisual] = useState(false)

  const post = state.posts.find(p => p.id === postId)
  if (!post) return null

  const selectedVariant = post.variants.find(v => v.id === post.selectedVariantId) || post.variants[0]
  const brandKit = brandKitService.getByChannelId(post.channelId)
  const allLinkButtons = brandKit?.linkKit.links.filter(l =>
    l.usage === 'button' || l.usage === 'always'
  ) || []

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

  const handleRegenerate = () => {
    showToast(t('postDetails.regenerateVariants') + '…')
  }

  const handleRegenerateVisual = async () => {
    if (isRegeneratingVisual || !selectedVariant) return
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
        showToast(t('postDetails.visualRegenerateFailed'), 'error')
        return
      }
      const data = await res.json() as { bannerUrl: string }
      updateVariantBannerUrl(post.id, selectedVariant.id, data.bannerUrl)
      showToast(t('postDetails.visualRegenerated'))
    } catch {
      showToast(t('postDetails.visualRegenerateFailed'), 'error')
    } finally {
      setIsRegeneratingVisual(false)
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

          {/* Visual (formerly Banner) */}
          {/* Visual section — real generated image (bannerUrl) or legacy mock banner */}
          {(selectedVariant?.bannerUrl || post.banner) && (
            <div>
              {sectionLabel('banner', <ImageIcon size={15} />, t('postDetails.visual'))}
              {openSection === 'banner' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  transition={{ duration: 0.22 }}
                  className="px-3 pb-3 overflow-hidden"
                >
                  {selectedVariant?.bannerUrl ? (
                    <div className="space-y-2">
                      <img
                        src={selectedVariant.bannerUrl}
                        alt={post.title}
                        className="w-full rounded-[14px] object-cover"
                        style={{ aspectRatio: '1 / 1' }}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleRegenerateVisual}
                        disabled={isRegeneratingVisual}
                        fullWidth
                      >
                        {isRegeneratingVisual
                          ? <><Loader2 size={13} className="animate-spin" />{t('postDetails.regeneratingVisual')}</>
                          : <><RefreshCw size={13} />{t('postDetails.regenerateVisual')}</>
                        }
                      </Button>
                    </div>
                  ) : post.banner ? (
                    <BannerPreview
                      banner={post.banner}
                      onRegenerate={() => showToast(t('postDetails.regenerateVisual') + '…')}
                      onChangeTemplate={() => showToast(t('postDetails.template') + '…')}
                      onRemove={() => showToast(t('postDetails.visual') + '…')}
                    />
                  ) : null}
                </motion.div>
              )}
            </div>
          )}

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
            <Button variant="ghost" size="md" onClick={handleRegenerate} fullWidth>
              <RefreshCw size={14} /> {t('postDetails.regenerateVariants')}
            </Button>
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
      </div>

      <ScheduleSheet
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSchedule={handleSchedulePost}
      />
    </motion.div>
  )
}
