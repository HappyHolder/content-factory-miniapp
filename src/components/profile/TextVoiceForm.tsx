import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { OptionPills } from '@/components/ui/OptionPills'
import { useApp } from '@/context/AppContext'
import type { VoiceProfile, Language, AddressStyle, AuthorRole, Tone, PostLength } from '@/types'

interface TextVoiceFormProps {
  channelId: string
  initialVoice: VoiceProfile
}

export function TextVoiceForm({ channelId, initialVoice }: TextVoiceFormProps) {
  const { updateBrandKit, t } = useApp()
  const [voice, setVoice] = useState<VoiceProfile>(initialVoice)

  const setV = <K extends keyof VoiceProfile>(key: K, val: VoiceProfile[K]) =>
    setVoice(prev => ({ ...prev, [key]: val }))

  const handleSave = () => {
    updateBrandKit(channelId, { voiceProfile: voice })
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
          { value: 'any', label: t('channelStyle.textVoice.any') },
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
          { value: 'any',     label: t('channelStyle.textVoice.any')         },
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
          { value: 'any',     label: t('channelStyle.textVoice.any')         },
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
          { value: 'any',    label: t('channelStyle.textVoice.any')          },
        ]}
      />

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
          {t('channelStyle.textVoice.customNote')}
        </p>
        <textarea
          value={voice.customNote ?? ''}
          onChange={e => setV('customNote', e.target.value)}
          placeholder={t('channelStyle.textVoice.customNotePlaceholder')}
          rows={3}
          className="glass-input w-full px-3 py-2.5 text-sm resize-none"
        />
      </div>

      <Button variant="primary" size="md" onClick={handleSave} fullWidth>
        {t('channelStyle.save.textVoice')}
      </Button>
    </div>
  )
}
