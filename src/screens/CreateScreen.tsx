import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, ChevronDown, Check, Loader2 } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { InputTypeChips, getPlaceholderKey } from '@/components/create/InputTypeChips'
import { generationService } from '@/services/generationService'
import { brandKitService } from '@/services/brandKitService'
import type { SourceType } from '@/types'
import { cn } from '@/lib/utils'

interface CreateScreenProps {
  onPostCreated: (id: string) => void
}

export function CreateScreen({ onPostCreated }: CreateScreenProps) {
  const { state, activeChannel, addPost, showToast, t } = useApp()
  const [input, setInput] = useState('')
  const [sourceType, setSourceType] = useState<SourceType>('prompt')
  const [isGenerating, setIsGenerating] = useState(false)
  const [done, setDone] = useState(false)
  const [channelDropOpen, setChannelDropOpen] = useState(false)
  const [selectedChannelId, setSelectedChannelId] = useState(state.activeChannelId)

  const selectedChannel = state.channels.find(c => c.id === selectedChannelId) || activeChannel

  const canGenerate = input.trim().length > 3 && !isGenerating

  const handleGenerate = async () => {
    if (!canGenerate || !selectedChannel) return

    const brandKit = brandKitService.getByChannelId(selectedChannelId)
    if (!brandKit) {
      showToast(t('create.generationFailed'), 'error')
      return
    }

    setIsGenerating(true)
    setDone(false)

    try {
      const post = await generationService.generate({
        input: input.trim(),
        sourceType,
        channelId: selectedChannelId,
        channelUsername: selectedChannel.username,
        brandKit,
      })
      addPost(post)
      setDone(true)
      setInput('')
      setTimeout(() => {
        setDone(false)
        onPostCreated(post.id)
      }, 900)
    } catch {
      showToast(t('create.generationFailed'), 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('create.title')}
        subtitle={t('create.subtitle')}
      />

      <div className="px-4 mt-1.5 space-y-2.5">
        {/* Main input card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <GlassCard strong padding="none" className="overflow-hidden">
            <div className="p-4 space-y-3">
              <InputTypeChips selected={sourceType} onChange={setSourceType} />

              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={t(getPlaceholderKey(sourceType))}
                rows={6}
                className="glass-input w-full px-3 py-3 text-sm leading-relaxed"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              />

              {/* Channel selector */}
              <div className="relative">
                <button
                  onClick={() => setChannelDropOpen(v => !v)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2.5 rounded-[12px]',
                    'bg-white/[0.04] border border-white/[0.06] text-sm text-[#A1A1AA] hover:text-white hover:bg-white/[0.07] transition-colors'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-[rgba(255,106,0,0.18)] flex items-center justify-center text-[9px] font-bold text-[#FF6A00]">
                      {selectedChannel?.title[0] || '?'}
                    </div>
                    <span>
                      {t('create.generateFor')}{' '}
                      <span className="text-white font-medium">@{selectedChannel?.username}</span>
                    </span>
                  </span>
                  <ChevronDown size={14} className={cn('transition-transform duration-200', channelDropOpen && 'rotate-180')} />
                </button>

                <AnimatePresence>
                  {channelDropOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.97 }}
                      transition={{ duration: 0.16 }}
                      className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-[#141417] border border-white/[0.07] rounded-[14px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
                    >
                      {state.channels.map(ch => (
                        <button
                          key={ch.id}
                          onClick={() => { setSelectedChannelId(ch.id); setChannelDropOpen(false) }}
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-white/6 transition-colors',
                            ch.id === selectedChannelId ? 'text-[#FF6A00]' : 'text-[#A1A1AA]'
                          )}
                        >
                          <div className="w-7 h-7 rounded-full bg-[rgba(255,106,0,0.14)] flex items-center justify-center text-[11px] font-bold text-[#FF6A00]">
                            {ch.title[0]}
                          </div>
                          <div>
                            <p className="font-medium text-white">{ch.title}</p>
                            <p className="text-[11px] text-[#66666E]">@{ch.username}</p>
                          </div>
                          {ch.id === selectedChannelId && <Check size={14} className="ml-auto" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="px-4 pb-4">
              <motion.button
                onClick={handleGenerate}
                disabled={!canGenerate}
                whileTap={{ scale: canGenerate ? 0.97 : 1 }}
                className={cn(
                  'w-full flex items-center justify-center gap-2.5 py-3.5 rounded-[14px] text-sm font-semibold transition-all duration-200',
                  canGenerate && !isGenerating && !done
                    ? 'bg-[#FF6A00] text-white hover:bg-[#ff7a1a] orange-glow'
                    : done
                      ? 'bg-[rgba(255,106,0,0.20)] text-[#FF6A00] border border-[rgba(255,106,0,0.38)]'
                      : 'bg-white/[0.04] text-[#44444C] border border-white/[0.06] cursor-not-allowed'
                )}
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t('create.generating')}
                  </>
                ) : done ? (
                  <>
                    <Check size={16} />
                    {t('create.postsReady')}
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    {t('create.generatePosts')}
                  </>
                )}
              </motion.button>
            </div>
          </GlassCard>
        </motion.div>

        {/* Tips */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.25 }}
        >
          <div className="px-1">
            <p className="text-[10px] font-semibold text-[#44444C] uppercase tracking-wider mb-2">
              {t('create.howItWorks')}
            </p>
            <div className="space-y-1">
              {([
                t('create.step1'),
                t('create.step2'),
                t('create.step3'),
              ] as string[]).map((tip, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="w-3.5 h-3.5 rounded-full bg-white/[0.05] text-[#55555D] text-[9px] font-bold flex items-center justify-center shrink-0 mt-px">
                    {i + 1}
                  </span>
                  <p className="text-[12px] text-[#55555D]">{tip}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
