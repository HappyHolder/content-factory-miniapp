import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Check, Loader2, Radio } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useWalkthrough } from '@/context/WalkthroughContext'
import { Coachmark, HighlightRing } from '@/components/onboarding/Coachmark'
import { ChannelSwitcherHeader } from '@/components/layout/ChannelSwitcherHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { Switch } from '@/components/ui/Switch'
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
  const { state, activeChannel, addPost, showToast, t, language, authStatus, canGenerate: hasQuota, createsRemaining } = useApp()
  const isRu = language === 'ru'
  const { step: wtStep } = useWalkthrough()
  const [textPrompt, setTextPrompt] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [useBrandKit, setUseBrandKit] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [done, setDone] = useState(false)

  // Cover engine for THIS generation. Defaults to the channel's saved mode,
  // re-synced when the active channel changes. HTML is a paid feature.
  const channelCoverMode =
    (brandKitService.getByChannelId(state.activeChannelId)?.visualKit?.coverMode ?? 'ai') as 'ai' | 'html'
  const canUseHtml = state.user.subscription.planTier !== 'free'
  const [coverMode, setCoverMode] = useState<'ai' | 'html'>(channelCoverMode)
  useEffect(() => { setCoverMode(channelCoverMode) }, [state.activeChannelId, channelCoverMode])

  const hasInput = textPrompt.trim().length > 3 || imagePrompt.trim().length > 3
  const canGenerate = hasInput && !isGenerating && hasQuota

  const handleGenerate = async () => {
    if (!hasInput || !activeChannel) return
    if (!hasQuota) {
      showToast(t('create.limitToast'), 'error')
      return
    }

    setIsGenerating(true)
    setDone(false)

    try {
      let post: GeneratedPost

      if (authStatus === 'authenticated') {
        const initData = getTelegramInitData()
        if (!initData) throw new Error('No initData')

        const effectiveInput = textPrompt.trim() || imagePrompt.trim()
        const res = await fetch(`${API_BASE}/api/posts/generate`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            initData,
            channelId:   state.activeChannelId,
            input:       effectiveInput,
            sourceType:  'prompt',
            useBrandKit,
            imageOnly:   !textPrompt.trim() && !!imagePrompt.trim(),
            ...(useBrandKit ? { coverMode } : {}),
            ...(imagePrompt.trim() ? { imagePrompt: imagePrompt.trim() } : {}),
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

              {/* BrandKit toggle */}
              <Switch
                label={t('create.useBrandKit')}
                description={t('create.useBrandKitDesc')}
                value={useBrandKit}
                onChange={setUseBrandKit}
              />

              {/* Cover engine for this generation (only with channel style) */}
              {useBrandKit && (
                <div>
                  <p className="text-[11px] font-semibold text-[#55555D] uppercase tracking-wider mb-1.5">
                    {isRu ? 'Движок обложки' : 'Cover engine'}
                  </p>
                  <div className="flex gap-1 p-1 rounded-[12px] bg-white/[0.04] border border-white/[0.06]">
                    {(['ai', 'html'] as const).map(mode => {
                      const locked = mode === 'html' && !canUseHtml
                      return (
                        <button
                          key={mode}
                          onClick={() => {
                            if (locked) {
                              showToast(isRu
                                ? 'HTML-обложки доступны на платных тарифах'
                                : 'HTML covers are available on paid plans', 'info')
                              return
                            }
                            setCoverMode(mode)
                          }}
                          className={cn(
                            'flex-1 py-1.5 rounded-[9px] text-[12px] font-semibold transition-all',
                            coverMode === mode
                              ? 'bg-[#FF6A00] text-white shadow-sm'
                              : locked ? 'text-[#44444C]' : 'text-[#55555D] hover:text-[#A1A1AA]'
                          )}
                        >
                          {mode === 'ai' ? '✦ AI' : (locked ? '🔒 HTML' : '</> HTML')}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 pb-4 space-y-2">
              {/* Walkthrough step 3 */}
              {wtStep === 'create' && (
                <Coachmark
                  stepLabel={t('onboarding.step3')}
                  title={t('onboarding.createTitle')}
                  text={t('onboarding.createText')}
                />
              )}

              {/* Quota counter */}
              {createsRemaining !== null && (
                <div className={cn(
                  'flex items-center justify-between px-3 py-2 rounded-[10px] text-[12px]',
                  createsRemaining === 0
                    ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                    : createsRemaining <= 5
                      ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                      : 'bg-white/[0.03] border border-white/[0.07] text-[#55555D]'
                )}>
                  <span>{t('create.creditsLeft')}</span>
                  <span className="font-semibold">{createsRemaining}</span>
                </div>
              )}

              {/* Limit reached banner */}
              {!hasQuota && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-[10px] bg-red-500/10 border border-red-500/20">
                  <span className="text-[12px] text-red-400 leading-snug">
                    {t('create.limitReached')} <span className="font-semibold underline cursor-pointer">{t('create.upgradePlan')}</span>
                  </span>
                </div>
              )}

              <HighlightRing active={wtStep === 'create'}>
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
              </HighlightRing>
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
