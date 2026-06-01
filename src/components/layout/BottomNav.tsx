import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Sparkles, User, Bot, Send, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApp } from '@/context/AppContext'

type Tab = 'posts' | 'create' | 'ai' | 'profile'

interface NavItem {
  id: Tab
  label: string
  icon: React.ElementType
}

interface BottomNavProps {
  active: Tab
  onChange: (tab: Tab) => void
  onAISend: (text: string) => void
  aiLoading: boolean
}

export function BottomNav({ active, onChange, onAISend, aiLoading }: BottomNavProps) {
  const { t } = useApp()
  const isAI = active === 'ai'
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const prevIsAI = useRef(false)

  const navItems: NavItem[] = [
    { id: 'posts',   label: t('nav.posts'),   icon: FileText },
    { id: 'create',  label: t('nav.create'),  icon: Sparkles },
    { id: 'ai',      label: t('nav.ai'),      icon: Bot      },
    { id: 'profile', label: t('nav.profile'), icon: User     },
  ]

  // Auto-focus input when switching to AI mode
  useEffect(() => {
    if (isAI && !prevIsAI.current) {
      setTimeout(() => inputRef.current?.focus(), 350)
    }
    prevIsAI.current = isAI
  }, [isAI])

  const handleSend = () => {
    if (!input.trim() || aiLoading) return
    onAISend(input.trim())
    setInput('')
  }

  return (
    <motion.nav
      layout
      transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
      className={cn(
        'bottom-nav flex items-center',
        isAI ? 'px-4' : 'px-2'
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isAI ? (
          /* ── AI input mode ── */
          <motion.div
            key="ai-input"
            className="flex items-center gap-2 w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, delay: 0.1 }}
          >
            {/* Bot icon — stays as visual anchor */}
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', bounce: 0.4, duration: 0.4, delay: 0.15 }}
              className="w-7 h-7 rounded-full bg-[rgba(255,106,0,0.15)] flex items-center justify-center flex-shrink-0"
            >
              <Bot size={14} className="text-[#FF6A00]" />
            </motion.div>

            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Напиши сообщение…"
              className="flex-1 bg-transparent text-[13px] text-white placeholder:text-[#55555D] outline-none min-w-0"
            />

            <motion.button
              onClick={handleSend}
              whileTap={{ scale: 0.88 }}
              disabled={!input.trim() || aiLoading}
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-200',
                input.trim() && !aiLoading
                  ? 'bg-[#FF6A00] text-white'
                  : 'bg-white/[0.08] text-[#55555D]'
              )}
            >
              {aiLoading
                ? <Loader2 size={13} className="animate-spin" />
                : <Send size={13} />
              }
            </motion.button>
          </motion.div>
        ) : (
          /* ── Normal tabs mode ── */
          <motion.div
            key="tabs"
            className="flex items-center w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {navItems.map(item => {
              const isActive = item.id === active
              const Icon = item.icon
              return (
                <motion.button
                  key={item.id}
                  onClick={() => onChange(item.id)}
                  whileTap={{ scale: 0.92 }}
                  transition={{ duration: 0.1 }}
                  className={cn(
                    'relative flex-1 flex flex-col items-center justify-center gap-0.5 h-[46px] rounded-[40px] transition-colors duration-200',
                    isActive ? 'text-[#FF6A00]' : 'text-[#66666E] hover:text-[#A1A1AA]'
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-active-bg"
                      className="absolute inset-0 rounded-[40px] bg-[rgba(255,106,0,0.09)]"
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
                    />
                  )}
                  <Icon size={18} strokeWidth={isActive ? 2.1 : 1.7} className="relative z-10" />
                  <span className={cn(
                    'relative z-10 text-[10px] font-semibold tracking-wide',
                    isActive ? 'text-[#FF6A00]' : 'text-[#66666E]'
                  )}>
                    {item.label}
                  </span>
                </motion.button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
