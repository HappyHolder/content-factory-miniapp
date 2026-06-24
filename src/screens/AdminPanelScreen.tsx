import { useState } from 'react'
import { Ticket, LayoutTemplate, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { useApp } from '@/context/AppContext'
import { AdminPromoScreen } from '@/screens/AdminPromoScreen'
import { AdminStylesScreen } from '@/screens/AdminStylesScreen'

interface AdminPanelScreenProps { onBack: () => void }

/**
 * Admin Panel — a hub that gathers all admin tools (promo codes, styles market,
 * and more later). Each section is a self-contained sub-screen.
 */
export function AdminPanelScreen({ onBack }: AdminPanelScreenProps) {
  const { t } = useApp()
  const [section, setSection] = useState<'home' | 'promo' | 'styles'>('home')

  if (section === 'promo')  return <AdminPromoScreen  onBack={() => setSection('home')} />
  if (section === 'styles') return <AdminStylesScreen onBack={() => setSection('home')} />

  return (
    <div className="pb-8">
      <PageHeader title={t('admin.panelTitle')} subtitle={t('admin.panelSubtitle')} onBack={onBack} />
      <div className="px-4 mt-2">
        <GlassCard padding="none" className="overflow-hidden divide-y divide-white/6">
          <SectionButton icon={Ticket}         title={t('admin.sectionPromo')}  desc={t('admin.sectionPromoDesc')}  onClick={() => setSection('promo')} />
          <SectionButton icon={LayoutTemplate} title={t('admin.sectionStyles')} desc={t('admin.sectionStylesDesc')} onClick={() => setSection('styles')} />
        </GlassCard>
      </div>
    </div>
  )
}

function SectionButton({ icon: Icon, title, desc, onClick }: {
  icon: React.ElementType; title: string; desc: string; onClick: () => void
}) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left">
      <div className="w-7 h-7 rounded-[8px] bg-[rgba(255,106,0,0.12)] flex items-center justify-center">
        <Icon size={13} className="text-[#FF6A00]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-white">{title}</p>
        <p className="text-[11px] text-[#55555D]">{desc}</p>
      </div>
      <ChevronRight size={13} className="text-[#44444C]" />
    </button>
  )
}
