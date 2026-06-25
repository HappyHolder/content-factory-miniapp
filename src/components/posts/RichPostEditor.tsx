import { useRef, useState } from 'react'
import { Loader2, Eye, Pencil, ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import { RichPostPreview, runsToText, textToRuns } from '@/components/posts/RichPostPreview'
import type { PostBlock } from '@/types'
import { cn } from '@/lib/utils'

interface RichPostEditorProps {
  postId:        string
  variantId:     string
  blocks:        PostBlock[]
  channelName?:  string
  channelHandle?: string
  avatarUrl?:    string | null
}

const BLOCK_LABEL: Record<PostBlock['type'], string> = {
  heading: 'Заголовок', paragraph: 'Абзац', list: 'Список', quote: 'Цитата',
  table: 'Таблица', image: 'Картинка', gallery: 'Галерея', divider: 'Разделитель',
}

function makeBlock(type: PostBlock['type']): PostBlock {
  switch (type) {
    case 'heading':   return { type: 'heading', text: '' }
    case 'paragraph': return { type: 'paragraph', runs: [{ t: '' }] }
    case 'list':      return { type: 'list', ordered: false, items: [[{ t: '' }]] }
    case 'quote':     return { type: 'quote', runs: [{ t: '' }], expandable: false }
    case 'table':     return { type: 'table', headers: ['', ''], rows: [['', '']] }
    case 'divider':   return { type: 'divider' }
    default:          return { type: 'paragraph', runs: [{ t: '' }] }
  }
}

export function RichPostEditor({ postId, variantId, blocks: initial, channelName, channelHandle, avatarUrl }: RichPostEditorProps) {
  const { state, updatePost, showToast } = useApp()
  const [blocks, setBlocks] = useState<PostBlock[]>(() => structuredClone(initial))
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const mutate = (next: PostBlock[]) => { setBlocks(next); setDirty(true) }
  const patch  = (i: number, next: PostBlock) => mutate(blocks.map((b, idx) => idx === i ? next : b))
  const remove = (i: number) => mutate(blocks.filter((_, idx) => idx !== i))
  const move   = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    const copy = blocks.slice()
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
    mutate(copy)
  }
  const add = (type: PostBlock['type']) => { mutate([...blocks, makeBlock(type)]); setAddOpen(false) }

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
        showToast(err.error ?? 'Не удалось сохранить', 'error'); return
      }
      const current = state.posts.find(p => p.id === postId)
      if (current) {
        updatePost(postId, { variants: current.variants.map(v => v.id === variantId ? { ...v, blocks } : v) })
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
        {([['preview', Eye, 'Превью'], ['edit', Pencil, 'Редактор']] as const).map(([m, Icon, label]) => (
          <button key={m} onClick={() => setMode(m)}
            className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[9px] text-[12.5px] font-semibold transition-colors',
              mode === m ? 'bg-[#FF6A00] text-white' : 'text-[#A1A1AA]')}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {mode === 'preview' ? (
        <RichPostPreview blocks={blocks} channelName={channelName} channelHandle={channelHandle} avatarUrl={avatarUrl} />
      ) : (
        <div className="space-y-2">
          {blocks.map((b, i) => (
            <div key={i} className="rounded-[12px] bg-white/[0.03] border border-white/[0.07] overflow-hidden">
              {/* card header */}
              <div className="flex items-center gap-1 px-2.5 py-1.5 bg-white/[0.02] border-b border-white/[0.05]">
                <span className="text-[10px] font-semibold text-[#55555D] uppercase tracking-wider flex-1">{BLOCK_LABEL[b.type]}</span>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-[#66666E] hover:text-white disabled:opacity-25"><ChevronUp size={14} /></button>
                <button onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="p-1 text-[#66666E] hover:text-white disabled:opacity-25"><ChevronDown size={14} /></button>
                <button onClick={() => remove(i)} className="p-1 text-[#55555D] hover:text-red-400"><Trash2 size={13} /></button>
              </div>
              <div className="p-2.5">
                <BlockEditor b={b} onChange={next => patch(i, next)} />
              </div>
            </div>
          ))}

          {/* add block */}
          <div>
            <button onClick={() => setAddOpen(o => !o)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[10px] border border-dashed border-white/[0.12] text-[12.5px] text-[#A1A1AA] hover:border-[#FF6A00]/40 hover:text-[#FF6A00] transition-colors">
              <Plus size={14} /> Добавить блок
            </button>
            {addOpen && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(['paragraph', 'heading', 'list', 'table', 'quote', 'divider'] as const).map(tp => (
                  <button key={tp} onClick={() => add(tp)}
                    className="px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40">
                    {BLOCK_LABEL[tp]}
                  </button>
                ))}
              </div>
            )}
          </div>
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

// ─── Markable textarea (Ж / подсветка / спойлер wrap selection) ──────────────────

function MarkableTextarea({ value, onChange, rows = 3, placeholder }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const wrap = (mk: string) => {
    const el = ref.current; if (!el) return
    const s = el.selectionStart, e = el.selectionEnd
    const sel = value.slice(s, e) || 'текст'
    const next = value.slice(0, s) + mk + sel + mk + value.slice(e)
    onChange(next)
    requestAnimationFrame(() => { el.focus(); el.selectionStart = s + mk.length; el.selectionEnd = s + mk.length + sel.length })
  }
  return (
    <div>
      <div className="flex gap-1 mb-1">
        {([['**', 'Ж'], ['==', 'Подсветка'], ['||', 'Спойлер']] as const).map(([mk, label]) => (
          <button key={mk} onMouseDown={e => e.preventDefault()} onClick={() => wrap(mk)}
            className="px-2 py-0.5 rounded-[7px] bg-white/[0.06] border border-white/[0.08] text-[11px] text-[#A1A1AA] hover:text-white hover:border-[#FF6A00]/40">
            {label}
          </button>
        ))}
      </div>
      <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
        className="glass-input w-full px-3 py-2 text-sm resize-none" />
    </div>
  )
}

// ─── Per-block editors ──────────────────────────────────────────────────────────

function BlockEditor({ b, onChange }: { b: PostBlock; onChange: (next: PostBlock) => void }) {
  switch (b.type) {
    case 'heading':
      return <input value={b.text} onChange={e => onChange({ ...b, text: e.target.value })}
        placeholder="Заголовок" className="glass-input w-full px-3 py-2 text-sm font-semibold" />
    case 'paragraph':
      return <MarkableTextarea value={runsToText(b.runs)} onChange={v => onChange({ ...b, runs: textToRuns(v) })} placeholder="Текст абзаца…" />
    case 'quote':
      return (
        <div className="space-y-1.5">
          <MarkableTextarea value={runsToText(b.runs)} onChange={v => onChange({ ...b, runs: textToRuns(v) })} rows={2} placeholder="Цитата…" />
          <label className="flex items-center gap-2 text-[12px] text-[#A1A1AA]">
            <input type="checkbox" checked={b.expandable === true} onChange={e => onChange({ ...b, expandable: e.target.checked })} />
            Сворачиваемая («Показать ещё»)
          </label>
        </div>
      )
    case 'list':
      return (
        <div>
          <textarea value={b.items.map(runsToText).join('\n')} rows={Math.max(2, b.items.length)}
            onChange={e => onChange({ ...b, items: e.target.value.split('\n').filter(l => l.trim()).map(textToRuns) })}
            placeholder="По пункту на строку" className="glass-input w-full px-3 py-2 text-sm resize-none" />
          <label className="flex items-center gap-2 mt-1.5 text-[12px] text-[#A1A1AA]">
            <input type="checkbox" checked={b.ordered === true} onChange={e => onChange({ ...b, ordered: e.target.checked })} />
            Нумерованный
          </label>
        </div>
      )
    case 'table':
      return (
        <div className="space-y-1">
          {b.headers.length > 0 && (
            <div className="flex gap-1">
              {b.headers.map((h, ci) => (
                <input key={ci} value={h} placeholder={`Столбец ${ci + 1}`}
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
          <button
            onClick={() => onChange({ ...b, rows: [...b.rows, b.headers.map(() => '')] })}
            className="text-[11px] font-medium text-[#FF6A00] mt-0.5">+ строка</button>
        </div>
      )
    case 'image':
      return <img src={b.url} alt="" className="w-full rounded-[10px] object-cover max-h-44" />
    case 'gallery':
      return (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {b.urls.map((u, i) => <img key={i} src={u} alt="" className="h-16 rounded-[8px] object-cover shrink-0" />)}
        </div>
      )
    case 'divider':
      return <div className="h-px bg-white/10" />
    default:
      return null
  }
}
