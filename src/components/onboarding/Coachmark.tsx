import { motion } from 'framer-motion'
import { useWalkthrough } from '@/context/WalkthroughContext'
import { useApp } from '@/context/AppContext'

interface CoachmarkProps {
  title: string
  text: string
  stepLabel: string   // e.g. "Шаг 1 из 3"
}

/**
 * A floating explanation card for the active walkthrough step. Render it next to
 * the highlighted target button. Includes "Skip step" and "Skip all" actions.
 */
export function Coachmark({ title, text, stepLabel }: CoachmarkProps) {
  const { skipStep, skipAll } = useWalkthrough()
  const { t } = useApp()
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="rounded-[16px] border border-[rgba(255,106,0,0.30)] bg-[#141416] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#FF6A00] mb-1.5">{stepLabel}</p>
      <p className="text-[14px] font-bold text-white mb-1">{title}</p>
      <p className="text-[12px] text-[#A1A1AA] leading-relaxed mb-3">{text}</p>
      <div className="flex items-center justify-between">
        <button onClick={skipStep} className="text-[12px] font-medium text-[#A1A1AA] hover:text-white transition-colors">
          {t('onboarding.skipStep')}
        </button>
        <button onClick={skipAll} className="text-[11px] text-[#55555D] hover:text-[#A1A1AA] transition-colors">
          {t('onboarding.skipAll')}
        </button>
      </div>
    </motion.div>
  )
}

/** Pulsing-ring wrapper to draw attention to the active step's target button. */
export function HighlightRing({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return <>{children}</>
  return (
    <div className="relative">
      <motion.span
        aria-hidden
        className="absolute -inset-1 rounded-[16px] border-2 border-[#FF6A00] pointer-events-none"
        animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.015, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      />
      {children}
    </div>
  )
}
