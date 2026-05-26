import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
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
              'px-3 py-1 rounded-full text-[12px] font-medium border transition-all duration-150',
              value === opt.value
                ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border-[rgba(255,106,0,0.38)]'
                : 'bg-white/5 text-[#A1A1AA] border-white/[0.06] hover:bg-white/8'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}


export function VisualKitForm({ channelId, initialData }: VisualKitFormProps) {
  const { updateBrandKit, t } = useApp()
  const [data, setData] = useState<VisualKit>(initialData)

  const set = <K extends keyof VisualKit>(key: K, val: VisualKit[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  const ORANGE_PRESETS = ['#FF6A00', '#FF4500', '#FF8C00', '#FFA500']

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
          {t('channelStyle.visual.brandColor')}
        </p>
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
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
          {t('channelStyle.visual.logo')}
        </p>
        <div className="flex items-center gap-3 p-3 rounded-[14px] bg-white/[0.03] border border-white/[0.06] border-dashed">
          <div className="w-12 h-12 rounded-[10px] bg-white/8 flex items-center justify-center">
            {data.logoUrl
              ? <img src={data.logoUrl} alt="logo" className="w-full h-full object-cover rounded-[10px]" />
              : <Upload size={18} className="text-[#66666E]" />
            }
          </div>
          <div>
            <p className="text-sm text-[#A1A1AA]">{t('channelStyle.visual.uploadLogo')}</p>
            <p className="text-[11px] text-[#66666E]">{t('channelStyle.visual.logoHint')}</p>
          </div>
        </div>
      </div>

      <OptionPills<VisualKit['backgroundStyle']>
        label={t('channelStyle.visual.backgroundStyle')}
        options={[
          { value: 'dark',     label: t('channelStyle.visual.bgDark')     },
          { value: 'glass',    label: t('channelStyle.visual.bgGlass')    },
          { value: 'gradient', label: t('channelStyle.visual.bgGradient') },
        ]}
        value={data.backgroundStyle}
        onChange={v => set('backgroundStyle', v)}
      />

      <OptionPills<VisualKit['cardStyle']>
        label={t('channelStyle.visual.cardStyle')}
        options={[
          { value: 'minimal', label: t('channelStyle.visual.cardMinimal') },
          { value: 'branded', label: t('channelStyle.visual.cardBranded') },
          { value: 'bold',    label: t('channelStyle.visual.cardBold')    },
        ]}
        value={data.cardStyle}
        onChange={v => set('cardStyle', v)}
      />

      <OptionPills<BannerTemplate>
        label={t('channelStyle.visual.visualTemplate')}
        options={[
          { value: 'dark_glass', label: t('channelStyle.visual.tplDarkGlass') },
          { value: 'minimal',    label: t('channelStyle.visual.tplMinimal')   },
          { value: 'branded',    label: t('channelStyle.visual.tplBranded')   },
          { value: 'news',       label: t('channelStyle.visual.tplNews')      },
        ]}
        value={data.bannerTemplate}
        onChange={v => set('bannerTemplate', v)}
      />

      <Switch
        label={t('channelStyle.visual.watermark')}
        description={t('channelStyle.visual.watermarkDesc')}
        value={data.watermark}
        onChange={v => set('watermark', v)}
      />

      <Button variant="primary" size="md" onClick={() => updateBrandKit(channelId, { visualKit: data })} fullWidth>
        {t('channelStyle.save.visual')}
      </Button>
    </div>
  )
}
