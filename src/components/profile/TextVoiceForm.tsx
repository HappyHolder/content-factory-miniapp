import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { OptionPills } from '@/components/ui/OptionPills'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import type { VoiceProfile, EmojiPackConfig, EmojiPackEntry, Language, AddressStyle, AuthorRole, Tone, PostLength, EmojiDensity } from '@/types'

interface TextVoiceFormProps {
  channelId: string
  initialVoice: VoiceProfile
  initialEmoji: EmojiPackConfig
}

export function TextVoiceForm({ channelId, initialVoice, initialEmoji }: TextVoiceFormProps) {
  const { updateBrandKit, showToast, authStatus, t } = useApp()
  const [voice, setVoice] = useState<VoiceProfile>(initialVoice)
  const [emoji, setEmoji] = useState<EmojiPackConfig>(initialEmoji)
  const [emojiInput, setEmojiInput] = useState('')
  const [isResolving, setIsResolving] = useState(false)

  const setV = <K extends keyof VoiceProfile>(key: K, val: VoiceProfile[K]) =>
    setVoice(prev => ({ ...prev, [key]: val }))
  const setE = <K extends keyof EmojiPackConfig>(key: K, val: EmojiPackConfig[K]) =>
    setEmoji(prev => ({ ...prev, [key]: val }))

  // ── Emoji pack helpers ─────────────────────────────────────────────────────
  // allowedEmojis is backward-compatible: entries may be plain strings (legacy)
  // or EmojiPackEntry objects (new). Helpers normalise access.

  const entryUnicode = (e: string | EmojiPackEntry) =>
    typeof e === 'string' ? e : e.unicode

  const entryId = (e: string | EmojiPackEntry) =>
    typeof e === 'string' ? '' : (e.customEmojiId ?? '')

  const addEmoji = () => {
    const chars = [...emojiInput.trim()]
    const existing = emoji.allowedEmojis.map(entryUnicode)
    const unique = chars.filter(c => c && !existing.includes(c))
    if (unique.length) setE('allowedEmojis', [...emoji.allowedEmojis, ...unique])
    setEmojiInput('')
  }

  const removeEmoji = (unicode: string) =>
    setE('allowedEmojis', emoji.allowedEmojis.filter(x => entryUnicode(x) !== unicode))

  /** Update (or clear) the customEmojiId for an existing entry. */
  const setEntryCustomId = (unicode: string, id: string) => {
    setE('allowedEmojis', emoji.allowedEmojis.map(x => {
      if (entryUnicode(x) !== unicode) return x
      const base: EmojiPackEntry = typeof x === 'object' ? { ...x } : { unicode }
      if (id) return { ...base, customEmojiId: id }
      // Strip customEmojiId; if no other fields remain, revert to plain string
      const { customEmojiId: _dropped, ...rest } = { ...base, customEmojiId: undefined }
      void _dropped
      return (rest.key) ? rest as EmojiPackEntry : unicode
    }))
  }

  /** Calls backend to resolve packLink → customEmojiId values, then merges into allowedEmojis. */
  const handleResolvePack = async () => {
    if (authStatus !== 'authenticated') {
      showToast(t('channelStyle.textVoice.resolvePackFailed'), 'error')
      return
    }
    const initData = getTelegramInitData()
    if (!initData) {
      showToast(t('channelStyle.textVoice.resolvePackFailed'), 'error')
      return
    }
    setIsResolving(true)
    try {
      const res = await fetch(`${API_BASE}/api/brandkits/resolve-emoji-pack`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, packLink: emoji.packLink }),
      })
      const data = await res.json() as { items?: { unicode: string; customEmojiId: string }[]; error?: string }
      if (!res.ok || !data.items) {
        showToast(data.error ?? t('channelStyle.textVoice.resolvePackFailed'), 'error')
        return
      }
      if (data.items.length === 0) {
        showToast(t('channelStyle.textVoice.resolvePackFailed'), 'error')
        return
      }
      // Build a lookup map: unicode → customEmojiId
      const idMap = new Map(data.items.map(i => [i.unicode, i.customEmojiId]))
      // Merge IDs into existing allowedEmojis — only update entries that match
      setE('allowedEmojis', emoji.allowedEmojis.map(x => {
        const unicode = entryUnicode(x)
        const customEmojiId = idMap.get(unicode)
        if (!customEmojiId) return x  // no match in pack — leave unchanged
        const base: EmojiPackEntry = typeof x === 'object' ? { ...x } : { unicode }
        return { ...base, customEmojiId }
      }))
      showToast(t('channelStyle.textVoice.resolvePackSuccess'))
    } catch {
      showToast(t('channelStyle.textVoice.resolvePackFailed'), 'error')
    } finally {
      setIsResolving(false)
    }
  }

  const handleSave = () => {
    updateBrandKit(channelId, { voiceProfile: voice, emojiPack: emoji })
  }

  return (
    <div className="space-y-4">

      <OptionPills<Language>
        label={t('channelStyle.textVoice.language')}
        value={voice.language}
        onChange={v => setV('language', v)}
        options={[
          { value: 'RU', label: t('channelStyle.textVoice.langRU') },
          { value: 'EN', label: t('channelStyle.textVoice.langEN') },
        ]}
      />

      <OptionPills<AddressStyle>
        label={t('channelStyle.textVoice.addressStyle')}
        value={voice.addressStyle}
        onChange={v => setV('addressStyle', v)}
        options={[
          { value: 'ты', label: t('channelStyle.textVoice.addressTy') },
          { value: 'вы', label: t('channelStyle.textVoice.addressVy') },
        ]}
      />

      <OptionPills<AuthorRole>
        label={t('channelStyle.textVoice.authorRole')}
        value={voice.authorRole ?? 'founder'}
        onChange={v => setV('authorRole', v)}
        options={[
          { value: 'founder', label: t('channelStyle.textVoice.roleFounder') },
          { value: 'expert',  label: t('channelStyle.textVoice.roleExpert')  },
          { value: 'media',   label: t('channelStyle.textVoice.roleMedia')   },
          { value: 'team',    label: t('channelStyle.textVoice.roleTeam')    },
          { value: 'personal',label: t('channelStyle.textVoice.rolePersonal')},
        ]}
      />

      <OptionPills<Tone>
        label={t('channelStyle.textVoice.tone')}
        value={voice.tone}
        onChange={v => setV('tone', v)}
        options={[
          { value: 'founder', label: t('channelStyle.textVoice.toneFounder') },
          { value: 'expert',  label: t('channelStyle.textVoice.toneExpert')  },
          { value: 'calm',    label: t('channelStyle.textVoice.toneCalm')    },
          { value: 'bold',    label: t('channelStyle.textVoice.toneBold')    },
          { value: 'crypto',  label: t('channelStyle.textVoice.toneCrypto')  },
          { value: 'meme',    label: t('channelStyle.textVoice.toneMeme')    },
        ]}
      />

      <OptionPills<PostLength>
        label={t('channelStyle.textVoice.postLength')}
        value={voice.postLength}
        onChange={v => setV('postLength', v)}
        options={[
          { value: 'short',  label: t('channelStyle.textVoice.lengthShort')  },
          { value: 'medium', label: t('channelStyle.textVoice.lengthMedium') },
          { value: 'long',   label: t('channelStyle.textVoice.lengthLong')   },
        ]}
      />

      <OptionPills<EmojiDensity>
        label={t('channelStyle.textVoice.emojiDensity')}
        value={voice.emojiDensity}
        onChange={v => setV('emojiDensity', v)}
        options={[
          { value: 'none',   label: t('channelStyle.textVoice.densityNone')   },
          { value: 'light',  label: t('channelStyle.textVoice.densityLight')  },
          { value: 'medium', label: t('channelStyle.textVoice.densityMedium') },
          { value: 'active', label: t('channelStyle.textVoice.densityActive') },
        ]}
      />

      {/* Emoji pack sub-section */}
      <div className="pt-1">
        <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider mb-1">
          {t('channelStyle.textVoice.emojiPackSection')}
        </p>
        <p className="text-[11px] text-[#55555D] mb-3">
          {t('channelStyle.textVoice.emojiPackHint')}
        </p>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
              {t('channelStyle.textVoice.packLink')}
            </p>
            <div className="flex gap-2">
              <input
                value={emoji.packLink}
                onChange={e => setE('packLink', e.target.value)}
                placeholder={t('channelStyle.textVoice.packLinkPlaceholder')}
                className="glass-input flex-1 px-3 py-2.5 text-sm"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleResolvePack}
                disabled={!emoji.packLink.trim() || isResolving}
              >
                {isResolving ? '…' : t('channelStyle.textVoice.resolvePack')}
              </Button>
            </div>
            <p className="text-[11px] text-[#66666E] mt-1.5">
              {t('channelStyle.textVoice.packLinkHint')}
            </p>
          </div>

          <Switch
            label={t('channelStyle.textVoice.strictMode')}
            description={t('channelStyle.textVoice.strictModeDesc')}
            value={emoji.strictMode}
            onChange={v => setE('strictMode', v)}
          />

          <Switch
            label={t('channelStyle.textVoice.fallback')}
            description={t('channelStyle.textVoice.fallbackDesc')}
            value={emoji.fallbackToStandard}
            onChange={v => setE('fallbackToStandard', v)}
          />

          <div>
            <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
              {t('channelStyle.textVoice.allowedEmoji')}
            </p>
            <div className="flex flex-col gap-2 mb-2 min-h-[32px]">
              {emoji.allowedEmojis.map(e => {
                const unicode = entryUnicode(e)
                const customId = entryId(e)
                return (
                  <div key={unicode} className="flex items-center gap-2">
                    <button
                      onClick={() => removeEmoji(unicode)}
                      className="text-xl hover:scale-110 transition-transform active:scale-90 select-none shrink-0"
                      title="Tap to remove"
                    >
                      {unicode}
                    </button>
                    <input
                      value={customId}
                      onChange={ev => setEntryCustomId(unicode, ev.target.value.trim())}
                      placeholder="Custom emoji ID (optional)"
                      className="glass-input flex-1 px-2 py-1 text-xs font-mono"
                    />
                  </div>
                )
              })}
              {emoji.allowedEmojis.length === 0 && (
                <span className="text-xs text-[#66666E] self-center">
                  {t('channelStyle.textVoice.noEmoji')}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={emojiInput}
                onChange={e => setEmojiInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEmoji()}
                placeholder={t('channelStyle.textVoice.emojiPlaceholder')}
                className="glass-input flex-1 px-3 py-2 text-sm"
              />
              <Button variant="secondary" size="sm" onClick={addEmoji}>
                {t('channelStyle.textVoice.addEmoji')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Button variant="primary" size="md" onClick={handleSave} fullWidth>
        {t('channelStyle.save.textVoice')}
      </Button>
    </div>
  )
}
