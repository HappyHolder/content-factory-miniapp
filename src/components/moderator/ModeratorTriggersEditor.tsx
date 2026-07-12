import { useCallback, useEffect, useRef, useState } from 'react'
import { Bold, Check, ChevronDown, ImagePlus, Italic, Link2, Loader2, MessageSquareReply, Plus, Save, Strikethrough, Trash2, X } from 'lucide-react'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData } from '@/lib/telegram'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { RichPostPreview, textToRuns } from '@/components/posts/RichPostPreview'
import type { PostBlock } from '@/types'

type TriggerButton = { id: string; label: string; url: string }
type Trigger = { id: string; name: string; enabled: boolean; phrases: string[]; matchMode: 'exact' | 'prefix' | 'contains'; text: string; imageUrl?: string; buttons: TriggerButton[]; access: 'all' | 'admins'; cooldownSeconds: number; autoDeleteSeconds: number; deleteTriggerMessage: boolean; useAsAiKnowledge: boolean }
type TriggersBlock = { id: string; type: 'triggers'; enabled: boolean; skipBots: boolean; triggers: Trigger[] }
const DEFAULT: TriggersBlock = { id: 'triggers-default', type: 'triggers', enabled: false, skipBots: true, triggers: [] }
const inputClass = 'min-h-11 w-full rounded-[11px] border border-white/[0.08] bg-[#171719] px-3 text-[13px] text-white outline-none focus:border-[rgba(255,106,0,0.45)]'
const createTrigger = (): Trigger => ({ id: 'trigger-' + Date.now(), name: 'Новый автоответ', enabled: true, phrases: [''], matchMode: 'exact', text: 'Напишите текст ответа', buttons: [], access: 'all', cooldownSeconds: 30, autoDeleteSeconds: 0, deleteTriggerMessage: false, useAsAiKnowledge: false })

export function ModeratorTriggersEditor({ moderatorId }: { moderatorId: string }) {
  const initData = getTelegramInitData()
  const [block, setBlock] = useState(DEFAULT)
  const [collapsed, setCollapsed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [published, setPublished] = useState(false)
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<string | null>(null)

  useEffect(() => {
    if (!initData) { setLoading(false); return }
    fetch(API_BASE + '/api/moderator-config/' + moderatorId + '/draft?initData=' + encodeURIComponent(initData))
      .then(async res => { const data = await res.json() as { draft?: { blocks?: TriggersBlock[] }; moderator?: { publishedVersion?: number | null }; error?: string }; if (!res.ok) throw new Error(data.error || 'Не удалось загрузить триггеры'); const found = data.draft?.blocks?.find(x => x.type === 'triggers'); if (found) setBlock({ ...DEFAULT, ...found, triggers: found.triggers || [] }); const yes = Boolean(data.moderator?.publishedVersion); setPublished(yes); if (yes) setCollapsed(true) })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Не удалось загрузить триггеры')).finally(() => setLoading(false))
  }, [initData, moderatorId])

  const patchTrigger = (id: string, patch: Partial<Trigger>) => setBlock(prev => ({ ...prev, triggers: prev.triggers.map(t => t.id === id ? { ...t, ...patch } : t) }))
  const removeTrigger = (id: string) => { setBlock(prev => ({ ...prev, triggers: prev.triggers.filter(t => t.id !== id) })); if (openId === id) setOpenId(null) }
  const addTrigger = () => { const item = createTrigger(); setBlock(prev => ({ ...prev, enabled: true, triggers: [...prev.triggers, item] })); setOpenId(item.id) }
  const addButton = (trigger: Trigger) => patchTrigger(trigger.id, { buttons: [...trigger.buttons, { id: 'trigger-btn-' + Date.now(), label: '', url: '' }].slice(0, 3) })
  const patchButton = (trigger: Trigger, id: string, patch: Partial<TriggerButton>) => patchTrigger(trigger.id, { buttons: trigger.buttons.map(b => b.id === id ? { ...b, ...patch } : b) })
  const wrapText = (trigger: Trigger, before: string, after: string) => patchTrigger(trigger.id, { text: trigger.text + before + 'текст' + after })

  const uploadImage = async (file: File) => {
    const id = uploadTarget.current
    if (!initData || !id) return
    setUploadingId(id); setMessage('')
    try { const form = new FormData(); form.append('initData', initData); form.append('image', file); const res = await fetch(API_BASE + '/api/posts/upload-block-image', { method: 'POST', body: form }); const data = await res.json() as { url?: string; error?: string }; if (!res.ok || !data.url) throw new Error(data.error || 'Не удалось загрузить изображение'); patchTrigger(id, { imageUrl: data.url }) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось загрузить изображение') }
    finally { setUploadingId(null); uploadTarget.current = null; if (fileRef.current) fileRef.current.value = '' }
  }

  const validate = () => {
    for (const trigger of block.triggers) {
      if (!trigger.name.trim()) return 'Укажите название автоответа'
      if (!trigger.phrases.some(p => p.trim())) return 'Добавьте хотя бы одно слово или фразу для «' + trigger.name + '»'
      if (!trigger.text.trim()) return 'Добавьте текст ответа для «' + trigger.name + '»'
      if (trigger.buttons.some(b => (b.label.trim() && !b.url.trim()) || (!b.label.trim() && b.url.trim()))) return 'Заполните название и ссылку кнопки в «' + trigger.name + '»'
    }
    return ''
  }
  const save = useCallback(async () => {
    if (!initData) return false
    const problem = validate(); if (problem) { setMessage(problem); return false }
    setSaving(true); setMessage('')
    try { const clean = { ...block, triggers: block.triggers.map(t => ({ ...t, name: t.name.trim(), phrases: t.phrases.map(p => p.trim()).filter(Boolean), text: t.text.trim() })) }; const res = await fetch(API_BASE + '/api/moderator-config/' + moderatorId + '/draft', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData, blocks: [clean] }) }); const data = await res.json() as { error?: string }; if (!res.ok) throw new Error(data.error || 'Не удалось сохранить'); setBlock(clean); setMessage('Черновик сохранён'); return true }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось сохранить'); return false }
    finally { setSaving(false) }
  }, [block, initData, moderatorId])
  const publish = async () => {
    if (!await save()) return
    setPublishing(true)
    try { const res = await fetch(API_BASE + '/api/moderator-config/' + moderatorId + '/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) }); const data = await res.json() as { error?: string }; if (!res.ok) throw new Error(data.error || 'Не удалось опубликовать'); setPublished(true); setMessage('Триггеры опубликованы и работают в чате') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось опубликовать') }
    finally { setPublishing(false) }
  }

  if (loading) return <div className="flex justify-center py-8 text-[#66666E]"><Loader2 size={20} className="animate-spin" /></div>
  return <GlassCard>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void uploadImage(file) }} />
    <div className={'flex items-center gap-1 ' + (collapsed ? '' : 'mb-4')}>
      <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)} className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[14px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[rgba(255,106,0,0.10)] text-[#FF6A00]"><MessageSquareReply size={18} /></span>
        <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="text-[14px] font-semibold text-white">Триггеры</span>{published && <span className="flex items-center gap-1 text-[10px] text-emerald-400"><Check size={11} /> опубликовано</span>}</span><span className="mt-0.5 block truncate text-[11px] text-[#66666E]">{block.triggers.length ? block.triggers.filter(t => t.enabled).length + ' активных автоответов' : 'Слово или фраза → Rich Message'}</span></span>
        <ChevronDown size={18} className={'shrink-0 text-[#66666E] transition-transform duration-200 ' + (collapsed ? '-rotate-90' : '')} />
      </button>
    </div>
    {!collapsed && <div>
      <div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Включить триггеры" description="Автоматически отвечать на настроенные слова и фразы" value={block.enabled} onChange={enabled => setBlock(prev => ({ ...prev, enabled }))} /></div>
      <div className="mt-4 flex items-center justify-between"><div><p className="text-[12px] font-semibold text-white">Автоответы</p><p className="mt-0.5 text-[10px] text-[#66666E]">До 50 сценариев, один ответ на сообщение</p></div><button type="button" onClick={addTrigger} disabled={block.triggers.length >= 50} className="flex min-h-10 cursor-pointer items-center gap-1 rounded-[10px] px-2.5 text-[11px] font-medium text-[#FF6A00] hover:bg-[rgba(255,106,0,0.08)] disabled:opacity-40"><Plus size={14} /> Добавить</button></div>
      <div className="mt-2 space-y-2">
        {block.triggers.length === 0 && <button type="button" onClick={addTrigger} className="flex min-h-24 w-full cursor-pointer flex-col items-center justify-center rounded-[14px] border border-dashed border-white/[0.1] text-[#777780] hover:border-[rgba(255,106,0,0.3)] hover:text-[#FF6A00]"><Plus size={19} /><span className="mt-1 text-[11px]">Создать первый автоответ</span></button>}
        {block.triggers.map(trigger => {
          const open = openId === trigger.id
          const previewText = trigger.text.replace(/\{name\}/g, 'Степан').replace(/\{username\}/g, '@stepan').replace(/\{group\}/g, 'Publium Chat').replace(/\{channel\}/g, '@publium')
          const previewBlocks: PostBlock[] = [...(trigger.imageUrl ? [{ type: 'image' as const, url: trigger.imageUrl }] : []), { type: 'paragraph', runs: textToRuns(previewText) }]
          return <div key={trigger.id} className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.025]">
            <div className="flex items-center gap-2 p-2">
              <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : trigger.id)} className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[10px] px-2 text-left hover:bg-white/[0.035]">
                <span className={'h-2 w-2 shrink-0 rounded-full ' + (trigger.enabled ? 'bg-emerald-400' : 'bg-[#55555D]')} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-white">{trigger.name || 'Без названия'}</span><span className="mt-0.5 block truncate font-mono text-[10px] text-[#66666E]">{trigger.phrases.filter(Boolean).join(' · ') || 'Триггер не задан'}</span></span>
                <ChevronDown size={15} className={'text-[#66666E] transition-transform ' + (open ? 'rotate-180' : '')} />
              </button>
              <button type="button" aria-label="Удалить автоответ" onClick={() => removeTrigger(trigger.id)} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] text-[#62626A] hover:bg-red-500/10 hover:text-red-400"><Trash2 size={15} /></button>
            </div>
            {open && <div className="space-y-4 border-t border-white/[0.07] p-3">
              <Switch label="Автоответ активен" value={trigger.enabled} onChange={enabled => patchTrigger(trigger.id, { enabled })} />
              <label className="block text-[11px] text-[#8A8A93]">Название<input value={trigger.name} maxLength={80} onChange={e => patchTrigger(trigger.id, { name: e.target.value })} placeholder="Например, Поддержка" className={'mt-1.5 ' + inputClass} /></label>
              <label className="block text-[11px] text-[#8A8A93]">Слова и фразы<textarea value={trigger.phrases.join('\n')} onChange={e => patchTrigger(trigger.id, { phrases: e.target.value.split('\n').slice(0, 10) })} rows={3} placeholder={'support\nсаппорт\nпомощь'} className="mt-1.5 w-full resize-none rounded-[11px] border border-white/[0.08] bg-[#0B0B0D] px-3 py-2.5 font-mono text-[13px] text-white outline-none focus:border-[rgba(255,106,0,0.45)]" /><span className="mt-1 block text-[10px] text-[#55555D]">Каждый вариант с новой строки</span></label>
              <label className="block text-[11px] text-[#8A8A93]">Когда срабатывать<select value={trigger.matchMode} onChange={e => patchTrigger(trigger.id, { matchMode: e.target.value as Trigger['matchMode'] })} className={'mt-1.5 ' + inputClass}><option value="exact">Точное сообщение</option><option value="prefix">В начале сообщения</option><option value="contains">Слово или фраза внутри</option></select></label>
              <div><p className="mb-1.5 text-[11px] text-[#8A8A93]">Ответ</p><div className="flex gap-1 rounded-t-[11px] border border-b-0 border-white/[0.08] bg-white/[0.035] p-1.5">{[[Bold,'Жирный','**','**'],[Italic,'Курсив','__','__'],[Strikethrough,'Зачёркнутый','~~','~~']].map(([Icon,label,before,after]) => { const I = Icon as typeof Bold; return <button key={String(label)} type="button" aria-label={String(label)} onClick={() => wrapText(trigger,String(before),String(after))} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[#8A8A93] hover:bg-white/[0.07] hover:text-white"><I size={15} /></button> })}<button type="button" aria-label="Ссылка" onClick={() => wrapText(trigger,'[текст](',')')} className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[#8A8A93] hover:bg-white/[0.07] hover:text-white"><Link2 size={15} /></button></div><textarea value={trigger.text} onChange={e => patchTrigger(trigger.id, { text: e.target.value })} rows={6} maxLength={3500} className="w-full resize-none rounded-b-[11px] border border-white/[0.08] bg-[#0B0B0D] px-3 py-3 text-[14px] leading-relaxed text-white outline-none focus:border-[rgba(255,106,0,0.45)]" /><div className="mt-1 text-right text-[10px] text-[#55555D]">{trigger.text.length}/3500</div></div>
              {trigger.imageUrl ? <div className="relative overflow-hidden rounded-[13px] border border-white/[0.08]"><img src={trigger.imageUrl} alt="Изображение автоответа" className="max-h-56 w-full object-cover" /><button type="button" aria-label="Удалить изображение" onClick={() => patchTrigger(trigger.id, { imageUrl: undefined })} className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white"><X size={15} /></button></div> : <Button variant="secondary" size="sm" fullWidth disabled={uploadingId === trigger.id} onClick={() => { uploadTarget.current = trigger.id; fileRef.current?.click() }}>{uploadingId === trigger.id ? <Loader2 size={14} className="animate-spin" /> : <><ImagePlus size={14} /> Добавить изображение</>}</Button>}
              <div><div className="flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#66666E]">Кнопки</p>{trigger.buttons.length < 3 && <button type="button" onClick={() => addButton(trigger)} className="flex min-h-9 items-center gap-1 text-[11px] text-[#FF6A00]"><Plus size={13} /> Добавить</button>}</div><div className="mt-2 space-y-2">{trigger.buttons.map(button => <div key={button.id} className="grid grid-cols-[1fr_1.35fr_40px] gap-2"><input value={button.label} onChange={e => patchButton(trigger, button.id, { label: e.target.value })} placeholder="Поддержка" className={inputClass} /><input value={button.url} onChange={e => patchButton(trigger, button.id, { url: e.target.value })} placeholder="https://…" className={inputClass} /><button type="button" aria-label="Удалить кнопку" onClick={() => patchTrigger(trigger.id, { buttons: trigger.buttons.filter(b => b.id !== button.id) })} className="flex h-11 w-10 items-center justify-center rounded-[10px] text-[#62626A] hover:bg-red-500/10 hover:text-red-400"><Trash2 size={14} /></button></div>)}</div></div>
              <details className="group rounded-[13px] border border-white/[0.08]"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-[12px] font-semibold text-white">Поведение<ChevronDown size={15} className="text-[#66666E] group-open:rotate-180" /></summary><div className="space-y-3 border-t border-white/[0.07] p-3">
                <label className="block text-[11px] text-[#8A8A93]">Доступ<select value={trigger.access} onChange={e => patchTrigger(trigger.id, { access: e.target.value as Trigger['access'] })} className={'mt-1.5 ' + inputClass}><option value="all">Все участники</option><option value="admins">Только администраторы</option></select></label>
                <label className="block text-[11px] text-[#8A8A93]">Повторный вызов<select value={trigger.cooldownSeconds} onChange={e => patchTrigger(trigger.id, { cooldownSeconds: Number(e.target.value) })} className={'mt-1.5 ' + inputClass}><option value={0}>Без задержки</option><option value={10}>Через 10 секунд</option><option value={30}>Через 30 секунд</option><option value={60}>Через 1 минуту</option><option value={300}>Через 5 минут</option></select></label>
                <label className="block text-[11px] text-[#8A8A93]">Автоудаление ответа<select value={trigger.autoDeleteSeconds} onChange={e => patchTrigger(trigger.id, { autoDeleteSeconds: Number(e.target.value) })} className={'mt-1.5 ' + inputClass}><option value={0}>Не удалять</option><option value={60}>Через 1 минуту</option><option value={300}>Через 5 минут</option><option value={900}>Через 15 минут</option><option value={3600}>Через 1 час</option></select></label>
                <Switch label="Удалять сообщение с триггером" description="Например, скрыть служебное сообщение «support»" value={trigger.deleteTriggerMessage} onChange={deleteTriggerMessage => patchTrigger(trigger.id, { deleteTriggerMessage })} />
                <Switch label="Использовать как знание Terra" description="Содержание ответа можно будет учитывать в AI-модерации" value={trigger.useAsAiKnowledge} onChange={useAsAiKnowledge => patchTrigger(trigger.id, { useAsAiKnowledge })} />
              </div></details>
              <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#66666E]">Переменные</p><div className="flex flex-wrap gap-1.5">{['{name}','{username}','{group}','{channel}'].map(token => <button key={token} type="button" onClick={() => patchTrigger(trigger.id, { text: trigger.text + ' ' + token })} className="min-h-9 rounded-[9px] border border-white/[0.08] bg-white/[0.035] px-2.5 font-mono text-[11px] text-[#A0A0A8]">{token}</button>)}</div></div>
              <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#66666E]">Предпросмотр</p><RichPostPreview blocks={previewBlocks} channelName="Модератор" />{trigger.buttons.filter(b => b.label && b.url).map(b => <div key={b.id} className="mt-1.5 rounded-[9px] border border-[#2E7CF6]/30 bg-[#2E7CF6]/10 px-3 py-2 text-center text-[12px] text-[#7FB0FF]">{b.label}</div>)}</div>
            </div>}
          </div>
        })}
      </div>
      <div className="mt-4 rounded-[12px] border border-white/[0.07] bg-white/[0.02] p-3"><Switch label="Игнорировать сообщения ботов" description="Защищает от циклов между автоответчиками" value={block.skipBots} onChange={skipBots => setBlock(prev => ({ ...prev, skipBots }))} /></div>
      {message && <p aria-live="polite" className="mt-3 text-[11px] text-[#8A8A93]">{message}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" onClick={() => void save()} disabled={saving || publishing} fullWidth>{saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} /> Сохранить</>}</Button><Button variant="primary" size="sm" onClick={() => void publish()} disabled={saving || publishing || !block.triggers.length} fullWidth>{publishing ? <Loader2 size={14} className="animate-spin" /> : 'Опубликовать'}</Button></div>
    </div>}
  </GlassCard>
}