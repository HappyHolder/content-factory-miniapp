import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { useApp } from '@/context/AppContext'
import type { PostRules } from '@/types'
import type { TranslationKey } from '@/i18n'

interface PostRulesFormProps {
  channelId: string
  initialData: PostRules
}

type ToggleField = {
  key: keyof PostRules
  labelKey: TranslationKey
  descKey: TranslationKey
}

const TOGGLE_FIELDS: ToggleField[] = [
  { key: 'neverCopySource',      labelKey: 'channelStyle.rules.neverCopySource',  descKey: 'channelStyle.rules.neverCopySourceDesc'  },
  { key: 'avoidClickbait',       labelKey: 'channelStyle.rules.avoidClickbait',   descKey: 'channelStyle.rules.avoidClickbaitDesc'   },
  { key: 'shortParagraphs',      labelKey: 'channelStyle.rules.shortParagraphs',  descKey: 'channelStyle.rules.shortParagraphsDesc'  },
  { key: 'addCtaIfRelevant',     labelKey: 'channelStyle.rules.addCta',           descKey: 'channelStyle.rules.addCtaDesc'           },
  { key: 'useLinkKitWhenRelevant',labelKey: 'channelStyle.rules.useLinks',        descKey: 'channelStyle.rules.useLinksDesc'         },
]


export function PostRulesForm({ channelId, initialData }: PostRulesFormProps) {
  const { updateBrandKit, t } = useApp()
  const [data, setData] = useState<PostRules>(initialData)

  const set = <K extends keyof PostRules>(key: K, val: PostRules[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
          {t('channelStyle.rules.defaultStructure')}
        </p>
        <input
          value={data.defaultStructure}
          onChange={e => set('defaultStructure', e.target.value)}
          placeholder="Hook → Context → Insight → CTA"
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
        <p className="text-[11px] text-[#66666E] mt-1.5">
          {t('channelStyle.rules.defaultStructureHint')}
        </p>
      </div>

      <div className="space-y-4">
        {TOGGLE_FIELDS.map(({ key, labelKey, descKey }) => (
          <Switch
            key={key as string}
            label={t(labelKey)}
            description={t(descKey)}
            value={data[key] as boolean}
            onChange={v => set(key, v)}
          />
        ))}
      </div>

      <Button variant="primary" size="md" onClick={() => updateBrandKit(channelId, { postRules: data })} fullWidth>
        {t('channelStyle.save.rules')}
      </Button>
    </div>
  )
}
