import { useCallback, useEffect, useRef, useState } from 'react'
import { Bold, Check, Code, EyeOff, Highlighter, ImagePlus, Italic, Link2, Loader2, MessageCircle, Plus, Save, Strikethrough, Trash2, X } from 'lucide-react'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData } from '@/lib/telegram'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { RichPostPreview, textToRuns } from '@/components/posts/RichPostPreview'
import type { PostBlock } from '@/types'

type WelcomeButton = { id: string; label: string; url: string }
type WelcomeBlock = {
  id: string
  type: 'welcome'
  enabled: boolean
  text: string
  imageUrl?: string
  buttons?: WelcomeButton[]
}

const DEFAULT_BLOCK: WelcomeBlock = {
  id: 'welcome-default', type: 'welcome', enabled: false,
  text: 'Добро пожаловать, **{name}**! Перед общением познакомьтесь с правилами сообщества.',
  buttons: [],
}

const MARKERS = [
  { icon: Bold, label: 'Жирный', before: '**', after: '**' },
  { icon: Italic, label: 'Курсив', before: '__', after: '__' },
  { icon: Strikethrough, label: 'Зачёркнутый', before: '~~', after: '~~' },
  { icon: Code, label: 'Моно', before: '`', after: '`' },
  { icon: Highlighter, label: 'Подсветка', before: '==', after: '==' },
  { icon: EyeOff, label: 'Спойлер', before: '||', after: '||' },
] as const

export function ModeratorRichWelcomeEditor({ moderatorId }: { moderatorId: string }) {
  const [block, setBlock] = useState<WelcomeBlock>(DEFAULT_BLOCK)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [published, setPublished] = useState(false)
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const initData = getTelegramInitData()

  useEffect(() => {
    if (!initData) { setLoading(false); return }
    fetch(`${API_BASE}/api/moderator-config/${moderatorId}/draft?initData=${encodeURIComponent(initData)}`)
      .then(async res => {
        const data = await res.json() as { draft?: { blocks?: WelcomeBlock[] }; moderator?: { publishedVersion?: number | null }; error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Не удалось загрузить настройки')
        const welcome = data.draft?.blocks?.find(item => item.type === 'welcome')
        if (welcome) setBlock({ ...DEFAULT_BLOCK, ...welcome, buttons: welcome.buttons ?? [] })
        setPublished(Boolean(data.moderator?.publishedVersion))
      })
      .catch(err => setMessage(err instanceof Error ? err.message : 'Не удалось загрузить настройки'))
      .finally(() => setLoading(false))
  }, [initData, moderatorId])

  const wrapSelection = (before: string, after: string) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = block.text.slice(start, end) || 'текст'
    const next = block.text.slice(0, start) + before + selected + after + block.text.slice(end)
    setBlock(prev => ({ ...prev, text: next }))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + before.length, start + before.length + selected.length) })
  }

  const addLink = () => {
    const url = window.prompt('Ссылка: https://…')?.trim()
    if (!url || !/^https?:\/\//i.test(url)) return
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = block.text.slice(start, end) || 'ссылка'
    const token = `[${selected}](${url})`
    setBlock(prev => ({ ...prev, text: prev.text.slice(0, start) + token + prev.text.slice(end) }))
  }

  const uploadImage = async (file: File) => {
    if (!initData) return
    setUploading(true); setMessage('')
    try {
      const form = new FormData(); form.append('initData', initData); form.append('image', file)
      const res = await fetch(`${API_BASE}/api/posts/upload-block-image`, { method: 'POST', body: form })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Не удалось загрузить изображение')
      setBlock(prev => ({ ...prev, imageUrl: data.url }))
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Не удалось загрузить изображение') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const addButton = () => setBlock(prev => ({
    ...prev,
    buttons: [...(prev.buttons ?? []), { id: `welcome-btn-${Date.now()}`, label: '', url: '' }].slice(0, 3),
  }))
  const patchButton = (id: string, patch: Partial<WelcomeButton>) => setBlock(prev => ({
    ...prev, buttons: (prev.buttons ?? []).map(button => button.id === id ? { ...button, ...patch } : button),
  }))
  const removeButton = (id: string) => setBlock(prev => ({ ...prev, buttons: (prev.buttons ?? []).filter(button => button.id !== id) }))

  const save = useCallback(async (): Promise<boolean> => {
    if (!initData || !block.text.trim()) return false
    setSaving(true); setMessage('')
    try {
      const res = await fetch(`${API_BASE}/api/moderator-config/${moderatorId}/draft`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, blocks: [{ ...block, text: block.text.trim() }] }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Не удалось сохранить')
      setMessage('Черновик сохранён'); return true
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Не удалось сохранить'); return false }
    finally { setSaving(false) }
  }, [block, initData, moderatorId])

  const publish = async () => {
    if (!initData || publishing) return
    setPublishing(true)
    if (!await save()) { setPublishing(false); return }
    try {
      const res = await fetch(`${API_BASE}/api/moderator-config/${moderatorId}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Не удалось опубликовать')
      setPublished(true); setMessage('Настройки опубликованы')
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Не удалось опубликовать') }
    finally { setPublishing(false) }
  }

  if (loading) return <div className="flex justify-center py-8 text-[#66666E]"><Loader2 size={20} className="animate-spin" /></div>
  const previewBlocks: PostBlock[] = [
    ...(block.imageUrl ? [{ type: 'image' as const, url: block.imageUrl }] : []),
    { type: 'paragraph', runs: textToRuns(block.text.split('{name}').join('Степан')) },
  ]

  return (
    <GlassCard>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[rgba(255,106,0,0.10)] text-[#FF6A00]"><MessageCircle size={18} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><p className="text-[14px] font-semibold text-white">Приветствие</p>{published && <span className="flex items-center gap-1 text-[10px] text-emerald-400"><Check size={11} /> опубликовано</span>}</div>
          <p className="mt-0.5 text-[11px] text-[#66666E]">Rich Message для нового участника</p>
        </div>
      </div>

      <div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Включить приветствие" description="Отправлять при вступлении" value={block.enabled} onChange={enabled => setBlock(prev => ({ ...prev, enabled }))} /></div>

      <div className="mt-4 flex flex-wrap gap-1 rounded-t-[12px] border border-b-0 border-white/[0.08] bg-white/[0.035] p-1.5">
        {MARKERS.map(({ icon: Icon, label, before, after }) => <button key={label} type="button" title={label} aria-label={label} onClick={() => wrapSelection(before, after)} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[#8A8A93] hover:bg-white/[0.07] hover:text-white"><Icon size={15} /></button>)}
        <button type="button" title="Ссылка" aria-label="Добавить ссылку" onClick={addLink} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[#8A8A93] hover:bg-white/[0.07] hover:text-white"><Link2 size={15} /></button>
      </div>
      <textarea ref={textareaRef} value={block.text} onChange={event => setBlock(prev => ({ ...prev, text: event.target.value }))} rows={6} maxLength={3500} className="w-full resize-none rounded-b-[12px] border border-white/[0.08] bg-[#0B0B0D] px-3.5 py-3 text-[14px] leading-relaxed text-white outline-none focus:border-[rgba(255,106,0,0.45)]" />
      <div className="mt-1 flex justify-between px-1 text-[10px] text-[#55555D]"><span><code>{'{name}'}</code> — имя</span><span>{block.text.length}/3500</span></div>

      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadImage(file) }} />
      <div className="mt-4">
        {block.imageUrl ? <div className="relative overflow-hidden rounded-[14px] border border-white/[0.08]"><img src={block.imageUrl} alt="Изображение приветствия" className="max-h-56 w-full object-cover" /><button type="button" onClick={() => setBlock(prev => ({ ...prev, imageUrl: undefined }))} className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white"><X size={15} /></button></div> : <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} fullWidth>{uploading ? <Loader2 size={14} className="animate-spin" /> : <><ImagePlus size={14} /> Добавить изображение</>}</Button>}
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#66666E]">Кнопки</span>{(block.buttons?.length ?? 0) < 3 && <button type="button" onClick={addButton} className="flex min-h-9 items-center gap-1 text-[11px] text-[#FF6A00]"><Plus size={13} /> Добавить</button>}</div>
        {(block.buttons ?? []).map(button => <div key={button.id} className="grid grid-cols-[1fr_1.4fr_36px] gap-2"><input value={button.label} onChange={e => patchButton(button.id, { label: e.target.value })} placeholder="Правила" className="min-w-0 rounded-[10px] border border-white/[0.08] bg-white/[0.035] px-3 text-[12px] text-white outline-none" /><input value={button.url} onChange={e => patchButton(button.id, { url: e.target.value })} placeholder="https://…" className="min-w-0 rounded-[10px] border border-white/[0.08] bg-white/[0.035] px-3 text-[12px] text-white outline-none" /><button type="button" aria-label="Удалить кнопку" onClick={() => removeButton(button.id)} className="flex h-10 w-9 items-center justify-center rounded-[9px] text-[#62626A] hover:bg-red-500/10 hover:text-red-400"><Trash2 size={14} /></button></div>)}
      </div>

      <div className="mt-5"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#66666E]">Предпросмотр</p><RichPostPreview blocks={previewBlocks} channelName="Модератор" />{(block.buttons ?? []).filter(b => b.label && b.url).map(b => <div key={b.id} className="mt-1.5 rounded-[9px] border border-[#2E7CF6]/30 bg-[#2E7CF6]/10 px-3 py-2 text-center text-[12px] text-[#7FB0FF]">{b.label}</div>)}</div>
      {message && <p aria-live="polite" className="mt-3 text-[11px] text-[#8A8A93]">{message}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" onClick={() => void save()} disabled={saving || publishing} fullWidth>{saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} /> Сохранить</>}</Button><Button variant="primary" size="sm" onClick={() => void publish()} disabled={saving || publishing} fullWidth>{publishing ? <Loader2 size={14} className="animate-spin" /> : 'Опубликовать'}</Button></div>
    </GlassCard>
  )
}
