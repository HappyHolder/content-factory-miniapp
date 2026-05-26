import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { GlassCard } from '@/components/ui/GlassCard'
import { useApp } from '@/context/AppContext'
import type { VoiceProfile, Tone, PostLength, EmojiDensity, Language, AddressStyle } from '@/types'
import { cn } from '@/lib/utils'

interface VoiceProfileFormProps {
  channelId: string
  initialData: VoiceProfile
}

function OptionGroup<T extends string>({
  label, options, value, onChange,
}: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div>
      <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3 py-1 rounded-full text-[12px] font-medium border transition-all duration-150',
              value === opt.value
                ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border-[rgba(255,106,0,0.38)]'
                : 'bg-white/5 text-[#A1A1AA] border-white/[0.06] hover:bg-white/8'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TagInput({ label, addLabel, tags, placeholder, onChange }: {
  label: string
  addLabel: string
  tags: string[]
  placeholder: string
  onChange: (t: string[]) => void
}) {
  const [input, setInput] = useState('')
  const add = () => {
    const val = input.trim()
    if (val && !tags.includes(val)) onChange([...tags, val])
    setInput('')
  }
  return (
    <div>
      <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map(tag => (
          <span
            key={tag}
            onClick={() => onChange(tags.filter(t => t !== tag))}
            className="px-2.5 py-1 rounded-full text-xs bg-white/8 text-[#A1A1AA] border border-white/[0.06] cursor-pointer hover:border-red-500/40 hover:text-red-400 transition-colors"
          >
            {tag} ×
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={placeholder}
          className="glass-input flex-1 px-3 py-2 text-sm"
        />
        <Button variant="secondary" size="sm" onClick={add}>{addLabel}</Button>
      </div>
    </div>
  )
}

export function VoiceProfileForm({ channelId, initialData }: VoiceProfileFormProps) {
  const { updateBrandKit, t } = useApp()
  const [data, setData] = useState<VoiceProfile>(initialData)

  const set = <K extends keyof VoiceProfile>(key: K, val: VoiceProfile[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  const handleSave = () => {
    updateBrandKit(channelId, { voiceProfile: data })
  }

  return (
    <div className="space-y-4">
      <OptionGroup<Language>
        label={t('channelStyle.voice.language')}
        options={[{ value: 'EN', label: 'EN' }, { value: 'RU', label: 'RU' }]}
        value={data.language}
        onChange={v => set('language', v)}
      />
      <OptionGroup<AddressStyle>
        label={t('channelStyle.voice.addressStyle')}
        options={[
          { value: 'ты', label: t('channelStyle.voice.addressTy') },
          { value: 'вы', label: t('channelStyle.voice.addressVy') },
        ]}
        value={data.addressStyle}
        onChange={v => set('addressStyle', v)}
      />
      <OptionGroup<Tone>
        label={t('channelStyle.voice.tone')}
        options={[
          { value: 'expert',  label: t('channelStyle.voice.toneExpert')  },
          { value: 'calm',    label: t('channelStyle.voice.toneCalm')    },
          { value: 'founder', label: t('channelStyle.voice.toneFounder') },
          { value: 'crypto',  label: t('channelStyle.voice.toneCrypto')  },
          { value: 'bold',    label: t('channelStyle.voice.toneBold')    },
          { value: 'meme',    label: t('channelStyle.voice.toneMeme')    },
        ]}
        value={data.tone}
        onChange={v => set('tone', v)}
      />
      <OptionGroup<PostLength>
        label={t('channelStyle.voice.postLength')}
        options={[
          { value: 'short',  label: t('channelStyle.voice.short')  },
          { value: 'medium', label: t('channelStyle.voice.medium') },
          { value: 'long',   label: t('channelStyle.voice.long')   },
        ]}
        value={data.postLength}
        onChange={v => set('postLength', v)}
      />
      <OptionGroup<EmojiDensity>
        label={t('channelStyle.voice.emojiDensity')}
        options={[
          { value: 'none',   label: t('channelStyle.voice.densityNone')   },
          { value: 'light',  label: t('channelStyle.voice.densityLight')  },
          { value: 'medium', label: t('channelStyle.voice.densityMedium') },
          { value: 'active', label: t('channelStyle.voice.densityActive') },
        ]}
        value={data.emojiDensity}
        onChange={v => set('emojiDensity', v)}
      />
      <TagInput
        label={t('channelStyle.voice.favoriteWords')}
        addLabel={t('channelStyle.voice.add')}
        placeholder={t('channelStyle.voice.addWord')}
        tags={data.favoriteWords}
        onChange={v => set('favoriteWords', v)}
      />
      <TagInput
        label={t('channelStyle.voice.forbiddenWords')}
        addLabel={t('channelStyle.voice.add')}
        placeholder={t('channelStyle.voice.addWord')}
        tags={data.forbiddenWords}
        onChange={v => set('forbiddenWords', v)}
      />
      <Button variant="primary" size="md" onClick={handleSave} fullWidth>
        {t('channelStyle.save.voice')}
      </Button>
    </div>
  )
}
