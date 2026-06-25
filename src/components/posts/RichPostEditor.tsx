import { useState } from 'react'
import { Loader2, Eye, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import { RichPostPreview, runsToText, textToRuns } from '@/components/posts/RichPostPreview'
import type { PostBlock } from '@/types'

interface RichPostEditorProps {
  postId:    string
  variantId: string
  blocks:    PostBlock[]
}

/**
 * Edits a formatted post's text content block-by-block, with a live preview, and
 * persists via PATCH /api/posts/:postId/blocks. Images/galleries are shown but
 * managed in the Visual section; here we edit the text of each block.
 */
export function RichPostEditor({ postId, variantId, blocks: initial }: RichPostEditorProps) {
  const { state, updatePost, showToast } = useApp()
  const [blocks, setBlocks] = useState<PostBlock[]>(() => structuredClone(initial))
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const patch = (i: number, next: PostBlock) => {
    setBlocks(prev => prev.map((b, idx) => idx === i ? next : b))
    setDirty(true)
  }

  const save = async () => {
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/posts/${postId}/blocks`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, variantId, blocks }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        showToast(err.error ?? 'Не удалось сохранить', 'error')
        return
      }
      // Reflect in app state so the preview and publish use the edited blocks.
      const current = state.posts.find(p => p.id === postId)
      if (current) {
        updatePost(postId, {
          variants: current.variants.map(v => v.id === variantId ? { ...v, blocks } : v),
        })
      }
      showToast('Сохранено')
      setDirty(false)
    } catch {
      showToast('Ошибка сохранения', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* mode toggle */}
      <div className="flex gap-1 p-1 rounded-[12px] bg-white/[0.04] border border-white/[0.06]">
        {([['preview', Eye, 'Превью'], ['edit', Pencil, 'Редактировать']] as const).map(([m, Icon, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] text-[12px] font-semibold transition-colors ${
              mode === m ? 'bg-[#FF6A00] text-white' : 'text-[#A1A1AA]'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {mode === 'preview' ? (
        <RichPostPreview blocks={blocks} />
      ) : (
        <div className="space-y-2.5">
          {blocks.map((b, i) => <BlockEditor key={i} b={b} onChange={next => patch(i, next)} />)}
        </div>
      )}

      {dirty && (
        <Button variant="primary" size="md" fullWidth onClick={save} disabled={saving}>
          {saving ? <><Loader2 size={14} className="animate-spin" /> Сохраняю…</> : 'Сохранить изменения'}
        </Button>
      )}
    </div>
  )
}

// ─── Per-block editors ──────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold text-[#55555D] uppercase tracking-wider mb-1">{children}</p>
}

function BlockEditor({ b, onChange }: { b: PostBlock; onChange: (next: PostBlock) => void }) {
  switch (b.type) {
    case 'heading':
      return (
        <div>
          <Label>Заголовок</Label>
          <input value={b.text} onChange={e => onChange({ ...b, text: e.target.value })}
            className="glass-input w-full px-3 py-2 text-sm font-semibold" />
        </div>
      )
    case 'paragraph':
      return (
        <div>
          <Label>Абзац · **жирный** ||спойлер||</Label>
          <textarea value={runsToText(b.runs)} onChange={e => onChange({ ...b, runs: textToRuns(e.target.value) })}
            rows={3} className="glass-input w-full px-3 py-2 text-sm resize-none" />
        </div>
      )
    case 'quote':
      return (
        <div>
          <Label>Цитата</Label>
          <textarea value={runsToText(b.runs)} onChange={e => onChange({ ...b, runs: textToRuns(e.target.value) })}
            rows={2} className="glass-input w-full px-3 py-2 text-sm resize-none" />
          <label className="flex items-center gap-2 mt-1.5 text-[12px] text-[#A1A1AA]">
            <input type="checkbox" checked={b.expandable === true}
              onChange={e => onChange({ ...b, expandable: e.target.checked })} />
            Сворачиваемая
          </label>
        </div>
      )
    case 'list':
      return (
        <div>
          <Label>Список · по пункту на строку</Label>
          <textarea
            value={b.items.map(runsToText).join('\n')}
            onChange={e => onChange({ ...b, items: e.target.value.split('\n').filter(l => l.trim()).map(textToRuns) })}
            rows={Math.max(2, b.items.length)} className="glass-input w-full px-3 py-2 text-sm resize-none" />
        </div>
      )
    case 'table':
      return (
        <div>
          <Label>Таблица</Label>
          <div className="space-y-1">
            {b.headers.length > 0 && (
              <div className="flex gap-1">
                {b.headers.map((h, ci) => (
                  <input key={ci} value={h}
                    onChange={e => onChange({ ...b, headers: b.headers.map((x, k) => k === ci ? e.target.value : x) })}
                    className="glass-input flex-1 min-w-0 px-2 py-1.5 text-[12px] font-semibold" />
                ))}
              </div>
            )}
            {b.rows.map((row, ri) => (
              <div key={ri} className="flex gap-1">
                {row.map((c, ci) => (
                  <input key={ci} value={c}
                    onChange={e => onChange({ ...b, rows: b.rows.map((r, k) => k === ri ? r.map((x, kk) => kk === ci ? e.target.value : x) : r) })}
                    className="glass-input flex-1 min-w-0 px-2 py-1.5 text-[12px]" />
                ))}
              </div>
            ))}
          </div>
        </div>
      )
    case 'image':
      return <div><Label>Картинка</Label><img src={b.url} alt="" className="w-full rounded-[10px] object-cover max-h-40" /></div>
    case 'gallery':
      return (
        <div>
          <Label>{b.layout === 'collage' ? 'Сетка' : 'Карусель'} · {b.urls.length} фото</Label>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {b.urls.map((u, i) => <img key={i} src={u} alt="" className="h-16 rounded-[8px] object-cover shrink-0" />)}
          </div>
        </div>
      )
    case 'divider':
      return <div><Label>Разделитель</Label><div className="h-px bg-white/10" /></div>
    default:
      return null
  }
}
