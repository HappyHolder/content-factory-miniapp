import { motion, AnimatePresence } from 'framer-motion'

interface AppShellProps {
  children: React.ReactNode
  pageKey: string
}

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
}

export function AppShell({ children, pageKey }: AppShellProps) {
  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pageKey}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
          className="absolute inset-0 overflow-y-auto page-content no-scrollbar"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
