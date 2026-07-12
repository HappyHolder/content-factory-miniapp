import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, MessageCircle, Save } from 'lucide-react'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData } from '@/lib/telegram'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'

type WelcomeBlock = {
  id: string
  type: 'welcome'
  enabled: boolean
  text: string
}

const DEFAULT_BLOCK: WelcomeBlock = {
  id: 'welcome-default',
  type: 'welcome',
  enabled: false,
  text: 'Добро пожаловать, {name}! Перед общением познакомьтесь с правилами сообщества.',
}

export function ModeratorWelcomeEditor({ moderatorId }: { moderatorId: string }) {
  const [block, setBlock] = useState<WelcomeBlock>(DEFAULT_BLOCK)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [message, setMessage] = useState('')
  const initData = getTelegramInitData()

  useEffect(() => {
    if (!initData) { setLoading(false); return }
    const query = encodeURIComponent(initData)
    fetch(`${API_BASE}/api/moderator-config/${moderatorId}/draft?initData=${query}`)
      .then(async res => {
        const data = await res.json() as { draft?: { blocks?: WelcomeBlock[] }; moderator?: { publishedVersion?: number | null }; error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Не удалось загрузить настройки')
        const welcome = data.draft?.blocks?.find(item => item.type === 'welcome')
        if (welcome) setBlock(welcome)
        setPublished(Boolean(data.moderator?.publishedVersion))
      })
      .catch(err => setMessage(err instanceof Error ? err.message : 'Не удалось загрузить настройки'))
      .finally(() => setLoading(false))
  }, [initData, moderatorId])

  const save = useCallback(async (): Promise<boolean> => {
    if (!initData || !block.text.trim()) return false
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch(`${API_BASE}/api/moderator-config/${moderatorId}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, blocks: [{ ...block, text: block.text.trim() }] }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Не удалось сохранить')
      setMessage('Черновик сохранён')
      return true
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Не удалось сохранить')
      return false
    } finally {
      setSaving(false)
    }
  }, [block, initData, moderatorId])

  const publish = async () => {
    if (!initData || publishing) return
    setPublishing(true)
    const saved = await save()
    if (!saved) { setPublishing(false); return }
    try {
      const res = await fetch(`${API_BASE}/api/moderator-config/${moderatorId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Не удалось опубликовать')
      setPublished(true)
      setMessage('Настройки опубликованы')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Не удалось опубликовать')
    } finally {
      setPublishing(false)
    }
  }

  if (loading) return <div className="flex justify-center py-8 text-[#66666E]"><Loader2 size={20} className="animate-spin" /></div>

  return (
    <GlassCard>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[rgba(255,106,0,0.10)] text-[#FF6A00]">
          <MessageCircle size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-semibold text-white">Приветствие</p>
            {published && <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400"><Check size={11} /> опубликовано</span>}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[#66666E]">Первое сообщение новому участнику группы</p>
        </div>
      </div>

      <div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3">
        <Switch
          label="Включить приветствие"
          description="Отправлять при вступлении нового участника"
          value={block.enabled}
          onChange={enabled => setBlock(prev => ({ ...prev, enabled }))}
        />
      </div>

      <label className="mt-4 block">
        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#66666E]">Сообщение</span>
        <textarea
          value={block.text}
          onChange={event => setBlock(prev => ({ ...prev, text: event.target.value }))}
          rows={5}
          maxLength={3500}
          className="w-full resize-none rounded-[14px] border border-white/[0.08] bg-[#0B0B0D] px-3.5 py-3 text-[14px] leading-relaxed text-white outline-none transition-colors placeholder:text-[#45454D] focus:border-[rgba(255,106,0,0.45)] focus:ring-2 focus:ring-[rgba(255,106,0,0.12)]"
        />
      </label>
      <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-[#55555D]">
        <span><code>{'{name}'}</code> — имя участника</span>
        <span>{block.text.length}/3500</span>
      </div>

      {message && <p aria-live="polite" className="mt-3 text-[11px] text-[#8A8A93]">{message}</p>}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" onClick={() => void save()} disabled={saving || publishing} fullWidth>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} /> Сохранить</>}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void publish()} disabled={saving || publishing} fullWidth>
          {publishing ? <Loader2 size={14} className="animate-spin" /> : 'Опубликовать'}
        </Button>
      </div>
    </GlassCard>
  )
}
