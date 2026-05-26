import { cn } from '@/lib/utils'

interface SwitchProps {
  label: string
  description?: string
  value: boolean
  onChange: (v: boolean) => void
}

export function Switch({ label, description, value, onChange }: SwitchProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{label}</p>
        {description && (
          <p className="text-[12px] text-[#66666E] mt-0.5">{description}</p>
        )}
      </div>
      <button
        onClick={() => onChange(!value)}
        aria-checked={value}
        role="switch"
        className={cn(
          'relative inline-flex h-5 min-h-0 w-9 shrink-0 items-center rounded-full',
          'transition-colors duration-200 ml-3',
          value ? 'bg-[#FF6A00]' : 'bg-[#3A3A3F]'
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm',
            'transition-transform duration-200',
            value ? 'translate-x-4' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  )
}
