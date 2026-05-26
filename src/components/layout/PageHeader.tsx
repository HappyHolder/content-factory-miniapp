import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
  right?: React.ReactNode
  chip?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, onBack, right, chip, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between px-4 pt-3 pb-2', className)}>
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {onBack && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onBack}
            className="shrink-0 mt-0.5 w-8 h-8 flex items-center justify-center rounded-full bg-white/8 text-[#A1A1AA] hover:text-white hover:bg-white/12 transition-colors"
          >
            <ArrowLeft size={17} />
          </motion.button>
        )}
        <div className="min-w-0 flex-1">
          {onBack ? (
            <>
              <h1 className="text-[15px] font-semibold text-white tracking-tight leading-snug line-clamp-2">{title}</h1>
              {chip && <div className="mt-1">{chip}</div>}
            </>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[18px] font-bold text-white tracking-tight truncate">{title}</h1>
              {chip}
            </div>
          )}
          {subtitle && (
            <p className="text-[12px] text-[#66666E] mt-0.5 leading-snug">{subtitle}</p>
          )}
        </div>
      </div>
      {right && <div className="shrink-0 ml-2">{right}</div>}
    </div>
  )
}
