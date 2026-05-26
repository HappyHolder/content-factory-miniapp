import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { useApp } from '@/context/AppContext'
import type { EmojiPackConfig } from '@/types'

interface EmojiPackFormProps {
  channelId: string
  initialData: EmojiPackConfig
}


export function EmojiPackForm({ channelId, initialData }: EmojiPackFormProps) {
  const { updateBrandKit, t } = useApp()
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
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
          {t('channelStyle.emoji.packLink')}
        </p>
        <input
          value={data.packLink}
          onChange={e => set('packLink', e.target.value)}
          placeholder="t.me/addemoji/..."
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
        <p className="text-[11px] text-[#66666E] mt-1.5">{t('channelStyle.emoji.packLinkHint')}</p>
      </div>

      <div className="space-y-3 py-1">
        <Switch
          label={t('channelStyle.emoji.strictMode')}
          description={t('channelStyle.emoji.strictModeDesc')}
          value={data.strictMode}
          onChange={v => set('strictMode', v)}
        />
        <Switch
          label={t('channelStyle.emoji.fallback')}
          description={t('channelStyle.emoji.fallbackDesc')}
          value={data.fallbackToStandard}
          onChange={v => set('fallbackToStandard', v)}
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
          {t('channelStyle.emoji.allowed')}
        </p>
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
            <span className="text-xs text-[#66666E] self-center">{t('channelStyle.emoji.noEmoji')}</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={emojiInput}
            onChange={e => setEmojiInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addEmoji()}
            placeholder={t('channelStyle.emoji.placeholder')}
            className="glass-input flex-1 px-3 py-2 text-sm"
          />
          <Button variant="secondary" size="sm" onClick={addEmoji}>
            {t('channelStyle.emoji.add')}
          </Button>
        </div>
      </div>

      <Button variant="primary" size="md" onClick={() => updateBrandKit(channelId, { emojiPack: data })} fullWidth>
        {t('channelStyle.save.emoji')}
      </Button>
    </div>
  )
}
