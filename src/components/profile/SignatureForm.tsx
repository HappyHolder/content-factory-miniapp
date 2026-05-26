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
  const { updateBrandKit } = useApp()
  const [data, setData] = useState<Signature>(initialData)

  const set = <K extends keyof Signature>(key: K, val: Signature[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">Signature text</p>
        <textarea
          value={data.text}
          onChange={e => set('text', e.target.value)}
          rows={2}
          placeholder="— Your name, building in public"
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">CTA (optional)</p>
        <input
          value={data.cta || ''}
          onChange={e => set('cta', e.target.value)}
          placeholder="Follow for more →"
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">Usage</p>
        <div className="flex flex-col gap-2">
          {(['always', 'when_relevant', 'never'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => set('usage', opt)}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-[14px] border text-left transition-all',
                data.usage === opt
                  ? 'bg-[rgba(255,106,0,0.08)] border-[rgba(255,106,0,0.38)]'
                  : 'bg-white/4 border-white/8 hover:bg-white/6'
              )}
            >
              <div className={cn(
                'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                data.usage === opt ? 'border-[#FF6A00]' : 'border-white/20'
              )}>
                {data.usage === opt && <div className="w-1.5 h-1.5 rounded-full bg-[#FF6A00]" />}
              </div>
              <div>
                <p className={cn('text-sm font-medium', data.usage === opt ? 'text-[#FF6A00]' : 'text-[#A1A1AA]')}>
                  {opt === 'always' ? 'Always add' : opt === 'when_relevant' ? 'When relevant' : 'Never'}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="p-3.5 rounded-[14px] bg-white/4 border border-white/8">
        <p className="text-[11px] text-[#66666E] uppercase tracking-wide font-semibold mb-1.5">Preview</p>
        <p className="text-sm text-[#A1A1AA] whitespace-pre-wrap">{data.text}</p>
        {data.cta && <p className="text-sm text-[#FF6A00] mt-1">{data.cta}</p>}
      </div>

      <Button variant="primary" size="md" onClick={() => updateBrandKit(channelId, { signature: data })} fullWidth>
        Save Signature
      </Button>
    </div>
  )
}
