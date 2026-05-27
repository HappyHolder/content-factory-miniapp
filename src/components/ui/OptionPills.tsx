import { cn } from '@/lib/utils'

interface PillOption<T extends string> {
  value: T
  label: string
}

interface OptionPillsProps<T extends string> {
  label?: string
  options: PillOption<T>[]
  value: T
  onChange: (v: T) => void
}

export function OptionPills<T extends string>({ label, options, value, onChange }: OptionPillsProps<T>) {
  return (
    <div>
      {label && (
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">{label}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3 py-1 rounded-full text-[12px] font-medium border transition-all duration-150',
              value === opt.value
                ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border-[rgba(255,106,0,0.38)]'
                : 'bg-white/5 text-[#A1A1AA] border-white/[0.06] hover:bg-white/[0.08]'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
