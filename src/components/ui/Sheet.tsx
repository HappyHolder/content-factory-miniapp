import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
  height?: 'auto' | 'full' | '80'
}

export function Sheet({ open, onClose, title, children, className, height = 'auto' }: SheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320, mass: 0.9 }}
            className={cn(
              'fixed left-0 right-0 bottom-0 z-[201] max-w-[430px] mx-auto',
              'bg-[#0E0E10] border-t border-white/10 rounded-t-[28px]',
              height === 'full' && 'h-[92vh] overflow-y-auto',
              height === '80' && 'max-h-[80vh] overflow-y-auto',
              className
            )}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <div className="w-10 h-1 bg-white/20 rounded-full mx-auto absolute left-1/2 -translate-x-1/2 top-3" />
              {title && (
                <h2 className="text-base font-semibold text-white mt-2">{title}</h2>
              )}
              <button
                onClick={onClose}
                className="ml-auto p-1.5 rounded-full bg-white/8 text-[#A1A1AA] hover:text-white hover:bg-white/12 transition-colors mt-1"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-4 pb-6">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
