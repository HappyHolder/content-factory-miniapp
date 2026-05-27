import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import type { ChannelAbout } from '@/types'

const DEFAULT_ABOUT: ChannelAbout = {
  topic: '',
  targetAudience: '',
  contentGoal: '',
}

interface ChannelAboutFormProps {
  channelId: string
  initialData?: ChannelAbout
}

export function ChannelAboutForm({ channelId, initialData }: ChannelAboutFormProps) {
  const { updateBrandKit, t } = useApp()
  const [data, setData] = useState<ChannelAbout>(initialData ?? DEFAULT_ABOUT)

  const set = <K extends keyof ChannelAbout>(key: K, val: ChannelAbout[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
          {t('channelStyle.about.topic')}
        </p>
        <textarea
          value={data.topic}
          onChange={e => set('topic', e.target.value)}
          placeholder={t('channelStyle.about.topicPlaceholder')}
          rows={2}
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
          {t('channelStyle.about.audience')}
        </p>
        <textarea
          value={data.targetAudience}
          onChange={e => set('targetAudience', e.target.value)}
          placeholder={t('channelStyle.about.audiencePlaceholder')}
          rows={2}
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
          {t('channelStyle.about.goal')}
        </p>
        <textarea
          value={data.contentGoal}
          onChange={e => set('contentGoal', e.target.value)}
          placeholder={t('channelStyle.about.goalPlaceholder')}
          rows={2}
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
      </div>

      <Button
        variant="primary"
        size="md"
        onClick={() => updateBrandKit(channelId, { channelAbout: data })}
        fullWidth
      >
        {t('channelStyle.save.about')}
      </Button>
    </div>
  )
}
