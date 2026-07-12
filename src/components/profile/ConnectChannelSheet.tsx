import { useState } from 'react'
import { Loader2, ShieldCheck, MessageSquare, AtSign, Lock } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import type { Channel } from '@/types'

interface ConnectChannelSheetProps {
  open: boolean
  onClose: () => void
}

export function ConnectChannelSheet({ open, onClose }: ConnectChannelSheetProps) {
  const { connectChannel, t } = useApp()

  const [username, setUsername] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const canSubmit = username.trim().length >= 3 && !loading

  const handleClose = () => {
    setUsername('')
    setError(null)
    setLoading(false)
    onClose()
  }

  const handleConnect = async () => {
    setError(null)

    const initData = getTelegramInitData()
    if (!initData) {
      setError(t('connectChannel.noInitData'))
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/channels/connect`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, username: username.trim() }),
      })

      const data = await res.json() as { channel?: Channel; error?: string }

      if (!res.ok) {
        setError(data.error ?? t('connectChannel.errGeneric'))
        return
      }

      if (!data.channel) {
        setError(t('connectChannel.errGeneric'))
        return
      }

      connectChannel(data.channel)
      handleClose()
    } catch {
      setError(t('connectChannel.errGeneric'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={handleClose} title={t('connectChannel.title')} height="auto">
      <div className="space-y-5 pt-1">

        {/* ── Instructions ── */}
        <div className="space-y-2.5">
          <Step icon={<ShieldCheck size={14} />} number={1} text={t('connectChannel.botStep')} />
          <Step icon={<MessageSquare size={14} />} number={2} text={t('connectChannel.permStep')} />
          <Step icon={<AtSign size={14} />} number={3} text={t('connectChannel.inputStep')} />
        </div>

        {/* ── Username input ── */}
        <div>
          <input
            type="text"
            value={username}
            onChange={e => { setUsername(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleConnect() }}
            placeholder={t('connectChannel.placeholder')}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="glass-input w-full px-4 py-3 text-sm rounded-[14px] placeholder:text-[#44444C]"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          />
        </div>

        {/* ── Private-channel hint ── */}
        <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-[12px] bg-white/[0.03] border border-white/[0.06]">
          <Lock size={13} className="text-[#55555D] shrink-0 mt-0.5" />
          <p className="text-[12px] text-[#8A8A93] leading-relaxed">{t('connectChannel.privateNote')}</p>
        </div>

        {/* ── Error message ── */}
        {error && (
          <div className="px-3.5 py-2.5 rounded-[12px] bg-red-500/10 border border-red-500/20">
            <p className="text-[12px] text-red-400 leading-relaxed">{error}</p>
          </div>
        )}

        {/* ── Connect button ── */}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          onClick={handleConnect}
        >
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              {t('connectChannel.connecting')}
            </>
          ) : (
            t('connectChannel.connect')
          )}
        </Button>

      </div>
    </Sheet>
  )
}

// ─── Step row ─────────────────────────────────────────────────────────────────

function Step({
  icon,
  number,
  text,
}: {
  icon: React.ReactNode
  number: number
  text: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-6 h-6 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0 mt-px">
        <span className="text-[10px] font-bold text-[#55555D]">{number}</span>
      </div>
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <span className="text-[#55555D] shrink-0 mt-0.5">{icon}</span>
        <p className="text-[13px] text-[#A1A1AA] leading-snug">{text}</p>
      </div>
    </div>
  )
}
