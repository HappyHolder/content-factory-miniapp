import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, AlertCircle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToastItem {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

interface ToastContainerProps {
  toasts: ToastItem[]
}

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
}

const styles = {
  success: 'border-[rgba(255,106,0,0.38)] text-white',
  error: 'border-red-500/30 text-white',
  info: 'border-white/15 text-white',
}

export function ToastContainer({ toasts }: ToastContainerProps) {
  return (
    <div className="fixed top-4 left-4 right-4 z-[300] flex flex-col gap-2 max-w-[430px] mx-auto pointer-events-none">
      <AnimatePresence>
        {toasts.map(toast => {
          const Icon = icons[toast.type]
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ type: 'spring', damping: 24, stiffness: 300 }}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-[16px]',
                'bg-[rgba(14,14,16,0.92)] backdrop-blur-xl border',
                'shadow-[0_8px_32px_rgba(0,0,0,0.4)]',
                styles[toast.type]
              )}
            >
              <Icon size={16} className="shrink-0 text-[#FF6A00]" />
              <span className="text-sm font-medium">{toast.message}</span>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
