import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface Tab {
  id: string
  label: string
  count?: number
}

interface SegmentedTabsProps {
  tabs: Tab[]
  activeTab: string
  onChange: (id: string) => void
  className?: string
}

export function SegmentedTabs({ tabs, activeTab, onChange, className }: SegmentedTabsProps) {
  return (
    <div className={cn(
      'flex items-center gap-0 p-[3px] rounded-[13px] bg-white/[0.03] border border-white/[0.06]',
      className
    )}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'relative flex-1 flex items-center justify-center gap-1 px-2.5 py-[5px] rounded-[10px] text-[13px] font-medium transition-colors duration-200 z-10',
            activeTab === tab.id ? 'text-white' : 'text-[#55555D] hover:text-[#A1A1AA]'
          )}
        >
          {activeTab === tab.id && (
            <motion.div
              layoutId="segmented-tab-pill"
              className="absolute inset-0 bg-[#1A1A1E] rounded-[10px] border border-white/[0.08] shadow-[0_1px_3px_rgba(0,0,0,0.45)]"
              transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
            />
          )}
          <span className="relative z-10">{tab.label}</span>
          {tab.count !== undefined && tab.count > 0 && (
            <span className={cn(
              'relative z-10 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-semibold',
              activeTab === tab.id
                ? 'bg-[rgba(255,106,0,0.18)] text-[#FF6A00]'
                : 'bg-white/6 text-[#55555D]'
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
