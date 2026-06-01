import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Loader2, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { cn } from '@/lib/utils'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Придумай 5 идей для постов',
  'Напиши промпт для обложки',
  'Как улучшить вовлечённость?',
  'Сделай контент-план на неделю',
]

export function ChatScreen() {
  const { activeChannel, t } = useApp()
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const bottomRef                 = useRef<HTMLDivElement>(null)
  const textareaRef               = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const newMessages: Message[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    try {
      const initData = getTelegramInitData() ?? 'mock'
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          initData,
          channelId: activeChannel?.id ?? '',
          messages:  newMessages,
        }),
      })

      const data = await res.json() as { reply?: string; error?: string }
      const reply = data.reply ?? data.error ?? 'Ошибка'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Ошибка соединения' }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-white/[0.06]">
        <div className="w-8 h-8 rounded-full bg-[rgba(255,106,0,0.15)] flex items-center justify-center">
          <Bot size={16} className="text-[#FF6A00]" />
        </div>
        <div>
          <p className="text-[13px] font-semibold text-white">AI Ассистент</p>
          {activeChannel && (
            <p className="text-[10px] text-[#55555D]">
              {activeChannel.handle ? `@${activeChannel.handle}` : activeChannel.name}
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 no-scrollbar">
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
                  onClick={() => send(s)}
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
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-white/[0.06]">
        <div className="flex items-end gap-2 bg-white/[0.05] rounded-2xl px-3 py-2 border border-white/[0.08]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Напиши сообщение…"
            rows={1}
            className="flex-1 bg-transparent text-[13px] text-white placeholder:text-[#55555D] resize-none outline-none leading-relaxed max-h-[120px] py-0.5"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className={cn(
              'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors mb-0.5',
              input.trim() && !loading
                ? 'bg-[#FF6A00] text-white'
                : 'bg-white/[0.08] text-[#55555D]'
            )}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
