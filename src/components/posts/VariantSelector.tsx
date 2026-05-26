import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { PostVariant } from '@/types'
import { truncate } from '@/lib/utils'

interface VariantSelectorProps {
  variants: PostVariant[]
  selectedId?: string
  onSelect: (id: string) => void
}

export function VariantSelector({ variants, selectedId, onSelect }: VariantSelectorProps) {
  return (
    <div className="space-y-1.5">
      {variants.map((variant, i) => {
        const isSelected = variant.id === selectedId
        return (
          <motion.div
            key={variant.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.2 }}
          >
            <button
              onClick={() => onSelect(variant.id)}
              className={cn(
                'w-full text-left p-3 rounded-[14px] border transition-all duration-200',
                isSelected
                  ? 'bg-[rgba(255,106,0,0.07)] border-[rgba(255,106,0,0.28)]'
                  : 'bg-white/[0.03] border-white/[0.07] hover:bg-white/[0.05] hover:border-white/10'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={cn(
                  'text-[11px] font-semibold uppercase tracking-wider',
                  isSelected ? 'text-[#FF6A00]' : 'text-[#55555D]'
                )}>
                  {variant.label}
                </span>
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    className="w-3.5 h-3.5 rounded-full bg-[#FF6A00] flex items-center justify-center"
                  >
                    <div className="w-1 h-1 rounded-full bg-white" />
                  </motion.div>
                )}
              </div>
              <p className="text-[12px] text-[#66666E] leading-relaxed line-clamp-2">
                {truncate(variant.text, 140)}
              </p>
            </button>
          </motion.div>
        )
      })}
    </div>
  )
}
