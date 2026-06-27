import { cn } from '@/lib/utils'
import { useApp } from '@/context/AppContext'
import type { PostStatus, SourceType } from '@/types'

const statusClassName: Record<PostStatus, string> = {
  new:       'bg-[rgba(255,106,0,0.13)] text-[#FF6A00] border-[rgba(255,106,0,0.28)]',
  scheduled: 'bg-white/6 text-[#A1A1AA] border-white/8',
  published: 'bg-white/4 text-[#55555D] border-white/6',
}

interface StatusChipProps {
  status: PostStatus
  className?: string
}

interface SourceChipProps {
  source: SourceType
  className?: string
}

export function StatusChip({ status, className }: StatusChipProps) {
  const { t } = useApp()

  const labelKey = {
    new:       'posts.status.new',
    scheduled: 'posts.status.scheduled',
    published: 'posts.status.published',
  }[status] as Parameters<typeof t>[0]

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-px rounded-full text-[11px] font-medium border',
      statusClassName[status],
      className
    )}>
      {t(labelKey)}
    </span>
  )
}

export function SourceChip({ source, className }: SourceChipProps) {
  const { t } = useApp()

  const labelKey = (({
    bot:            'posts.source.bot',
    prompt:         'posts.source.prompt',
    link:           'posts.source.link',
    text:           'posts.source.text',
    photo:          'posts.source.photo',
    forwarded_post: 'posts.source.forwardedPost',
    manual:         'posts.source.manual',
  } as Record<string, Parameters<typeof t>[0]>)[source]) ?? 'posts.source.prompt'

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-px rounded-full text-[11px] font-medium bg-white/[0.05] text-[#66666E] border border-white/[0.07]',
      className
    )}>
      {t(labelKey)}
    </span>
  )
}
