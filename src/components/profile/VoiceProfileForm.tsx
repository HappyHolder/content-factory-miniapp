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
              'px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all duration-150',
              value === opt.value
                ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border-[rgba(255,106,0,0.38)]'
                : 'bg-white/5 text-[#A1A1AA] border-white/8 hover:bg-white/8'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TagInput({ label, tags, onChange }: { label: string; tags: string[]; onChange: (t: string[]) => void }) {
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
            className="px-2.5 py-1 rounded-full text-xs bg-white/8 text-[#A1A1AA] border border-white/10 cursor-pointer hover:border-red-500/40 hover:text-red-400 transition-colors"
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
          placeholder="Add word…"
          className="glass-input flex-1 px-3 py-2 text-sm"
        />
        <Button variant="secondary" size="sm" onClick={add}>Add</Button>
      </div>
    </div>
  )
}

export function VoiceProfileForm({ channelId, initialData }: VoiceProfileFormProps) {
  const { updateBrandKit } = useApp()
  const [data, setData] = useState<VoiceProfile>(initialData)

  const set = <K extends keyof VoiceProfile>(key: K, val: VoiceProfile[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  const handleSave = () => {
    updateBrandKit(channelId, { voiceProfile: data })
  }

  return (
    <div className="space-y-5">
      <OptionGroup<Language>
        label="Language"
        options={[{ value: 'EN', label: 'EN' }, { value: 'RU', label: 'RU' }]}
        value={data.language}
        onChange={v => set('language', v)}
      />
      <OptionGroup<AddressStyle>
        label="Address style"
        options={[{ value: 'ты', label: 'ты (informal)' }, { value: 'вы', label: 'вы (formal)' }]}
        value={data.addressStyle}
        onChange={v => set('addressStyle', v)}
      />
      <OptionGroup<Tone>
        label="Tone"
        options={[
          { value: 'expert', label: 'Expert' },
          { value: 'calm', label: 'Calm' },
          { value: 'founder', label: 'Founder' },
          { value: 'crypto', label: 'Crypto' },
          { value: 'bold', label: 'Bold' },
          { value: 'meme', label: 'Meme' },
        ]}
        value={data.tone}
        onChange={v => set('tone', v)}
      />
      <OptionGroup<PostLength>
        label="Post length"
        options={[
          { value: 'short', label: 'Short' },
          { value: 'medium', label: 'Medium' },
          { value: 'long', label: 'Long' },
        ]}
        value={data.postLength}
        onChange={v => set('postLength', v)}
      />
      <OptionGroup<EmojiDensity>
        label="Emoji density"
        options={[
          { value: 'none', label: 'None' },
          { value: 'light', label: 'Light' },
          { value: 'medium', label: 'Medium' },
          { value: 'active', label: 'Active' },
        ]}
        value={data.emojiDensity}
        onChange={v => set('emojiDensity', v)}
      />
      <TagInput label="Favorite words" tags={data.favoriteWords} onChange={v => set('favoriteWords', v)} />
      <TagInput label="Forbidden words" tags={data.forbiddenWords} onChange={v => set('forbiddenWords', v)} />
      <Button variant="primary" size="md" onClick={handleSave} fullWidth>Save Voice Profile</Button>
    </div>
  )
}
