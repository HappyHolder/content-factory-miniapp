import { motion } from 'framer-motion'
import { Image, ChevronRight, Clock, Layers } from 'lucide-react'
import type { GeneratedPost } from '@/types'
import { StatusChip, SourceChip } from '@/components/ui/StatusChip'
import { formatRelativeTime, formatScheduledTime } from '@/lib/utils'
import { BannerMini } from '@/components/posts/BannerMini'
import { useApp } from '@/context/AppContext'

interface PostCardProps {
  post: GeneratedPost
  onClick: () => void
  index?: number
}

export function PostCard({ post, onClick, index = 0 }: PostCardProps) {
  const { t } = useApp()
  const variantWord = post.variants.length === 1 ? t('posts.meta.variant') : t('posts.meta.variants')

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.26, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <div
        onClick={onClick}
        className="glass-card p-3 cursor-pointer active:scale-[0.99] transition-transform duration-100"
      >
        <div className="flex gap-2.5">
          {post.banner && (
            <div className="shrink-0">
              <BannerMini banner={post.banner} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h3 className="text-[13px] font-semibold text-white leading-snug line-clamp-2 flex-1">
                {post.title}
              </h3>
              <StatusChip status={post.status} className="shrink-0 mt-0.5" />
            </div>

            <div className="flex flex-wrap items-center gap-1 mb-2">
              <SourceChip source={post.sourceType} />
              <span className="text-[11px] text-[#55555D] flex items-center gap-1">
                <Layers size={10} />
                {post.variants.length} {variantWord}
              </span>
              {post.banner && (
                <span className="text-[11px] text-[#55555D] flex items-center gap-1">
                  <Image size={10} />
                  {t('posts.meta.visual')}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#55555D]">@{post.channelUsername}</span>
                {post.status === 'scheduled' && post.scheduledAt ? (
                  <span className="text-[11px] text-[#FF6A00] flex items-center gap-1">
                    <Clock size={10} />
                    {formatScheduledTime(post.scheduledAt)}
                  </span>
                ) : (
                  <span className="text-[11px] text-[#55555D]">{formatRelativeTime(post.createdAt)}</span>
                )}
              </div>
              <ChevronRight size={13} className="text-[#44444C]" />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
