import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Check, Loader2, Radio } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { ChannelSwitcherHeader } from '@/components/layout/ChannelSwitcherHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { generationService } from '@/services/generationService'
import { brandKitService } from '@/services/brandKitService'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { GeneratedPost } from '@/types'

// API returns dates as ISO strings; banner is absent (undefined on receipt).
type GenerateApiPost = Omit<GeneratedPost, 'createdAt' | 'scheduledAt' | 'publishedAt' | 'banner'> & {
  createdAt:   string
  scheduledAt: string | null
  publishedAt: string | null
}

interface CreateScreenProps {
  onPostCreated: (id: string) => void
}

export function CreateScreen({ onPostCreated }: CreateScreenProps) {
  const { state, activeChannel, addPost, showToast, t, authStatus } = useApp()
  const [textPrompt, setTextPrompt] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [done, setDone] = useState(false)

  const canGenerate = textPrompt.trim().length > 3 && !isGenerating

  const handleGenerate = async () => {
    if (!canGenerate || !activeChannel) return

    setIsGenerating(true)
    setDone(false)

    try {
      let post: GeneratedPost

      if (authStatus === 'authenticated') {
        const initData = getTelegramInitData()
        if (!initData) throw new Error('No initData')

        const res = await fetch(`${API_BASE}/api/posts/generate`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            initData,
            channelId:  state.activeChannelId,
            input:      textPrompt.trim(),
            sourceType: 'prompt',
          }),
        })
        if (!res.ok) throw new Error(`generate failed: ${res.status}`)

        const data = await res.json() as { post: GenerateApiPost }
        post = {
          ...data.post,
          createdAt:   new Date(data.post.createdAt),
          scheduledAt: data.post.scheduledAt != null ? new Date(data.post.scheduledAt) : undefined,
          publishedAt: data.post.publishedAt != null ? new Date(data.post.publishedAt) : undefined,
        }
      } else {
        const brandKit = brandKitService.getByChannelId(state.activeChannelId)
        if (!brandKit) {
          showToast(t('create.generationFailed'), 'error')
          return
        }
        post = await generationService.generate({
          input:           textPrompt.trim(),
          sourceType:      'prompt',
          channelId:       state.activeChannelId,
          channelUsername: activeChannel.username,
          brandKit,
        })
      }

      addPost(post)
      setDone(true)
      setTextPrompt('')
      setImagePrompt('')
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
      <ChannelSwitcherHeader />

      <div className="px-4 space-y-2.5">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <GlassCard strong padding="none" className="overflow-hidden">
            <div className="p-4 space-y-4">
              <h2 className="text-[15px] font-semibold text-white">{t('create.title')}</h2>

              {/* Text prompt */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#55555D] uppercase tracking-wider">
                  {t('create.textPromptLabel')}
                </label>
                <textarea
                  value={textPrompt}
                  onChange={e => setTextPrompt(e.target.value)}
                  placeholder={t('create.textPromptPlaceholder')}
                  rows={5}
                  className="glass-input w-full px-3 py-3 text-sm leading-relaxed"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                />
              </div>

              {/* Image prompt */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-[#55555D] uppercase tracking-wider">
                  {t('create.imagePromptLabel')}
                </label>
                <textarea
                  value={imagePrompt}
                  onChange={e => setImagePrompt(e.target.value)}
                  placeholder={t('create.imagePromptPlaceholder')}
                  rows={3}
                  className="glass-input w-full px-3 py-3 text-sm leading-relaxed"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                />
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
                    {t('create.generatePost')}
                  </>
                )}
              </motion.button>
            </div>
          </GlassCard>
        </motion.div>

        {/* No-channel notice */}
        {state.channels.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.2 }}
          >
            <div className="flex items-start gap-3 px-3.5 py-3 rounded-[14px] bg-white/[0.03] border border-white/[0.07]">
              <Radio size={15} className="text-[#44444C] shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] font-semibold text-white">{t('create.noChannel')}</p>
                <p className="text-[11px] text-[#55555D] mt-0.5 leading-relaxed">{t('create.noChannelSub')}</p>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
