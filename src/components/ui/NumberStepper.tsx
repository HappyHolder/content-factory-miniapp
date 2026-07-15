import { Minus, Plus } from 'lucide-react'

interface NumberStepperProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  ariaLabel?: string
}

/**
 * Touch-friendly numeric control: − [value] + with big tap targets.
 * The middle stays typable (numeric keyboard) for large jumps, while the
 * buttons handle the common small adjustments that are painful on mobile.
 */
export function NumberStepper({ value, onChange, min = 0, max = 999, step = 1, suffix, ariaLabel }: NumberStepperProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n))
  const set = (n: number) => onChange(clamp(Number.isFinite(n) ? n : min))

  return (
    <div className="mt-1.5 flex items-center gap-1 rounded-[11px] border border-white/[0.08] bg-[#0B0B0D] p-1">
      <button
        type="button"
        aria-label="Уменьшить"
        onClick={() => set(value - step)}
        disabled={value <= min}
        className="flex h-9 w-11 shrink-0 items-center justify-center rounded-[8px] text-[#A1A1AA] transition active:scale-90 hover:bg-white/[0.06] disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]"
      >
        <Minus size={16} />
      </button>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={ariaLabel}
        value={value}
        onChange={e => { const n = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10); set(Number.isNaN(n) ? min : n) }}
        className="min-w-0 flex-1 bg-transparent text-center text-[15px] font-semibold tabular-nums text-white outline-none"
      />
      {suffix && <span className="pointer-events-none pr-1 text-[11px] text-[#66666E]">{suffix}</span>}
      <button
        type="button"
        aria-label="Увеличить"
        onClick={() => set(value + step)}
        disabled={value >= max}
        className="flex h-9 w-11 shrink-0 items-center justify-center rounded-[8px] text-[#A1A1AA] transition active:scale-90 hover:bg-white/[0.06] disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
