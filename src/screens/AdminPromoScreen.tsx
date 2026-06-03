import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Ticket, Copy, Check, Loader2, Plus } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import type { PlanTier } from '@/types'

interface AdminPromoScreenProps {
  onBack: () => void
}

type ApiTier = 'STARTER' | 'CREATOR' | 'STUDIO_PRO'

interface PromoRow {
  code: string
  tier: ApiTier
  durationDays: number
  redeemed: boolean
  redeemedAt: string | null
  createdAt: string
}

const TIER_LABEL: Record<ApiTier, string> = {
  STARTER:    'Starter',
  CREATOR:    'Creator',
  STUDIO_PRO: 'Studio Pro',
}

const TIER_OPTIONS: ApiTier[] = ['STARTER', 'CREATOR', 'STUDIO_PRO']

export function AdminPromoScreen({ onBack }: AdminPromoScreenProps) {
  const { showToast } = useApp()
  const [tier, setTier] = useState<ApiTier>('CREATOR')
  const [days, setDays] = useState('10')
  const [isCreating, setIsCreating] = useState(false)
  const [lastCode, setLastCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [rows, setRows] = useState<PromoRow[]>([])
  const [loadingList, setLoadingList] = useState(true)

  const loadList = useCallback(async () => {
    const initData = getTelegramInitData()
    if (!initData) { setLoadingList(false); return }
    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/list`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData }),
      })
      if (res.ok) {
        const data = await res.json() as { codes: PromoRow[] }
        setRows(Array.isArray(data.codes) ? data.codes : [])
      }
    } catch { /* non-fatal */ } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  const handleCreate = async () => {
    if (isCreating) return
    const n = parseInt(days, 10)
    if (!Number.isInteger(n) || n < 1) {
      showToast('Укажите срок в днях (целое число ≥ 1)', 'error')
      return
    }
    const initData = getTelegramInitData()
    if (!initData) { showToast('Доступно только в Telegram', 'error'); return }

    setIsCreating(true)
    setLastCode(null)
    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/create`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, tier, durationDays: n }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        showToast(err.error ?? 'Не удалось создать код', 'error')
        return
      }
      const data = await res.json() as { code: { code: string } }
      setLastCode(data.code.code)
      setCopied(false)
      showToast('Код создан')
      loadList()
    } catch {
      showToast('Ошибка соединения', 'error')
    } finally {
      setIsCreating(false)
    }
  }

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      showToast('Скопировано')
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => showToast('Не удалось скопировать', 'error'))
  }

  return (
    <div>
      <PageHeader title="Промокоды" subtitle="Генерация кодов доступа" onBack={onBack} />

      <div className="px-4 mt-2 space-y-3">
        {/* Generator */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          <GlassCard strong>
            <div className="flex items-center gap-1.5 mb-3">
              <Ticket size={14} className="text-[#FF6A00]" />
              <span className="text-[14px] font-semibold text-white">Новый код</span>
            </div>

            {/* Tier picker */}
            <label className="text-[11px] font-semibold text-[#55555D] uppercase tracking-wider">Тариф</label>
            <div className="grid grid-cols-3 gap-1.5 mt-1.5 mb-3">
              {TIER_OPTIONS.map(opt => (
                <button
                  key={opt}
                  onClick={() => setTier(opt)}
                  className={`py-2 rounded-[10px] text-[12px] font-semibold border transition-colors ${
                    tier === opt
                      ? 'bg-[rgba(255,106,0,0.12)] border-[rgba(255,106,0,0.32)] text-[#FF6A00]'
                      : 'bg-white/[0.03] border-white/[0.07] text-[#A1A1AA] hover:bg-white/[0.05]'
                  }`}
                >
                  {TIER_LABEL[opt]}
                </button>
              ))}
            </div>

            {/* Duration */}
            <label className="text-[11px] font-semibold text-[#55555D] uppercase tracking-wider">Срок, дней</label>
            <input
              value={days}
              onChange={e => setDays(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="10"
              className="glass-input w-full px-3 py-2.5 text-sm mt-1.5 mb-3"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            />

            <Button variant="primary" size="md" fullWidth onClick={handleCreate} disabled={isCreating}>
              {isCreating
                ? <><Loader2 size={15} className="animate-spin" />Генерируем…</>
                : <><Plus size={15} />Сгенерировать код</>
              }
            </Button>

            {/* Last generated code */}
            {lastCode && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-center justify-between gap-2 px-3 py-2.5 rounded-[12px] bg-[rgba(255,106,0,0.08)] border border-[rgba(255,106,0,0.22)]"
              >
                <span className="text-[15px] font-bold tracking-wider text-[#FF6A00] select-all">{lastCode}</span>
                <button
                  onClick={() => copyCode(lastCode)}
                  className="shrink-0 w-8 h-8 rounded-[8px] bg-white/[0.05] flex items-center justify-center text-[#A1A1AA] hover:text-white transition-colors"
                >
                  {copied ? <Check size={14} className="text-[#FF6A00]" /> : <Copy size={14} />}
                </button>
              </motion.div>
            )}
          </GlassCard>
        </motion.div>

        {/* Issued codes list */}
        <div>
          <p className="text-xs font-semibold text-[#66666E] uppercase tracking-wide px-1 mb-2">Выданные коды</p>
          {loadingList ? (
            <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-[#55555D]" /></div>
          ) : rows.length === 0 ? (
            <GlassCard className="text-center py-5">
              <p className="text-[12px] text-[#55555D]">Кодов пока нет</p>
            </GlassCard>
          ) : (
            <div className="space-y-1.5">
              {rows.map(r => (
                <GlassCard key={r.code} padding="none" className="px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-[13px] font-bold tracking-wide ${r.redeemed ? 'text-[#55555D] line-through' : 'text-white'}`}>
                        {r.code}
                      </p>
                      <p className="text-[11px] text-[#55555D]">
                        {TIER_LABEL[r.tier]} · {r.durationDays} дн.
                      </p>
                    </div>
                    {r.redeemed ? (
                      <span className="shrink-0 text-[10px] font-semibold text-[#55555D] bg-white/[0.05] border border-white/[0.07] px-2 py-px rounded-full">
                        Погашен
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] font-semibold text-[#FF6A00] bg-[rgba(255,106,0,0.10)] border border-[rgba(255,106,0,0.22)] px-2 py-px rounded-full">
                        Активен
                      </span>
                    )}
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Re-export for type consumers if needed
export type { PlanTier }
