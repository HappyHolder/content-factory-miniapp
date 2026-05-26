import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import type { EmojiPackConfig } from '@/types'
import { cn } from '@/lib/utils'

interface EmojiPackFormProps {
  channelId: string
  initialData: EmojiPackConfig
}

function Toggle({ label, description, value, onChange }: {
  label: string; description?: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-[12px] text-[#66666E] mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          'relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 mt-0.5',
          value ? 'bg-[#FF6A00]' : 'bg-white/12'
        )}
      >
        <span className={cn(
          'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200',
          value ? 'translate-x-[22px]' : 'translate-x-0.5'
        )} />
      </button>
    </div>
  )
}

export function EmojiPackForm({ channelId, initialData }: EmojiPackFormProps) {
  const { updateBrandKit } = useApp()
  const [data, setData] = useState<EmojiPackConfig>(initialData)
  const [emojiInput, setEmojiInput] = useState('')

  const set = <K extends keyof EmojiPackConfig>(key: K, val: EmojiPackConfig[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  const addEmoji = () => {
    const chars = [...emojiInput.trim()]
    const unique = chars.filter(e => e && !data.allowedEmojis.includes(e))
    if (unique.length) set('allowedEmojis', [...data.allowedEmojis, ...unique])
    setEmojiInput('')
  }

  const removeEmoji = (e: string) => set('allowedEmojis', data.allowedEmojis.filter(x => x !== e))

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">Emoji pack link</p>
        <input
          value={data.packLink}
          onChange={e => set('packLink', e.target.value)}
          placeholder="t.me/addemoji/..."
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
        <p className="text-[11px] text-[#66666E] mt-1.5">Link a Telegram custom emoji pack</p>
      </div>

      <div className="space-y-3 py-1">
        <Toggle
          label="Strict mode"
          description="Only use emojis from this pack. No random emoji."
          value={data.strictMode}
          onChange={v => set('strictMode', v)}
        />
        <Toggle
          label="Fallback to standard emoji"
          description="Use standard emoji if pack emoji aren't available"
          value={data.fallbackToStandard}
          onChange={v => set('fallbackToStandard', v)}
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">Allowed emoji</p>
        <div className="flex flex-wrap gap-2 mb-2 min-h-[36px]">
          {data.allowedEmojis.map(e => (
            <button
              key={e}
              onClick={() => removeEmoji(e)}
              className="text-xl hover:scale-110 transition-transform active:scale-90 select-none"
              title="Click to remove"
            >
              {e}
            </button>
          ))}
          {data.allowedEmojis.length === 0 && (
            <span className="text-xs text-[#66666E] self-center">No emoji added yet</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={emojiInput}
            onChange={e => setEmojiInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addEmoji()}
            placeholder="Type or paste emoji…"
            className="glass-input flex-1 px-3 py-2 text-sm"
          />
          <Button variant="secondary" size="sm" onClick={addEmoji}>Add</Button>
        </div>
      </div>

      <Button variant="primary" size="md" onClick={() => updateBrandKit(channelId, { emojiPack: data })} fullWidth>
        Save Emoji Pack
      </Button>
    </div>
  )
}
