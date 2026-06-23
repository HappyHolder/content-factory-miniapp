import { LayoutTemplate } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useApp } from '@/context/AppContext'

/**
 * Styles tab — the cover-style market. Placeholder for now: 4 "Soon" cards.
 * Card contents will be defined later.
 */
export function StylesScreen() {
  const { t } = useApp()
  return (
    <div className="pb-8">
      <PageHeader title={t('styles.title')} subtitle={t('styles.subtitle')} />

      <div className="px-4 mt-2 grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className="relative aspect-square rounded-[18px] bg-white/[0.04] border border-white/[0.07] flex flex-col items-center justify-center gap-3"
          >
            <LayoutTemplate size={26} className="text-[#3A3A42]" />
            <span className="px-3 py-1 rounded-full bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.25)] text-[#FF6A00] text-[10px] font-semibold uppercase tracking-wider">
              {t('styles.soon')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
