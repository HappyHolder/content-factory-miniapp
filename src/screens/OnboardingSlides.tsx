import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Sparkles } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import type { TranslationKey } from '@/i18n'

interface OnboardingSlidesProps {
  onDone: () => void
}

interface SlideDef {
  image: string                 // path in /public
  titleKey: TranslationKey
  textKey: TranslationKey
}

// Images live in public/onboarding/. Drop slide1.png … slide4.png there.
// Until they exist, a branded gradient placeholder is shown (onError).
const SLIDES: SlideDef[] = [
  { image: '/onboarding/slide1.png', titleKey: 'onboarding.slide1Title', textKey: 'onboarding.slide1Text' },
  { image: '/onboarding/slide2.png', titleKey: 'onboarding.slide2Title', textKey: 'onboarding.slide2Text' },
  { image: '/onboarding/slide3.png', titleKey: 'onboarding.slide3Title', textKey: 'onboarding.slide3Text' },
  { image: '/onboarding/slide4.png', titleKey: 'onboarding.slide4Title', textKey: 'onboarding.slide4Text' },
]

export function OnboardingSlides({ onDone }: OnboardingSlidesProps) {
  const { t } = useApp()
  const [index, setIndex] = useState(0)
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({})

  const isLast = index === SLIDES.length - 1
  const slide = SLIDES[index]!

  const next = () => {
    if (isLast) { onDone(); return }
    setIndex(i => Math.min(i + 1, SLIDES.length - 1))
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#070708]">
      {/* Skip */}
      <div className="flex justify-end px-4 pt-4">
        <button
          onClick={onDone}
          className="text-[13px] font-medium text-[#66666E] hover:text-white transition-colors px-2 py-1"
        >
          {t('onboarding.skip')}
        </button>
      </div>

      {/* Slide body */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-7">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25 }}
            className="w-full flex flex-col items-center text-center"
          >
            {/* Illustration */}
            <div className="w-full max-w-[340px] aspect-square rounded-[22px] overflow-hidden mb-7 border border-white/[0.07] bg-[rgba(255,255,255,0.03)] flex items-center justify-center">
              {failedImages[index] ? (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[rgba(255,106,0,0.15)] to-[rgba(255,106,0,0.02)]">
                  <Sparkles size={48} className="text-[#FF6A00] opacity-60" />
                </div>
              ) : (
                <img
                  src={slide.image}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={() => setFailedImages(m => ({ ...m, [index]: true }))}
                />
              )}
            </div>

            <h1 className="text-[22px] font-bold text-white mb-2.5 leading-tight">{t(slide.titleKey)}</h1>
            <p className="text-[14px] text-[#A1A1AA] leading-relaxed max-w-[320px]">{t(slide.textKey)}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer: dots + CTA */}
      <div className="px-7 pb-8 space-y-5">
        {/* Dots */}
        <div className="flex items-center justify-center gap-1.5">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index ? 'w-6 bg-[#FF6A00]' : 'w-1.5 bg-white/[0.15]'
              }`}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>

        <button
          onClick={next}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[14px] bg-[#FF6A00] text-white text-[15px] font-semibold hover:bg-[#ff7a1a] transition-colors orange-glow"
        >
          {isLast ? t('onboarding.start') : t('onboarding.next')}
          {!isLast && <ChevronRight size={17} />}
        </button>
      </div>
    </div>
  )
}
