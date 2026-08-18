import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ListFilter, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData, moderatorFetch } from '@/lib/telegram'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Sheet } from '@/components/ui/Sheet'
import { ModeratorHelpSheet, ModeratorInfoButton } from '@/components/moderator/ModeratorHelpSheet'

type MediaType = 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'video_note' | 'sticker' | 'animation' | 'poll' | 'contact' | 'location'
type Category = { id: string; name: string; enabled: boolean; severity: 'standard' | 'serious' | 'critical'; terms: string[]; action: 'delete' | 'delete_warn'; responseMode: 'none' | 'custom'; responseText: string; autoDeleteSeconds: number }
type FiltersBlock = { id: string; type: 'content_filters'; enabled: boolean; stopWords: string[]; textCategories: Category[]; regexPatterns: string[]; blacklistedDomains: string[]; maxMentions: number; capsEnabled: boolean; capsPercent: number; capsMinLetters: number; emojiEnabled: boolean; maxEmoji: number; blockForwarded: boolean; blockedMedia: MediaType[]; action: 'delete' | 'delete_warn'; skipBots: boolean; skipAdmins: boolean; skipTrusted: boolean }
const DEFAULT: FiltersBlock = { id: 'content-filters-default', type: 'content_filters', enabled: false, stopWords: [], textCategories: [], regexPatterns: [], blacklistedDomains: [], maxMentions: 0, capsEnabled: false, capsPercent: 80, capsMinLetters: 10, emojiEnabled: false, maxEmoji: 10, blockForwarded: false, blockedMedia: [], action: 'delete', skipBots: true, skipAdmins: true, skipTrusted: true }
const MEDIA: Array<{ id: MediaType; label: string }> = [{ id: 'photo', label: 'Фото' }, { id: 'video', label: 'Видео' }, { id: 'document', label: 'Файлы' }, { id: 'audio', label: 'Аудио' }, { id: 'voice', label: 'Голосовые' }, { id: 'video_note', label: 'Кружки' }, { id: 'sticker', label: 'Стикеры' }, { id: 'animation', label: 'GIF' }, { id: 'poll', label: 'Опросы' }, { id: 'contact', label: 'Контакты' }, { id: 'location', label: 'Геолокация' }]
const inputClass = 'mt-1.5 min-h-11 w-full rounded-[11px] border border-white/[0.08] bg-[#171719] px-3 text-[13px] text-white outline-none focus:border-[rgba(255,106,0,0.45)]'
const list = (value: string) => [...new Set(value.split(/[\n,;\t]+/).map(x => x.trim()).filter(Boolean))].slice(0, 1000)
const blankCategory = (): Category => ({ id: 'filter-category-' + Date.now(), name: 'Новая категория', enabled: true, severity: 'standard', terms: [], action: 'delete_warn', responseMode: 'custom', responseText: '{name}, пожалуйста, соблюдайте правила сообщества.', autoDeleteSeconds: 60 })
const PRESETS: Record<string, Partial<Category>> = {
  custom: { name: 'Новая категория', severity: 'standard', responseText: '{name}, пожалуйста, соблюдайте правила сообщества.' },
  profanity: { name: 'Мат', severity: 'standard', responseText: '{name}, пожалуйста, без мата.' },
  insults: { name: 'Оскорбления и травля', severity: 'serious', responseText: '{name}, не оскорбляйте участников сообщества.' },
  discrimination: { name: 'Дискриминация', severity: 'critical', responseText: '{name}, дискриминация и унижение участников недопустимы.' },
  spam: { name: 'Спам и реклама', severity: 'serious', responseText: '{name}, реклама и спам без согласования запрещены.' },
  scam: { name: 'Скам и мошенничество', severity: 'critical', responseText: 'Сообщение удалено как потенциально опасное.' },
  politics: { name: 'Политика', severity: 'standard', responseText: '{name}, пожалуйста, вернёмся к теме сообщества.' },
}
const SEVERITY = { standard: { label: 'Обычная', dot: 'bg-amber-400' }, serious: { label: 'Серьёзная', dot: 'bg-orange-500' }, critical: { label: 'Критическая', dot: 'bg-red-500' } }

export function ModeratorContentFiltersEditor({ moderatorId }: { moderatorId: string }) {
  const [block, setBlock] = useState(DEFAULT)
  const [patterns, setPatterns] = useState(''), [domains, setDomains] = useState('')
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [publishing, setPublishing] = useState(false), [published, setPublished] = useState(false), [collapsed, setCollapsed] = useState(false), [message, setMessage] = useState('')
  const [helpOpen, setHelpOpen] = useState(false), [editingId, setEditingId] = useState<string | null>(null)
  const initData = getTelegramInitData()
  const editing = useMemo(() => block.textCategories.find(category => category.id === editingId) ?? null, [block.textCategories, editingId])

  useEffect(() => {
    if (!initData) { setLoading(false); return }
    moderatorFetch(API_BASE + '/api/moderator-config/' + moderatorId + '/draft').then(async response => {
      const data = await response.json() as { draft?: { blocks?: FiltersBlock[] }; moderator?: { publishedVersion?: number | null }; error?: string }
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить фильтры')
      const found = data.draft?.blocks?.find(x => x.type === 'content_filters')
      if (found) {
        const legacy = (!found.textCategories?.length && found.stopWords?.length) ? [{ ...blankCategory(), id: 'filter-category-legacy', name: 'Без категории', action: found.action, responseMode: 'custom' as const, responseText: '{username}, сообщение удалено фильтром сообщества.', terms: found.stopWords }] : []
        setBlock({ ...DEFAULT, ...found, textCategories: found.textCategories?.length ? found.textCategories : legacy })
        setPatterns((found.regexPatterns || []).join('\n')); setDomains((found.blacklistedDomains || []).join('\n'))
      }
      const yes = Boolean(data.moderator?.publishedVersion); setPublished(yes); if (yes) setCollapsed(true)
    }).catch(error => setMessage(error instanceof Error ? error.message : 'Не удалось загрузить фильтры')).finally(() => setLoading(false))
  }, [initData, moderatorId])

  const patchCategory = (id: string, patch: Partial<Category>) => setBlock(previous => ({ ...previous, textCategories: previous.textCategories.map(category => category.id === id ? { ...category, ...patch } : category) }))
  const addCategory = () => { const category = blankCategory(); setBlock(previous => ({ ...previous, enabled: true, textCategories: [...previous.textCategories, category] })); setEditingId(category.id) }
  const removeCategory = (id: string) => { setBlock(previous => ({ ...previous, textCategories: previous.textCategories.filter(category => category.id !== id) })); setEditingId(null) }
  const applyPreset = (id: string, preset: string) => patchCategory(id, { ...PRESETS[preset], responseMode: 'custom' })

  const save = useCallback(async () => {
    if (!initData) return false
    const invalid = block.textCategories.find(category => !category.name.trim() || !category.terms.length || (category.responseMode === 'custom' && !category.responseText.trim()))
    if (invalid) { setMessage('Заполните название, слова и ответ категории «' + (invalid.name || 'Без названия') + '»'); return false }
    setSaving(true); setMessage('')
    const next = { ...block, stopWords: [], textCategories: block.textCategories.map(category => ({ ...category, name: category.name.trim(), terms: list(category.terms.join('\n')), responseText: category.responseText.trim() })), regexPatterns: list(patterns), blacklistedDomains: list(domains) }
    try {
      const response = await moderatorFetch(API_BASE + '/api/moderator-config/' + moderatorId + '/draft', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: [next] }) })
      const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || 'Не удалось сохранить')
      setBlock(next); setMessage('Черновик сохранён'); return true
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось сохранить'); return false }
    finally { setSaving(false) }
  }, [block, domains, initData, moderatorId, patterns])

  const publish = async () => {
    if (!initData || publishing) return
    setPublishing(true); if (!await save()) { setPublishing(false); return }
    try {
      const response = await moderatorFetch(API_BASE + '/api/moderator-config/' + moderatorId + '/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockType: 'content_filters' }) })
      const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || 'Не удалось применить')
      setPublished(true); setMessage('Категории фильтрации применены')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось применить') }
    finally { setPublishing(false) }
  }
  const toggleMedia = (id: MediaType) => setBlock(previous => ({ ...previous, blockedMedia: previous.blockedMedia.includes(id) ? previous.blockedMedia.filter(x => x !== id) : [...previous.blockedMedia, id] }))

  if (loading) return <div className="flex justify-center py-6 text-[#66666E]"><Loader2 size={20} className="animate-spin" /></div>
  return <GlassCard>
    <div className={'flex items-center gap-1 ' + (collapsed ? '' : 'mb-4')}>
      <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)} className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[14px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[rgba(255,106,0,0.10)] text-[#FF6A00]"><ListFilter size={18} /></span>
        <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[14px] font-semibold text-white">Фильтры контента {published && <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-400"><Check size={11} /> применено</span>}</span><span className="mt-0.5 block truncate text-[11px] text-[#66666E]">{block.textCategories.filter(category => category.enabled).length + ' категорий · ' + block.textCategories.reduce((sum, category) => sum + category.terms.length, 0) + ' слов и фраз'}</span></span>
        <ChevronDown size={18} className={'shrink-0 text-[#66666E] transition-transform ' + (collapsed ? '-rotate-90' : '')} />
      </button>
      <ModeratorInfoButton onClick={() => setHelpOpen(true)} label="Открыть справку: Фильтры контента" />
    </div>

    {!collapsed && <div>
      <div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Включить фильтры" description="Проверять сообщения и их редактирование" value={block.enabled} onChange={enabled => setBlock(previous => ({ ...previous, enabled }))} /></div>

      <section className="mt-4">
        <div className="flex items-center justify-between"><div><p className="text-[12px] font-semibold text-white">Категории текста</p><p className="mt-0.5 text-[10px] text-[#66666E]">У каждой свой список, реакция и ответ</p></div><button type="button" onClick={addCategory} disabled={block.textCategories.length >= 20} className="flex min-h-10 items-center gap-1 rounded-[10px] px-2.5 text-[11px] font-medium text-[#FF6A00] hover:bg-[rgba(255,106,0,0.08)] disabled:opacity-40"><Plus size={14} /> Добавить</button></div>
        <div className="mt-2 space-y-2">
          {block.textCategories.length === 0 && <button type="button" onClick={addCategory} className="flex min-h-24 w-full flex-col items-center justify-center rounded-[14px] border border-dashed border-white/[0.1] text-[#777780] hover:border-[rgba(255,106,0,0.3)] hover:text-[#FF6A00]"><Plus size={19} /><span className="mt-1 text-[11px]">Создать первую категорию</span></button>}
          {block.textCategories.map(category => <button key={category.id} type="button" onClick={() => setEditingId(category.id)} className="flex min-h-16 w-full items-center gap-3 rounded-[14px] border border-white/[0.07] bg-white/[0.025] px-3 text-left hover:border-white/[0.13]">
            <span className={'h-2.5 w-2.5 shrink-0 rounded-full ' + (category.enabled ? SEVERITY[category.severity].dot : 'bg-[#44444B]')} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-white">{category.name}</span><span className="mt-0.5 block truncate text-[10px] text-[#66666E]">{category.terms.length + ' слов и фраз · ' + (category.responseMode === 'custom' ? 'свой ответ' : 'без ответа')}</span></span>
            <ChevronRight size={16} className="text-[#55555D]" />
          </button>)}
        </div>
      </section>

      <details className="group mt-4 rounded-[14px] border border-white/[0.07] bg-white/[0.025]"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-[12px] font-semibold text-white">Другие текстовые ограничения <ChevronDown size={15} className="text-[#66666E] transition-transform group-open:rotate-180" /></summary><div className="space-y-3 border-t border-white/[0.07] p-3">
        <label className="block text-[11px] text-[#8A8A93]">Regex-паттерны<textarea value={patterns} onChange={event => setPatterns(event.target.value)} rows={3} placeholder={'\\bpromo[-_ ]?code\\b'} className={inputClass + ' py-2.5 font-mono'} /></label>
        <label className="block text-[11px] text-[#8A8A93]">Чёрный список доменов<textarea value={domains} onChange={event => setDomains(event.target.value)} rows={3} placeholder={'spam.example\nbad-site.com'} className={inputClass + ' py-2.5'} /></label>
        <label className="block text-[11px] text-[#8A8A93]">Максимум упоминаний<select value={block.maxMentions} onChange={event => setBlock(previous => ({ ...previous, maxMentions: Number(event.target.value) }))} className={inputClass}><option value={0}>Не ограничивать</option>{[1,2,3,5,10,20].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <Switch label="Ограничить CAPS" value={block.capsEnabled} onChange={capsEnabled => setBlock(previous => ({ ...previous, capsEnabled }))} />
        <Switch label="Ограничить эмодзи" value={block.emojiEnabled} onChange={emojiEnabled => setBlock(previous => ({ ...previous, emojiEnabled }))} />
        <Switch label="Запретить пересланные сообщения" value={block.blockForwarded} onChange={blockForwarded => setBlock(previous => ({ ...previous, blockForwarded }))} />
      </div></details>

      <details className="group mt-4 rounded-[14px] border border-white/[0.07] bg-white/[0.025]"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-[12px] font-semibold text-white">Вложения <ChevronDown size={15} className="text-[#66666E] transition-transform group-open:rotate-180" /></summary><div className="flex flex-wrap gap-2 border-t border-white/[0.07] p-3">{MEDIA.map(item => <button key={item.id} type="button" aria-pressed={block.blockedMedia.includes(item.id)} onClick={() => toggleMedia(item.id)} className={'min-h-11 rounded-[10px] border px-3 text-[12px] transition-colors ' + (block.blockedMedia.includes(item.id) ? 'border-red-400/30 bg-red-400/10 text-red-300' : 'border-white/[0.08] bg-white/[0.035] text-[#8A8A93] hover:text-white')}>{item.label}</button>)}</div></details>

      <div className="mt-4 space-y-3 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3">
        <label className="block text-[11px] text-[#8A8A93]">Реакция для regex, доменов и вложений<select value={block.action} onChange={event => setBlock(previous => ({ ...previous, action: event.target.value as FiltersBlock['action'] }))} className={inputClass}><option value="delete">Удалить сообщение</option><option value="delete_warn">Удалить и предупредить</option></select></label>
        <Switch label="Пропускать ботов" value={block.skipBots} onChange={skipBots => setBlock(previous => ({ ...previous, skipBots }))} />
        {block.skipAdmins && <p className="rounded-[10px] border border-amber-400/15 bg-amber-400/[0.07] px-3 py-2 text-[10px] leading-relaxed text-amber-200">Сообщения администраторов не проверяются. Для теста со своего админ-аккаунта временно выключите этот тумблер.</p>}
        <Switch label="Пропускать админов" value={block.skipAdmins} onChange={skipAdmins => setBlock(previous => ({ ...previous, skipAdmins }))} />
        <Switch label="Пропускать доверенных" value={block.skipTrusted} onChange={skipTrusted => setBlock(previous => ({ ...previous, skipTrusted }))} />
      </div>
      {message && <p aria-live="polite" className="mt-3 text-[11px] text-[#8A8A93]">{message}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" onClick={() => void save()} disabled={saving || publishing} fullWidth>{saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} /> Сохранить</>}</Button><Button variant="primary" size="sm" onClick={() => void publish()} disabled={saving || publishing} fullWidth>{publishing ? <Loader2 size={14} className="animate-spin" /> : 'Применить'}</Button></div>
    </div>}

    <Sheet open={Boolean(editing)} onClose={() => setEditingId(null)} title={editing?.name || 'Категория'} height="full">
      {editing && <div className="space-y-4 pb-4">
        <Switch label="Категория активна" value={editing.enabled} onChange={enabled => patchCategory(editing.id, { enabled })} />
        <label className="block text-[11px] text-[#8A8A93]">Быстрый шаблон<select defaultValue="custom" onChange={event => applyPreset(editing.id, event.target.value)} className={inputClass}><option value="custom">Своя категория</option><option value="profanity">Мат</option><option value="insults">Оскорбления и травля</option><option value="discrimination">Дискриминация</option><option value="spam">Спам и реклама</option><option value="scam">Скам и мошенничество</option><option value="politics">Политика</option></select></label>
        <label className="block text-[11px] text-[#8A8A93]">Название<input value={editing.name} maxLength={80} onChange={event => patchCategory(editing.id, { name: event.target.value })} className={inputClass} /></label>
        <label className="block text-[11px] text-[#8A8A93]">Приоритет<select value={editing.severity} onChange={event => patchCategory(editing.id, { severity: event.target.value as Category['severity'] })} className={inputClass}><option value="standard">Обычная</option><option value="serious">Серьёзная</option><option value="critical">Критическая</option></select><span className="mt-1 block text-[10px] text-[#55555D]">Если совпали несколько категорий, сначала выбирается точная фраза, затем более высокий приоритет.</span></label>
        <label className="block text-[11px] text-[#8A8A93]">Стоп-слова и фразы<textarea value={editing.terms.join('\n')} onChange={event => patchCategory(editing.id, { terms: list(event.target.value) })} rows={8} placeholder={'тупой хохол\nоскорбительная фраза'} className={inputClass + ' resize-none py-2.5'} /><span className="mt-1 flex justify-between text-[10px] text-[#55555D]"><span>Перенос, запятая или точка с запятой</span><span>{editing.terms.length}/1000</span></span></label>
        <label className="block text-[11px] text-[#8A8A93]">Реакция<select value={editing.action} onChange={event => patchCategory(editing.id, { action: event.target.value as Category['action'] })} className={inputClass}><option value="delete">Только удалить</option><option value="delete_warn">Удалить и предупредить</option></select></label>
        <label className="block text-[11px] text-[#8A8A93]">Ответ после удаления<select value={editing.responseMode} onChange={event => patchCategory(editing.id, { responseMode: event.target.value as Category['responseMode'] })} className={inputClass}><option value="none">Не отвечать</option><option value="custom">Свой текст</option></select></label>
        {editing.responseMode === 'custom' && <div><textarea value={editing.responseText} onChange={event => patchCategory(editing.id, { responseText: event.target.value })} rows={4} maxLength={500} className={inputClass + ' resize-none py-2.5'} /><div className="mt-2 flex flex-wrap gap-1.5">{['{name}','{username}','{reason}','{warnings}','{ban_after}'].map(token => <button key={token} type="button" onClick={() => patchCategory(editing.id, { responseText: editing.responseText + ' ' + token })} className="min-h-9 rounded-[9px] border border-white/[0.08] bg-white/[0.035] px-2.5 font-mono text-[10px] text-[#A0A0A8]">{token}</button>)}</div></div>}
        {editing.responseMode === 'custom' && <label className="block text-[11px] text-[#8A8A93]">Автоудаление ответа<select value={editing.autoDeleteSeconds} onChange={event => patchCategory(editing.id, { autoDeleteSeconds: Number(event.target.value) })} className={inputClass}><option value={0}>Не удалять</option><option value={60}>Через 1 минуту</option><option value={300}>Через 5 минут</option><option value={900}>Через 15 минут</option><option value={3600}>Через 1 час</option></select></label>}
        <div className="rounded-[13px] border border-white/[0.07] bg-white/[0.025] p-3"><p className="text-[10px] uppercase tracking-[0.1em] text-[#66666E]">Предпросмотр</p><p className="mt-2 text-[12px] leading-relaxed text-white">{editing.responseMode === 'custom' ? editing.responseText.replace('{name}', 'Степан').replace('{username}', '@stepan').replace('{reason}', editing.name).replace('{warnings}', '1').replace('{ban_after}', '5') : 'Ответ отключён'}</p></div>
        <button type="button" onClick={() => removeCategory(editing.id)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[11px] border border-red-400/15 bg-red-400/[0.06] text-[12px] font-medium text-red-300"><Trash2 size={14} /> Удалить категорию</button>
      </div>}
    </Sheet>
    <ModeratorHelpSheet kind="filters" open={helpOpen} onClose={() => setHelpOpen(false)} />
  </GlassCard>
}
