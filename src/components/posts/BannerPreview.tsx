import { motion } from 'framer-motion'
import { RefreshCw, LayoutTemplate, X } from 'lucide-react'
import type { Banner } from '@/types'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'

interface BannerPreviewProps {
  banner: Banner
  onRegenerate?: () => void
  onChangeTemplate?: () => void
  onRemove?: () => void
}

const templatePatterns: Record<string, string> = {
  dark_glass: 'radial-gradient(ellipse at 80% 20%, rgba(255,106,0,0.18) 0%, transparent 55%), radial-gradient(ellipse at 20% 80%, rgba(255,106,0,0.08) 0%, transparent 50%)',
  minimal:    'radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.04) 0%, transparent 60%)',
  branded:    'radial-gradient(ellipse at 100% 0%, rgba(255,106,0,0.22) 0%, transparent 50%), linear-gradient(135deg, rgba(255,106,0,0.06) 0%, transparent 50%)',
  news:       'linear-gradient(135deg, rgba(255,106,0,0.12) 0%, transparent 40%), radial-gradient(ellipse at 0% 100%, rgba(255,106,0,0.08) 0%, transparent 50%)',
}

export function BannerPreview({ banner, onRegenerate, onChangeTemplate, onRemove }: BannerPreviewProps) {
  const { t } = useApp()
  const pattern = templatePatterns[banner.templateId] || templatePatterns.dark_glass

  return (
    <div className="space-y-2">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25 }}
        className="relative w-full aspect-[1.91/1] rounded-[18px] overflow-hidden bg-[#141417] border border-white/10"
      >
        <div className="absolute inset-0" style={{ background: pattern }} />

        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(255,255,255,1) 19px, rgba(255,255,255,1) 20px)',
          }}
        />

        <div className="absolute top-0 left-0 right-0 h-[1px]"
          style={{ background: `linear-gradient(90deg, transparent 0%, ${banner.accentColor}50 30%, ${banner.accentColor}80 50%, ${banner.accentColor}50 70%, transparent 100%)` }}
        />

        <div className="absolute inset-0 flex flex-col justify-between p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[rgba(255,106,0,0.20)] border border-[rgba(255,106,0,0.38)] flex items-center justify-center">
                <div className="w-3 h-3 rounded-sm" style={{ background: banner.accentColor }} />
              </div>
              <span className="text-[11px] font-semibold text-[#A1A1AA] tracking-wide uppercase">Publium</span>
            </div>
            {banner.watermark && (
              <span className="text-[9px] text-[#66666E] font-medium opacity-70">CF</span>
            )}
          </div>

          <div>
            {banner.subtitle && (
              <p className="text-[11px] text-[#A1A1AA] mb-1 font-medium">{banner.subtitle}</p>
            )}
            <h2 className="text-lg font-bold text-white leading-tight tracking-tight">
              {banner.title}
            </h2>
            <div className="mt-3 h-[2px] w-12 rounded-full" style={{ background: banner.accentColor }} />
          </div>
        </div>
      </motion.div>

      <div className="flex gap-2">
        {onRegenerate && (
          <Button variant="secondary" size="sm" onClick={onRegenerate} className="flex-1">
            <RefreshCw size={13} />
            {t('postDetails.regenerateVisual')}
          </Button>
        )}
        {onChangeTemplate && (
          <Button variant="secondary" size="sm" onClick={onChangeTemplate} className="flex-1">
            <LayoutTemplate size={13} />
            {t('postDetails.template')}
          </Button>
        )}
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <X size={13} />
          </Button>
        )}
      </div>
    </div>
  )
}
