import { useState } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { OptionPills } from '@/components/ui/OptionPills'
import { useApp } from '@/context/AppContext'
import type { ChannelAbout, Language, Tone, VoiceProfile } from '@/types'

const EMPTY_ABOUT: ChannelAbout = {
  topic: '',
  targetAudience: '',
  contentGoal: '',
}

interface ChatStyleFormProps {
  chatId: string
  initialAbout?: ChannelAbout
  initialVoice: VoiceProfile
}

export function ChatStyleForm({ chatId, initialAbout, initialVoice }: ChatStyleFormProps) {
  const { updateChatStyle, t } = useApp()
  const [about, setAbout] = useState<ChannelAbout>(initialAbout ?? EMPTY_ABOUT)
  const [voice, setVoice] = useState<VoiceProfile>(initialVoice)

  const setAboutField = <K extends keyof ChannelAbout>(key: K, value: ChannelAbout[K]) =>
    setAbout(current => ({ ...current, [key]: value }))

  const setVoiceField = <K extends keyof VoiceProfile>(key: K, value: VoiceProfile[K]) =>
    setVoice(current => ({ ...current, [key]: value }))

  const save = () => updateChatStyle(chatId, { channelAbout: about, voiceProfile: voice })

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 rounded-[13px] border border-[rgba(255,106,0,0.18)] bg-[rgba(255,106,0,0.07)] px-3 py-2.5">
        <Info size={15} className="mt-0.5 shrink-0 text-[#FF6A00]" />
        <p className="text-[11px] leading-relaxed text-[#A1A1AA]">
          {t('chatStyle.contextHint')}
        </p>
      </div>

      <div>
        <label htmlFor="chat-style-topic" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#777780]">
          {t('chatStyle.topic')}
        </label>
        <textarea
          id="chat-style-topic"
          value={about.topic}
          onChange={event => setAboutField('topic', event.target.value)}
          placeholder={t('chatStyle.topicPlaceholder')}
          rows={3}
          className="glass-input w-full resize-none px-3 py-2.5 text-sm"
        />
        <p className="mt-1 text-[11px] leading-relaxed text-[#62626A]">{t('chatStyle.topicHint')}</p>
      </div>

      <div>
        <label htmlFor="chat-style-audience" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#777780]">
          {t('chatStyle.audience')}
        </label>
        <textarea
          id="chat-style-audience"
          value={about.targetAudience}
          onChange={event => setAboutField('targetAudience', event.target.value)}
          placeholder={t('chatStyle.audiencePlaceholder')}
          rows={2}
          className="glass-input w-full resize-none px-3 py-2.5 text-sm"
        />
      </div>

      <div>
        <label htmlFor="chat-style-goal" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#777780]">
          {t('chatStyle.goal')}
        </label>
        <textarea
          id="chat-style-goal"
          value={about.contentGoal}
          onChange={event => setAboutField('contentGoal', event.target.value)}
          placeholder={t('chatStyle.goalPlaceholder')}
          rows={2}
          className="glass-input w-full resize-none px-3 py-2.5 text-sm"
        />
      </div>

      <OptionPills<Language>
        label={t('chatStyle.language')}
        value={voice.language}
        onChange={value => setVoiceField('language', value)}
        options={[
          { value: 'RU', label: t('channelStyle.textVoice.langRU') },
          { value: 'EN', label: t('channelStyle.textVoice.langEN') },
          { value: 'BI', label: t('channelStyle.textVoice.langBI') },
        ]}
      />

      <OptionPills<Tone>
        label={t('chatStyle.tone')}
        value={voice.tone}
        onChange={value => setVoiceField('tone', value)}
        options={[
          { value: 'calm', label: t('channelStyle.textVoice.toneCalm') },
          { value: 'expert', label: t('channelStyle.textVoice.toneExpert') },
          { value: 'bold', label: t('channelStyle.textVoice.toneBold') },
          { value: 'any', label: t('channelStyle.textVoice.any') },
        ]}
      />

      <div>
        <label htmlFor="chat-style-note" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[#777780]">
          {t('chatStyle.communicationStyle')}
        </label>
        <textarea
          id="chat-style-note"
          value={voice.customNote ?? ''}
          onChange={event => setVoiceField('customNote', event.target.value)}
          placeholder={t('chatStyle.communicationStylePlaceholder')}
          rows={3}
          className="glass-input w-full resize-none px-3 py-2.5 text-sm"
        />
      </div>

      <Button variant="primary" size="lg" onClick={save} fullWidth>
        {t('chatStyle.save')}
      </Button>
    </div>
  )
}
