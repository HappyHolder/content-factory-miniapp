import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Loader2, Sparkles, ArrowLeft, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Придумай 5 идей для постов',
  'Напиши промпт для обложки',
  'Как улучшить вовлечённость?',
  'Сделай контент-план на неделю',
]

interface ChatScreenProps {
  messages: ChatMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  historyLoaded: boolean
  setHistoryLoaded: React.Dispatch<React.SetStateAction<boolean>>
  onSend: (text: string) => void
  loading: boolean
  onBack: () => void
}

export function ChatScreen({ messages, setMessages, historyLoaded, setHistoryLoaded, onSend, loading, onBack }: ChatScreenProps) {
  const { activeChannel, authStatus } = useApp()
  const bottomRef    = useRef<HTMLDivElement>(null)
  const scrollRef    = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  // Show/hide scroll-to-bottom button based on scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollBtn(distanceFromBottom > 120)
  }, [])

  // Load history from DB once
  useEffect(() => {
    if (historyLoaded || authStatus === 'checking') return
    const initData = getTelegramInitData()
    if (!initData) { setHistoryLoaded(true); return }

    fetch(`${API_BASE}/api/chat/history?initData=${encodeURIComponent(initData)}`)
      .then(r => r.json())
      .then((data: { messages?: ChatMessage[] }) => {
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(data.messages)
        }
      })
      .catch(() => {})
      .finally(() => {
        setHistoryLoaded(true)
        // Scroll to bottom without animation after history loads
        setTimeout(() => scrollToBottom(false), 50)
      })
  }, [authStatus, historyLoaded, setHistoryLoaded, setMessages, scrollToBottom])

  // Auto-scroll on new message / loading indicator
  useEffect(() => {
    if (!historyLoaded) return
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    // Only auto-scroll if already near the bottom (user hasn't scrolled up)
    if (distanceFromBottom < 200) scrollToBottom()
  }, [messages, loading, historyLoaded, scrollToBottom])

  const isEmpty = messages.length === 0 && historyLoaded

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 pt-4 pb-3 border-b border-white/[0.06]">
        <motion.button
          onClick={onBack}
          whileTap={{ scale: 0.88 }}
          className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0 text-[#ABABAB] hover:text-white transition-colors"
        >
          <ArrowLeft size={15} />
        </motion.button>

        <div className="w-7 h-7 rounded-full bg-[rgba(255,106,0,0.15)] flex items-center justify-center flex-shrink-0">
          <Bot size={14} className="text-[#FF6A00]" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white">AI Ассистент</p>
          {activeChannel && (
            <p className="text-[10px] text-[#55555D] truncate">
              {activeChannel.username ? `@${activeChannel.username}` : activeChannel.title}
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-3 space-y-3 no-scrollbar"
          style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}
        >
        {!historyLoaded && (
          <div className="flex justify-center pt-10">
            <Loader2 size={16} className="text-[#FF6A00] animate-spin" />
          </div>
        )}

        {isEmpty && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-full gap-5 pb-4"
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[rgba(255,106,0,0.12)] flex items-center justify-center">
                <Sparkles size={22} className="text-[#FF6A00]" />
              </div>
              <p className="text-[13px] font-semibold text-white">Чем могу помочь?</p>
              <p className="text-[11px] text-[#55555D] leading-relaxed max-w-[220px]">
                Идеи постов, промпты для обложек, контент-стратегия и редактура
              </p>
            </div>

            <div className="w-full space-y-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  className="w-full text-left px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.07] text-[12px] text-[#ABABAB] hover:bg-white/[0.07] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[82%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap',
                  msg.role === 'user'
                    ? 'bg-[#FF6A00] text-white rounded-br-sm'
                    : 'bg-white/[0.06] text-[#E0E0E0] rounded-bl-sm'
                )}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-white/[0.06] px-3 py-2.5 rounded-2xl rounded-bl-sm">
              <Loader2 size={14} className="text-[#FF6A00] animate-spin" />
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
        </div> {/* end scrollable div */}
      </div> {/* end relative wrapper */}

      {/* Scroll-to-bottom button — centered above nav bar, like Telegram/WhatsApp */}
      <AnimatePresence>
        {showScrollBtn && (
          <motion.button
            key="scroll-btn"
            initial={{ opacity: 0, scale: 0.8, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 6 }}
            transition={{ duration: 0.18 }}
            onClick={() => scrollToBottom()}
            style={{ bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))' }}
            className="absolute left-1/2 -translate-x-1/2 z-20 w-8 h-8 rounded-full bg-[#1C1C1F] border border-white/[0.12] shadow-xl flex items-center justify-center text-[#ABABAB] hover:text-white hover:border-white/25 transition-colors"
          >
            <ChevronDown size={16} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
