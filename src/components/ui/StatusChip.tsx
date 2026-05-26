import { cn } from '@/lib/utils'
import type { PostStatus, SourceType } from '@/types'

const statusConfig: Record<PostStatus, { label: string; className: string }> = {
  new: { label: 'New', className: 'bg-[rgba(255,106,0,0.13)] text-[#FF6A00] border-[rgba(255,106,0,0.28)]' },
  scheduled: { label: 'Scheduled', className: 'bg-white/6 text-[#A1A1AA] border-white/8' },
  published: { label: 'Published', className: 'bg-white/4 text-[#55555D] border-white/6' },
}

const sourceConfig: Record<SourceType, { label: string }> = {
  bot: { label: 'Bot' },
  link: { label: 'Link' },
  prompt: { label: 'Prompt' },
  text: { label: 'Text' },
  forwarded_post: { label: 'Forwarded' },
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
  const cfg = statusConfig[status]
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-px rounded-full text-[11px] font-medium border',
      cfg.className,
      className
    )}>
      {cfg.label}
    </span>
  )
}

export function SourceChip({ source, className }: SourceChipProps) {
  const cfg = sourceConfig[source]
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-px rounded-full text-[11px] font-medium bg-white/[0.05] text-[#66666E] border border-white/[0.07]',
      className
    )}>
      {cfg.label}
    </span>
  )
}
