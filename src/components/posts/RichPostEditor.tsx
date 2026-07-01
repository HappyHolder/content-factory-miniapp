import { useRef, useState } from 'react'
import { Loader2, Eye, Pencil, ChevronUp, ChevronDown, Trash2, Plus, Upload, GripVertical, Sparkles, Bold, Italic, Strikethrough, Code, Highlighter, EyeOff, Link2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import { RichPostPreview, runsToText, textToRuns } from '@/components/posts/RichPostPreview'
import type { PostBlock, LinkItem } from '@/types'
import { cn } from '@/lib/utils'

interface RichPostEditorProps {
  postId:        string
  variantId:     string
  blocks:        PostBlock[]
  channelName?:  string
  channelHandle?: string
  avatarUrl?:    string | null
  /** Manual posts: let the user add their own inline-keyboard buttons here. */
  enableButtons?: boolean
}

const BLOCK_LABEL: Record<PostBlock['type'], string> = {
  heading: 'Заголовок', paragraph: 'Абзац', list: 'Список', quote: 'Цитата',
  table: 'Таблица', image: 'Картинка', video: 'Видео', document: 'Файл', gallery: 'Галерея', divider: 'Разделитель',
}

function makeBlock(type: PostBlock['type']): PostBlock {
  switch (type) {
    case 'heading':   return { type: 'heading', text: '' }
    case 'paragraph': return { type: 'paragraph', runs: [{ t: '' }] }
    case 'list':      return { type: 'list', ordered: false, items: [[{ t: '' }]] }
    case 'quote':     return { type: 'quote', runs: [{ t: '' }], expandable: false }
    case 'table':     return { type: 'table', headers: ['', ''], rows: [['', '']] }
    case 'gallery':   return { type: 'gallery', layout: 'slideshow', urls: [] }
    case 'document':  return { type: 'document', url: '', name: 'Файл' }
    case 'divider':   return { type: 'divider' }
    default:          return { type: 'paragraph', runs: [{ t: '' }] }
  }
}

export function RichPostEditor({ postId, variantId, blocks: initial, channelName, channelHandle, avatarUrl, enableButtons }: RichPostEditorProps) {
  const { state, updatePost, showToast } = useApp()
  const [blocks, setBlocks] = useState<PostBlock[]>(() => structuredClone(initial))
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Manual-post inline-keyboard buttons (post-level, persisted separately from
  // blocks). Initialised from the post's current linkButtons.
  const [buttons, setButtons] = useState<LinkItem[]>(
    () => (state.posts.find(p => p.id === postId)?.linkButtons ?? []).map(b => ({ ...b })),
  )
  const [buttonsDirty, setButtonsDirty] = useState(false)
  const addButton = () => {
    setButtons([...buttons, {
      id: `btn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: '', url: '', anchorText: '', buttonLabel: '', usage: 'button',
    }])
    setButtonsDirty(true)
  }
  const patchButton = (i: number, field: 'label' | 'url', v: string) => {
    setButtons(buttons.map((b, idx) => idx === i ? { ...b, [field]: v } : b)); setButtonsDirty(true)
  }
  const removeButton = (i: number) => { setButtons(buttons.filter((_, idx) => idx !== i)); setButtonsDirty(true) }
  const [addOpen, setAddOpen] = useState(false)
  // Upload target: 'new' = append a new block; number = replace block at index;
  // { gallery } = append a photo into the gallery block at that index.
  type UploadTarget = 'new' | number | { gallery: number }
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const documentRef = useRef<HTMLInputElement>(null)

  const pickImage = (target: UploadTarget) => { setUploadTarget(target); fileRef.current?.click() }
  const pickVideo = (target: 'new' | number) => { setUploadTarget(target); videoRef.current?.click() }
  const pickDocument = (target: 'new' | number) => { setUploadTarget(target); documentRef.current?.click() }

  const handleFile = async (file: File) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }
    const target = uploadTarget
    setUploading(true)
    try {
      const form = new FormData()
      form.append('initData', initData)
      form.append('image', file)
      const res = await fetch(`${API_BASE}/api/posts/upload-block-image`, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !data.url) { showToast(data.error ?? 'Не удалось загрузить', 'error'); return }
      if (target === 'new') mutate([...blocks, { type: 'image', url: data.url }])
      else if (typeof target === 'number') patch(target, { type: 'image', url: data.url })
      else if (target && typeof target === 'object') {
        const gi = target.gallery
        const blk = blocks[gi]
        if (blk?.type === 'gallery') patch(gi, { ...blk, urls: [...blk.urls, data.url] })
      }
      setAddOpen(false)
    } catch {
      showToast('Ошибка загрузки', 'error')
    } finally {
      setUploading(false)
      setUploadTarget(null)
    }
  }

  const handleVideoFile = async (file: File) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }
    if (file.size > 20 * 1024 * 1024) { showToast('Видео до 20 МБ (Telegram качает по ссылке)', 'error'); return }
    const target = uploadTarget
    setUploading(true)
    try {
      const form = new FormData()
      form.append('initData', initData)
      form.append('video', file)
      const res = await fetch(`${API_BASE}/api/posts/upload-block-video`, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !data.url) { showToast(data.error ?? 'Не удалось загрузить видео', 'error'); return }
      if (target === 'new') mutate([...blocks, { type: 'video', url: data.url }])
      else if (typeof target === 'number') patch(target, { type: 'video', url: data.url })
      setAddOpen(false)
    } catch {
      showToast('Ошибка загрузки видео', 'error')
    } finally {
      setUploading(false)
      setUploadTarget(null)
    }
  }


  const handleDocumentFile = async (file: File) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }
    if (file.size > 20 * 1024 * 1024) { showToast('Файл до 20 МБ', 'error'); return }
    const target = uploadTarget
    setUploading(true)
    try {
      const form = new FormData()
      form.append('initData', initData)
      form.append('document', file)
      const res = await fetch(`${API_BASE}/api/posts/upload-block-document`, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({})) as { url?: string; name?: string; mime?: string; size?: number; error?: string }
      if (!res.ok || !data.url) { showToast(data.error ?? 'Не удалось загрузить файл', 'error'); return }
      const block: PostBlock = { type: 'document', url: data.url, name: data.name ?? file.name, mime: data.mime ?? file.type, size: data.size ?? file.size }
      if (target === 'new') mutate([...blocks, block])
      else if (typeof target === 'number') patch(target, block)
      setAddOpen(false)
    } catch {
      showToast('Ошибка загрузки файла', 'error')
    } finally {
      setUploading(false)
      setUploadTarget(null)
    }
  }
  const [genLoading, setGenLoading] = useState(false)
  const [genOpen, setGenOpen] = useState(false)   // new-image prompt panel
  const [genPrompt, setGenPrompt] = useState('')
  const [regenIndex, setRegenIndex] = useState<number | null>(null) // which block is being regenerated

  // Generates an AI image from `prompt` (empty = derive from the post). When
  // `replaceIndex` is given, replaces that block; otherwise appends a new one.
  const generateImage = async (prompt: string, replaceIndex?: number) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }
    setGenLoading(true); setRegenIndex(replaceIndex ?? null)
    try {
      const res = await fetch(`${API_BASE}/api/posts/generate-block-image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, postId, prompt: prompt.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !data.url) { showToast(data.error ?? 'Не удалось сгенерировать', 'error'); return }
      const block: PostBlock = { type: 'image', url: data.url, prompt: prompt.trim() }
      if (typeof replaceIndex === 'number') patch(replaceIndex, block)
      else mutate([...blocks, block])
      setGenOpen(false); setGenPrompt(''); setAddOpen(false)
    } catch {
      showToast('Ошибка генерации', 'error')
    } finally {
      setGenLoading(false); setRegenIndex(null)
    }
  }

  // Generate an AI photo straight into a gallery block (append to its urls).
  const [galleryGenIdx, setGalleryGenIdx] = useState<number | null>(null)
  const generateGalleryPhoto = async (gi: number, prompt: string) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }
    setGalleryGenIdx(gi)
    try {
      const res = await fetch(`${API_BASE}/api/posts/generate-block-image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, postId, prompt: prompt.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !data.url) { showToast(data.error ?? 'Не удалось сгенерировать', 'error'); return }
      const blk = blocks[gi]
      if (blk?.type === 'gallery') patch(gi, { ...blk, urls: [...blk.urls, data.url] })
    } catch {
      showToast('Ошибка генерации', 'error')
    } finally {
      setGalleryGenIdx(null)
    }
  }

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

  // Drag-and-drop reorder (pointer events — works on touch + mouse).
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const moveTo = (from: number, to: number) => {
    if (from === to) return
    const copy = blocks.slice()
    const [item] = copy.splice(from, 1)
    copy.splice(to, 0, item!)
    mutate(copy)
  }

  const save = async () => {
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }
    setSaving(true)
    try {
      // Blocks (variant-level).
      if (dirty) {
        const res = await fetch(`${API_BASE}/api/posts/${postId}/blocks`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ initData, variantId, blocks }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string }
          showToast(err.error ?? 'Не удалось сохранить', 'error'); return
        }
      }
      // Buttons (post-level). Only valid (label + url) entries are persisted.
      let savedButtons: LinkItem[] | null = null
      if (buttonsDirty) {
        const clean = buttons
          .map(b => ({ ...b, label: b.label.trim(), url: b.url.trim(), buttonLabel: b.label.trim() }))
          .filter(b => b.label && b.url)
        const res = await fetch(`${API_BASE}/api/posts/${postId}/buttons`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ initData, buttons: clean }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string }
          showToast(err.error ?? 'Не удалось сохранить кнопки', 'error'); return
        }
        const data = await res.json().catch(() => ({})) as { buttons?: LinkItem[] }
        savedButtons = data.buttons ?? clean
      }
      // Reflect into app state.
      const current = state.posts.find(p => p.id === postId)
      if (current) {
        updatePost(postId, {
          ...(dirty ? { variants: current.variants.map(v => v.id === variantId ? { ...v, blocks } : v) } : {}),
          ...(savedButtons ? { linkButtons: savedButtons } : {}),
        })
      }
      showToast('Сохранено')
      setDirty(false); setButtonsDirty(false)
      if (savedButtons) setButtons(savedButtons)
    } catch {
      showToast('Ошибка сохранения', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* shared hidden file input for image upload (add / replace) */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleVideoFile(f); e.target.value = '' }}
      />

      <input
        ref={documentRef}
        type="file"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleDocumentFile(f); e.target.value = '' }}
      />
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
            <div
              key={i}
              data-block-index={i}
              className={cn('rounded-[12px] bg-white/[0.03] border overflow-hidden transition-colors',
                dragIndex === i ? 'opacity-50 border-[#FF6A00]/50' : 'border-white/[0.07]',
                overIndex === i && dragIndex !== null && dragIndex !== i ? 'ring-2 ring-[#FF6A00]' : '')}
            >
              {/* card header */}
              <div className="flex items-center gap-1 px-2.5 py-1.5 bg-white/[0.02] border-b border-white/[0.05]">
                <div
                  onPointerDown={e => { e.preventDefault(); setDragIndex(i); setOverIndex(i); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }}
                  onPointerMove={e => {
                    if (dragIndex === null) return
                    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
                    const card = el?.closest('[data-block-index]') as HTMLElement | null
                    if (card) { const idx = Number(card.dataset['blockIndex']); if (!Number.isNaN(idx)) setOverIndex(idx) }
                  }}
                  onPointerUp={() => { if (dragIndex !== null && overIndex !== null) moveTo(dragIndex, overIndex); setDragIndex(null); setOverIndex(null) }}
                  style={{ touchAction: 'none', cursor: 'grab' }}
                  className="p-1 -ml-1 text-[#55555D] hover:text-white"
                ><GripVertical size={14} /></div>
                <span className="text-[10px] font-semibold text-[#55555D] uppercase tracking-wider flex-1">{BLOCK_LABEL[b.type]}</span>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-[#66666E] hover:text-white disabled:opacity-25"><ChevronUp size={14} /></button>
                <button onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="p-1 text-[#66666E] hover:text-white disabled:opacity-25"><ChevronDown size={14} /></button>
                <button onClick={() => remove(i)} className="p-1 text-[#55555D] hover:text-red-400"><Trash2 size={13} /></button>
              </div>
              <div className="p-2.5">
                <BlockEditor
                  b={b}
                  onChange={next => patch(i, next)}
                  onReplace={() => (b.type === 'video' ? pickVideo(i) : b.type === 'document' ? pickDocument(i) : pickImage(i))}
                  onAddGalleryPhoto={() => pickImage({ gallery: i })}
                  onGenerateGalleryPhoto={(p: string) => generateGalleryPhoto(i, p)}
                  galleryGenLoading={galleryGenIdx === i}
                  onRegenerate={(p: string) => generateImage(p, i)}
                  regenLoading={genLoading && regenIndex === i}
                  uploading={uploading && (uploadTarget === i || (typeof uploadTarget === 'object' && uploadTarget?.gallery === i))}
                />
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
                {(['paragraph', 'heading', 'list', 'table', 'quote', 'gallery', 'divider'] as const).map(tp => (
                  <button key={tp} onClick={() => add(tp)}
                    className="px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40">
                    {BLOCK_LABEL[tp]}
                  </button>
                ))}
                <button onClick={() => pickImage('new')} disabled={uploading}
                  className="px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40 disabled:opacity-50 flex items-center gap-1">
                  {uploading && uploadTarget === 'new' ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                  Изображение
                </button>
                <button onClick={() => pickVideo('new')} disabled={uploading}
                  className="px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40 disabled:opacity-50 flex items-center gap-1">
                  {uploading && uploadTarget === 'new' ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                  Видео
                </button>
                <button onClick={() => pickDocument('new')} disabled={uploading}
                  className="px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40 disabled:opacity-50 flex items-center gap-1">
                  {uploading && uploadTarget === 'new' ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
                  Файл
                </button>
                <button onClick={() => { setGenOpen(o => !o); setAddOpen(true) }}
                  className="px-3 py-1.5 rounded-full bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.3)] text-[12px] text-[#FF6A00] hover:bg-[rgba(255,106,0,0.18)] flex items-center gap-1">
                  <Sparkles size={11} /> AI-картинка
                </button>
              </div>
            )}

            {/* AI image prompt panel — control WHAT gets generated */}
            {addOpen && genOpen && (
              <div className="mt-2 p-2.5 rounded-[12px] bg-[rgba(255,106,0,0.06)] border border-[rgba(255,106,0,0.2)] space-y-2">
                <p className="text-[11px] text-[#A1A1AA]">Опиши, что сгенерировать. Пусто = движок придумает по посту и стилю канала.</p>
                <textarea
                  value={genPrompt}
                  onChange={e => setGenPrompt(e.target.value)}
                  rows={2}
                  placeholder="напр.: Илон Маск на сцене, тёмный фон, неон"
                  className="glass-input w-full px-3 py-2 text-sm resize-none"
                />
                <Button variant="primary" size="sm" fullWidth onClick={() => generateImage(genPrompt)} disabled={genLoading}>
                  {genLoading && regenIndex === null ? <><Loader2 size={13} className="animate-spin" /> Генерирую…</> : <><Sparkles size={13} /> Сгенерировать</>}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual posts: inline-keyboard buttons — editor in edit mode, chips in preview */}
      {enableButtons && mode === 'edit' && (
        <div className="rounded-[12px] bg-white/[0.03] border border-white/[0.07] p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Link2 size={13} className="text-[#FF6A00]" />
            <span className="text-[10px] font-semibold text-[#55555D] uppercase tracking-wider">Кнопки поста</span>
          </div>
          {buttons.length === 0 && (
            <p className="text-[11px] text-[#55555D] leading-relaxed">
              Кнопки-ссылки под постом (инлайн-клавиатура). Текст + ссылка. Напр.: «Подробнее» → https://…
            </p>
          )}
          {buttons.map((b, i) => (
            <div key={b.id} className="space-y-1">
              <div className="flex gap-1.5">
                <input value={b.label} onChange={e => patchButton(i, 'label', e.target.value)}
                  placeholder="Текст кнопки" className="glass-input flex-1 min-w-0 px-2.5 py-1.5 text-[12px]" />
                <button onClick={() => removeButton(i)} className="p-1.5 text-[#55555D] hover:text-red-400"><Trash2 size={13} /></button>
              </div>
              <input value={b.url} onChange={e => patchButton(i, 'url', e.target.value)}
                placeholder="https://… или @канал" className="glass-input w-full px-2.5 py-1.5 text-[12px]" />
            </div>
          ))}
          <button onClick={addButton}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] border border-dashed border-white/[0.12] text-[12px] text-[#A1A1AA] hover:border-[#FF6A00]/40 hover:text-[#FF6A00] transition-colors">
            <Plus size={13} /> Добавить кнопку
          </button>
        </div>
      )}
      {enableButtons && mode === 'preview' && buttons.some(b => b.label.trim() && b.url.trim()) && (
        <div className="flex flex-col gap-1.5">
          {buttons.filter(b => b.label.trim() && b.url.trim()).map(b => (
            <div key={b.id} className="w-full text-center py-2 rounded-[10px] bg-white/[0.06] border border-white/[0.1] text-[13px] font-medium text-[#5AA9FF]">
              {b.label}
            </div>
          ))}
        </div>
      )}

      {(dirty || buttonsDirty) && (
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
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const sel = useRef<{ s: number; e: number }>({ s: 0, e: 0 })

  const wrap = (mk: string) => {
    const el = ref.current; if (!el) return
    const s = el.selectionStart, e = el.selectionEnd
    const t = value.slice(s, e) || 'текст'
    const next = value.slice(0, s) + mk + t + mk + value.slice(e)
    onChange(next)
    requestAnimationFrame(() => { el.focus(); el.selectionStart = s + mk.length; el.selectionEnd = s + mk.length + t.length })
  }

  const openLink = () => {
    const el = ref.current; if (!el) return
    sel.current = { s: el.selectionStart, e: el.selectionEnd }
    setLinkUrl(''); setLinkOpen(true)
  }
  const applyLink = () => {
    const url = linkUrl.trim()
    if (!url) { setLinkOpen(false); return }
    const { s, e } = sel.current
    const t = value.slice(s, e) || 'ссылка'
    const href = /^https?:\/\//i.test(url) ? url : url.startsWith('@') ? `https://t.me/${url.slice(1)}` : `https://${url}`
    onChange(value.slice(0, s) + `[${t}](${href})` + value.slice(e))
    setLinkOpen(false); setLinkUrl('')
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1">
        {([
          ['**', Bold, 'Жирный'],
          ['__', Italic, 'Курсив'],
          ['~~', Strikethrough, 'Зачёркнутый'],
          ['`', Code, 'Моноширинный'],
          ['==', Highlighter, 'Подсветка'],
          ['||', EyeOff, 'Спойлер'],
        ] as const).map(([mk, Icon, title]) => (
          <button key={mk} type="button" title={title} aria-label={title}
            onMouseDown={e => e.preventDefault()} onClick={() => wrap(mk)}
            className="w-7 h-7 flex items-center justify-center rounded-[8px] bg-white/[0.05] border border-white/[0.08] text-[#A1A1AA] hover:text-[#FF6A00] hover:border-[#FF6A00]/40 active:bg-[rgba(255,106,0,0.12)] transition-colors">
            <Icon size={14} />
          </button>
        ))}
        <button type="button" title="Ссылка" aria-label="Ссылка"
          onMouseDown={e => e.preventDefault()} onClick={openLink}
          className="w-7 h-7 flex items-center justify-center rounded-[8px] bg-white/[0.05] border border-white/[0.08] text-[#A1A1AA] hover:text-[#FF6A00] hover:border-[#FF6A00]/40 active:bg-[rgba(255,106,0,0.12)] transition-colors">
          <Link2 size={14} />
        </button>
      </div>
      {linkOpen && (
        <div className="flex gap-1.5 mb-1">
          <input autoFocus value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } }}
            placeholder="https://… (ссылка на выделенный текст)"
            className="glass-input flex-1 px-2.5 py-1.5 text-[12px]" />
          <button type="button" onClick={applyLink}
            className="px-3 py-1.5 rounded-[8px] bg-[#FF6A00] text-white text-[12px] font-semibold">OK</button>
        </div>
      )}
      <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
        className="glass-input w-full px-3 py-2 text-sm resize-none" />
    </div>
  )
}

// ─── Per-block editors ──────────────────────────────────────────────────────────

function BlockEditor({ b, onChange, onReplace, onAddGalleryPhoto, onGenerateGalleryPhoto, galleryGenLoading, onRegenerate, regenLoading, uploading }: {
  b: PostBlock; onChange: (next: PostBlock) => void; onReplace?: () => void; onAddGalleryPhoto?: () => void
  onGenerateGalleryPhoto?: (prompt: string) => void; galleryGenLoading?: boolean
  onRegenerate?: (prompt: string) => void; regenLoading?: boolean; uploading?: boolean
}) {
  // Local prompt state for the gallery "+ AI-фото" panel (one photo at a time).
  const [galPromptOpen, setGalPromptOpen] = useState(false)
  const [galPrompt, setGalPrompt] = useState('')
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
      return (
        <div className="space-y-1.5">
          <img src={b.url} alt="" className="w-full rounded-[10px] object-cover max-h-44" />
          {/* AI-generated image (has a prompt) → editable prompt + regenerate */}
          {typeof b.prompt === 'string' && (
            <>
              <textarea value={b.prompt} onChange={e => onChange({ ...b, prompt: e.target.value })}
                rows={2} placeholder="Опиши картинку (пусто = по посту)"
                className="glass-input w-full px-3 py-2 text-[12px] resize-none" />
              <button onClick={() => onRegenerate?.(b.prompt ?? '')} disabled={regenLoading}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.3)] text-[12px] text-[#FF6A00] hover:bg-[rgba(255,106,0,0.18)] disabled:opacity-50">
                {regenLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Перегенерировать
              </button>
            </>
          )}
          <button onClick={onReplace} disabled={uploading}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40 disabled:opacity-50">
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Заменить
          </button>
        </div>
      )
    case 'video':
      return (
        <div className="space-y-1.5">
          <video src={b.url} controls playsInline className="w-full rounded-[10px] max-h-44 bg-black" />
          <button onClick={onReplace} disabled={uploading}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40 disabled:opacity-50">
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Заменить
          </button>
        </div>
      )
    case 'document':
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 rounded-[10px] bg-white/[0.04] border border-white/[0.08] px-3 py-2">
            <div className="w-9 h-9 rounded-[10px] bg-[#FF6A00]/15 text-[#FF6A00] flex items-center justify-center font-bold text-[11px] shrink-0">FILE</div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-white truncate">{b.name}</p>
              <p className="text-[11px] text-[#66666E]">{typeof b.size === 'number' ? `${(b.size / 1024 / 1024).toFixed(2)} МБ` : 'Документ'}</p>
            </div>
          </div>
          <button onClick={onReplace} disabled={uploading}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40 disabled:opacity-50">
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Заменить
          </button>
        </div>
      )
    case 'gallery':
      return (
        <div className="space-y-2">
          {/* layout toggle */}
          <div className="flex gap-1 p-0.5 rounded-[9px] bg-white/[0.04] border border-white/[0.06] w-fit">
            {([['slideshow', 'Карусель'], ['collage', 'Сетка']] as const).map(([lay, label]) => (
              <button key={lay} onClick={() => onChange({ ...b, layout: lay })}
                className={cn('px-2.5 py-1 rounded-[7px] text-[11px] font-medium', b.layout === lay ? 'bg-[#FF6A00] text-white' : 'text-[#A1A1AA]')}>
                {label}
              </button>
            ))}
          </div>
          {/* thumbnails with remove */}
          {b.urls.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {b.urls.map((u, i) => (
                <div key={i} className="relative shrink-0">
                  <img src={u} alt="" className="h-16 w-16 rounded-[8px] object-cover" />
                  <button onClick={() => onChange({ ...b, urls: b.urls.filter((_, k) => k !== i) })}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center text-[10px]">×</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <button onClick={onAddGalleryPhoto} disabled={uploading}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40 disabled:opacity-50">
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} + Фото
            </button>
            <button onClick={() => setGalPromptOpen(o => !o)} disabled={galleryGenLoading}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.3)] text-[12px] text-[#FF6A00] hover:bg-[rgba(255,106,0,0.18)] disabled:opacity-50">
              {galleryGenLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} + AI-фото
            </button>
          </div>
          {galPromptOpen && (
            <div className="p-2 rounded-[10px] bg-[rgba(255,106,0,0.06)] border border-[rgba(255,106,0,0.2)] space-y-1.5">
              <textarea value={galPrompt} onChange={e => setGalPrompt(e.target.value)} rows={2}
                placeholder="Опиши фото для карусели (пусто = по посту)"
                className="glass-input w-full px-2.5 py-1.5 text-[12px] resize-none" />
              <button onClick={() => { onGenerateGalleryPhoto?.(galPrompt); setGalPrompt('') }} disabled={galleryGenLoading}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] bg-[#FF6A00] text-white text-[12px] font-semibold disabled:opacity-50">
                {galleryGenLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Сгенерировать фото
              </button>
            </div>
          )}
          <p className="text-[11px] text-[#55555D]">{b.urls.length} фото{b.urls.length < 2 ? ' · нужно 2+ для галереи' : ''}</p>
        </div>
      )
    case 'divider':
      return <div className="h-px bg-white/10" />
    default:
      return null
  }
}
