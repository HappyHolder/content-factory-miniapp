import { ArrowDown, ArrowUp, Copy, Link2, Plus, Trash2 } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import type { ButtonStyle, LinkItem } from '@/types'
import { cn } from '@/lib/utils'

const STYLES: Array<{ value: ButtonStyle | undefined; dot: string; preview: string }> = [
  { value: undefined, dot: 'bg-[#8B8B94]', preview: 'bg-white/[0.08] border-white/[0.14] text-[#5AA9FF]' },
  { value: 'primary', dot: 'bg-[#2E7CF6]', preview: 'bg-[#2E7CF6]/15 border-[#2E7CF6]/45 text-[#7FB0FF]' },
  { value: 'success', dot: 'bg-[#22A06B]', preview: 'bg-[#22A06B]/15 border-[#22A06B]/45 text-[#4FD394]' },
  { value: 'danger', dot: 'bg-[#E5484D]', preview: 'bg-[#E5484D]/15 border-[#E5484D]/45 text-[#FF7A7E]' },
]

const postButtonInputLabel = (button: LinkItem) => button.buttonLabel || button.label || ''
export const postButtonLabel = (button: LinkItem) => postButtonInputLabel(button).trim()
export const postButtonTarget = (button: LinkItem) => button.kind === 'copy' ? (button.copyText ?? '').trim() : button.url.trim()
export const isPostButtonComplete = (button: LinkItem) => Boolean(postButtonLabel(button) && postButtonTarget(button))
export const normalizePostButton = (button: LinkItem): LinkItem => {
  const label = postButtonInputLabel(button)
  return { ...button, label, buttonLabel: label, url: button.url ?? '', anchorText: button.anchorText ?? '', usage: button.usage ?? 'button', kind: button.kind ?? 'url', copyText: button.copyText ?? '', sameRow: button.sameRow === true }
}
export const createPostButton = (): LinkItem => ({ id: `btn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: '', buttonLabel: '', url: '', anchorText: '', usage: 'button', kind: 'url', copyText: '', sameRow: false })
export function groupPostButtonRows(buttons: LinkItem[]) {
  const rows: LinkItem[][] = []
  buttons.forEach(button => {
    if (!isPostButtonComplete(button)) return
    if (button.sameRow && rows.length) rows[rows.length - 1].push(button)
    else rows.push([button])
  })
  return rows
}

export function PostButtonsPreview({ buttons }: { buttons: LinkItem[] }) {
  const rows = groupPostButtonRows(buttons)
  if (!rows.length) return null
  return <div className="flex flex-col gap-1.5">{rows.map((row, ri) => <div key={ri} className="flex gap-1.5">{row.map(button => {
    const style = STYLES.find(item => item.value === button.style) ?? STYLES[0]
    return <div key={button.id} className={cn('flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-medium', style.preview)}>{button.kind === 'copy' && <Copy size={13} />}<span className="truncate">{postButtonLabel(button)}</span></div>
  })}</div>)}</div>
}

interface Props { buttons: LinkItem[]; onChange: (buttons: LinkItem[]) => void; allowAdd?: boolean; allowRemove?: boolean; firstCanJoinPrevious?: boolean; showPreview?: boolean; showErrors?: boolean; disabled?: boolean }
export function PostButtonsEditor({ buttons, onChange, allowAdd = true, allowRemove = true, firstCanJoinPrevious = false, showPreview = false, showErrors = false, disabled = false }: Props) {
  const { language } = useApp()
  const ru = language === 'ru'
  const labels = ru ? ['Обычная', 'Синяя', 'Зелёная', 'Красная'] : ['Default', 'Blue', 'Green', 'Red']
  const patch = (index: number, value: Partial<LinkItem>) => onChange(buttons.map((button, i) => i === index ? { ...button, ...value } : button))
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= buttons.length) return
    const next = [...buttons]; [next[index], next[target]] = [next[target], next[index]]
    if (target === 0 && !firstCanJoinPrevious) next[target] = { ...next[target], sameRow: false }
    onChange(next)
  }
  return <div className="space-y-3">
    {buttons.map((raw, index) => {
      const button = normalizePostButton(raw), missingLabel = showErrors && !postButtonLabel(button), missingTarget = showErrors && !postButtonTarget(button)
      return <div key={button.id} className="space-y-3 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3">
        <div className="flex min-h-11 items-center gap-1"><span className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-[#66666E]">{ru ? `Кнопка ${index + 1}` : `Button ${index + 1}`}</span>
          {buttons.length > 1 && <><IconButton disabled={disabled || index === 0} label={ru ? 'Поднять кнопку' : 'Move up'} onClick={() => move(index, -1)}><ArrowUp size={17} /></IconButton><IconButton disabled={disabled || index === buttons.length - 1} label={ru ? 'Опустить кнопку' : 'Move down'} onClick={() => move(index, 1)}><ArrowDown size={17} /></IconButton></>}
          {allowRemove && <IconButton disabled={disabled} label={ru ? 'Удалить кнопку' : 'Delete button'} danger onClick={() => onChange(buttons.filter((_, i) => i !== index))}><Trash2 size={17} /></IconButton>}
        </div>
        <Field label={ru ? 'Текст кнопки' : 'Button text'} error={missingLabel ? (ru ? 'Добавьте текст кнопки' : 'Add button text') : undefined}><input value={postButtonInputLabel(button)} disabled={disabled} onChange={e => patch(index, { label: e.target.value, buttonLabel: e.target.value })} placeholder={ru ? 'Например, открыть сайт' : 'For example, open website'} className={cn('glass-input min-h-11 w-full px-3 py-2.5 text-base', missingLabel && 'border-red-500/55')} /></Field>
        <div><Caption>{ru ? 'Действие' : 'Action'}</Caption><div className="grid grid-cols-2 gap-1 rounded-[12px] border border-white/[0.07] bg-black/15 p-1">{([['url', Link2, ru ? 'Открыть ссылку' : 'Open link'], ['copy', Copy, ru ? 'Копировать' : 'Copy text']] as const).map(([kind, Icon, text]) => <button type="button" key={kind} disabled={disabled} onClick={() => patch(index, { kind })} className={cn('flex min-h-11 items-center justify-center gap-2 rounded-[9px] px-2 text-[12px] font-semibold', button.kind === kind ? 'bg-[#FF6A00] text-white' : 'text-[#8B8B94] hover:bg-white/[0.04] hover:text-white')}><Icon size={15} />{text}</button>)}</div></div>
        <Field label={button.kind === 'copy' ? (ru ? 'Текст для копирования' : 'Text to copy') : (ru ? 'Ссылка' : 'Link')} error={missingTarget ? (ru ? 'Заполните действие кнопки' : 'Complete the button action') : undefined}>{button.kind === 'copy' ? <textarea value={button.copyText} disabled={disabled} rows={2} onChange={e => patch(index, { copyText: e.target.value })} placeholder={ru ? 'Текст, промокод или адрес кошелька' : 'Text, promo code or wallet address'} className={cn('glass-input min-h-20 w-full resize-none px-3 py-2.5 text-base', missingTarget && 'border-red-500/55')} /> : <input value={button.url} disabled={disabled} onChange={e => patch(index, { url: e.target.value })} placeholder="https://… или @channel" className={cn('glass-input min-h-11 w-full px-3 py-2.5 text-base', missingTarget && 'border-red-500/55')} />}</Field>
        <div><Caption>{ru ? 'Цвет' : 'Color'}</Caption><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{STYLES.map((style, i) => <button type="button" key={style.value ?? 'default'} disabled={disabled} onClick={() => patch(index, { style: style.value })} className={cn('flex min-h-11 items-center justify-center gap-2 rounded-[10px] border px-2 text-[12px] font-medium', button.style === style.value ? 'border-[#FF6A00]/55 bg-[#FF6A00]/10 text-white' : 'border-white/[0.07] bg-white/[0.03] text-[#8B8B94]')}><span className={cn('size-2.5 rounded-full', style.dot)} />{labels[i]}</button>)}</div></div>
        {(index > 0 || firstCanJoinPrevious) && <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 text-[13px] text-[#A1A1AA]"><input type="checkbox" checked={button.sameRow} disabled={disabled} onChange={e => patch(index, { sameRow: e.target.checked })} className="size-4 accent-[#FF6A00]" />{ru ? 'В один ряд с предыдущей кнопкой' : 'Same row as previous button'}</label>}
      </div>
    })}
    {allowAdd && <button type="button" disabled={disabled} onClick={() => onChange([...buttons, createPostButton()])} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[11px] border border-dashed border-white/[0.14] text-[13px] font-medium text-[#A1A1AA] hover:border-[#FF6A00]/45 hover:text-[#FF6A00]"><Plus size={16} />{ru ? 'Добавить кнопку' : 'Add button'}</button>}
    {showPreview && groupPostButtonRows(buttons).length > 0 && <div className="space-y-2 rounded-[14px] border border-white/[0.07] bg-black/15 p-3"><Caption>{ru ? 'Предпросмотр' : 'Preview'}</Caption><PostButtonsPreview buttons={buttons} /></div>}
  </div>
}
function Caption({ children }: { children: React.ReactNode }) { return <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[#66666E]">{children}</p> }
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <div><Caption>{label}</Caption>{children}{error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}</div> }
function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) { return <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className={cn('flex size-11 items-center justify-center rounded-[10px] text-[#777780] hover:bg-white/[0.06] hover:text-white disabled:opacity-25', danger && 'hover:bg-red-500/10 hover:text-red-400')}>{children}</button> }