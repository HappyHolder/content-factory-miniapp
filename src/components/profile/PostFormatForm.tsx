import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { OptionPills } from '@/components/ui/OptionPills'
import { useApp } from '@/context/AppContext'
import type { PostRules, ParagraphStyle, ListUsage } from '@/types'

interface PostFormatFormProps {
  channelId: string
  initialData: PostRules
}

type CtaUsage = 'never' | 'when_relevant' | 'always'

export function PostFormatForm({ channelId, initialData }: PostFormatFormProps) {
  const { updateBrandKit, t } = useApp()

  const [structure, setStructure]       = useState(initialData.defaultStructure)
  const [paraStyle, setParaStyle]       = useState<ParagraphStyle>(
    initialData.paragraphStyle ?? (initialData.shortParagraphs ? 'short' : 'medium')
  )
  const [listUsage, setListUsage]       = useState<ListUsage>(initialData.listUsage ?? 'when_relevant')
  const [ctaUsage, setCtaUsage]         = useState<CtaUsage>(
    initialData.ctaUsage ?? (initialData.addCtaIfRelevant ? 'when_relevant' : 'never')
  )
  const [neverCopy, setNeverCopy]       = useState(initialData.neverCopySource)
  const [noClickbait, setNoClickbait]   = useState(initialData.avoidClickbait)
  const [useLinks, setUseLinks]         = useState(initialData.useLinkKitWhenRelevant)

  const handleSave = () => {
    updateBrandKit(channelId, {
      postRules: {
        ...initialData,
        defaultStructure: structure,
        paragraphStyle:   paraStyle,
        listUsage,
        ctaUsage,
        neverCopySource:       neverCopy,
        avoidClickbait:        noClickbait,
        useLinkKitWhenRelevant: useLinks,
        // Keep legacy boolean fields in sync
        shortParagraphs:  paraStyle === 'short',
        addCtaIfRelevant: ctaUsage !== 'never',
      },
    })
  }

  return (
    <div className="space-y-4">

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
          {t('channelStyle.postFormat.structure')}
        </p>
        <input
          value={structure}
          onChange={e => setStructure(e.target.value)}
          placeholder={t('channelStyle.postFormat.structurePlaceholder')}
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
        <p className="text-[11px] text-[#66666E] mt-1.5">
          {t('channelStyle.postFormat.structureHint')}
        </p>
      </div>

      <OptionPills<ParagraphStyle>
        label={t('channelStyle.postFormat.paragraphStyle')}
        value={paraStyle}
        onChange={setParaStyle}
        options={[
          { value: 'short',  label: t('channelStyle.postFormat.paraShort')  },
          { value: 'medium', label: t('channelStyle.postFormat.paraMedium') },
          { value: 'long',   label: t('channelStyle.postFormat.paraLong')   },
        ]}
      />

      <OptionPills<ListUsage>
        label={t('channelStyle.postFormat.lists')}
        value={listUsage}
        onChange={setListUsage}
        options={[
          { value: 'never',         label: t('channelStyle.postFormat.listNever')        },
          { value: 'when_relevant', label: t('channelStyle.postFormat.listWhenRelevant') },
          { value: 'always',        label: t('channelStyle.postFormat.listAlways')       },
        ]}
      />

      <OptionPills<CtaUsage>
        label={t('channelStyle.postFormat.cta')}
        value={ctaUsage}
        onChange={setCtaUsage}
        options={[
          { value: 'never',         label: t('channelStyle.postFormat.ctaNever')        },
          { value: 'when_relevant', label: t('channelStyle.postFormat.ctaWhenRelevant') },
          { value: 'always',        label: t('channelStyle.postFormat.ctaAlways')       },
        ]}
      />

      {/* Content rules */}
      <div className="pt-1">
        <p className="text-xs font-semibold text-[#55555D] uppercase tracking-wider mb-3">
          {t('channelStyle.postFormat.contentRules')}
        </p>
        <div className="space-y-3">
          <Switch
            label={t('channelStyle.postFormat.neverCopySource')}
            description={t('channelStyle.postFormat.neverCopySourceDesc')}
            value={neverCopy}
            onChange={setNeverCopy}
          />
          <Switch
            label={t('channelStyle.postFormat.avoidClickbait')}
            description={t('channelStyle.postFormat.avoidClickbaitDesc')}
            value={noClickbait}
            onChange={setNoClickbait}
          />
          <Switch
            label={t('channelStyle.postFormat.useLinks')}
            description={t('channelStyle.postFormat.useLinksDesc')}
            value={useLinks}
            onChange={setUseLinks}
          />
        </div>
      </div>

      <Button variant="primary" size="md" onClick={handleSave} fullWidth>
        {t('channelStyle.save.postFormat')}
      </Button>
    </div>
  )
}
