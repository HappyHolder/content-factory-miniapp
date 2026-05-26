import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import type { PostRules } from '@/types'
import { cn } from '@/lib/utils'

interface PostRulesFormProps {
  channelId: string
  initialData: PostRules
}

const toggleFields: { key: keyof PostRules; label: string; description: string }[] = [
  { key: 'neverCopySource', label: 'Never copy source wording', description: 'Always create original text from ideas' },
  { key: 'avoidClickbait', label: 'Avoid clickbait', description: 'No misleading or sensational headlines' },
  { key: 'shortParagraphs', label: 'Short paragraphs', description: 'Maximum 2–3 sentences per paragraph' },
  { key: 'addCtaIfRelevant', label: 'Add CTA if relevant', description: 'Include a call-to-action when it fits the post' },
  { key: 'useLinkKitWhenRelevant', label: 'Use Link Kit when relevant', description: 'Insert links from Link Kit when contextually relevant' },
]

function Toggle({ label, description, value, onChange }: {
  label: string; description: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-[12px] text-[#66666E] mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn('relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 mt-0.5', value ? 'bg-[#FF6A00]' : 'bg-white/12')}
      >
        <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200', value ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    </div>
  )
}

export function PostRulesForm({ channelId, initialData }: PostRulesFormProps) {
  const { updateBrandKit } = useApp()
  const [data, setData] = useState<PostRules>(initialData)

  const set = <K extends keyof PostRules>(key: K, val: PostRules[K]) =>
    setData(prev => ({ ...prev, [key]: val }))

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-2">Default structure</p>
        <input
          value={data.defaultStructure}
          onChange={e => set('defaultStructure', e.target.value)}
          placeholder="Hook → Context → Insight → CTA"
          className="glass-input w-full px-3 py-2.5 text-sm"
        />
        <p className="text-[11px] text-[#66666E] mt-1.5">Guide the AI on how to structure posts</p>
      </div>

      <div className="space-y-4">
        {toggleFields.map(({ key, label, description }) => (
          <Toggle
            key={key}
            label={label}
            description={description}
            value={data[key] as boolean}
            onChange={v => set(key, v)}
          />
        ))}
      </div>

      <Button variant="primary" size="md" onClick={() => updateBrandKit(channelId, { postRules: data })} fullWidth>
        Save Post Rules
      </Button>
    </div>
  )
}
