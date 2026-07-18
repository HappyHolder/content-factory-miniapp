import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, Loader2, Save, UserRoundPlus } from 'lucide-react'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData, moderatorFetch } from '@/lib/telegram'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { ModeratorHelpSheet, ModeratorInfoButton } from '@/components/moderator/ModeratorHelpSheet'

type ProbationBlock = {
  id: string; type: 'probation'; enabled: boolean
  durationHours: number; messageThreshold: number
  blockLinks: boolean; blockForwards: boolean; blockMedia: boolean
  action: 'delete' | 'delete_warn'
}
const DEFAULT: ProbationBlock = { id: 'probation-default', type: 'probation', enabled: false, durationHours: 24, messageThreshold: 5, blockLinks: true, blockForwards: true, blockMedia: false, action: 'delete_warn' }

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block text-[11px] text-[#8A8A93]">{label}{children}</label>
const selectClass = 'mt-1.5 min-h-11 w-full rounded-[11px] border border-white/[0.08] bg-[#171719] px-3 text-[13px] text-white outline-none focus:border-[rgba(255,106,0,0.45)]'

export function ModeratorProbationEditor({ moderatorId }: { moderatorId: string }) {
  const [block, setBlock] = useState(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [message, setMessage] = useState('')
  const initData = getTelegramInitData()

  useEffect(() => {
    if (!initData) { setLoading(false); return }
    moderatorFetch(`${API_BASE}/api/moderator-config/${moderatorId}/draft`).then(async r => {
      const data = await r.json() as { draft?: { blocks?: ProbationBlock[] }; moderator?: { publishedVersion?: number | null }; error?: string }
      if (!r.ok) throw new Error(data.error ?? 'Не удалось загрузить режим новичка')
      const found = data.draft?.blocks?.find(x => x.type === 'probation'); if (found) setBlock({ ...DEFAULT, ...found })
      const yes = Boolean(data.moderator?.publishedVersion); setPublished(yes); if (yes) setCollapsed(true)
    }).catch(e => setMessage(e instanceof Error ? e.message : 'Не удалось загрузить режим новичка')).finally(() => setLoading(false))
  }, [initData, moderatorId])

  const save = useCallback(async () => {
    if (!initData) return false
    setSaving(true); setMessage('')
    try { const r = await moderatorFetch(`${API_BASE}/api/moderator-config/${moderatorId}/draft`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: [block] }) }); const data = await r.json() as { error?: string }; if (!r.ok) throw new Error(data.error ?? 'Не удалось сохранить'); setMessage('Черновик сохранён'); return true }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось сохранить'); return false } finally { setSaving(false) }
  }, [block, initData, moderatorId])
  const publish = async () => { if (!initData || publishing) return; setPublishing(true); if (!await save()) { setPublishing(false); return } try { const r = await moderatorFetch(`${API_BASE}/api/moderator-config/${moderatorId}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); const data = await r.json() as { error?: string }; if (!r.ok) throw new Error(data.error ?? 'Не удалось применить'); setPublished(true); setMessage('Режим новичка применён') } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось применить') } finally { setPublishing(false) } }
  if (loading) return <div className="flex justify-center py-6 text-[#66666E]"><Loader2 size={20} className="animate-spin" /></div>

  return <GlassCard>
    <div className={`flex items-center gap-1 ${collapsed ? '' : 'mb-4'}`}>
      <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)} className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[14px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[rgba(255,106,0,0.10)] text-[#FF6A00]"><UserRoundPlus size={18} /></span>
        <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[14px] font-semibold text-white">Режим новичка {published && <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-400"><Check size={11} /> применено</span>}</span><span className="mt-0.5 block truncate text-[11px] text-[#66666E]">{collapsed ? `${block.enabled ? 'Включён' : 'Выключен'} · ${block.durationHours} ч · ${block.messageThreshold || '∞'} сообщений` : 'Ограничения для недавно вступивших участников'}</span></span>
        <ChevronDown size={18} className={`shrink-0 text-[#66666E] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <ModeratorInfoButton onClick={() => setHelpOpen(true)} label="Открыть справку: Режим новичка" />
    </div>
    {!collapsed && <div>
      <div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Включить режим новичка" description="Новые участники временно без ссылок и пересылок" value={block.enabled} onChange={enabled => setBlock(p => ({ ...p, enabled }))} /></div>
      <section className="mt-4 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><div className="grid grid-cols-2 gap-3"><Field label="Длительность"><select value={block.durationHours} onChange={e => setBlock(p => ({ ...p, durationHours: Number(e.target.value) }))} className={selectClass}>{[6, 12, 24, 48, 72, 168].map(v => <option key={v} value={v}>{v < 24 ? `${v} ч` : `${v / 24} дн`}</option>)}</select></Field><Field label="Снять после сообщений"><select value={block.messageThreshold} onChange={e => setBlock(p => ({ ...p, messageThreshold: Number(e.target.value) }))} className={selectClass}><option value={0}>Только по времени</option>{[3, 5, 10, 20].map(v => <option key={v} value={v}>{v}</option>)}</select></Field></div><span className="mt-2 block text-[10px] text-[#55555D]">Ограничение снимается, когда истечёт время или участник напишет достаточно обычных сообщений.</span></section>
      <section className="mt-4 space-y-3 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Блокировать ссылки" value={block.blockLinks} onChange={blockLinks => setBlock(p => ({ ...p, blockLinks }))} /><Switch label="Блокировать пересылки" value={block.blockForwards} onChange={blockForwards => setBlock(p => ({ ...p, blockForwards }))} /><Switch label="Блокировать медиа" description="Фото, видео, документы, стикеры" value={block.blockMedia} onChange={blockMedia => setBlock(p => ({ ...p, blockMedia }))} /><Field label="Реакция"><select value={block.action} onChange={e => setBlock(p => ({ ...p, action: e.target.value as ProbationBlock['action'] }))} className={selectClass}><option value="delete">Удалить сообщение</option><option value="delete_warn">Удалить и предупредить</option></select></Field></section>
      {message && <p aria-live="polite" className="mt-3 text-[11px] text-[#8A8A93]">{message}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" onClick={() => void save()} disabled={saving || publishing} fullWidth>{saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} /> Сохранить</>}</Button><Button variant="primary" size="sm" onClick={() => void publish()} disabled={saving || publishing} fullWidth>{publishing ? <Loader2 size={14} className="animate-spin" /> : 'Применить'}</Button></div>
    </div>}
    <ModeratorHelpSheet kind="probation" open={helpOpen} onClose={() => setHelpOpen(false)} />
  </GlassCard>
}
