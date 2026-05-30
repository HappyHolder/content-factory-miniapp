import { useState, useRef } from 'react'
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { OptionPills } from '@/components/ui/OptionPills'
import { useApp } from '@/context/AppContext'
import type { VisualKit, BannerTemplate, CoverAspectRatio, LogoUsage } from '@/types'
import { cn } from '@/lib/utils'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'

interface CoversFormProps {
  channelId: string
  initialData: VisualKit
}

const PRIMARY_PRESETS = ['#FF6A00', '#FF4500', '#FF8C00', '#FFA500', '#E040FB', '#2196F3']
const SECONDARY_PRESETS = ['#1A0A00', '#0D1117', '#111114', '#1A1A2E', '#0F0F23', '#181818']

/** Returns true when a string looks like a direct image URL. */
function isImageUrl(s: string): boolean {
  try {
    const url = new URL(s)
    return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(url.pathname)
  } catch {
    return false
  }
}

export function CoversForm({ channelId, initialData }: CoversFormProps) {
  const { updateBrandKit, showToast, authStatus, t } = useApp()
  const [data, setData] = useState<VisualKit>(initialData)
  const [refInput,   setRefInput]   = useState('')
  const [avoidInput, setAvoidInput] = useState('')
  const [isUploadingLogo, setIsUploadingLogo]   = useState(false)
  const [isUploadingRef,  setIsUploadingRef]    = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const refInputRef  = useRef<HTMLInputElement>(null)

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

  const uploadAsset = async (file: File, assetType: 'logo' | 'reference') => {
    const initData = getTelegramInitData()
    if (!initData) {
      showToast(t('channelStyle.covers.uploadFailed'), 'error')
      return
    }

    const isLogo = assetType === 'logo'
    isLogo ? setIsUploadingLogo(true) : setIsUploadingRef(true)

    try {
      const form = new FormData()
      form.append('initData', initData)
      form.append('channelId', channelId)
      form.append('assetType', assetType)
      form.append('file', file)

      const res = await fetch(`${API_BASE}/api/brandkits/upload-asset`, {
        method: 'POST',
        body:   form,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        showToast(err.error ?? t('channelStyle.covers.uploadFailed'), 'error')
        return
      }

      const { url } = await res.json() as { url: string }

      if (isLogo) {
        set('logoUrl', url)
      } else {
        set('references', [...(data.references ?? []), url])
      }
      showToast(t('channelStyle.covers.uploadDone'))
    } catch {
      showToast(t('channelStyle.covers.uploadFailed'), 'error')
    } finally {
      isLogo ? setIsUploadingLogo(false) : setIsUploadingRef(false)
    }
  }

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

        {/* Hidden file input — triggered by the Upload button */}
        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) uploadAsset(file, 'logo')
            e.target.value = ''   // reset so the same file can be re-selected
          }}
        />

        <div className="flex items-center gap-3 p-3 rounded-[14px] bg-white/[0.03] border border-white/[0.06] border-dashed mb-3">
          <div className="w-12 h-12 rounded-[10px] bg-white/[0.06] flex items-center justify-center shrink-0 overflow-hidden">
            {data.logoUrl
              ? <img src={data.logoUrl} alt="logo" className="w-full h-full object-cover" />
              : isUploadingLogo
                ? <Loader2 size={18} className="text-[#FF6A00] animate-spin" />
                : <Upload size={18} className="text-[#55555D]" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#A1A1AA]">
              {data.logoUrl ? data.logoUrl.split('/').pop()?.slice(0, 30) : t('channelStyle.covers.uploadLogo')}
            </p>
            <p className="text-[11px] text-[#55555D]">{t('channelStyle.covers.logoHint')}</p>
          </div>
        </div>

        <div className="flex gap-2 mb-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => logoInputRef.current?.click()}
            disabled={isUploadingLogo || authStatus !== 'authenticated'}
            className="flex-1"
          >
            {isUploadingLogo
              ? <><Loader2 size={12} className="animate-spin" />{t('channelStyle.covers.uploading')}</>
              : <><Upload size={12} />{t('channelStyle.covers.uploadLogo')}</>
            }
          </Button>
          {data.logoUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set('logoUrl', undefined)}
            >
              <X size={12} /> {t('channelStyle.covers.removeLogo')}
            </Button>
          )}
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

        {/* Hidden file input for reference image upload */}
        <input
          ref={refInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) uploadAsset(file, 'reference')
            e.target.value = ''
          }}
        />

        {(data.references ?? []).length > 0 && (
          <div className="space-y-1.5 mb-2">
            {(data.references ?? []).map((ref, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-[10px] bg-white/[0.03] border border-white/[0.05]">
                {isImageUrl(ref) ? (
                  <img
                    src={ref}
                    alt={`ref-${i}`}
                    className="w-8 h-8 rounded-[6px] object-cover shrink-0 bg-white/[0.05]"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <ImageIcon size={14} className="text-[#55555D] shrink-0" />
                )}
                <span className="flex-1 text-[12px] text-[#A1A1AA] truncate">{ref}</span>
                <button onClick={() => removeRef(i)} className="text-[#55555D] hover:text-red-400 transition-colors shrink-0">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Text URL input */}
        <div className="flex gap-2 mb-2">
          <input
            value={refInput}
            onChange={e => setRefInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addRef()}
            placeholder={t('channelStyle.covers.referenceAdd')}
            className="glass-input flex-1 px-3 py-2 text-sm"
          />
          <Button variant="secondary" size="sm" onClick={addRef}>+</Button>
        </div>

        {/* Image upload button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refInputRef.current?.click()}
          disabled={isUploadingRef || authStatus !== 'authenticated'}
          fullWidth
        >
          {isUploadingRef
            ? <><Loader2 size={12} className="animate-spin" />{t('channelStyle.covers.uploading')}</>
            : <><Upload size={12} />{t('channelStyle.covers.uploadReference')}</>
          }
        </Button>
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
