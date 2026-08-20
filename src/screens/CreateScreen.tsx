import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Check, Loader2, Radio, ImagePlus, X, PencilLine } from 'lucide-react'
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

type GenerateApiPost = Omit<GeneratedPost, 'createdAt' | 'scheduledAt' | 'publishedAt' | 'banner'> & {
  createdAt:   string
  scheduledAt: string | null
  publishedAt: string | null
}

interface CreateScreenProps {
  onPostCreated: (id: string) => void
  /** Text handed over from the AI assistant ("Отправить в Create") — prefills
   *  the input and auto-starts generation. `nonce` re-triggers on each handoff. */
  prefill?: { text: string; nonce: number } | null
  /** Called once the prefill has been consumed, so the parent clears it and a
   *  later remount of this screen never re-runs the same handoff generation. */
  onPrefillConsumed?: () => void
}

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())

// Handoff nonces that have already kicked off a generation. Module-level so the
// guard survives this screen unmounting/remounting (tab switch, navigation to the
// new post, AnimatePresence churn). Without it, a remount with a still-present
// prefill re-fires the same handoff — which produced an endless generation loop.
const consumedHandoffNonces = new Set<number>()

export function CreateScreen({ onPostCreated, prefill, onPrefillConsumed }: CreateScreenProps) {
  const { state, activeChannel, addPost, showToast, t, language, authStatus, canGenerate: hasQuota, createsRemaining, applyServerSubscription } = useApp()
  const isRu = language === 'ru'
  const { step: wtStep } = useWalkthrough()
  const [input, setInput] = useState('')
  const [useBrandKit, setUseBrandKit] = useState(true)
  const visualAvailable = state.user.subscription.limits.canUseAiVisuals && state.user.subscription.usage.visuals.used < state.user.subscription.usage.visuals.limit
  const [generateVisual, setGenerateVisual] = useState(visualAvailable)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploadingShot, setUploadingShot] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [done, setDone] = useState(false)
  // 'ai' = source → neural generation; 'blank' = build a post by hand in the editor.
  const [mode, setMode] = useState<'ai' | 'blank'>('ai')
  const [creatingBlank, setCreatingBlank] = useState(false)
  const shotRef = useRef<HTMLInputElement>(null)

  const hasInput = input.trim().length > 3 || !!imageUrl
  const canGenerate = hasInput && !isGenerating && hasQuota

  const uploadShot = async (file: File) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast(isRu ? 'Доступно только в Telegram' : 'Telegram only', 'error'); return }
    setUploadingShot(true)
    try {
      const form = new FormData()
      form.append('initData', initData)
      form.append('image', file)
      const res = await fetch(`${API_BASE}/api/posts/upload-block-image`, { method: 'POST', body: form })
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !data.url) { showToast(data.error ?? (isRu ? 'Не удалось загрузить' : 'Upload failed'), 'error'); return }
      setImageUrl(data.url)
    } catch {
      showToast(isRu ? 'Ошибка загрузки' : 'Upload error', 'error')
    } finally {
      setUploadingShot(false)
    }
  }

  const handleGenerate = async (overrideInput?: string) => {
    const text = (overrideInput ?? input).trim()
    if ((!text && !imageUrl) || !activeChannel || isGenerating) return
    if (!hasQuota) { showToast(t('create.limitToast'), 'error'); return }

    setIsGenerating(true); setDone(false)
    try {
      let post: GeneratedPost
      const sourceType = imageUrl ? 'photo' : isUrl(text) ? 'link' : 'prompt'

      if (authStatus === 'authenticated') {
        const initData = getTelegramInitData()
        if (!initData) throw new Error('No initData')
        const res = await fetch(`${API_BASE}/api/posts/generate`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            initData,
            channelId: state.activeChannelId,
            input:     text,
            sourceType,
            useBrandKit,
            generateVisual: generateVisual && visualAvailable,
            ...(imageUrl ? { imageUrl } : {}),
          }),
        })
        if (!res.ok) throw new Error(`generate failed: ${res.status}`)
        const data = await res.json() as { post: GenerateApiPost; subscription?: Parameters<typeof applyServerSubscription>[0] }
        if (data.subscription) applyServerSubscription(data.subscription)
        post = {
          ...data.post,
          createdAt:   new Date(data.post.createdAt),
          scheduledAt: data.post.scheduledAt != null ? new Date(data.post.scheduledAt) : undefined,
          publishedAt: data.post.publishedAt != null ? new Date(data.post.publishedAt) : undefined,
        }
      } else {
        const brandKit = brandKitService.getByChannelId(state.activeChannelId)
        if (!brandKit) { showToast(t('create.generationFailed'), 'error'); return }
        post = await generationService.generate({
          input: text, sourceType, channelId: state.activeChannelId,
          channelUsername: activeChannel.username, brandKit,
        })
      }

      addPost(post)
      setDone(true)
      setInput(''); setImageUrl(null)
      setTimeout(() => { setDone(false); onPostCreated(post.id) }, 700)
    } catch {
      showToast(t('create.generationFailed'), 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  // Manual mode: create an empty draft on the server and open it in the block
  // editor (PostDetailsScreen). No AI, no quota — just a blank post to build by hand.
  const handleCreateBlank = async () => {
    if (!activeChannel || creatingBlank) return
    if (authStatus !== 'authenticated') { showToast(isRu ? 'Доступно только в Telegram' : 'Telegram only', 'error'); return }
    const initData = getTelegramInitData()
    if (!initData) { showToast(isRu ? 'Доступно только в Telegram' : 'Telegram only', 'error'); return }
    setCreatingBlank(true)
    try {
      const res = await fetch(`${API_BASE}/api/posts/create-blank`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, channelId: state.activeChannelId, title: isRu ? 'Новый пост' : 'New post' }),
      })
      if (!res.ok) throw new Error(`create-blank failed: ${res.status}`)
      const data = await res.json() as { post: GenerateApiPost }
      const post: GeneratedPost = {
        ...data.post,
        createdAt:   new Date(data.post.createdAt),
        scheduledAt: data.post.scheduledAt != null ? new Date(data.post.scheduledAt) : undefined,
        publishedAt: data.post.publishedAt != null ? new Date(data.post.publishedAt) : undefined,
      }
      addPost(post)
      onPostCreated(post.id)
    } catch {
      showToast(t('create.generationFailed'), 'error')
    } finally {
      setCreatingBlank(false)
    }
  }

  // AI assistant → Create handoff: prefill the input and auto-start generation.
  // Clear the prefill in the parent the moment it's consumed — otherwise a later
  // remount of this screen (e.g. navigating back to the Create tab) would re-run
  // the same handoff and create a duplicate post with its own cover.
  useEffect(() => {
    if (!prefill?.text) return
    // Fire each handoff exactly once, ever. Clearing the prefill in the parent is
    // not enough on its own: a remount can read a still-present prefill before the
    // clear commits, re-firing generation in a loop. This module-level set is the
    // authoritative once-only guard.
    if (consumedHandoffNonces.has(prefill.nonce)) return
    consumedHandoffNonces.add(prefill.nonce)
    setMode('ai')
    setInput(prefill.text)
    handleGenerate(prefill.text)
    onPrefillConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce])

  return (
    <div>
      <ChannelSwitcherHeader />

      <div className="px-4 space-y-2.5">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <GlassCard strong padding="none" className="overflow-hidden">
            <div className="p-4 space-y-3.5">
              <h2 className="text-[15px] font-semibold text-white">{isRu ? 'Создать пост' : 'Create a post'}</h2>

              {/* Mode toggle: AI generation vs manual block editor */}
              <div className="flex gap-1 p-1 rounded-[12px] bg-white/[0.04] border border-white/[0.06]">
                {([['ai', Sparkles, isRu ? 'С помощью ИИ' : 'With AI'], ['blank', PencilLine, isRu ? 'С нуля' : 'From scratch']] as const).map(([m, Icon, label]) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[9px] text-[12.5px] font-semibold transition-colors',
                      mode === m ? 'bg-[#FF6A00] text-white' : 'text-[#A1A1AA]')}>
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>

              {mode === 'ai' ? (
                <>
                  {/* Single AI input: text, link, or idea */}
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={isRu
                      ? 'Ссылка, текст или идея. Напр.: «новость про X», вставь ссылку на статью, или опиши пост…'
                      : 'A link, text, or idea. e.g. "news about X", paste an article link, or describe the post…'}
                    rows={5}
                    className="glass-input w-full px-3 py-3 text-sm leading-relaxed"
                    style={{ background: 'rgba(255,255,255,0.03)' }}
                  />

                  {/* Screenshot attach */}
                  <input ref={shotRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadShot(f); e.target.value = '' }} />
                  {imageUrl ? (
                    <div className="flex items-center gap-2.5 p-2 rounded-[12px] bg-white/[0.03] border border-white/[0.07]">
                      <img src={imageUrl} alt="" className="w-12 h-12 rounded-[8px] object-cover" />
                      <span className="flex-1 text-[12px] text-[#A1A1AA]">{isRu ? 'Скриншот прикреплён' : 'Screenshot attached'}</span>
                      <button onClick={() => setImageUrl(null)} className="p-1.5 text-[#55555D] hover:text-red-400"><X size={14} /></button>
                    </div>
                  ) : (
                    <button onClick={() => shotRef.current?.click()} disabled={uploadingShot}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[12px] border border-dashed border-white/[0.12] text-[12.5px] text-[#A1A1AA] hover:border-[#FF6A00]/40 hover:text-[#FF6A00] transition-colors disabled:opacity-50">
                      {uploadingShot ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                      {isRu ? 'Прикрепить скриншот' : 'Attach a screenshot'}
                    </button>
                  )}

                  <Switch
                    label={t('create.useBrandKit')}
                    description={t('create.useBrandKitDesc')}
                    value={useBrandKit}
                    onChange={setUseBrandKit}
                  />
                </>
              ) : (
                <div className="px-3.5 py-3 rounded-[14px] bg-white/[0.03] border border-white/[0.07]">
                  <div>
                    <p className="text-[12px] font-semibold text-white">{isRu ? 'Собрать пост вручную' : 'Build a post by hand'}</p>
                    <p className="text-[11px] text-[#55555D] mt-0.5 leading-relaxed">
                      {isRu
                        ? 'Открой редактор: пиши текст блоками, форматируй, добавляй и генерируй картинки — без нейросети.'
                        : 'Open the editor: write text in blocks, format it, add or generate images — no AI.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 pb-4 space-y-2">
              {wtStep === 'create' && (
                <Coachmark stepLabel={t('onboarding.step3')} title={t('onboarding.createTitle')} text={t('onboarding.createText')} />
              )}

              {mode === 'ai' && (
                <div className="rounded-[12px] border border-white/[0.07] bg-white/[0.025] px-3 py-3">
                  <Switch
                    label={isRu ? 'Создать AI-обложку' : 'Generate AI cover'}
                    description={visualAvailable
                      ? (isRu ? `Спишется 1 визуал · осталось ${Math.max(0, state.user.subscription.usage.visuals.limit - state.user.subscription.usage.visuals.used)}` : 'Uses 1 visual credit')
                      : (isRu ? 'Недоступно на тарифе или лимит исчерпан' : 'Unavailable on your plan or limit reached')}
                    value={generateVisual && visualAvailable}
                    onChange={value => setGenerateVisual(value && visualAvailable)}
                  />
                </div>
              )}
              {mode === 'ai' && createsRemaining !== null && (
                <div className={cn('flex items-center justify-between px-3 py-2 rounded-[10px] text-[12px]',
                  createsRemaining === 0 ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                  : createsRemaining <= 5 ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                  : 'bg-white/[0.03] border border-white/[0.07] text-[#55555D]')}>
                  <span>{isRu ? 'AI-текстов осталось' : 'AI texts left'}</span>
                  <span className="font-semibold">{createsRemaining}</span>
                </div>
              )}

              {mode === 'ai' && !hasQuota && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-[10px] bg-red-500/10 border border-red-500/20">
                  <span className="text-[12px] text-red-400 leading-snug">
                    {t('create.limitReached')} <span className="font-semibold underline cursor-pointer">{t('create.upgradePlan')}</span>
                  </span>
                </div>
              )}

              {/* Progress + note while generating */}
              {mode === 'ai' && isGenerating && (
                <div className="space-y-1.5">
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full w-2/3 bg-[#FF6A00] rounded-full animate-pulse" />
                  </div>
                  <p className="text-[11px] text-[#55555D] text-center">
                    {isRu ? 'Собираю пост — это может занять до минуты' : 'Building the post — this can take up to a minute'}
                  </p>
                </div>
              )}

              {mode === 'ai' ? (
                <HighlightRing active={wtStep === 'create'}>
                  <motion.button
                    onClick={() => handleGenerate()}
                    disabled={!canGenerate}
                    whileTap={{ scale: canGenerate ? 0.97 : 1 }}
                    className={cn('w-full flex items-center justify-center gap-2.5 py-3.5 rounded-[14px] text-sm font-semibold transition-all duration-200',
                      canGenerate && !isGenerating && !done ? 'bg-[#FF6A00] text-white hover:bg-[#ff7a1a] orange-glow'
                      : done ? 'bg-[rgba(255,106,0,0.20)] text-[#FF6A00] border border-[rgba(255,106,0,0.38)]'
                      : 'bg-white/[0.04] text-[#44444C] border border-white/[0.06] cursor-not-allowed')}>
                    {isGenerating ? <><Loader2 size={16} className="animate-spin" />{t('create.generating')}</>
                      : done ? <><Check size={16} />{t('create.postsReady')}</>
                      : (isRu ? 'Создать' : 'Create')}
                  </motion.button>
                </HighlightRing>
              ) : (
                <motion.button
                  onClick={handleCreateBlank}
                  disabled={!activeChannel || creatingBlank}
                  whileTap={{ scale: !activeChannel || creatingBlank ? 1 : 0.97 }}
                  className={cn('w-full flex items-center justify-center gap-2.5 py-3.5 rounded-[14px] text-sm font-semibold transition-all duration-200',
                    activeChannel && !creatingBlank ? 'bg-[#FF6A00] text-white hover:bg-[#ff7a1a] orange-glow'
                    : 'bg-white/[0.04] text-[#44444C] border border-white/[0.06] cursor-not-allowed')}>
                  {creatingBlank ? <><Loader2 size={16} className="animate-spin" />{isRu ? 'Создаю…' : 'Creating…'}</>
                    : (isRu ? 'Открыть редактор' : 'Open editor')}
                </motion.button>
              )}
            </div>
          </GlassCard>
        </motion.div>

        {state.channels.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.2 }}>
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
