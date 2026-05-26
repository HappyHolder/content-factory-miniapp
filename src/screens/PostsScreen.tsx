import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, ExternalLink, Copy, Pencil, Trash2, Send } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { ChannelSwitcherHeader } from '@/components/layout/ChannelSwitcherHeader'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { PostCard } from '@/components/posts/PostCard'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { BannerMini } from '@/components/posts/BannerMini'
import type { GeneratedPost } from '@/types'
import { formatScheduledTime, formatRelativeTime } from '@/lib/utils'

type TabId = 'new' | 'scheduled' | 'published'

interface PostsScreenProps {
  onOpenPost: (id: string) => void
}

export function PostsScreen({ onOpenPost }: PostsScreenProps) {
  const { state, publishPost, cancelSchedule, showToast, t } = useApp()
  const [activeTab, setActiveTab] = useState<TabId>('new')

  const newPosts       = state.posts.filter(p => p.status === 'new')
  const scheduledPosts = state.posts.filter(p => p.status === 'scheduled')
  const publishedPosts = state.posts.filter(p => p.status === 'published')

  const tabs = [
    { id: 'new',       label: t('posts.tabs.new'),       count: newPosts.length       },
    { id: 'scheduled', label: t('posts.tabs.scheduled'), count: scheduledPosts.length },
    { id: 'published', label: t('posts.tabs.published')                               },
  ]

  return (
    <div>
      <ChannelSwitcherHeader />

      <div className="px-4 mb-2.5">
        <SegmentedTabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={id => setActiveTab(id as TabId)}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="px-4 space-y-2"
        >
          {activeTab === 'new' && (
            newPosts.length === 0
              ? <EmptyState message={t('posts.empty.noNew')} sub={t('posts.empty.noNewSub')} />
              : newPosts.map((p, i) => (
                <PostCard key={p.id} post={p} onClick={() => onOpenPost(p.id)} index={i} />
              ))
          )}

          {activeTab === 'scheduled' && (
            scheduledPosts.length === 0
              ? <EmptyState message={t('posts.empty.noScheduled')} sub={t('posts.empty.noScheduledSub')} />
              : scheduledPosts.map((p, i) => (
                <ScheduledCard
                  key={p.id}
                  post={p}
                  onOpen={() => onOpenPost(p.id)}
                  onPublishNow={() => publishPost(p.id)}
                  onCancel={() => cancelSchedule(p.id)}
                  index={i}
                />
              ))
          )}

          {activeTab === 'published' && (
            publishedPosts.length === 0
              ? <EmptyState message={t('posts.empty.noPublished')} sub={t('posts.empty.noPublishedSub')} />
              : publishedPosts.map((p, i) => (
                <PublishedCard
                  key={p.id}
                  post={p}
                  onCopy={() => {
                    const variant = p.variants.find(v => v.id === p.selectedVariantId) || p.variants[0]
                    navigator.clipboard.writeText(variant?.text || '').catch(() => {})
                    showToast(t('common.copied'))
                  }}
                  onCreateSimilar={() => showToast(t('posts.actions.createSimilar') + '…')}
                  index={i}
                />
              ))
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function EmptyState({ message, sub }: { message: string; sub: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <div className="w-12 h-12 rounded-full bg-white/4 flex items-center justify-center mb-3">
        <div className="w-5 h-5 rounded-full bg-white/10" />
      </div>
      <p className="text-sm font-medium text-[#A1A1AA] mb-1">{message}</p>
      <p className="text-xs text-[#66666E]">{sub}</p>
    </motion.div>
  )
}

function ScheduledCard({ post, onOpen, onPublishNow, onCancel, index }: {
  post: GeneratedPost
  onOpen: () => void
  onPublishNow: () => void
  onCancel: () => void
  index: number
}) {
  const { t } = useApp()
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.25 }}
    >
      <GlassCard padding="sm">
        <div className="flex gap-2.5 mb-2.5">
          {post.banner && <BannerMini banner={post.banner} />}
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] font-semibold text-white line-clamp-2 mb-1">{post.title}</h3>
            <span className="text-[11px] text-[#FF6A00] flex items-center gap-1">
              <Clock size={10} />
              {post.scheduledAt ? formatScheduledTime(post.scheduledAt) : '—'}
            </span>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={onOpen} className="flex-1">
            <Pencil size={11} /> {t('posts.actions.open')}
          </Button>
          <Button variant="primary" size="sm" onClick={onPublishNow} className="flex-1">
            <Send size={11} /> {t('posts.actions.publishNow')}
          </Button>
          <Button variant="danger" size="sm" onClick={onCancel}>
            <Trash2 size={11} />
          </Button>
        </div>
      </GlassCard>
    </motion.div>
  )
}

function PublishedCard({ post, onCopy, onCreateSimilar, index }: {
  post: GeneratedPost
  onCopy: () => void
  onCreateSimilar: () => void
  index: number
}) {
  const { t } = useApp()
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.25 }}
    >
      <GlassCard padding="sm">
        <div className="flex gap-2.5 mb-2.5">
          {post.banner && <BannerMini banner={post.banner} />}
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] font-semibold text-white line-clamp-2 mb-1">{post.title}</h3>
            <p className="text-[11px] text-[#55555D]">
              @{post.channelUsername} · {post.publishedAt ? formatRelativeTime(post.publishedAt) : '—'}
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open('https://t.me/' + post.channelUsername, '_blank')}
            className="flex-1"
          >
            <ExternalLink size={11} /> {t('posts.actions.open')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCreateSimilar} className="flex-1">
            {t('posts.actions.createSimilar')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCopy}>
            <Copy size={11} />
          </Button>
        </div>
      </GlassCard>
    </motion.div>
  )
}
