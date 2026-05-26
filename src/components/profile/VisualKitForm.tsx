import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import type { VisualKit, BannerTemplate } from '@/types'
import { cn } from '@/lib/utils'

interface VisualKitFormProps {
  channelId: string
  initialData: VisualKit
}

function OptionPills<T extends string>({ label, options, value, onChange }: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div>
      <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all duration-150',
              value === opt.value
                ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border-[rgba(255,106,0,0.38)]'
                : 'bg-white/5 text-[#A1A1AA] border-white/8 hover:bg-white/8'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({ label, description, value, onChange }: {
  label: string; description?: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-[12px] text-[#66666E] mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn('relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 mt-0.5', value ? 'bg-[#FF6A00]' : 'bg-white/12')}
      >
        <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200', value ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    </div>
  )
}

export function VisualKitForm({ channelId, initialData }: VisualKitFormProps) {
  const { updateBrandKit } = useApp()
  const [data, setData] = useState<VisualKit>(initialData)

  const set = <K extends keyof VisualKit>(key: K, val: VisualKit[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  const ORANGE_PRESETS = ['#FF6A00', '#FF4500', '#FF8C00', '#FFA500']

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">Brand color</p>
        <div className="flex items-center gap-3">
          {ORANGE_PRESETS.map(c => (
            <button
              key={c}
              onClick={() => set('primaryColor', c)}
              className={cn(
                'w-9 h-9 rounded-full border-2 transition-all duration-150',
                data.primaryColor === c ? 'border-white scale-110' : 'border-transparent'
              )}
              style={{ background: c }}
            />
          ))}
          <div className="flex-1 flex items-center gap-2">
            <input
              type="color"
              value={data.primaryColor}
              onChange={e => set('primaryColor', e.target.value)}
              className="w-9 h-9 rounded-full cursor-pointer bg-transparent border-0 p-0"
            />
            <span className="text-sm text-[#A1A1AA] font-mono">{data.primaryColor}</span>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">Logo</p>
        <div className="flex items-center gap-3 p-3 rounded-[14px] bg-white/4 border border-white/8 border-dashed">
          <div className="w-12 h-12 rounded-[10px] bg-white/8 flex items-center justify-center">
            {data.logoUrl
              ? <img src={data.logoUrl} alt="logo" className="w-full h-full object-cover rounded-[10px]" />
              : <Upload size={18} className="text-[#66666E]" />
            }
          </div>
          <div>
            <p className="text-sm text-[#A1A1AA]">Upload logo</p>
            <p className="text-[11px] text-[#66666E]">PNG, SVG · appears on banners</p>
          </div>
        </div>
      </div>

      <OptionPills<VisualKit['backgroundStyle']>
        label="Background style"
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'glass', label: 'Glass' },
          { value: 'gradient', label: 'Gradient' },
        ]}
        value={data.backgroundStyle}
        onChange={v => set('backgroundStyle', v)}
      />

      <OptionPills<VisualKit['cardStyle']>
        label="Card style"
        options={[
          { value: 'minimal', label: 'Minimal' },
          { value: 'branded', label: 'Branded' },
          { value: 'bold', label: 'Bold' },
        ]}
        value={data.cardStyle}
        onChange={v => set('cardStyle', v)}
      />

      <OptionPills<BannerTemplate>
        label="Banner template"
        options={[
          { value: 'dark_glass', label: 'Dark Glass' },
          { value: 'minimal', label: 'Minimal' },
          { value: 'branded', label: 'Branded' },
          { value: 'news', label: 'News' },
        ]}
        value={data.bannerTemplate}
        onChange={v => set('bannerTemplate', v)}
      />

      <Toggle
        label="Watermark"
        description="Add 'CF' watermark to generated banners"
        value={data.watermark}
        onChange={v => set('watermark', v)}
      />

      <Button variant="primary" size="md" onClick={() => updateBrandKit(channelId, { visualKit: data })} fullWidth>
        Save Visual Kit
      </Button>
    </div>
  )
}
