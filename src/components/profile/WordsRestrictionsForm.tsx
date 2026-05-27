import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import type { VoiceProfile, PostRules } from '@/types'

interface WordsRestrictionsFormProps {
  channelId: string
  initialVoice: VoiceProfile
  initialRules: PostRules
}

function TagInput({
  label,
  hint,
  tags,
  onAdd,
  onRemove,
  placeholder,
  addLabel,
}: {
  label: string
  hint: string
  tags: string[]
  onAdd: (val: string) => void
  onRemove: (val: string) => void
  placeholder: string
  addLabel: string
}) {
  const [input, setInput] = useState('')
  const submit = () => {
    const val = input.trim()
    if (val && !tags.includes(val)) onAdd(val)
    setInput('')
  }
  return (
    <div>
      <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1">{label}</p>
      <p className="text-[11px] text-[#55555D] mb-2">{hint}</p>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map(tag => (
            <span
              key={tag}
              className="flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[12px] text-[#A1A1AA]"
            >
              {tag}
              <button
                onClick={() => onRemove(tag)}
                className="text-[#55555D] hover:text-white transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          className="glass-input flex-1 px-3 py-2 text-sm"
        />
        <Button variant="secondary" size="sm" onClick={submit}>{addLabel}</Button>
      </div>
    </div>
  )
}

export function WordsRestrictionsForm({ channelId, initialVoice, initialRules }: WordsRestrictionsFormProps) {
  const { state, updateBrandKit, t } = useApp()

  const [favoriteWords,  setFavoriteWords]  = useState<string[]>(initialVoice.favoriteWords)
  const [forbiddenWords, setForbiddenWords] = useState<string[]>(initialVoice.forbiddenWords)
  const [thingsToAvoid,  setThingsToAvoid]  = useState<string[]>(initialRules.thingsToAvoid ?? [])

  const handleSave = () => {
    const liveKit = state.brandKits.find(k => k.channelId === channelId)
    updateBrandKit(channelId, {
      voiceProfile: { ...(liveKit?.voiceProfile ?? initialVoice), favoriteWords, forbiddenWords },
      postRules:    { ...(liveKit?.postRules    ?? initialRules),  thingsToAvoid },
    })
  }

  return (
    <div className="space-y-5">
      <TagInput
        label={t('channelStyle.words.favoriteWords')}
        hint={t('channelStyle.words.favoriteWordsHint')}
        tags={favoriteWords}
        onAdd={v  => setFavoriteWords(prev => [...prev, v])}
        onRemove={v => setFavoriteWords(prev => prev.filter(x => x !== v))}
        placeholder={t('channelStyle.words.addWord')}
        addLabel={t('channelStyle.words.add')}
      />

      <TagInput
        label={t('channelStyle.words.forbiddenWords')}
        hint={t('channelStyle.words.forbiddenWordsHint')}
        tags={forbiddenWords}
        onAdd={v  => setForbiddenWords(prev => [...prev, v])}
        onRemove={v => setForbiddenWords(prev => prev.filter(x => x !== v))}
        placeholder={t('channelStyle.words.addWord')}
        addLabel={t('channelStyle.words.add')}
      />

      <TagInput
        label={t('channelStyle.words.thingsToAvoid')}
        hint={t('channelStyle.words.thingsToAvoidHint')}
        tags={thingsToAvoid}
        onAdd={v  => setThingsToAvoid(prev => [...prev, v])}
        onRemove={v => setThingsToAvoid(prev => prev.filter(x => x !== v))}
        placeholder={t('channelStyle.words.avoidPlaceholder')}
        addLabel={t('channelStyle.words.add')}
      />

      <Button variant="primary" size="md" onClick={handleSave} fullWidth>
        {t('channelStyle.save.words')}
      </Button>
    </div>
  )
}
