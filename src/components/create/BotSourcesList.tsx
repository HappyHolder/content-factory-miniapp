import { motion } from 'framer-motion'
import { Bot, Link as LinkIcon, FileText } from 'lucide-react'
import type { BotSource, Channel } from '@/types'
import { formatRelativeTime, cn } from '@/lib/utils'
import { useApp } from '@/context/AppContext'

interface BotSourcesListProps {
  sources: BotSource[]
  usedIds: Set<string>
  isLoading: boolean
  channels: Channel[]
  onSelect: (source: BotSource) => void
}

export function BotSourcesList({
  sources,
  usedIds,
  isLoading,
  channels,
  onSelect,
}: BotSourcesListProps) {
  const { t } = useApp()

  // Hide entirely when not loading and nothing to show
  if (!isLoading && sources.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="space-y-2"
    >
      {/* Section header */}
      <div className="flex items-center gap-1.5 px-1">
        <Bot size={12} className="text-[#FF6A00]" />
        <p className="text-[10px] font-semibold text-[#44444C] uppercase tracking-wider">
          {t('create.botSourcesTitle')}
          {!isLoading && sources.length > 0 && (
            <span className="ml-1.5 text-[#FF6A00]">{sources.length}</span>
          )}
        </p>
      </div>

      {isLoading ? (
        // Subtle loading shimmer — two placeholder cards
        <div className="space-y-1.5">
          {[0, 1].map(i => (
            <div
              key={i}
              className="h-[62px] rounded-[14px] bg-white/[0.03] border border-white/[0.05] animate-pulse"
            />
          ))}
          <p className="text-[10px] text-[#44444C] text-center pb-1">
            {t('create.botSourcesLoading')}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sources.map((source, i) => {
            const isUsed    = usedIds.has(source.id)
            const isUrl     = source.type === 'URL'
            const snippet   = source.content.length > 80
              ? source.content.slice(0, 80) + '…'
              : source.content
            const channelTitle = source.channelId
              ? channels.find(c => c.id === source.channelId)?.title
              : undefined

            return (
              <motion.button
                key={source.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.2 }}
                onClick={() => { if (!isUsed) onSelect(source) }}
                disabled={isUsed}
                className={cn(
                  'w-full text-left rounded-[14px] border px-3 py-2.5 transition-all duration-150',
                  isUsed
                    ? 'bg-white/[0.02] border-white/[0.04] opacity-35 cursor-default'
                    : 'bg-white/[0.03] border-white/[0.07] hover:bg-white/[0.05] active:scale-[0.99] cursor-pointer'
                )}
              >
                {/* Content snippet + "Use" label */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-[12px] text-[#C1C1C8] leading-snug line-clamp-2 flex-1">
                    {snippet}
                  </p>
                  {!isUsed && (
                    <span className="text-[10px] font-semibold text-[#FF6A00] shrink-0 mt-px">
                      {t('create.botSourceUse')}
                    </span>
                  )}
                </div>

                {/* Metadata row */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Type badge */}
                  <span className={cn(
                    'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                    isUrl
                      ? 'bg-[rgba(255,106,0,0.09)] text-[#FF6A00]'
                      : 'bg-white/[0.05] text-[#55555D]'
                  )}>
                    {isUrl ? <LinkIcon size={9} /> : <FileText size={9} />}
                    {isUrl ? t('create.botSourceUrl') : t('create.botSourceText')}
                  </span>

                  {/* Relative time */}
                  <span className="text-[10px] text-[#44444C]">
                    {formatRelativeTime(new Date(source.createdAt))}
                  </span>

                  {/* Channel title if resolved */}
                  {channelTitle && (
                    <span className="text-[10px] text-[#44444C]">
                      · {channelTitle}
                    </span>
                  )}
                </div>
              </motion.button>
            )
          })}
        </div>
      )}
    </motion.div>
  )
}
