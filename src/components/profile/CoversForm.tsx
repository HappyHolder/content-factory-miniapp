import { useState } from 'react'
import { Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { OptionPills } from '@/components/ui/OptionPills'
import { useApp } from '@/context/AppContext'
import type { VisualKit, BannerTemplate, CoverAspectRatio, LogoUsage } from '@/types'
import { cn } from '@/lib/utils'

interface CoversFormProps {
  channelId: string
  initialData: VisualKit
}

const PRIMARY_PRESETS = ['#FF6A00', '#FF4500', '#FF8C00', '#FFA500', '#E040FB', '#2196F3']
const SECONDARY_PRESETS = ['#1A0A00', '#0D1117', '#111114', '#1A1A2E', '#0F0F23', '#181818']

export function CoversForm({ channelId, initialData }: CoversFormProps) {
  const { updateBrandKit, t } = useApp()
  const [data, setData] = useState<VisualKit>(initialData)
  const [refInput,   setRefInput]   = useState('')
  const [avoidInput, setAvoidInput] = useState('')

  const set = <K extends keyof VisualKit>(key: K, val: VisualKit[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  const addRef = () => {
    const val = refInput.trim()
    if (val) {
      set('references', [...(data.references ?? []), val])
      setRefInput('')
    }
  }
  const removeRef = (i: number) =>
    set('references', (data.references ?? []).filter((_, idx) => idx !== i))

  const addAvoid = () => {
    const val = avoidInput.trim()
    if (val && !(data.avoidList ?? []).includes(val)) {
      set('avoidList', [...(data.avoidList ?? []), val])
      setAvoidInput('')
    }
  }
  const removeAvoid = (v: string) =>
    set('avoidList', (data.avoidList ?? []).filter(x => x !== v))

  return (
    <div className="space-y-5">

      {/* Brand colors */}
      <div>
        <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider mb-3">
          {t('channelStyle.covers.colors')}
        </p>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
              {t('channelStyle.covers.primaryColor')}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {PRIMARY_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => set('primaryColor', c)}
                  className={cn(
                    'w-8 h-8 rounded-full border-2 transition-all duration-150',
                    data.primaryColor === c ? 'border-white scale-110' : 'border-transparent'
                  )}
                  style={{ background: c }}
                />
              ))}
              <div className="flex items-center gap-2 ml-1">
                <input
                  type="color"
                  value={data.primaryColor}
                  onChange={e => set('primaryColor', e.target.value)}
                  className="w-8 h-8 rounded-full cursor-pointer bg-transparent border-0 p-0"
                />
                <span className="text-sm text-[#A1A1AA] font-mono">{data.primaryColor}</span>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
              {t('channelStyle.covers.secondaryColor')}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {SECONDARY_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => set('secondaryColor', c)}
                  className={cn(
                    'w-8 h-8 rounded-full border-2 transition-all duration-150',
                    data.secondaryColor === c ? 'border-white scale-110' : 'border-transparent'
                  )}
                  style={{ background: c }}
                />
              ))}
              <div className="flex items-center gap-2 ml-1">
                <input
                  type="color"
                  value={data.secondaryColor ?? '#111114'}
                  onChange={e => set('secondaryColor', e.target.value)}
                  className="w-8 h-8 rounded-full cursor-pointer bg-transparent border-0 p-0"
                />
                <span className="text-sm text-[#A1A1AA] font-mono">{data.secondaryColor ?? '#111114'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Logo */}
      <div>
        <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider mb-3">
          {t('channelStyle.covers.logo')}
        </p>
        <div className="flex items-center gap-3 p-3 rounded-[14px] bg-white/[0.03] border border-white/[0.06] border-dashed mb-3">
          <div className="w-12 h-12 rounded-[10px] bg-white/[0.06] flex items-center justify-center shrink-0">
            {data.logoUrl
              ? <img src={data.logoUrl} alt="logo" className="w-full h-full object-cover rounded-[10px]" />
              : <Upload size={18} className="text-[#55555D]" />
            }
          </div>
          <div>
            <p className="text-sm text-[#A1A1AA]">{t('channelStyle.covers.uploadLogo')}</p>
            <p className="text-[11px] text-[#55555D]">{t('channelStyle.covers.logoHint')}</p>
          </div>
        </div>

        <OptionPills<LogoUsage>
          label={t('channelStyle.covers.logoUsage')}
          value={data.logoUsage ?? 'when_relevant'}
          onChange={v => set('logoUsage', v)}
          options={[
            { value: 'always',        label: t('channelStyle.covers.logoAlways')       },
            { value: 'when_relevant', label: t('channelStyle.covers.logoWhenRelevant') },
            { value: 'never',         label: t('channelStyle.covers.logoNever')        },
          ]}
        />
      </div>

      {/* Watermark */}
      <Switch
        label={t('channelStyle.covers.watermark')}
        description={t('channelStyle.covers.watermarkDesc')}
        value={data.watermark}
        onChange={v => set('watermark', v)}
      />

      {/* Cover style */}
      <OptionPills<BannerTemplate>
        label={t('channelStyle.covers.coverStyle')}
        value={data.bannerTemplate}
        onChange={v => set('bannerTemplate', v)}
        options={[
          { value: 'dark_glass', label: t('channelStyle.covers.styleDarkGlass') },
          { value: 'minimal',    label: t('channelStyle.covers.styleMinimal')   },
          { value: 'branded',    label: t('channelStyle.covers.styleBranded')   },
          { value: 'news',       label: t('channelStyle.covers.styleNews')      },
        ]}
      />

      {/* Aspect ratio */}
      <OptionPills<CoverAspectRatio>
        label={t('channelStyle.covers.aspectRatio')}
        value={data.aspectRatio ?? '16:9'}
        onChange={v => set('aspectRatio', v)}
        options={[
          { value: '16:9', label: t('channelStyle.covers.ratio16x9') },
          { value: '4:5',  label: t('channelStyle.covers.ratio4x5')  },
          { value: '1:1',  label: t('channelStyle.covers.ratio1x1')  },
          { value: '9:16', label: t('channelStyle.covers.ratio9x16') },
        ]}
      />

      {/* Text on cover */}
      <Switch
        label={t('channelStyle.covers.textOnCover')}
        description={t('channelStyle.covers.textOnCoverDesc')}
        value={data.textOnCover ?? true}
        onChange={v => set('textOnCover', v)}
      />

      {/* Style references */}
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1">
          {t('channelStyle.covers.references')}
        </p>
        <p className="text-[11px] text-[#55555D] mb-2">{t('channelStyle.covers.referencesHint')}</p>
        {(data.references ?? []).length > 0 && (
          <div className="space-y-1.5 mb-2">
            {(data.references ?? []).map((ref, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-white/[0.03] border border-white/[0.05]">
                <span className="flex-1 text-[12px] text-[#A1A1AA] truncate">{ref}</span>
                <button onClick={() => removeRef(i)} className="text-[#55555D] hover:text-red-400 transition-colors shrink-0">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={refInput}
            onChange={e => setRefInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addRef()}
            placeholder={t('channelStyle.covers.referenceAdd')}
            className="glass-input flex-1 px-3 py-2 text-sm"
          />
          <Button variant="secondary" size="sm" onClick={addRef}>+</Button>
        </div>
      </div>

      {/* What to avoid */}
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1">
          {t('channelStyle.covers.avoidList')}
        </p>
        <p className="text-[11px] text-[#55555D] mb-2">{t('channelStyle.covers.avoidListHint')}</p>
        {(data.avoidList ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(data.avoidList ?? []).map(item => (
              <span
                key={item}
                className="flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[12px] text-[#A1A1AA]"
              >
                {item}
                <button onClick={() => removeAvoid(item)} className="text-[#55555D] hover:text-white transition-colors">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={avoidInput}
            onChange={e => setAvoidInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addAvoid()}
            placeholder={t('channelStyle.covers.avoidAdd')}
            className="glass-input flex-1 px-3 py-2 text-sm"
          />
          <Button variant="secondary" size="sm" onClick={addAvoid}>+</Button>
        </div>
      </div>

      <Button variant="primary" size="md" onClick={() => updateBrandKit(channelId, { visualKit: data })} fullWidth>
        {t('channelStyle.save.covers')}
      </Button>
    </div>
  )
}
