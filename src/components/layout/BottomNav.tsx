import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Sparkles, User, Bot, Send, Loader2, ChevronDown, LayoutTemplate } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApp } from '@/context/AppContext'

type Tab = 'posts' | 'create' | 'ai' | 'styles' | 'profile'

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
  aiEnabled?: boolean
  showScrollBtn?: boolean
  onScrollToBottom?: () => void
}

export function BottomNav({ active, onChange, onAISend, aiLoading, aiEnabled = true, showScrollBtn, onScrollToBottom }: BottomNavProps) {
  const { t } = useApp()
  // FREE users have no AI input — keep the bar in normal tabs mode on the AI tab.
  const isAI = active === 'ai' && aiEnabled
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const prevIsAI = useRef(false)

  // Auto-grow the textarea up to ~5 lines, then scroll internally.
  const autoGrow = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }
  // Track if we've mounted — skip animation on first render
  const mounted = useRef(false)

  const navItems: NavItem[] = [
    { id: 'posts',   label: t('nav.posts'),   icon: FileText },
    { id: 'create',  label: t('nav.create'),  icon: Sparkles },
    { id: 'ai',      label: t('nav.ai'),      icon: Bot      },
    { id: 'styles',  label: t('nav.styles'),  icon: LayoutTemplate },
    { id: 'profile', label: t('nav.profile'), icon: User     },
  ]

  useEffect(() => {
    mounted.current = true
  }, [])

  // Auto-focus input when switching to AI mode
  useEffect(() => {
    if (isAI && !prevIsAI.current) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
    prevIsAI.current = isAI
  }, [isAI])

  const handleSend = () => {
    if (!input.trim() || aiLoading) return
    onAISend(input.trim())
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }

  return (
    <nav
      className={cn(
        'bottom-nav flex',
        isAI ? 'px-4 items-end' : 'px-2 items-center'
      )}
      style={{
        transition: 'padding 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        // In AI mode let the bar grow upward with the textarea (pill → rounded box).
        ...(isAI
          ? { height: 'auto', minHeight: '58px', borderRadius: '26px', paddingTop: '8px', paddingBottom: '8px' }
          : {}),
      }}
    >
      {/* Scroll-to-bottom button — absolute inside fixed nav = perfectly centered above bar */}
      <AnimatePresence>
        {showScrollBtn && (
          // Outer div handles centering, inner motion.button handles animation
          // (framer-motion overwrites transform, which breaks translateX centering if combined)
          <div
            key="scroll-btn-wrapper"
            style={{ position: 'absolute', top: '-44px', left: '50%', transform: 'translateX(-50%)' }}
          >
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.18 }}
              onClick={onScrollToBottom}
              className="w-8 h-8 rounded-full bg-[#1C1C1F] border border-white/[0.15] shadow-xl flex items-center justify-center text-[#ABABAB]"
            >
              <ChevronDown size={16} />
            </motion.button>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait" initial={false}>
        {isAI ? (
          /* ── AI input mode ── */
          <motion.div
            key="ai-input"
            className="flex items-end gap-2 w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', bounce: 0.35, duration: 0.35 }}
              className="w-7 h-7 rounded-full bg-[rgba(255,106,0,0.15)] flex items-center justify-center flex-shrink-0"
            >
              <Bot size={14} className="text-[#FF6A00]" />
            </motion.div>

            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={e => { setInput(e.target.value); autoGrow() }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
              }}
              placeholder="Напиши сообщение…"
              className="flex-1 bg-transparent text-[13px] leading-[1.4] text-white placeholder:text-[#55555D] outline-none min-w-0 resize-none overflow-y-auto no-scrollbar py-1 max-h-[120px]"
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
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="absolute inset-0 rounded-[40px] bg-[rgba(255,106,0,0.09)]"
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
    </nav>
  )
}
