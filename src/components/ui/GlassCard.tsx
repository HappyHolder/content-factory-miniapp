import { cn } from '@/lib/utils'

interface GlassCardProps {
  children: React.ReactNode
  className?: string
  strong?: boolean
  onClick?: () => void
  padding?: 'sm' | 'md' | 'lg' | 'none'
}

export function GlassCard({ children, className, strong, onClick, padding = 'md' }: GlassCardProps) {
  const padMap = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' }
  return (
    <div
      onClick={onClick}
      className={cn(
        strong ? 'glass-card-strong' : 'glass-card',
        padMap[padding],
        onClick && 'cursor-pointer active:scale-[0.99] active:opacity-90 transition-all duration-100',
        className
      )}
    >
      {children}
    </div>
  )
}
