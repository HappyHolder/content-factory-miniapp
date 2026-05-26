import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import type { Signature } from '@/types'
import { cn } from '@/lib/utils'

interface SignatureFormProps {
  channelId: string
  initialData: Signature
}

export function SignatureForm({ channelId, initialData }: SignatureFormProps) {
  const { updateBrandKit, t } = useApp()
  const [data, setData] = useState<Signature>(initialData)

  const set = <K extends keyof Signature>(key: K, val: Signature[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  const usageOptions = [
    { value: 'always'       as const, label: t('channelStyle.signature.always')      },
    { value: 'when_relevant'as const, label: t('channelStyle.signature.whenRelevant') },
    { value: 'never'        as const, label: t('channelStyle.signature.never')        },
  ]

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
          {t('channelStyle.signature.text')}
        </p>
        <textarea
          value={data.text}
          onChange={e => set('text', e.target.value)}
          rows={2}
          placeholder="— Your name, building in public"
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
          {t('channelStyle.signature.cta')}
        </p>
        <input
          value={data.cta || ''}
          onChange={e => set('cta', e.target.value)}
          placeholder="Follow for more →"
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">
          {t('channelStyle.signature.usage')}
        </p>
        <div className="flex flex-col gap-2">
          {usageOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => set('usage', opt.value)}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-[14px] border text-left transition-all',
                data.usage === opt.value
                  ? 'bg-[rgba(255,106,0,0.08)] border-[rgba(255,106,0,0.38)]'
                  : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]'
              )}
            >
              <div className={cn(
                'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                data.usage === opt.value ? 'border-[#FF6A00]' : 'border-white/20'
              )}>
                {data.usage === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-[#FF6A00]" />}
              </div>
              <p className={cn('text-sm font-medium', data.usage === opt.value ? 'text-[#FF6A00]' : 'text-[#A1A1AA]')}>
                {opt.label}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="p-3.5 rounded-[14px] bg-white/[0.03] border border-white/[0.06]">
        <p className="text-[11px] text-[#66666E] uppercase tracking-wide font-semibold mb-1.5">
          {t('channelStyle.signature.preview')}
        </p>
        <p className="text-sm text-[#A1A1AA] whitespace-pre-wrap">{data.text}</p>
        {data.cta && <p className="text-sm text-[#FF6A00] mt-1">{data.cta}</p>}
      </div>

      <Button variant="primary" size="md" onClick={() => updateBrandKit(channelId, { signature: data })} fullWidth>
        {t('channelStyle.save.signature')}
      </Button>
    </div>
  )
}
