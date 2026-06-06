import { useState, useRef } from 'react'
import { Upload, X, Loader2, Image as ImageIcon, FileCode } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { OptionPills } from '@/components/ui/OptionPills'
import { useApp } from '@/context/AppContext'
import type { VisualKit, ReferenceItem, BrandColor, BannerTemplate, CoverAspectRatio, LogoUsage } from '@/types'
import { cn } from '@/lib/utils'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'

interface CoversFormProps {
  channelId: string
  initialData: VisualKit
}

/** Returns true when a string looks like a direct image URL. */
function isImageUrl(s: string): boolean {
  try {
    const url = new URL(s)
    return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(url.pathname)
  } catch {
    return false
  }
}

/** Returns true for #ABC or #AABBCC hex strings. */
function isValidHex(s: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(s)
}

/** Derives initial brand color tokens from legacy primaryColor / secondaryColor. */
function deriveInitialBrandColors(vk: VisualKit, isRu: boolean): BrandColor[] {
  const tokens: BrandColor[] = []
  if (vk.primaryColor) {
    tokens.push({
      name:  isRu ? 'Акцент'    : 'Accent',
      hex:   vk.primaryColor,
      usage: isRu ? 'Основной акцентный цвет' : 'Main accent color',
    })
  }
  if (vk.secondaryColor) {
    tokens.push({
      name:  isRu ? 'Вторичный' : 'Secondary',
      hex:   vk.secondaryColor,
      usage: isRu ? 'Вторичный цвет бренда' : 'Secondary brand color',
    })
  }
  return tokens
}

export function CoversForm({ channelId, initialData }: CoversFormProps) {
  const { updateBrandKit, showToast, authStatus, language, t } = useApp()

  // On first render, if brandColors is absent, seed from legacy primaryColor/secondaryColor.
  const [data, setData] = useState<VisualKit>(() => {
    if (initialData.brandColors && initialData.brandColors.length > 0) return initialData
    const derived = deriveInitialBrandColors(initialData, language === 'ru')
    return derived.length > 0 ? { ...initialData, brandColors: derived } : initialData
  })

  const [refInput,   setRefInput]   = useState('')
  const [avoidInput, setAvoidInput] = useState('')
  const [isUploadingLogo, setIsUploadingLogo]     = useState(false)
  const [isUploadingRef,  setIsUploadingRef]      = useState(false)
  const [isUploadingHtml, setIsUploadingHtml]     = useState(false)
  const [isGeneratingStyle, setIsGeneratingStyle] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const refInputRef  = useRef<HTMLInputElement>(null)
  const htmlInputRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof VisualKit>(key: K, val: VisualKit[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  // ── Brand color token helpers ─────────────────────────────────────────────
  const addColor = () =>
    set('brandColors', [...(data.brandColors ?? []), { name: '', hex: '#FF6A00', usage: '' }])

  const updateColor = (i: number, patch: Partial<BrandColor>) =>
    set('brandColors', (data.brandColors ?? []).map((c, idx) => idx === i ? { ...c, ...patch } : c))

  const removeColor = (i: number) =>
    set('brandColors', (data.brandColors ?? []).filter((_, idx) => idx !== i))

  // ── Generate cover style via AI ──────────────────────────────────────────
  const handleGenerateCoverStyle = async () => {
    const initData = getTelegramInitData()
    if (!initData || isGeneratingStyle) return
    setIsGeneratingStyle(true)
    try {
      const res = await fetch(`${API_BASE}/api/brandkits/generate-cover-style`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, channelId, visualKit: data }),
      })
      if (!res.ok) { showToast(t('channelStyle.covers.visualCoverStyleGenerating'), 'error'); return }
      const { style } = await res.json() as { style: string }
      if (style) set('visualCoverStyle', style)
    } catch {
      showToast('Failed to generate style', 'error')
    } finally {
      setIsGeneratingStyle(false)
    }
  }

  // ── Save — syncs primaryColor/secondaryColor for backward compat ──────────
  const handleSave = () => {
    const saveData = { ...data }
    const colors = saveData.brandColors ?? []
    if (colors[0]?.hex && isValidHex(colors[0].hex)) saveData.primaryColor = colors[0].hex
    if (colors[1]?.hex && isValidHex(colors[1].hex)) saveData.secondaryColor = colors[1].hex
    updateBrandKit(channelId, { visualKit: saveData })
  }

  const normalizeRef = (r: unknown): ReferenceItem =>
    typeof r === 'string' ? { url: r } : (r as ReferenceItem)

  const refs = (): ReferenceItem[] =>
    (data.references ?? []).map(normalizeRef)

  const addRef = () => {
    const val = refInput.trim()
    if (val) {
      set('references', [...refs(), { url: val }])
      setRefInput('')
    }
  }
  const removeRef = (i: number) =>
    set('references', refs().filter((_, idx) => idx !== i))

  const updateRefDescription = (i: number, description: string) =>
    set('references', refs().map((r, idx) => idx === i ? { ...r, description } : r))

  const addAvoid = () => {
    const val = avoidInput.trim()
    if (val && !(data.avoidList ?? []).includes(val)) {
      set('avoidList', [...(data.avoidList ?? []), val])
      setAvoidInput('')
    }
  }
  const removeAvoid = (v: string) =>
    set('avoidList', (data.avoidList ?? []).filter(x => x !== v))

  const uploadHtmlTemplate = async (file: File) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast(t('channelStyle.covers.uploadFailed'), 'error'); return }
    setIsUploadingHtml(true)
    try {
      const form = new FormData()
      form.append('initData', initData)
      form.append('channelId', channelId)
      form.append('file', file)
      const res = await fetch(`${API_BASE}/api/brandkits/upload-html-template`, {
        method: 'POST', body: form,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        showToast(err.error ?? t('channelStyle.covers.uploadFailed'), 'error')
        return
      }
      const { url } = await res.json() as { url: string }
      set('htmlTemplate', url)
      showToast(t('channelStyle.covers.uploadDone'))
    } catch {
      showToast(t('channelStyle.covers.uploadFailed'), 'error')
    } finally {
      setIsUploadingHtml(false)
    }
  }

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

      const result = await res.json() as { url: string; description?: string }

      if (isLogo) {
        set('logoUrl', result.url)
      } else {
        set('references', [...refs(), { url: result.url, description: result.description }])
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

      {/* Color Tokens */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider">
              {t('channelStyle.covers.colorTokens')}
            </p>
            <p className="text-[11px] text-[#55555D] mt-0.5">
              {t('channelStyle.covers.colorTokensDesc')}
            </p>
          </div>
          <button
            onClick={addColor}
            className="text-[12px] font-medium text-[#FF6A00] hover:text-[#ff8c3a] transition-colors shrink-0 pt-0.5"
          >
            {t('channelStyle.covers.addColor')}
          </button>
        </div>

        {(data.brandColors ?? []).length === 0 ? (
          <div className="mt-3 flex flex-col items-center gap-2 py-5 rounded-[14px] bg-white/[0.02] border border-white/[0.06] border-dashed">
            <p className="text-[12px] text-[#44444C]">{t('channelStyle.covers.noColors')}</p>
            <button
              onClick={addColor}
              className="text-[12px] font-medium text-[#FF6A00] hover:text-[#ff8c3a] transition-colors"
            >
              {t('channelStyle.covers.addColor')}
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {(data.brandColors ?? []).map((token, i) => {
              const preview = isValidHex(token.hex) ? token.hex : null
              return (
                <div
                  key={i}
                  className="flex gap-2.5 p-3 rounded-[14px] bg-white/[0.03] border border-white/[0.06]"
                >
                  {/* Color preview + native picker */}
                  <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
                    <div
                      className={cn(
                        'w-9 h-9 rounded-[10px] border border-white/10 overflow-hidden',
                        !preview && 'bg-white/[0.06]'
                      )}
                      style={preview ? { background: preview } : undefined}
                    />
                    <input
                      type="color"
                      value={preview ?? '#FF6A00'}
                      onChange={e => updateColor(i, { hex: e.target.value })}
                      title={t('channelStyle.covers.colorHex')}
                      className="w-7 h-5 cursor-pointer bg-transparent border-0 p-0 opacity-60 hover:opacity-100 transition-opacity"
                    />
                  </div>

                  {/* Fields */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <input
                      value={token.name}
                      onChange={e => updateColor(i, { name: e.target.value })}
                      placeholder={t('channelStyle.covers.colorNamePlaceholder')}
                      className="glass-input w-full px-2.5 py-1.5 text-[13px] font-medium"
                    />
                    <input
                      value={token.hex}
                      onChange={e => updateColor(i, { hex: e.target.value })}
                      placeholder="#48945E"
                      className={cn(
                        'glass-input w-full px-2.5 py-1.5 text-[12px] font-mono',
                        token.hex && !isValidHex(token.hex) && 'border-red-500/30'
                      )}
                    />
                    <input
                      value={token.usage ?? ''}
                      onChange={e => updateColor(i, { usage: e.target.value })}
                      placeholder={t('channelStyle.covers.colorUsagePlaceholder')}
                      className="glass-input w-full px-2.5 py-1.5 text-[11px] text-[#A1A1AA]"
                    />
                  </div>

                  {/* Remove */}
                  <button
                    onClick={() => removeColor(i)}
                    title={t('channelStyle.covers.removeColor')}
                    className="shrink-0 text-[#44444C] hover:text-red-400 transition-colors mt-0.5"
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
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

      {/* Visual font */}
      <div>
        <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider mb-0.5">
          {t('channelStyle.covers.visualFont')}
        </p>
        <p className="text-[11px] text-[#55555D] mb-3">
          {t('channelStyle.covers.visualFontDesc')}
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(
            [
              ['default',     t('channelStyle.covers.visualFontPresetDefault')],
              ['serif',       t('channelStyle.covers.visualFontPresetSerif')],
              ['sans',        t('channelStyle.covers.visualFontPresetSans')],
              ['mono',        t('channelStyle.covers.visualFontPresetMono')],
              ['display',     t('channelStyle.covers.visualFontPresetDisplay')],
              ['handwritten', t('channelStyle.covers.visualFontPresetHandwritten')],
            ] as [VisualKit['visualFontPreset'], string][]
          ).map(([value, label]) => {
            const active = (data.visualFontPreset ?? 'default') === value
            return (
              <button
                key={value}
                onClick={() => set('visualFontPreset', value)}
                className={cn(
                  'px-3 py-1 rounded-full text-[12px] font-medium border transition-colors',
                  active
                    ? 'bg-[#FF6A00] border-[#FF6A00] text-white'
                    : 'bg-white/[0.04] border-white/[0.08] text-[#A1A1AA] hover:border-white/20'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
        <textarea
          value={data.visualFontRules ?? ''}
          onChange={e => set('visualFontRules', e.target.value || undefined)}
          placeholder={t('channelStyle.covers.visualFontRulesPlaceholder')}
          rows={2}
          className="glass-input w-full px-3 py-2 text-sm resize-none"
        />
        {(data.visualFontRules ?? '').length > 0 && (
          <p className="text-[10px] text-[#44444C] mt-1">
            {t('channelStyle.covers.visualFontRules')}
          </p>
        )}
      </div>

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

        {refs().length > 0 && (
          <div className="space-y-2 mb-2">
            {refs().map((ref, i) => (
              <div key={i} className="rounded-[10px] bg-white/[0.03] border border-white/[0.05] overflow-hidden">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  {isImageUrl(ref.url) ? (
                    <img
                      src={ref.url}
                      alt={`ref-${i}`}
                      className="w-8 h-8 rounded-[6px] object-cover shrink-0 bg-white/[0.05]"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <ImageIcon size={14} className="text-[#55555D] shrink-0" />
                  )}
                  <span className="flex-1 text-[12px] text-[#A1A1AA] truncate">{ref.url}</span>
                  <button onClick={() => removeRef(i)} className="text-[#55555D] hover:text-red-400 transition-colors shrink-0">
                    <X size={12} />
                  </button>
                </div>
                <div className="px-2 pb-2">
                  <textarea
                    value={ref.description ?? ''}
                    onChange={e => updateRefDescription(i, e.target.value)}
                    placeholder={t('channelStyle.covers.refDescription')}
                    rows={2}
                    className="glass-input w-full px-2 py-1.5 text-[11px] text-[#A1A1AA] placeholder:text-[#55555D] resize-none"
                  />
                </div>
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
            ? <><Loader2 size={12} className="animate-spin" />{t('channelStyle.covers.analyzing')}</>
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

      {/* Visual Cover Style */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider">
              {t('channelStyle.covers.visualCoverStyle')}
            </p>
            <p className="text-[11px] text-[#55555D] mt-0.5">
              {t('channelStyle.covers.visualCoverStyleDesc')}
            </p>
          </div>
          <button
            onClick={handleGenerateCoverStyle}
            disabled={isGeneratingStyle || authStatus !== 'authenticated'}
            className="text-[12px] font-medium text-[#FF6A00] hover:text-[#ff8c3a] transition-colors shrink-0 pt-0.5 disabled:opacity-40"
          >
            {isGeneratingStyle
              ? <><Loader2 size={11} className="inline animate-spin mr-1" />{t('channelStyle.covers.visualCoverStyleGenerating')}</>
              : t('channelStyle.covers.visualCoverStyleGenerate')
            }
          </button>
        </div>
        <textarea
          value={data.visualCoverStyle ?? ''}
          onChange={e => set('visualCoverStyle', e.target.value || undefined)}
          placeholder={t('channelStyle.covers.visualCoverStylePlaceholder')}
          rows={4}
          className="glass-input w-full px-3 py-2 text-sm resize-none mt-2"
        />
      </div>

      {/* HTML Cover Template */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider">
              {language === 'ru' ? 'HTML шаблон обложки' : 'HTML Cover Template'}
            </p>
            <p className="text-[11px] text-[#55555D] mt-0.5">
              {language === 'ru'
                ? 'Загрузи свой .html файл — система подставит {{headline}}, {{stat}}, {{logo}} и CSS переменные --primary, --bg'
                : 'Upload your .html file — the system injects {{headline}}, {{stat}}, {{logo}} and CSS vars --primary, --bg'}
            </p>
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={htmlInputRef}
          type="file"
          accept=".html,text/html"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) uploadHtmlTemplate(file)
            e.target.value = ''
          }}
        />

        {data.htmlTemplate ? (
          <div className="flex items-center gap-2 p-3 rounded-[14px] bg-white/[0.03] border border-white/[0.06] mb-2">
            <FileCode size={16} className="text-[#FF6A00] shrink-0" />
            <span className="flex-1 text-[12px] text-[#A1A1AA] truncate">
              {data.htmlTemplate.split('/').pop()?.split('?')[0] ?? 'template.html'}
            </span>
            <button
              onClick={() => set('htmlTemplate', undefined)}
              className="text-[#55555D] hover:text-red-400 transition-colors shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-[14px] bg-white/[0.02] border border-white/[0.06] border-dashed mb-2">
            <FileCode size={16} className="text-[#44444C] shrink-0" />
            <p className="text-[12px] text-[#44444C]">
              {language === 'ru' ? 'Шаблон не загружен - используются встроенные шаблоны' : 'No template - built-in templates are used'}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => htmlInputRef.current?.click()}
            disabled={isUploadingHtml || authStatus !== 'authenticated'}
            className="flex-1"
          >
            {isUploadingHtml
              ? <><Loader2 size={12} className="animate-spin" />{language === 'ru' ? 'Загрузка...' : 'Uploading...'}</>
              : <><Upload size={12} />{language === 'ru' ? 'Загрузить .html' : 'Upload .html'}</>
            }
          </Button>
          {data.htmlTemplate && (
            <Button variant="ghost" size="sm" onClick={() => window.open(data.htmlTemplate, '_blank')}>
              {language === 'ru' ? 'Открыть' : 'View'}
            </Button>
          )}
        </div>

        {/* Slot reference */}
        <div className="mt-2 p-2.5 rounded-[10px] bg-white/[0.02] border border-white/[0.04]">
          <p className="text-[10px] font-mono text-[#44444C] leading-relaxed">
            {'{{headline}}'} {'{{subheadline}}'} {'{{stat}}'} {'{{category}}'} {'{{logo}}'}<br/>
            {'--primary'} {'--bg'} {'--accent'}
          </p>
        </div>
      </div>

      <Button variant="primary" size="md" onClick={handleSave} fullWidth>
        {t('channelStyle.save.covers')}
      </Button>
    </div>
  )
}
