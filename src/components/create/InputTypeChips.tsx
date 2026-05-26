import { motion } from 'framer-motion'
import { Link, Lightbulb, FileText, Newspaper, Megaphone } from 'lucide-react'
import type { SourceType } from '@/types'
import type { TranslationKey } from '@/i18n'
import { useApp } from '@/context/AppContext'
import { cn } from '@/lib/utils'

interface InputTypeChipsProps {
  selected: SourceType
  onChange: (type: SourceType) => void
}

// Maps each source type to its label and placeholder translation keys.
// Placeholders are consumed by the parent (CreateScreen) via getPlaceholderKey().
const CHIP_CONFIG: { id: SourceType; labelKey: TranslationKey; icon: React.ElementType; placeholderKey: TranslationKey }[] = [
  { id: 'link',           labelKey: 'create.input.link',  icon: Link,        placeholderKey: 'create.placeholderLink'  },
  { id: 'prompt',         labelKey: 'create.input.idea',  icon: Lightbulb,   placeholderKey: 'create.placeholder'      },
  { id: 'text',           labelKey: 'create.input.text',  icon: FileText,    placeholderKey: 'create.placeholderText'  },
  { id: 'bot',            labelKey: 'create.input.news',  icon: Newspaper,   placeholderKey: 'create.placeholderNews'  },
  { id: 'forwarded_post', labelKey: 'create.input.promo', icon: Megaphone,   placeholderKey: 'create.placeholderPromo' },
]

/** Returns the translation key for the textarea placeholder of a given source type. */
export function getPlaceholderKey(sourceType: SourceType): TranslationKey {
  return CHIP_CONFIG.find(c => c.id === sourceType)?.placeholderKey ?? 'create.placeholder'
}

export function InputTypeChips({ selected, onChange }: InputTypeChipsProps) {
  const { t } = useApp()

  return (
    <div className="flex gap-1.5 flex-wrap">
      {CHIP_CONFIG.map((chip, i) => {
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
            {t(chip.labelKey)}
          </motion.button>
        )
      })}
    </div>
  )
}
