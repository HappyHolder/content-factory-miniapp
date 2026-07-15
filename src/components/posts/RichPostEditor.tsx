import { useId, useRef, useState } from 'react'
import { Loader2, Eye, Pencil, ChevronUp, ChevronDown, Trash2, Plus, Upload, GripVertical, Sparkles, Bold, Italic, Strikethrough, Code, Highlighter, EyeOff, Link2, FileText, Copy, X, Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import { RichPostPreview, runsToText, textToRuns, listItemsToText, textToListItems } from '@/components/posts/RichPostPreview'
import type { PostBlock, LinkItem, ButtonStyle } from '@/types'
import { cn } from '@/lib/utils'
import { normalizePostBlocks } from '@/lib/postBlockNormalizer'

// Inline-button styles Telegram accepts ('' = default). `chip` colors the picker
// when active; `preview` colors the button chip in preview mode.
const BTN_STYLES = [
  { v: '',        label: 'Обычная', chip: 'bg-white/20 text-white',      preview: 'bg-white/[0.08] border-white/[0.14] text-[#5AA9FF]' },
  { v: 'primary', label: 'Синяя',   chip: 'bg-[#2E7CF6] text-white',     preview: 'bg-[#2E7CF6]/15 border-[#2E7CF6]/45 text-[#7FB0FF]' },
  { v: 'success', label: 'Зелёная', chip: 'bg-[#22A06B] text-white',     preview: 'bg-[#22A06B]/15 border-[#22A06B]/45 text-[#4FD394]' },
  { v: 'danger',  label: 'Красная', chip: 'bg-[#E5484D] text-white',     preview: 'bg-[#E5484D]/15 border-[#E5484D]/45 text-[#FF7A7E]' },
] as const

const btnStyleMeta = (s?: ButtonStyle) => BTN_STYLES.find(m => m.v === (s ?? '')) ?? BTN_STYLES[0]
const btnHasTarget = (b: LinkItem) => (b.kind === 'copy' ? (b.copyText ?? '').trim() : b.url.trim())

// Groups valid buttons into keyboard rows, honoring `sameRow` (grid layout).
function groupButtonRows(buttons: LinkItem[]): LinkItem[][] {
  const rows: LinkItem[][] = []
  for (const b of buttons) {
    if (!b.label.trim() || !btnHasTarget(b)) continue
    if (b.sameRow && rows.length > 0) rows[rows.length - 1].push(b)
    else rows.push([b])
  }
  return rows
}

interface RichPostEditorProps {
  postId:        string
  variantId:     string
  blocks:        PostBlock[]
  channelName?:  string
  channelHandle?: string
  avatarUrl?:    string | null
  /** Show the inline-keyboard button editor (all block posts). */
  enableButtons?: boolean
}

type PanoramaCut = 'horizontal' | 'vertical' | 'grid4'

const BLOCK_LABEL: Record<PostBlock['type'], string> = {
  heading: 'Заголовок', paragraph: 'Абзац', list: 'Список', quote: 'Цитата',
  table: 'Таблица', image: 'Картинка', video: 'Видео', document: 'Файл', gallery: 'Галерея',
  linkbox: 'Ссылка-рамка', checklist: 'Чек-лист', details: 'Спойлер-секция', code: 'Код',
  divider: 'Разделитель',
}

function makeBlock(type: PostBlock['type']): PostBlock {
  switch (type) {
    case 'heading':   return { type: 'heading', text: '' }
    case 'paragraph': return { type: 'paragraph', runs: [{ t: '' }] }
    case 'list':      return { type: 'list', ordered: false, items: [{ runs: [{ t: '' }] }] }
    case 'quote':     return { type: 'quote', runs: [{ t: '' }], expandable: false }
    case 'table':     return { type: 'table', headers: ['', ''], rows: [['', '']] }
    case 'gallery':   return { type: 'gallery', layout: 'slideshow', urls: [] }
    case 'linkbox':   return { type: 'linkbox', text: '', url: '' }
    case 'checklist': return { type: 'checklist', items: [{ text: '', checked: false }] }
    case 'details':   return { type: 'details', summary: '', body: '' }
    case 'code':      return { type: 'code', text: '', language: '' }
    case 'document':  return { type: 'document', url: '', name: 'Файл' }
    case 'divider':   return { type: 'divider' }
    default:          return { type: 'paragraph', runs: [{ t: '' }] }
  }
}

export function RichPostEditor({ postId, variantId, blocks: initial, channelName, channelHandle, avatarUrl, enableButtons }: RichPostEditorProps) {
  const { state, updatePost, showToast } = useApp()
  const [blocks, setBlocks] = useState<PostBlock[]>(() => structuredClone(normalizePostBlocks(initial) ?? []))
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Inline-keyboard buttons (post-level, persisted separately from blocks).
  // Initialised from the post's current linkButtons. For AI/bot posts these are
  // the channel-inherited buttons, whose display text lives in `buttonLabel`
  // (their `label` is the channel's internal name) — seed the editable `label`
  // field from `buttonLabel` so the shown text matches the real button and isn't
  // clobbered on save.
  const [buttons, setButtons] = useState<LinkItem[]>(
    () => (state.posts.find(p => p.id === postId)?.linkButtons ?? [])
      .map(b => ({ ...b, label: (b.buttonLabel || b.label || '').trim() })),
  )
  const [buttonsDirty, setButtonsDirty] = useState(false)
  const addButton = () => {
    setButtons([...buttons, {
      id: `btn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: '', url: '', anchorText: '', buttonLabel: '', usage: 'button',
      kind: 'url', copyText: '', sameRow: false,
    }])
    setButtonsDirty(true)
  }
  const patchButton = (i: number, patch: Partial<LinkItem>) => {
    setButtons(buttons.map((b, idx) => idx === i ? { ...b, ...patch } : b)); setButtonsDirty(true)
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
  const panoRef = useRef<HTMLInputElement>(null)
  const [panoTarget, setPanoTarget] = useState<{ gallery: number; orientation: PanoramaCut; count: number } | null>(null)
  const [panoGen, setPanoGen] = useState<number | null>(null)

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

  const pickPanorama = (gallery: number, orientation: PanoramaCut, count: number) => {
    setPanoTarget({ gallery, orientation, count }); panoRef.current?.click()
  }

  const handlePanoFile = async (file: File) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }
    const t = panoTarget
    if (!t) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('initData', initData)
      form.append('image', file)
      form.append('orientation', t.orientation)
      form.append('count', String(t.count))
      const res = await fetch(`${API_BASE}/api/posts/slice-panorama`, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({})) as { urls?: string[]; groups?: string[][]; layout?: string; error?: string }
      if (!res.ok || !data.urls?.length) { showToast(data.error ?? 'Не удалось нарезать', 'error'); return }
      const blk = blocks[t.gallery]
      if (blk?.type === 'gallery') {
        patch(t.gallery, {
          type: 'gallery',
          urls: data.urls,
          layout: data.layout === 'stack' ? 'stack' : 'slideshow',
          ...(data.groups?.length === 4 ? { matrix4: data.groups } : {}),
        })
      }
    } catch {
      showToast('Ошибка нарезки', 'error')
    } finally {
      setUploading(false); setPanoTarget(null)
    }
  }

  const generatePanorama = async (gi: number, orientation: PanoramaCut, count: number, prompt: string) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }
    if (!prompt.trim()) { showToast('Опиши, что сгенерировать', 'error'); return }
    setPanoGen(gi)
    try {
      const res = await fetch(`${API_BASE}/api/posts/generate-panorama`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, postId, prompt, orientation, count }),
      })
      const data = await res.json().catch(() => ({})) as { urls?: string[]; groups?: string[][]; layout?: string; error?: string }
      if (!res.ok || !data.urls?.length) { showToast(data.error ?? 'Не удалось сгенерировать', 'error'); return }
      const blk = blocks[gi]
      if (blk?.type === 'gallery') {
        patch(gi, {
          type: 'gallery',
          urls: data.urls,
          layout: data.layout === 'stack' ? 'stack' : 'slideshow',
          ...(data.groups?.length === 4 ? { matrix4: data.groups } : {}),
        })
      }
    } catch {
      showToast('Ошибка генерации', 'error')
    } finally {
      setPanoGen(null)
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
      // Buttons (post-level). A URL button needs a label + url; a copy button
      // needs a label + copyText. The server re-validates and stores them.
      let savedButtons: LinkItem[] | null = null
      if (buttonsDirty) {
        const clean = buttons
          .map(b => ({ ...b, label: b.label.trim(), url: b.url.trim(), copyText: (b.copyText ?? '').trim(), buttonLabel: b.label.trim() }))
          .filter(b => b.label && (b.kind === 'copy' ? b.copyText : b.url))
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
      <input
        ref={panoRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handlePanoFile(f); e.target.value = '' }}
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
                  allowGrid4={state.user.isAdmin === true}
                  onChange={next => patch(i, next)}
                  onReplace={() => (b.type === 'video' ? pickVideo(i) : b.type === 'document' ? pickDocument(i) : pickImage(i))}
                  onAddGalleryPhoto={() => pickImage({ gallery: i })}
                  onSlicePanorama={(orientation, count) => pickPanorama(i, orientation, count)}
                  onGeneratePanorama={(orientation, count, prompt) => generatePanorama(i, orientation, count, prompt)}
                  panoGenLoading={panoGen === i}
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
                {(['paragraph', 'heading', 'list', 'checklist', 'table', 'quote', 'details', 'code', 'linkbox', 'gallery', 'divider'] as const).map(tp => (
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

      {/* Inline-keyboard buttons (all block posts) — editor in edit mode, chips in preview.
          Seeded from post.linkButtons: for AI/bot posts that's the channel's inherited
          buttons, which the user can now add to, edit, or remove per post. */}
      {enableButtons && mode === 'edit' && (
        <div className="rounded-[12px] bg-white/[0.03] border border-white/[0.07] p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Link2 size={13} className="text-[#FF6A00]" />
            <span className="text-[10px] font-semibold text-[#55555D] uppercase tracking-wider">Кнопки поста</span>
          </div>
          {buttons.length === 0 && (
            <p className="text-[11px] text-[#55555D] leading-relaxed">
              Кнопки под постом (инлайн-клавиатура): ссылка или «копировать текст», с цветом и раскладкой в ряды.
            </p>
          )}
          {buttons.map((b, i) => {
            const kind = b.kind ?? 'url'
            return (
              <div key={b.id} className="space-y-1.5 rounded-[10px] bg-white/[0.02] border border-white/[0.06] p-2">
                <div className="flex gap-1.5">
                  <input value={b.label} onChange={e => patchButton(i, { label: e.target.value })}
                    placeholder="Текст кнопки" className="glass-input flex-1 min-w-0 px-2.5 py-1.5 text-[12px]" />
                  <button onClick={() => removeButton(i)} className="p-1.5 text-[#55555D] hover:text-red-400"><Trash2 size={13} /></button>
                </div>
                {/* type: link vs copy */}
                <div className="flex gap-1">
                  {([['url', 'Ссылка'], ['copy', 'Копировать']] as const).map(([k, lbl]) => (
                    <button key={k} onClick={() => patchButton(i, { kind: k })}
                      className={cn('px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
                        kind === k ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border-[rgba(255,106,0,0.38)]' : 'bg-white/5 text-[#A1A1AA] border-white/[0.06]')}>
                      {lbl}
                    </button>
                  ))}
                </div>
                {/* target */}
                {kind === 'copy' ? (
                  <input value={b.copyText ?? ''} onChange={e => patchButton(i, { copyText: e.target.value })}
                    placeholder="Текст для копирования (напр. адрес кошелька)" className="glass-input w-full px-2.5 py-1.5 text-[12px]" />
                ) : (
                  <input value={b.url} onChange={e => patchButton(i, { url: e.target.value })}
                    placeholder="https://… или @канал" className="glass-input w-full px-2.5 py-1.5 text-[12px]" />
                )}
                {/* style */}
                <div className="flex flex-wrap gap-1">
                  {BTN_STYLES.map(s => (
                    <button key={s.v || 'default'} onClick={() => patchButton(i, { style: (s.v || undefined) as ButtonStyle | undefined })}
                      className={cn('px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
                        (b.style ?? '') === s.v ? `${s.chip} border-transparent` : 'bg-white/5 text-[#A1A1AA] border-white/[0.06]')}>
                      {s.label}
                    </button>
                  ))}
                </div>
                {/* layout */}
                {i > 0 && (
                  <label className="flex items-center gap-2 text-[11px] text-[#A1A1AA]">
                    <input type="checkbox" checked={b.sameRow === true} onChange={e => patchButton(i, { sameRow: e.target.checked })} />
                    В один ряд с предыдущей
                  </label>
                )}
              </div>
            )
          })}
          <button onClick={addButton}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-[9px] border border-dashed border-white/[0.12] text-[12px] text-[#A1A1AA] hover:border-[#FF6A00]/40 hover:text-[#FF6A00] transition-colors">
            <Plus size={13} /> Добавить кнопку
          </button>
        </div>
      )}
      {enableButtons && mode === 'preview' && groupButtonRows(buttons).length > 0 && (
        <div className="flex flex-col gap-1.5">
          {groupButtonRows(buttons).map((row, ri) => (
            <div key={ri} className="flex gap-1.5">
              {row.map(b => {
                const meta = btnStyleMeta(b.style)
                return (
                  <div key={b.id} className={cn('flex-1 min-w-0 text-center py-2 rounded-[10px] border text-[13px] font-medium flex items-center justify-center gap-1.5', meta.preview)}>
                    {b.kind === 'copy' && <Copy size={12} className="shrink-0" />}
                    <span className="truncate">{b.label}</span>
                  </div>
                )
              })}
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
          <button key={mk} type="button" disabled={mk === '=='} title={mk === '==' ? 'Подсветка временно недоступна: текст может читаться некорректно' : title} aria-label={mk === '==' ? 'Подсветка временно недоступна' : title}
            onMouseDown={e => e.preventDefault()} onClick={() => wrap(mk)}
            className="w-7 h-7 flex items-center justify-center rounded-[8px] bg-white/[0.05] border border-white/[0.08] text-[#A1A1AA] hover:text-[#FF6A00] hover:border-[#FF6A00]/40 active:bg-[rgba(255,106,0,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/[0.08] disabled:hover:text-[#A1A1AA]">
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

function BlockEditor({ b, allowGrid4, onChange, onReplace, onAddGalleryPhoto, onGenerateGalleryPhoto, galleryGenLoading, onRegenerate, regenLoading, uploading, onSlicePanorama, onGeneratePanorama, panoGenLoading }: {
  b: PostBlock; onChange: (next: PostBlock) => void; onReplace?: () => void; onAddGalleryPhoto?: () => void
  allowGrid4: boolean
  onGenerateGalleryPhoto?: (prompt: string) => void; galleryGenLoading?: boolean
  onRegenerate?: (prompt: string) => void; regenLoading?: boolean; uploading?: boolean
  onSlicePanorama?: (orientation: PanoramaCut, count: number) => void
  onGeneratePanorama?: (orientation: PanoramaCut, count: number, prompt: string) => void
  panoGenLoading?: boolean
}) {
  // Local prompt state for the gallery "+ AI-фото" panel (one photo at a time).
  const editorId = useId()
  const [galPromptOpen, setGalPromptOpen] = useState(false)
  const [galPrompt, setGalPrompt] = useState('')
  const [galleryTool, setGalleryTool] = useState<'photos' | 'slice'>(() => b.type === 'gallery' && b.matrix4 ? 'slice' : 'photos')
  // Panorama slicer (gallery): orientation + how many pieces to cut one image into.
  const [panoOrient, setPanoOrient] = useState<PanoramaCut>(b.type === 'gallery' && b.matrix4 ? 'grid4' : 'horizontal')
  const [panoCount, setPanoCount] = useState(3)
  const [panoPrompt, setPanoPrompt] = useState('')
  // Shared formatting toolbar for table cells — acts on the last-focused cell input.
  const cellTarget = useRef<{ el: HTMLInputElement; ri: number | 'h'; ci: number } | null>(null)
  const cellLinkTarget = useRef<{ el: HTMLInputElement; ri: number | 'h'; ci: number; s: number; e: number } | null>(null)
  const [cellLinkOpen, setCellLinkOpen] = useState(false)
  const [cellLinkUrl, setCellLinkUrl] = useState('')
  switch (b.type) {
    case 'heading':
      return (
        <div className="space-y-1.5">
          <input value={b.text} onChange={e => onChange({ ...b, text: e.target.value })}
            placeholder="Заголовок" className="glass-input w-full px-3 py-2 text-sm font-semibold" />
          <input value={b.link ?? ''} onChange={e => onChange({ ...b, link: e.target.value.trim() || undefined })}
            placeholder="Ссылка (необязательно) — https://…" className="glass-input w-full px-3 py-1.5 text-[12px]" />
        </div>
      )
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
    case 'linkbox':
      return (
        <div className="space-y-1.5">
          <input value={b.text} onChange={e => onChange({ ...b, text: e.target.value })}
            placeholder="Текст в рамке (напр. Подробнее)" className="glass-input w-full px-3 py-2 text-sm font-semibold" />
          <input value={b.url} onChange={e => onChange({ ...b, url: e.target.value.trim() })}
            placeholder="Ссылка — https://…" className="glass-input w-full px-3 py-1.5 text-[12px]" />
        </div>
      )
    case 'checklist':
      return (
        <div className="space-y-1">
          {b.items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <button type="button" title={it.checked ? 'Выполнено' : 'Не выполнено'}
                onClick={() => onChange({ ...b, items: b.items.map((x, k) => k === i ? { ...x, checked: !x.checked } : x) })}
                className={`w-5 h-5 shrink-0 rounded-[5px] border flex items-center justify-center text-[10px] font-bold leading-none ${it.checked ? 'bg-[#FF6A00] border-[#FF6A00] text-white' : 'border-white/25 text-transparent'}`}>✓</button>
              <input value={it.text} placeholder="Пункт"
                onChange={e => onChange({ ...b, items: b.items.map((x, k) => k === i ? { ...x, text: e.target.value } : x) })}
                className="glass-input flex-1 min-w-0 px-2.5 py-1.5 text-[12px]" />
              <button type="button" onClick={() => onChange({ ...b, items: b.items.filter((_, k) => k !== i) })} disabled={b.items.length <= 1}
                className="w-5 shrink-0 flex justify-center text-[#71717A] hover:text-[#EF4444] disabled:opacity-30 disabled:hover:text-[#71717A]"><Trash2 size={12} /></button>
            </div>
          ))}
          <button type="button" onClick={() => onChange({ ...b, items: [...b.items, { text: '', checked: false }] })}
            className="text-[11px] font-medium text-[#FF6A00]">+ пункт</button>
        </div>
      )
    case 'details':
      return (
        <div className="space-y-1.5">
          <input value={b.summary} onChange={e => onChange({ ...b, summary: e.target.value })}
            placeholder="Заголовок секции (виден всегда)" className="glass-input w-full px-3 py-2 text-sm font-semibold" />
          <MarkableTextarea value={b.body} onChange={v => onChange({ ...b, body: v })} rows={2}
            placeholder="Содержимое — раскрывается по клику…" />
        </div>
      )
    case 'code':
      return (
        <div className="space-y-1.5">
          <input value={b.language ?? ''} onChange={e => onChange({ ...b, language: e.target.value.trim() || undefined })}
            placeholder="Язык (необязательно): js, python, sql…" className="glass-input w-full px-3 py-1.5 text-[12px]" />
          <textarea value={b.text} onChange={e => onChange({ ...b, text: e.target.value })} rows={4} spellCheck={false}
            placeholder="Код…" className="glass-input w-full px-3 py-2 text-[12.5px] font-mono resize-none" />
        </div>
      )
    case 'list':
      return (
        <div>
          <MarkableTextarea value={listItemsToText(b.items)}
            rows={Math.max(2, b.items.reduce((n, it) => n + 1 + (it.sub?.length ?? 0), 0))}
            onChange={v => onChange({ ...b, items: textToListItems(v) })}
            placeholder="По пункту на строку. Отступ (Tab) в начале строки — вложенный подпункт." />
          <label className="flex items-center gap-2 mt-1.5 text-[12px] text-[#A1A1AA]">
            <input type="checkbox" checked={b.ordered === true} onChange={e => onChange({ ...b, ordered: e.target.checked })} />
            Нумерованный
          </label>
        </div>
      )
    case 'table': {
      // Actual column count — robust to ragged rows / headers that got out of sync.
      const cols = Math.max(b.headers.length, ...b.rows.map(r => r.length), 1)
      const norm = (arr: string[]) => Array.from({ length: cols }, (_, i) => arr[i] ?? '')
      const setHeader = (ci: number, v: string) =>
        onChange({ ...b, headers: norm(b.headers).map((x, k) => k === ci ? v : x) })
      const setCell = (ri: number, ci: number, v: string) =>
        onChange({ ...b, rows: b.rows.map((r, k) => k === ri ? norm(r).map((x, kk) => kk === ci ? v : x) : r) })
      const addRow = () => onChange({ ...b, rows: [...b.rows, Array.from({ length: cols }, () => '')] })
      const removeRow = (ri: number) => onChange({ ...b, rows: b.rows.filter((_, k) => k !== ri) })
      const addCol = () => onChange({ ...b, headers: [...norm(b.headers), ''], rows: b.rows.map(r => [...norm(r), '']) })
      const removeCol = (ci: number) =>
        onChange({ ...b, headers: norm(b.headers).filter((_, k) => k !== ci), rows: b.rows.map(r => norm(r).filter((_, k) => k !== ci)) })
      // Formatting toolbar → wraps the selection inside the last-focused cell input.
      const applyToCell = (t: { ri: number | 'h'; ci: number }, v: string) =>
        t.ri === 'h' ? setHeader(t.ci, v) : setCell(t.ri, t.ci, v)
      const wrapCell = (mk: string) => {
        const t = cellTarget.current; if (!t) return
        const el = t.el, s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length
        const sel = el.value.slice(s, e) || 'текст'
        applyToCell(t, el.value.slice(0, s) + mk + sel + mk + el.value.slice(e))
        requestAnimationFrame(() => { el.focus(); el.selectionStart = s + mk.length; el.selectionEnd = s + mk.length + sel.length })
      }
      const openCellLink = () => {
        const t = cellTarget.current; if (!t) return
        cellLinkTarget.current = { ...t, s: t.el.selectionStart ?? 0, e: t.el.selectionEnd ?? 0 }
        setCellLinkUrl(''); setCellLinkOpen(true)
      }
      const applyCellLink = () => {
        const url = cellLinkUrl.trim(), c = cellLinkTarget.current
        if (!url || !c) { setCellLinkOpen(false); return }
        const sel = c.el.value.slice(c.s, c.e) || 'ссылка'
        const href = /^https?:\/\//i.test(url) ? url : url.startsWith('@') ? `https://t.me/${url.slice(1)}` : `https://${url}`
        applyToCell(c, c.el.value.slice(0, c.s) + `[${sel}](${href})` + c.el.value.slice(c.e))
        setCellLinkOpen(false); setCellLinkUrl('')
      }
      const FMT = [['**', Bold, 'Жирный'], ['__', Italic, 'Курсив'], ['~~', Strikethrough, 'Зачёркнутый'], ['`', Code, 'Моно'], ['==', Highlighter, 'Подсветка'], ['||', EyeOff, 'Спойлер']] as const
      return (
        <div className="space-y-1">
          {/* Shared formatting toolbar — applies to the focused cell's selection */}
          <div className="flex flex-wrap gap-1 items-center">
            {FMT.map(([mk, Icon, title]) => (
              <button key={mk} type="button" disabled={mk === '=='} title={mk === '==' ? 'Подсветка временно недоступна: текст может читаться некорректно' : title} aria-label={mk === '==' ? 'Подсветка временно недоступна' : title}
                onMouseDown={e => e.preventDefault()} onClick={() => wrapCell(mk)}
                className="w-7 h-7 flex items-center justify-center rounded-[8px] bg-white/[0.05] border border-white/[0.08] text-[#A1A1AA] hover:text-[#FF6A00] hover:border-[#FF6A00]/40 active:bg-[rgba(255,106,0,0.12)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/[0.08] disabled:hover:text-[#A1A1AA]">
                <Icon size={14} />
              </button>
            ))}
            <button type="button" title="Ссылка" aria-label="Ссылка"
              onMouseDown={e => e.preventDefault()} onClick={openCellLink}
              className="w-7 h-7 flex items-center justify-center rounded-[8px] bg-white/[0.05] border border-white/[0.08] text-[#A1A1AA] hover:text-[#FF6A00] hover:border-[#FF6A00]/40 active:bg-[rgba(255,106,0,0.12)]">
              <Link2 size={14} />
            </button>
            <span className="text-[10px] text-[#55555D] ml-1">формат — к выделенному в ячейке</span>
          </div>
          {cellLinkOpen && (
            <div className="flex gap-1.5">
              <input autoFocus value={cellLinkUrl} onChange={e => setCellLinkUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyCellLink() } }}
                placeholder="https://… (ссылка на выделенный текст)" className="glass-input flex-1 px-2.5 py-1.5 text-[12px]" />
              <button type="button" onClick={applyCellLink} className="px-3 py-1.5 rounded-[8px] bg-[#FF6A00] text-white text-[12px] font-semibold">OK</button>
            </div>
          )}
          {/* Per-column delete strip (aligned with the inputs below) */}
          {cols > 1 && (
            <div className="flex gap-1 items-center">
              {Array.from({ length: cols }).map((_, ci) => (
                <button key={ci} onClick={() => removeCol(ci)} title="Удалить столбец"
                  className="flex-1 min-w-0 flex justify-center py-0.5 text-[#71717A] hover:text-[#EF4444]">
                  <X size={11} />
                </button>
              ))}
              <span className="w-5 shrink-0" />
            </div>
          )}
          <div className="flex gap-1 items-center">
            {norm(b.headers).map((h, ci) => (
              <input key={ci} value={h} placeholder={`Столбец ${ci + 1}`}
                onChange={e => setHeader(ci, e.target.value)}
                onFocus={e => { cellTarget.current = { el: e.currentTarget, ri: 'h', ci } }}
                className="glass-input flex-1 min-w-0 px-2 py-1.5 text-[12px] font-semibold" />
            ))}
            <span className="w-5 shrink-0" />
          </div>
          {b.rows.map((row, ri) => (
            <div key={ri} className="flex gap-1 items-center">
              {norm(row).map((c, ci) => (
                <input key={ci} value={c}
                  onChange={e => setCell(ri, ci, e.target.value)}
                  onFocus={e => { cellTarget.current = { el: e.currentTarget, ri, ci } }}
                  className="glass-input flex-1 min-w-0 px-2 py-1.5 text-[12px]" />
              ))}
              <button onClick={() => removeRow(ri)} disabled={b.rows.length <= 1} title="Удалить строку"
                className="w-5 shrink-0 flex justify-center text-[#71717A] hover:text-[#EF4444] disabled:opacity-30 disabled:hover:text-[#71717A]">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div className="flex gap-3 mt-0.5">
            <button onClick={addRow} className="text-[11px] font-medium text-[#FF6A00]">+ строка</button>
            <button onClick={addCol} className="text-[11px] font-medium text-[#FF6A00]">+ столбец</button>
          </div>
        </div>
      )
    }
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
        <div className="space-y-3">
          <div role="tablist" aria-label="Способ создания галереи" className="grid grid-cols-2 gap-1 rounded-[10px] bg-white/[0.04] border border-white/[0.07] p-1">
            <button type="button" role="tab" aria-selected={galleryTool === 'photos'} onClick={() => setGalleryTool('photos')}
              className={cn('min-h-9 rounded-[8px] px-3 text-[12px] font-semibold transition-colors', galleryTool === 'photos' ? 'bg-[#FF6A00] text-white' : 'text-[#A1A1AA] hover:text-white')}>
              Галерея из фото
            </button>
            <button type="button" role="tab" aria-selected={galleryTool === 'slice'} onClick={() => setGalleryTool('slice')}
              className={cn('min-h-9 rounded-[8px] px-3 text-[12px] font-semibold transition-colors', galleryTool === 'slice' ? 'bg-[#FF6A00] text-white' : 'text-[#A1A1AA] hover:text-white')}>
              Нарезать изображение
            </button>
          </div>

          {galleryTool === 'photos' ? (
            b.matrix4 ? (
              <div className="rounded-[10px] border border-[rgba(255,106,0,0.25)] bg-[rgba(255,106,0,0.07)] p-3 space-y-2">
                <p className="text-[12px] font-semibold text-white">Это составная нарезка 4×4</p>
                <p className="text-[11px] leading-relaxed text-[#A1A1AA]">Внутри четыре независимо листаемых ряда. Генерация и замена исходника находятся во вкладке «Нарезать изображение».</p>
                <button type="button" onClick={() => setGalleryTool('slice')} className="text-[11px] font-semibold text-[#FF6A00]">Открыть нарезку →</button>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-[#A1A1AA]">Как показывать фотографии</p>
                  <div className="grid grid-cols-3 gap-1 rounded-[9px] bg-white/[0.04] border border-white/[0.06] p-1">
                    {([['slideshow', 'Карусель'], ['collage', 'Сетка'], ['stack', 'Стопка']] as const).map(([lay, label]) => (
                      <button type="button" key={lay} onClick={() => onChange({ ...b, layout: lay })}
                        className={cn('min-h-9 rounded-[7px] px-2 text-[11px] font-medium transition-colors', b.layout === lay ? 'bg-white/[0.1] text-white' : 'text-[#A1A1AA] hover:text-white')}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {b.urls.length > 0 ? (
                  <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-1">
                    {b.urls.map((u, i) => (
                      <div key={i} className="relative shrink-0">
                        <img src={u} alt="" className="h-16 w-16 rounded-[8px] object-cover" />
                        <button type="button" aria-label="Удалить фотографию" onClick={() => onChange({ ...b, urls: b.urls.filter((_, k) => k !== i) })}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/80 text-white flex items-center justify-center text-[11px]">×</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[9px] border border-dashed border-white/[0.1] px-3 py-4 text-center text-[11px] text-[#66666E]">Добавьте минимум две фотографии</div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={onAddGalleryPhoto} disabled={uploading}
                    className="min-h-10 flex items-center justify-center gap-1.5 rounded-[9px] bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40 disabled:opacity-50">
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Добавить фото
                  </button>
                  <button type="button" onClick={() => setGalPromptOpen(o => !o)} disabled={galleryGenLoading}
                    className="min-h-10 flex items-center justify-center gap-1.5 rounded-[9px] bg-[rgba(255,106,0,0.12)] border border-[rgba(255,106,0,0.3)] text-[12px] text-[#FF6A00] disabled:opacity-50">
                    {galleryGenLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Создать AI-фото
                  </button>
                </div>

                {galPromptOpen && (
                  <div className="rounded-[10px] bg-[rgba(255,106,0,0.06)] border border-[rgba(255,106,0,0.2)] p-2.5 space-y-2">
                    <label className="block text-[11px] font-semibold text-[#A1A1AA]" htmlFor={editorId + '-gallery-ai-prompt'}>Что должно быть на фотографии</label>
                    <textarea id={editorId + '-gallery-ai-prompt'} value={galPrompt} onChange={e => setGalPrompt(e.target.value)} rows={2}
                      placeholder="Коротко опишите изображение"
                      className="glass-input w-full px-2.5 py-2 text-[12px] resize-none" />
                    <button type="button" onClick={() => { onGenerateGalleryPhoto?.(galPrompt); setGalPrompt('') }} disabled={galleryGenLoading}
                      className="w-full min-h-10 flex items-center justify-center gap-1.5 rounded-[9px] bg-[#FF6A00] text-white text-[12px] font-semibold disabled:opacity-50">
                      {galleryGenLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Сгенерировать фото
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-[#55555D]">{b.urls.length} фото{b.urls.length < 2 ? ' · нужно 2+ для галереи' : ''}</p>
              </>
            )
          ) : (
            <>
              {b.matrix4 && (
                <div className="inline-flex items-center gap-2 rounded-[9px] bg-[rgba(255,106,0,0.1)] border border-[rgba(255,106,0,0.28)] px-2.5 py-1.5">
                  <span className="text-[11px] font-semibold text-[#FF6A00]">4×4</span>
                  <span className="text-[10px] text-[#A1A1AA]">единый блок · 4 листаемых ряда · 16 фрагментов</span>
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-[#A1A1AA]">Как нарезать исходное изображение</p>
                <div className="grid grid-cols-3 gap-1 rounded-[9px] bg-white/[0.04] border border-white/[0.06] p-1">
                  {([['horizontal', 'Горизонт'], ['vertical', 'Вертикаль'], ['grid4', '4×4']] as const).map(([orientation, label]) => {
                    const locked = orientation === 'grid4' && !allowGrid4
                    return (
                      <button type="button" key={orientation} onClick={() => !locked && setPanoOrient(orientation)} disabled={locked}
                        title={locked ? 'Сложный коллаж 4×4 временно доступен только администратору' : undefined}
                        className={cn('min-h-9 rounded-[7px] px-2 text-[11px] font-medium transition-colors flex items-center justify-center gap-1', panoOrient === orientation ? 'bg-[#FF6A00] text-white' : 'text-[#A1A1AA] hover:text-white', locked && 'cursor-not-allowed opacity-40 hover:text-[#A1A1AA]')}>
                        {label}{locked && <Lock size={10} />}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] leading-relaxed text-[#66666E]">
                  {panoOrient === 'horizontal' && 'Одна широкая сцена → горизонтальная карусель.'}
                  {panoOrient === 'vertical' && 'Одна высокая сцена → вертикальная стопка.'}
                  {panoOrient === 'grid4' && 'Квадрат 1:1 в 4K → 16 частей → 4 независимо листаемых ряда.'}
                </p>
              </div>

              {panoOrient !== 'grid4' && (
                <label className="flex items-center justify-between gap-3 rounded-[9px] bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-[11px] text-[#A1A1AA]">
                  Количество частей
                  <input type="number" min={2} max={8} value={panoCount}
                    onChange={e => setPanoCount(Math.min(8, Math.max(2, parseInt(e.target.value, 10) || 2)))}
                    className="glass-input w-16 px-2 py-1.5 text-center text-[12px]" />
                </label>
              )}

              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-[#A1A1AA]" htmlFor={editorId + '-panorama-subject'}>Что должно быть на исходной картинке</label>
                <textarea id={editorId + '-panorama-subject'} value={panoPrompt} onChange={e => setPanoPrompt(e.target.value)} rows={3}
                  placeholder={panoOrient === 'grid4' ? 'Например: один горный пейзаж в четырёх временах года' : 'Коротко опишите сюжет изображения'}
                  className="glass-input w-full px-3 py-2 text-[12px] resize-none" />
                <p className="text-[10px] leading-relaxed text-[#66666E]">Пишите только сюжет. Размер, композицию, линии нарезки и BrandKit Publium добавит сам.</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => onSlicePanorama?.(panoOrient, panoCount)} disabled={uploading || panoGenLoading || (panoOrient === 'grid4' && !allowGrid4)}
                  className="min-h-11 flex items-center justify-center gap-1.5 rounded-[9px] bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#D4D4D8] hover:border-[#FF6A00]/40 disabled:opacity-50">
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Загрузить исходник
                </button>
                <button type="button" onClick={() => onGeneratePanorama?.(panoOrient, panoCount, panoPrompt)} disabled={panoGenLoading || uploading || !panoPrompt.trim() || (panoOrient === 'grid4' && !allowGrid4)}
                  className="min-h-11 flex items-center justify-center gap-1.5 rounded-[9px] bg-[#FF6A00] text-white text-[12px] font-semibold disabled:opacity-50">
                  {panoGenLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Сгенерировать
                </button>
              </div>

              {b.matrix4 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-[#A1A1AA]">Нарезка 4×4</p>
                  <div className="grid grid-cols-4 gap-0 overflow-hidden rounded-[8px] bg-black">
                    {b.matrix4.flat().map((u, i) => <img key={i} src={u} alt="" className="aspect-square w-full object-cover" />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )
    case 'divider':
      return <div className="h-px bg-white/10" />
    default:
      return null
  }
}
