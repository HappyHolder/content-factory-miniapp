import type { Banner } from '@/types'
import { cn } from '@/lib/utils'

interface BannerMiniProps {
  banner: Banner
  className?: string
}

export function BannerMini({ banner, className }: BannerMiniProps) {
  return (
    <div className={cn(
      'w-[52px] h-[52px] rounded-[12px] overflow-hidden relative shrink-0',
      'bg-[#111114] border border-white/[0.07] flex items-end justify-start p-1',
      className
    )}>
      <div
        className="absolute inset-0 opacity-25"
        style={{
          background: `radial-gradient(circle at 70% 30%, ${banner.accentColor}55 0%, transparent 60%)`,
        }}
      />
      <div className="absolute top-0 left-0 right-0 h-[1px] opacity-50"
        style={{ background: `linear-gradient(90deg, transparent, ${banner.accentColor}50, transparent)` }}
      />
      <span className="relative z-10 text-[7px] font-bold text-white leading-tight line-clamp-2 opacity-85">
        {banner.title}
      </span>
    </div>
  )
}
