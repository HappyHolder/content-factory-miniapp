import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CalendarX, ChevronLeft, ChevronRight, Loader2, Minus, Plus } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import { cn } from '@/lib/utils'

interface ScheduleSheetProps {
  open: boolean
  onClose: () => void
  onSchedule: (date: Date) => Promise<boolean>
  onCancelSchedule?: () => Promise<boolean>
  initialDate?: Date
  channelTitle?: string
  isScheduled?: boolean
}

interface CalendarValue { year: number; month: number; day: number; hour: number; minute: number }
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
const QUICK_TIMES = [[9, 0], [12, 0], [18, 0], [21, 0]] as const

function dateToMsk(date: Date): CalendarValue {
  const shifted = new Date(date.getTime() + MSK_OFFSET_MS)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate(), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() }
}
function mskToDate(v: CalendarValue) { return new Date(Date.UTC(v.year, v.month, v.day, v.hour, v.minute) - MSK_OFFSET_MS) }
function initialValue(date?: Date): CalendarValue {
  if (date && date.getTime() > Date.now()) return dateToMsk(date)
  const next = new Date(Date.now() + 30 * 60_000)
  next.setMinutes(Math.ceil(next.getMinutes() / 5) * 5, 0, 0)
  return dateToMsk(next)
}
function addDays(v: CalendarValue, days: number): CalendarValue {
  const d = new Date(Date.UTC(v.year, v.month, v.day + days))
  return { ...v, year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() }
}
function sameDay(a: CalendarValue, b: CalendarValue) { return a.year === b.year && a.month === b.month && a.day === b.day }

export function ScheduleSheet({ open, onClose, onSchedule, onCancelSchedule, initialDate, channelTitle, isScheduled = false }: ScheduleSheetProps) {
  const { t, language } = useApp()
  const [value, setValue] = useState<CalendarValue>(() => initialValue(initialDate))
  const [shown, setShown] = useState(() => { const v = initialValue(initialDate); return { year: v.year, month: v.month } })
  const [busy, setBusy] = useState<'save' | 'cancel' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const v = initialValue(initialDate)
    setValue(v); setShown({ year: v.year, month: v.month }); setBusy(null); setError('')
  }, [open, initialDate])

  const locale = language === 'ru' ? 'ru-RU' : 'en-US'
  const now = dateToMsk(new Date())
  const mondayOffset = ((8 - new Date(Date.UTC(now.year, now.month, now.day)).getUTCDay()) % 7) || 7
  const presets = [{ label: t('schedule.today'), date: now }, { label: t('schedule.tomorrow'), date: addDays(now, 1) }, { label: t('schedule.nextMonday'), date: addDays(now, mondayOffset) }]
  const selectedDate = mskToDate(value)
  const valid = selectedDate.getTime() >= Date.now() + 60_000
  const monthLabel = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(shown.year, shown.month, 1))), [locale, shown])
  const summary = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(selectedDate), [locale, selectedDate])
  const leading = (new Date(Date.UTC(shown.year, shown.month, 1)).getUTCDay() + 6) % 7
  const count = new Date(Date.UTC(shown.year, shown.month + 1, 0)).getUTCDate()
  const cells: (number | null)[] = [...Array(leading).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  const weekDays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, i + 1))).replace('.', ''))

  const chooseDay = (v: CalendarValue) => { setValue(old => ({ ...old, year: v.year, month: v.month, day: v.day })); setShown({ year: v.year, month: v.month }); setError('') }
  const moveMonth = (delta: number) => { const d = new Date(Date.UTC(shown.year, shown.month + delta, 1)); setShown({ year: d.getUTCFullYear(), month: d.getUTCMonth() }) }
  const stepTime = (part: 'hour' | 'minute', delta: number) => {
    setValue(old => {
      if (part === 'hour') return { ...old, hour: (old.hour + delta + 24) % 24 }
      const total = (old.hour * 60 + old.minute + delta * 5 + 1440) % 1440
      return { ...old, hour: Math.floor(total / 60), minute: total % 60 }
    }); setError('')
  }
  const save = async () => {
    if (!valid || busy) { setError(t('schedule.futureError')); return }
    setBusy('save'); setError('')
    const ok = await onSchedule(selectedDate)
    setBusy(null)
    if (ok) onClose(); else setError(t('schedule.saveError'))
  }
  const cancel = async () => {
    if (!onCancelSchedule || busy) return
    setBusy('cancel'); setError('')
    const ok = await onCancelSchedule()
    setBusy(null)
    if (ok) onClose(); else setError(t('schedule.cancelError'))
  }

  const iconButton = 'flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-[#A1A1AA] transition-colors hover:bg-white/[.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]'
  const chip = 'min-h-11 cursor-pointer rounded-[12px] border px-2 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]'
  const selectedChip = 'border-[rgba(255,106,0,.48)] bg-[rgba(255,106,0,.12)] text-[#FF7A1A]'
  const idleChip = 'border-white/[.08] bg-white/[.035] text-[#B4B4BD] hover:bg-white/[.06]'

  return <Sheet open={open} onClose={busy ? () => undefined : onClose} title={isScheduled ? t('schedule.changeTitle') : t('schedule.title')} height="80" className="max-h-[min(90dvh,760px)]">
    <div className="space-y-5 pt-1">
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.12em] text-[#777780]">{t('schedule.quickChoice')}</p>
        <div className="grid grid-cols-3 gap-2">{presets.map(p => <button type="button" key={p.label} disabled={!!busy} onClick={() => chooseDay(p.date)} className={cn(chip, sameDay(value, p.date) ? selectedChip : idleChip)}>{p.label}</button>)}</div>
      </section>

      <section className="rounded-[18px] border border-white/[.08] bg-white/[.025] p-3">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" aria-label={t('schedule.previousMonth')} disabled={!!busy} onClick={() => moveMonth(-1)} className={iconButton}><ChevronLeft size={19} /></button>
          <p className="text-[15px] font-semibold capitalize text-white">{monthLabel}</p>
          <button type="button" aria-label={t('schedule.nextMonth')} disabled={!!busy} onClick={() => moveMonth(1)} className={iconButton}><ChevronRight size={19} /></button>
        </div>
        <div className="grid grid-cols-7">
          {weekDays.map(d => <div key={d} className="flex h-8 items-center justify-center text-[11px] font-medium text-[#66666E]">{d}</div>)}
          {cells.map((day, i) => {
            if (!day) return <div key={`e${i}`} className="h-11" />
            const candidate = { ...value, year: shown.year, month: shown.month, day }
            const disabled = Date.UTC(candidate.year, candidate.month, candidate.day) < Date.UTC(now.year, now.month, now.day)
            const selected = sameDay(value, candidate), today = sameDay(now, candidate)
            return <button type="button" key={day} disabled={disabled || !!busy} onClick={() => chooseDay(candidate)} aria-current={today ? 'date' : undefined} aria-pressed={selected} className={cn('mx-auto flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]', selected && 'bg-[#FF6A00] font-semibold text-white', !selected && today && 'border border-[rgba(255,106,0,.45)] text-[#FF7A1A]', !selected && !today && !disabled && 'text-[#D4D4D8] hover:bg-white/[.06]', disabled && 'cursor-not-allowed text-[#3F3F46]')}>{day}</button>
          })}
        </div>
      </section>

      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.12em] text-[#777780]">{t('schedule.time')}</p>
        <div className="grid grid-cols-4 gap-2">{QUICK_TIMES.map(([h, m]) => <button type="button" key={h} disabled={!!busy} onClick={() => { setValue(v => ({ ...v, hour: h, minute: m })); setError('') }} className={cn(chip, 'tabular-nums', value.hour === h && value.minute === m ? selectedChip : idleChip)}>{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}</button>)}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">{([{ part: 'hour' as const, label: t('schedule.hours'), display: value.hour }, { part: 'minute' as const, label: t('schedule.minutes'), display: value.minute }]).map(c => <div key={c.part} className="rounded-[14px] border border-white/[.08] bg-white/[.025] p-2">
          <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wide text-[#66666E]">{c.label}</p>
          <div className="flex items-center justify-between"><button type="button" aria-label={`${t('schedule.decrease')} ${c.label}`} disabled={!!busy} onClick={() => stepTime(c.part, -1)} className={cn(iconButton, 'rounded-[11px] bg-white/[.05]')}><Minus size={17} /></button><span className="text-xl font-semibold tabular-nums text-white">{String(c.display).padStart(2, '0')}</span><button type="button" aria-label={`${t('schedule.increase')} ${c.label}`} disabled={!!busy} onClick={() => stepTime(c.part, 1)} className={cn(iconButton, 'rounded-[11px] bg-white/[.05]')}><Plus size={17} /></button></div>
        </div>)}</div>
      </section>

      <div className="flex gap-3 rounded-[16px] border border-[rgba(255,106,0,.18)] bg-[rgba(255,106,0,.055)] p-3.5"><CalendarClock size={19} className="mt-0.5 shrink-0 text-[#FF6A00]" /><div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-wide text-[#8B8B94]">{isScheduled ? t('schedule.willBeMoved') : t('schedule.willBePublished')}</p><p className="mt-1 text-[15px] font-semibold capitalize leading-snug text-white">{summary}</p><p className="mt-1 truncate text-xs text-[#777780]">{channelTitle ? `${channelTitle} \u00B7 ` : ''}{t('schedule.moscowTime')}</p></div></div>
      {(!valid || error) && <p role="alert" className="rounded-[12px] border border-red-500/20 bg-red-500/[.07] px-3 py-2.5 text-sm leading-snug text-red-300">{error || t('schedule.futureError')}</p>}
      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-white/[.06] bg-[#0E0E10]/95 px-4 pb-[calc(.25rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        <Button variant="primary" size="lg" onClick={save} disabled={!valid || !!busy} fullWidth>{busy === 'save' ? <><Loader2 size={17} className="animate-spin" />{t('common.loading')}</> : (isScheduled ? t('schedule.saveNewTime') : t('schedule.schedule'))}</Button>
        {isScheduled && onCancelSchedule && <button type="button" onClick={cancel} disabled={!!busy} className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[12px] text-sm font-semibold text-[#A1A1AA] transition-colors hover:bg-white/[.04] hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00] disabled:opacity-50">{busy === 'cancel' ? <Loader2 size={16} className="animate-spin" /> : <CalendarX size={16} />}{t('schedule.cancelSchedule')}</button>}
      </div>
    </div>
  </Sheet>
}
