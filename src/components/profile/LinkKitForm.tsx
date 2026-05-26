import { useState } from 'react'
import { Plus, Trash2, ExternalLink, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useApp } from '@/context/AppContext'
import type { LinkItem, LinkUsage } from '@/types'
import { cn } from '@/lib/utils'

interface LinkKitFormProps {
  channelId: string
  initialLinks: LinkItem[]
}

const defaultLinkTemplates = [
  { label: 'Product', buttonLabel: 'Open Product', anchorText: 'open the app' },
  { label: 'Channel', buttonLabel: 'Join Channel', anchorText: 'our channel'  },
  { label: 'Chat',    buttonLabel: 'Join Chat',    anchorText: 'community'    },
  { label: 'Website', buttonLabel: 'Visit Website',anchorText: 'our website'  },
]

export function LinkKitForm({ channelId, initialLinks }: LinkKitFormProps) {
  const { updateBrandKit, t } = useApp()
  const [links, setLinks] = useState<LinkItem[]>(initialLinks)
  const [editingLink, setEditingLink] = useState<LinkItem | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const usageOptions: { value: LinkUsage; label: string }[] = [
    { value: 'button',        label: t('channelStyle.links.usageButton')       },
    { value: 'inline',        label: t('channelStyle.links.usageInline')       },
    { value: 'signature',     label: t('channelStyle.links.usageSignature')    },
    { value: 'when_relevant', label: t('channelStyle.links.usageWhenRelevant') },
    { value: 'always',        label: t('channelStyle.links.usageAlways')       },
  ]

  const openNew = (template?: { label: string; buttonLabel: string; anchorText: string }) => {
    setEditingLink({
      id: `l-${Date.now()}`,
      label: template?.label || '',
      url: '',
      anchorText: template?.anchorText || '',
      buttonLabel: template?.buttonLabel || '',
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
    const existing = links.find(l => l.id === editingLink.id)
    if (existing) {
      setLinks(links.map(l => l.id === editingLink.id ? editingLink : l))
    } else {
      setLinks([...links, editingLink])
    }
    setSheetOpen(false)
    updateBrandKit(channelId, { linkKit: { links: existing
      ? links.map(l => l.id === editingLink.id ? editingLink : l)
      : [...links, editingLink]
    }})
  }

  const deleteLink = (id: string) => {
    const next = links.filter(l => l.id !== id)
    setLinks(next)
    updateBrandKit(channelId, { linkKit: { links: next } })
  }

  const fieldLabel = (field: 'label' | 'url' | 'anchorText' | 'buttonLabel'): string => {
    if (field === 'label')       return t('channelStyle.links.label')
    if (field === 'url')         return t('channelStyle.links.url')
    if (field === 'anchorText')  return t('channelStyle.links.anchorText')
    if (field === 'buttonLabel') return t('channelStyle.links.buttonLabel')
    return field
  }

  return (
    <div className="space-y-4">
      {links.length > 0 && (
        <div className="space-y-2">
          {links.map(link => (
            <div
              key={link.id}
              onClick={() => openEdit(link)}
              className="flex items-start gap-3 p-3.5 rounded-[16px] bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] cursor-pointer transition-colors"
            >
              <GripVertical size={14} className="text-[#66666E] mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-sm font-semibold text-white">{link.label}</span>
                  <span className="text-[11px] text-[#66666E] bg-white/6 px-2 py-0.5 rounded-full shrink-0">
                    {usageOptions.find(u => u.value === link.usage)?.label}
                  </span>
                </div>
                <p className="text-xs text-[#66666E] truncate">
                  {link.url || t('channelStyle.links.noUrl')}
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

      {links.length === 0 && (
        <div>
          <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
            {t('channelStyle.links.quickAdd')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {defaultLinkTemplates.map(tpl => (
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

      <Button variant="secondary" size="md" onClick={() => openNew()} fullWidth>
        <Plus size={14} /> {t('channelStyle.links.addLink')}
      </Button>

      {/* Edit sheet */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editingLink?.id?.startsWith('l-') ? t('channelStyle.links.addLink') : t('channelStyle.links.editLink')}
        height="80"
      >
        {editingLink && (
          <div className="space-y-3 pt-1">
            {(['label', 'url', 'anchorText', 'buttonLabel'] as const).map(field => (
              <div key={field}>
                <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
                  {fieldLabel(field)}
                </p>
                <input
                  value={editingLink[field]}
                  onChange={e => setEditingLink(prev => prev ? { ...prev, [field]: e.target.value } : null)}
                  placeholder={
                    field === 'url'         ? 'https://...'   :
                    field === 'anchorText'  ? 'click here'    :
                    field === 'buttonLabel' ? 'Open Product'  : 'Product'
                  }
                  className="glass-input w-full px-3 py-2.5 text-sm"
                />
              </div>
            ))}

            <div>
              <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
                {t('channelStyle.links.usage')}
              </p>
              <div className="flex flex-wrap gap-2">
                {usageOptions.map(opt => (
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
                {t('channelStyle.links.cancel')}
              </Button>
              <Button variant="primary" size="md" onClick={saveLink} fullWidth>
                {t('channelStyle.links.save')}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
