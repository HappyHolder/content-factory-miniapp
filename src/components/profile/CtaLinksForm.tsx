import { useState } from 'react'
import { Plus, Trash2, ExternalLink, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useApp } from '@/context/AppContext'
import type { Signature, LinkItem, LinkUsage } from '@/types'
import { cn } from '@/lib/utils'

interface CtaLinksFormProps {
  channelId: string
  initialSignature: Signature
  initialLinks: LinkItem[]
}

type SigUsage = 'always' | 'when_relevant' | 'never'

const QUICK_ADD_TEMPLATES = [
  { label: 'Product',  buttonLabel: 'Open Product',  anchorText: 'open the app'  },
  { label: 'Channel',  buttonLabel: 'Join Channel',  anchorText: 'our channel'   },
  { label: 'Chat',     buttonLabel: 'Join Chat',     anchorText: 'community'     },
  { label: 'Website',  buttonLabel: 'Visit Website', anchorText: 'our website'   },
]

export function CtaLinksForm({ channelId, initialSignature, initialLinks }: CtaLinksFormProps) {
  const { updateBrandKit, t } = useApp()

  // Signature state
  const [sigText,  setSigText]  = useState(initialSignature.text)
  const [sigCta,   setSigCta]   = useState(initialSignature.cta ?? '')
  const [sigUsage, setSigUsage] = useState<SigUsage>(initialSignature.usage)

  // Links state
  const [links,       setLinks]       = useState<LinkItem[]>(initialLinks)
  const [editingLink, setEditingLink] = useState<LinkItem | null>(null)
  const [sheetOpen,   setSheetOpen]   = useState(false)

  const sigUsageOptions: { value: SigUsage; label: string }[] = [
    { value: 'always',        label: t('channelStyle.ctaLinks.always')       },
    { value: 'when_relevant', label: t('channelStyle.ctaLinks.whenRelevant') },
    { value: 'never',         label: t('channelStyle.ctaLinks.never')        },
  ]

  const linkUsageOptions: { value: LinkUsage; label: string }[] = [
    { value: 'button',        label: t('channelStyle.ctaLinks.usageButton')       },
    { value: 'inline',        label: t('channelStyle.ctaLinks.usageInline')       },
    { value: 'signature',     label: t('channelStyle.ctaLinks.usageSignature')    },
    { value: 'when_relevant', label: t('channelStyle.ctaLinks.usageWhenRelevant') },
    { value: 'always',        label: t('channelStyle.ctaLinks.usageAlways')       },
  ]

  const openNew = (tpl?: { label: string; buttonLabel: string; anchorText: string }) => {
    setEditingLink({
      id: `l-${Date.now()}`,
      label: tpl?.label ?? '',
      url: '',
      anchorText: tpl?.anchorText ?? '',
      buttonLabel: tpl?.buttonLabel ?? '',
      usage: 'button',
    })
    setSheetOpen(true)
  }

  const openEdit = (link: LinkItem) => {
    setEditingLink({ ...link })
    setSheetOpen(true)
  }

  const saveLink = () => {
    if (!editingLink) return
    const exists = links.some(l => l.id === editingLink.id)
    setLinks(exists
      ? links.map(l => l.id === editingLink.id ? editingLink : l)
      : [...links, editingLink]
    )
    setSheetOpen(false)
  }

  const deleteLink = (id: string) => setLinks(links.filter(l => l.id !== id))

  const handleSave = () => {
    updateBrandKit(channelId, {
      signature: { text: sigText, cta: sigCta || undefined, usage: sigUsage },
      linkKit:   { links },
    })
  }

  return (
    <div className="space-y-5">

      {/* ── Signature ── */}
      <div>
        <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider mb-3">
          {t('channelStyle.ctaLinks.signatureSection')}
        </p>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
              {t('channelStyle.ctaLinks.signatureText')}
            </p>
            <textarea
              value={sigText}
              onChange={e => setSigText(e.target.value)}
              rows={2}
              placeholder={t('channelStyle.ctaLinks.signaturePlaceholder')}
              className="glass-input w-full px-3 py-2.5 text-sm"
            />
          </div>

          <div>
            <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
              {t('channelStyle.ctaLinks.ctaText')}
            </p>
            <input
              value={sigCta}
              onChange={e => setSigCta(e.target.value)}
              placeholder={t('channelStyle.ctaLinks.ctaPlaceholder')}
              className="glass-input w-full px-3 py-2.5 text-sm"
            />
          </div>

          <div>
            <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
              {t('channelStyle.ctaLinks.signatureUsage')}
            </p>
            <div className="flex flex-wrap gap-2">
              {sigUsageOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSigUsage(opt.value)}
                  className={cn(
                    'px-3 py-1 rounded-full text-[12px] font-medium border transition-all duration-150',
                    sigUsage === opt.value
                      ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border-[rgba(255,106,0,0.38)]'
                      : 'bg-white/5 text-[#A1A1AA] border-white/[0.06]'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {(sigText || sigCta) && (
            <div className="p-3 rounded-[12px] bg-white/[0.03] border border-white/[0.06]">
              <p className="text-[10px] font-semibold text-[#55555D] uppercase tracking-wide mb-1.5">
                {t('channelStyle.ctaLinks.preview')}
              </p>
              {sigText && <p className="text-sm text-[#A1A1AA] whitespace-pre-wrap">{sigText}</p>}
              {sigCta  && <p className="text-sm text-[#FF6A00] mt-1">{sigCta}</p>}
            </div>
          )}
        </div>
      </div>

      {/* ── Link buttons ── */}
      <div>
        <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider mb-3">
          {t('channelStyle.ctaLinks.linksSection')}
        </p>

        {/* Existing links */}
        {links.length > 0 && (
          <div className="space-y-2 mb-3">
            {links.map(link => (
              <div
                key={link.id}
                onClick={() => openEdit(link)}
                className="flex items-start gap-3 p-3.5 rounded-[14px] bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] cursor-pointer transition-colors"
              >
                <GripVertical size={14} className="text-[#66666E] mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-white">{link.label}</span>
                    <span className="text-[11px] text-[#66666E] shrink-0">
                      {linkUsageOptions.find(u => u.value === link.usage)?.label}
                    </span>
                  </div>
                  <p className="text-xs text-[#66666E] truncate">
                    {link.url || t('channelStyle.ctaLinks.noUrl')}
                  </p>
                  {link.buttonLabel && (
                    <div className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[rgba(255,106,0,0.10)] border border-[rgba(255,106,0,0.20)] text-[11px] text-[#FF6A00]">
                      <ExternalLink size={9} />
                      {link.buttonLabel}
                    </div>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteLink(link.id) }}
                  className="text-[#66666E] hover:text-red-400 transition-colors p-1 shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Quick add (only when empty) */}
        {links.length === 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
              {t('channelStyle.ctaLinks.quickAdd')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ADD_TEMPLATES.map(tpl => (
                <button
                  key={tpl.label}
                  onClick={() => openNew(tpl)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-[12px] bg-white/[0.03] border border-white/[0.06] text-sm text-[#A1A1AA] hover:bg-white/[0.06] hover:text-white transition-colors text-left"
                >
                  <Plus size={13} className="text-[#FF6A00]" />
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <Button variant="secondary" size="sm" onClick={() => openNew()} fullWidth>
          <Plus size={14} /> {t('channelStyle.ctaLinks.addLink')}
        </Button>
      </div>

      <Button variant="primary" size="md" onClick={handleSave} fullWidth>
        {t('channelStyle.save.ctaLinks')}
      </Button>

      {/* Link editor sheet */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t('channelStyle.ctaLinks.editLink')}
        height="80"
      >
        {editingLink && (
          <div className="space-y-3 pt-1">
            {(['label', 'url', 'anchorText', 'buttonLabel'] as const).map(field => (
              <div key={field}>
                <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
                  {t(`channelStyle.ctaLinks.${field}`)}
                </p>
                <input
                  value={editingLink[field]}
                  onChange={e => setEditingLink(prev => prev ? { ...prev, [field]: e.target.value } : null)}
                  placeholder={
                    field === 'url'         ? 'https://…'      :
                    field === 'anchorText'  ? 'click here'     :
                    field === 'buttonLabel' ? 'Open Product'   : 'Product'
                  }
                  className="glass-input w-full px-3 py-2.5 text-sm"
                />
              </div>
            ))}

            <div>
              <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
                {t('channelStyle.ctaLinks.usage')}
              </p>
              <div className="flex flex-wrap gap-2">
                {linkUsageOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setEditingLink(prev => prev ? { ...prev, usage: opt.value } : null)}
                    className={cn(
                      'px-3 py-1 rounded-full text-[12px] font-medium border transition-all',
                      editingLink.usage === opt.value
                        ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border-[rgba(255,106,0,0.38)]'
                        : 'bg-white/5 text-[#A1A1AA] border-white/[0.06]'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" size="md" onClick={() => setSheetOpen(false)} fullWidth>
                {t('channelStyle.ctaLinks.cancel')}
              </Button>
              <Button variant="primary" size="md" onClick={saveLink} fullWidth>
                {t('channelStyle.ctaLinks.save')}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
