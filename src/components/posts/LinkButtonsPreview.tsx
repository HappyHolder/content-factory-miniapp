import { useState } from 'react'
import { ExternalLink, ToggleLeft, ToggleRight } from 'lucide-react'
import type { LinkItem } from '@/types'
import { cn } from '@/lib/utils'
import { useApp } from '@/context/AppContext'

interface LinkButtonsPreviewProps {
  buttons: LinkItem[]
  allButtons?: LinkItem[]
  onToggle?: (id: string, enabled: boolean) => void
}

export function LinkButtonsPreview({ buttons, allButtons, onToggle }: LinkButtonsPreviewProps) {
  const { t } = useApp()
  const displayButtons = allButtons || buttons
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {}
    displayButtons.forEach(b => {
      map[b.id] = buttons.some(btn => btn.id === b.id)
    })
    return map
  })

  const handleToggle = (id: string) => {
    const next = !enabled[id]
    setEnabled(prev => ({ ...prev, [id]: next }))
    onToggle?.(id, next)
  }

  if (displayButtons.length === 0) {
    return (
      <p className="text-sm text-[#66666E] text-center py-4">
        {t('postDetails.noButtons')}<br />
        <span className="text-[#A1A1AA]">{t('postDetails.configureLinks')}</span>
      </p>
    )
  }

  const activeButtons = displayButtons.filter(b => enabled[b.id])

  return (
    <div className="space-y-3">
      {displayButtons.map(btn => (
        <div key={btn.id} className="flex items-center justify-between gap-3">
          <div className={cn(
            'flex-1 flex items-center gap-2.5 px-4 py-2.5 rounded-[12px] border transition-all duration-200',
            enabled[btn.id]
              ? 'bg-white/6 border-white/12 text-white'
              : 'bg-white/3 border-white/6 text-[#66666E]'
          )}>
            <ExternalLink size={14} className="shrink-0 text-[#A1A1AA]" />
            <span className="text-sm font-medium">{btn.buttonLabel}</span>
          </div>
          <button
            onClick={() => handleToggle(btn.id)}
            className="text-[#66666E] hover:text-white transition-colors"
          >
            {enabled[btn.id]
              ? <ToggleRight size={22} className="text-[#FF6A00]" />
              : <ToggleLeft size={22} />
            }
          </button>
        </div>
      ))}

      {activeButtons.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/8">
          <p className="text-[11px] text-[#66666E] uppercase tracking-wide font-semibold mb-2">
            {t('postDetails.previewLabel')}
          </p>
          <div className="flex flex-wrap gap-2">
            {activeButtons.map(btn => (
              <div
                key={btn.id}
                className="px-4 py-2 rounded-[10px] bg-[rgba(255,106,0,0.10)] border border-[rgba(255,106,0,0.28)] text-sm font-medium text-[#FF6A00] flex items-center gap-1.5"
              >
                {btn.buttonLabel}
                <ExternalLink size={11} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
