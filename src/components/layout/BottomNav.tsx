import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Sparkles, User, Bot, Send, Loader2, ChevronDown, LayoutTemplate, Paperclip, Mic, X, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApp } from '@/context/AppContext'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData } from '@/lib/telegram'

type Tab = 'posts' | 'create' | 'ai' | 'styles' | 'profile'

interface NavItem {
  id: Tab
  label: string
  icon: React.ElementType
}

interface BottomNavProps {
  active: Tab
  onChange: (tab: Tab) => void
  onAISend: (text: string, imageUrl?: string, previewUrl?: string) => void
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

  // Composer attachments (Stage 3): image + voice.
  const [attachedImage, setAttachedImage] = useState<string | null>(null)     // server URL (extraction only)
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null) // local blob URL (bubble display)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [voiceHint, setVoiceHint] = useState('')   // transient failure note
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const flashVoiceHint = (msg: string) => { setVoiceHint(msg); setTimeout(() => setVoiceHint(''), 3500) }
  const micSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  const clearAttachment = () => {
    setAttachedImage(null)
    setAttachedPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }

  const handleSend = () => {
    const text = input.trim()
    if ((!text && !attachedImage) || aiLoading || uploading) return
    // Bubble shows the local blob (survives the server file being deleted after
    // extraction); the server URL is sent only so the backend can read the image.
    onAISend(text, attachedImage ?? undefined, attachedPreview ?? undefined)
    setInput('')
    setAttachedImage(null)
    setAttachedPreview(null) // ownership of the blob URL passes to the chat bubble
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setAttachedPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('initData', getTelegramInitData() ?? 'mock')
      fd.append('image', file)
      const r = await fetch(`${API_BASE}/api/chat/upload-image`, { method: 'POST', body: fd })
      const d = await r.json() as { url?: string }
      if (r.ok && d.url) setAttachedImage(d.url); else clearAttachment()
    } catch { clearAttachment() } finally { setUploading(false) }
  }

  const startRecording = async () => {
    if (!micSupported || recording || transcribing) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = ev => { if (ev.data.size > 0) chunksRef.current.push(ev.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size < 800) { flashVoiceHint('Слишком короткая запись'); return }
        setTranscribing(true)
        try {
          const fd = new FormData()
          fd.append('initData', getTelegramInitData() ?? 'mock')
          fd.append('audio', blob, 'voice.webm')
          const res = await fetch(`${API_BASE}/api/chat/transcribe`, { method: 'POST', body: fd })
          const d = await res.json() as { text?: string; error?: string }
          if (res.ok && d.text) {
            setInput(prev => (prev ? prev + ' ' : '') + d.text!.trim())
            setTimeout(() => { autoGrow(); inputRef.current?.focus() }, 0)
          } else {
            flashVoiceHint(d.error || 'Не удалось распознать речь')
          }
        } catch { flashVoiceHint('Не удалось распознать речь') } finally { setTranscribing(false) }
      }
      recorderRef.current = rec
      // Timeslice → dataavailable fires periodically (some webviews emit an empty
      // blob otherwise), so the recording is reliably captured.
      rec.start(250)
      setRecording(true)
    } catch { flashVoiceHint('Нет доступа к микрофону') }
  }
  const stopRecording = (send = true) => {
    const rec = recorderRef.current
    if (!rec) return
    if (!send) chunksRef.current = []
    if (rec.state !== 'inactive') rec.stop()
    setRecording(false)
  }

  const hasContent = !!input.trim() || !!attachedImage || !!attachedPreview

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
            className="flex flex-col gap-1.5 w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            {/* Transient voice hint (mic denied / short / failed) */}
            <AnimatePresence>
              {voiceHint && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-2 text-[11px] text-[#E0A030]"
                >
                  {voiceHint}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Attached-image preview strip */}
            <AnimatePresence>
              {attachedPreview && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 pl-1"
                >
                  <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-white/[0.06] flex items-center justify-center">
                    <img src={attachedPreview} alt="" className="w-full h-full object-cover" />
                    {uploading && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 size={16} className="text-[#FF6A00] animate-spin" />
                      </div>
                    )}
                    {!uploading && (
                      <button
                        onClick={clearAttachment}
                        aria-label="Убрать изображение"
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/80 flex items-center justify-center text-white"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                  <span className="text-[11px] text-[#8A8A92]">{uploading ? 'Загружаю…' : 'Изображение прикреплено'}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-end gap-2 w-full">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />

              {recording ? (
                /* ── Recording bar ── */
                <>
                  <motion.button
                    onClick={() => stopRecording(false)}
                    whileTap={{ scale: 0.88 }}
                    aria-label="Отменить запись"
                    className="w-9 h-9 min-w-9 rounded-full bg-white/[0.08] text-[#ABABAB] flex items-center justify-center flex-shrink-0"
                  >
                    <X size={16} />
                  </motion.button>
                  <div className="flex-1 min-w-0 flex items-center gap-2 bg-white/[0.06] border border-white/[0.09] rounded-[19px] px-4 min-h-[38px]">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                    <span className="text-[13px] text-[#C7C7CE]">Идёт запись…</span>
                  </div>
                  <motion.button
                    onClick={() => stopRecording(true)}
                    whileTap={{ scale: 0.88 }}
                    aria-label="Остановить и распознать"
                    className="w-9 h-9 min-w-9 aspect-square rounded-full bg-[#FF6A00] text-white flex items-center justify-center flex-shrink-0"
                  >
                    <Square size={13} fill="currentColor" />
                  </motion.button>
                </>
              ) : (
                <>
                  {/* Paperclip (attach image) */}
                  <motion.button
                    onClick={() => fileInputRef.current?.click()}
                    whileTap={{ scale: 0.88 }}
                    disabled={uploading || aiLoading}
                    aria-label="Прикрепить изображение"
                    className="w-9 h-9 min-w-9 rounded-full bg-white/[0.06] text-[#ABABAB] hover:text-white flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50"
                  >
                    <Paperclip size={16} />
                  </motion.button>

                  {/* Telegram-style pill field */}
                  <div className="flex-1 min-w-0 flex items-center bg-white/[0.06] border border-white/[0.09] rounded-[19px] px-4 min-h-[38px]">
                    <textarea
                      ref={inputRef}
                      value={input}
                      rows={1}
                      onChange={e => { setInput(e.target.value); autoGrow() }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                      }}
                      placeholder={transcribing ? 'Распознаю речь…' : 'Напиши сообщение…'}
                      disabled={transcribing}
                      className="flex-1 bg-transparent text-[13px] leading-[1.4] text-white placeholder:text-[#55555D] outline-none min-w-0 resize-none overflow-y-auto no-scrollbar py-[9px] max-h-[120px]"
                    />
                  </div>

                  {/* Mic when empty, Send when there's content */}
                  {hasContent || !micSupported ? (
                    <motion.button
                      onClick={handleSend}
                      whileTap={{ scale: 0.88 }}
                      disabled={!hasContent || aiLoading || uploading}
                      aria-label="Отправить"
                      className={cn(
                        'w-9 h-9 min-w-9 aspect-square rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-200',
                        hasContent && !aiLoading && !uploading ? 'bg-[#FF6A00] text-white' : 'bg-white/[0.08] text-[#55555D]',
                      )}
                    >
                      {aiLoading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} className="-ml-0.5" />}
                    </motion.button>
                  ) : (
                    <motion.button
                      onClick={startRecording}
                      whileTap={{ scale: 0.88 }}
                      disabled={transcribing || aiLoading}
                      aria-label="Записать голосовое"
                      className="w-9 h-9 min-w-9 aspect-square rounded-full bg-white/[0.08] text-[#ABABAB] hover:text-white flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50"
                    >
                      {transcribing ? <Loader2 size={15} className="animate-spin" /> : <Mic size={16} />}
                    </motion.button>
                  )}
                </>
              )}
            </div>
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
