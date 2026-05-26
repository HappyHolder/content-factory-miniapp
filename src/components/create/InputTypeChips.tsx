import { motion } from 'framer-motion'
import { Link, Lightbulb, FileText, Newspaper, Megaphone } from 'lucide-react'
import type { SourceType } from '@/types'
import { cn } from '@/lib/utils'

interface InputTypeChipsProps {
  selected: SourceType
  onChange: (type: SourceType) => void
}

const chips: { id: SourceType; label: string; icon: React.ElementType; placeholder: string }[] = [
  { id: 'link', label: 'Link', icon: Link, placeholder: 'Paste a URL — article, product page, announcement…' },
  { id: 'prompt', label: 'Idea', icon: Lightbulb, placeholder: 'Describe what you want to write about…' },
  { id: 'text', label: 'Text', icon: FileText, placeholder: 'Paste a text to transform into a post…' },
  { id: 'bot', label: 'News', icon: Newspaper, placeholder: 'Paste a news item or announcement…' },
  { id: 'forwarded_post', label: 'Promo', icon: Megaphone, placeholder: 'Describe a promo or offer to create a post for…' },
]

export const chipPlaceholders = Object.fromEntries(chips.map(c => [c.id, c.placeholder]))

export function InputTypeChips({ selected, onChange }: InputTypeChipsProps) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {chips.map((chip, i) => {
        const isActive = chip.id === selected
        const Icon = chip.icon
        return (
          <motion.button
            key={chip.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04, duration: 0.18 }}
            onClick={() => onChange(chip.id)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-all duration-150',
              isActive
                ? 'bg-[rgba(255,106,0,0.11)] text-[#FF6A00] border-[rgba(255,106,0,0.28)]'
                : 'bg-white/[0.04] text-[#66666E] border-white/[0.07] hover:bg-white/[0.07] hover:text-[#A1A1AA]'
            )}
          >
            <Icon size={13} />
            {chip.label}
          </motion.button>
        )
      })}
    </div>
  )
}
