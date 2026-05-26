import { useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Calendar, RefreshCw, Layers, Image as ImageIcon, Link as LinkIcon } from 'lucide-react'
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

interface PostDetailsScreenProps {
  postId: string
  onBack: () => void
}

type Section = 'variants' | 'editor' | 'banner' | 'buttons'

export function PostDetailsScreen({ postId, onBack }: PostDetailsScreenProps) {
  const { state, selectVariant, publishPost, schedulePost, showToast, canSchedulePosts } = useApp()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [openSection, setOpenSection] = useState<Section>('variants')

  const post = state.posts.find(p => p.id === postId)
  if (!post) return null

  const selectedVariant = post.variants.find(v => v.id === post.selectedVariantId) || post.variants[0]
  const brandKit = brandKitService.getByChannelId(post.channelId)
  const allLinkButtons = brandKit?.linkKit.links.filter(l =>
    l.usage === 'button' || l.usage === 'always'
  ) || []

  const handlePublish = () => {
    publishPost(post.id)
    onBack()
  }

  const handleRegenerate = () => {
    showToast('Regenerating variant… (mock)')
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
            {sectionLabel('variants', <Layers size={15} />, 'Variants', `${post.variants.length}`)}
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
            {sectionLabel('editor', <span className="text-[13px] font-bold">Aa</span>, 'Edit text')}
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

          {/* Banner */}
          {post.banner && (
            <div>
              {sectionLabel('banner', <ImageIcon size={15} />, 'Banner')}
              {openSection === 'banner' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  transition={{ duration: 0.22 }}
                  className="px-3 pb-3 overflow-hidden"
                >
                  <BannerPreview
                    banner={post.banner}
                    onRegenerate={() => showToast('Banner regenerated (mock)')}
                    onChangeTemplate={() => showToast('Template changed (mock)')}
                    onRemove={() => showToast('Banner removed (mock)')}
                  />
                </motion.div>
              )}
            </div>
          )}

          {/* Buttons */}
          <div>
            {sectionLabel('buttons', <LinkIcon size={15} />, 'Link buttons', allLinkButtons.length > 0 ? `${allLinkButtons.length}` : undefined)}
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

        {/* Actions */}
        {post.status === 'new' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button variant="primary" size="lg" onClick={handlePublish} fullWidth>
                <Send size={16} /> Publish now
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => {
                  if (!canSchedulePosts) {
                    showToast('Отложенные посты доступны на тарифе Автор.', 'info')
                    return
                  }
                  setScheduleOpen(true)
                }}
              >
                <Calendar size={16} />
              </Button>
            </div>
            <Button variant="ghost" size="md" onClick={handleRegenerate} fullWidth>
              <RefreshCw size={14} /> Regenerate variants
            </Button>
          </div>
        )}

        {post.status === 'scheduled' && (
          <div className="space-y-2">
            <Button variant="primary" size="lg" onClick={handlePublish} fullWidth>
              <Send size={16} /> Publish now
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                if (!canSchedulePosts) {
                  showToast('Отложенные посты доступны на тарифе Автор.', 'info')
                  return
                }
                setScheduleOpen(true)
              }}
              fullWidth
            >
              <Calendar size={14} /> Change schedule
            </Button>
          </div>
        )}

        {post.status === 'published' && (
          <div className="space-y-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => window.open('https://t.me/' + post.channelUsername, '_blank')}
              fullWidth
            >
              Open in Telegram
            </Button>
            <Button variant="ghost" size="md" onClick={() => showToast('Creating similar post… (mock)')} fullWidth>
              Create similar
            </Button>
          </div>
        )}
      </div>

      <ScheduleSheet
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSchedule={date => schedulePost(post.id, date)}
      />
    </motion.div>
  )
}
