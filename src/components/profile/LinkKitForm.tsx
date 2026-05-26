import { useState } from 'react'
import { Plus, Trash2, ExternalLink, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { GlassCard } from '@/components/ui/GlassCard'
import { Sheet } from '@/components/ui/Sheet'
import { useApp } from '@/context/AppContext'
import type { LinkItem, LinkUsage } from '@/types'
import { cn } from '@/lib/utils'

interface LinkKitFormProps {
  channelId: string
  initialLinks: LinkItem[]
}

const usageOptions: { value: LinkUsage; label: string }[] = [
  { value: 'button', label: 'Button under post' },
  { value: 'inline', label: 'Inline link' },
  { value: 'signature', label: 'Signature' },
  { value: 'when_relevant', label: 'When relevant' },
  { value: 'always', label: 'Always add' },
]

const defaultLinkTemplates = [
  { label: 'Product', buttonLabel: 'Open Product', anchorText: 'open the app' },
  { label: 'Channel', buttonLabel: 'Join Channel', anchorText: 'our channel' },
  { label: 'Chat', buttonLabel: 'Join Chat', anchorText: 'community' },
  { label: 'Website', buttonLabel: 'Visit Website', anchorText: 'our website' },
]

export function LinkKitForm({ channelId, initialLinks }: LinkKitFormProps) {
  const { updateBrandKit } = useApp()
  const [links, setLinks] = useState<LinkItem[]>(initialLinks)
  const [editingLink, setEditingLink] = useState<LinkItem | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

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

  return (
    <div className="space-y-4">
      {links.length > 0 && (
        <div className="space-y-2">
          {links.map(link => (
            <div
              key={link.id}
              onClick={() => openEdit(link)}
              className="flex items-start gap-3 p-3.5 rounded-[16px] bg-white/4 border border-white/8 hover:bg-white/6 cursor-pointer transition-colors"
            >
              <GripVertical size={14} className="text-[#66666E] mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-sm font-semibold text-white">{link.label}</span>
                  <span className="text-[11px] text-[#66666E] bg-white/6 px-2 py-0.5 rounded-full shrink-0">
                    {usageOptions.find(u => u.value === link.usage)?.label}
                  </span>
                </div>
                <p className="text-xs text-[#66666E] truncate">{link.url || 'No URL'}</p>
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
          <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">Quick add</p>
          <div className="grid grid-cols-2 gap-2">
            {defaultLinkTemplates.map(t => (
              <button
                key={t.label}
                onClick={() => openNew(t)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-[12px] bg-white/4 border border-white/8 text-sm text-[#A1A1AA] hover:bg-white/8 hover:text-white transition-colors text-left"
              >
                <Plus size={13} className="text-[#FF6A00]" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <Button variant="secondary" size="md" onClick={() => openNew()} fullWidth>
        <Plus size={14} /> Add link
      </Button>

      {/* Edit sheet */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={editingLink?.id?.startsWith('l-') ? 'Add Link' : 'Edit Link'} height="80">
        {editingLink && (
          <div className="space-y-3 pt-1">
            {(['label', 'url', 'anchorText', 'buttonLabel'] as const).map(field => (
              <div key={field}>
                <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
                  {field === 'anchorText' ? 'Anchor text' : field === 'buttonLabel' ? 'Button label' : field.charAt(0).toUpperCase() + field.slice(1)}
                </p>
                <input
                  value={editingLink[field]}
                  onChange={e => setEditingLink(prev => prev ? { ...prev, [field]: e.target.value } : null)}
                  placeholder={
                    field === 'url' ? 'https://...' :
                    field === 'anchorText' ? 'click here' :
                    field === 'buttonLabel' ? 'Open Product' : 'Product'
                  }
                  className="glass-input w-full px-3 py-2.5 text-sm"
                />
              </div>
            ))}

            <div>
              <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">Usage</p>
              <div className="flex flex-wrap gap-2">
                {usageOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setEditingLink(prev => prev ? { ...prev, usage: opt.value } : null)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                      editingLink.usage === opt.value
                        ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border-[rgba(255,106,0,0.38)]'
                        : 'bg-white/5 text-[#A1A1AA] border-white/8'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" size="md" onClick={() => setSheetOpen(false)} fullWidth>Cancel</Button>
              <Button variant="primary" size="md" onClick={saveLink} fullWidth>Save</Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
