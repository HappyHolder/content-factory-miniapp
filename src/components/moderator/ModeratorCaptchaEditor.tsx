import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, Loader2, Save, ShieldCheck } from 'lucide-react'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData, moderatorFetch } from '@/lib/telegram'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { ModeratorHelpSheet, ModeratorInfoButton } from '@/components/moderator/ModeratorHelpSheet'

type CaptchaBlock = {
  id: string; type: 'captcha'; enabled: boolean; text: string; buttonText: string
  timeoutSeconds: number; failureAction: 'kick' | 'restrict'; deleteOnSuccess: boolean
  skipBots: boolean; skipAdmins: boolean; skipTrusted: boolean
}
const DEFAULT: CaptchaBlock = { id: 'captcha-default', type: 'captcha', enabled: false, text: '**{name}**, подтвердите, что вы человек.', buttonText: 'Я человек', timeoutSeconds: 300, failureAction: 'kick', deleteOnSuccess: true, skipBots: true, skipAdmins: true, skipTrusted: true }

export function ModeratorCaptchaEditor({ moderatorId }: { moderatorId: string }) {
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
    moderatorFetch(`${API_BASE}/api/moderator-config/${moderatorId}/draft`)
      .then(async r => { const d = await r.json() as { draft?: { blocks?: CaptchaBlock[] }; moderator?: { publishedVersion?: number | null }; error?: string }; if (!r.ok) throw new Error(d.error ?? 'Не удалось загрузить CAPTCHA'); const found = d.draft?.blocks?.find(x => x.type === 'captcha'); if (found) setBlock({ ...DEFAULT, ...found }); const yes = Boolean(d.moderator?.publishedVersion); setPublished(yes); if (yes) setCollapsed(true) })
      .catch(e => setMessage(e instanceof Error ? e.message : 'Не удалось загрузить CAPTCHA')).finally(() => setLoading(false))
  }, [initData, moderatorId])

  const save = useCallback(async () => {
    if (!initData || !block.text.trim() || !block.buttonText.trim()) return false
    setSaving(true); setMessage('')
    try { const r = await moderatorFetch(`${API_BASE}/api/moderator-config/${moderatorId}/draft`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: [block] }) }); const d = await r.json() as { error?: string }; if (!r.ok) throw new Error(d.error ?? 'Не удалось сохранить'); setMessage('Черновик сохранён'); return true }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось сохранить'); return false } finally { setSaving(false) }
  }, [block, initData, moderatorId])
  const publish = async () => { if (!initData || publishing) return; setPublishing(true); if (!await save()) { setPublishing(false); return } try { const r = await moderatorFetch(`${API_BASE}/api/moderator-config/${moderatorId}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockType: 'captcha' }) }); const d = await r.json() as { error?: string }; if (!r.ok) throw new Error(d.error ?? 'Не удалось применить'); setPublished(true); setMessage('CAPTCHA применена') } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось применить') } finally { setPublishing(false) } }
  if (loading) return <div className="flex justify-center py-6 text-[#66666E]"><Loader2 size={20} className="animate-spin" /></div>

  return <GlassCard>
    <div className={`flex items-center gap-1 ${collapsed ? '' : 'mb-4'}`}>
      <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)} className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[14px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[rgba(255,106,0,0.10)] text-[#FF6A00]"><ShieldCheck size={18} /></span>
        <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[14px] font-semibold text-white">CAPTCHA {published && <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-400"><Check size={11} /> применено</span>}</span><span className="mt-0.5 block truncate text-[11px] text-[#66666E]">{collapsed ? `${block.enabled ? 'Включена' : 'Выключена'} · ${Math.round(block.timeoutSeconds / 60)} мин.` : 'Проверка нового участника до приветствия'}</span></span>
        <ChevronDown size={18} className={`shrink-0 text-[#66666E] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <ModeratorInfoButton onClick={() => setHelpOpen(true)} label="Открыть справку: CAPTCHA" />
    </div>
    {!collapsed && <div>
      <div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Включить CAPTCHA" description="Ограничить новичка до подтверждения" value={block.enabled} onChange={enabled => setBlock(p => ({ ...p, enabled }))} /></div>
      <label className="mt-4 block text-[11px] text-[#8A8A93]">Сообщение<textarea value={block.text} onChange={e => setBlock(p => ({ ...p, text: e.target.value }))} rows={4} maxLength={1000} className="mt-1.5 w-full resize-none rounded-[12px] border border-white/[0.08] bg-[#0B0B0D] px-3.5 py-3 text-[14px] leading-relaxed text-white outline-none focus:border-[rgba(255,106,0,0.45)]" /></label>
      <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-[11px] text-[#8A8A93]">Текст кнопки<input value={block.buttonText} onChange={e => setBlock(p => ({ ...p, buttonText: e.target.value }))} maxLength={64} className="mt-1.5 min-h-11 w-full rounded-[11px] border border-white/[0.08] bg-[#171719] px-3 text-[13px] text-white outline-none" /></label><label className="text-[11px] text-[#8A8A93]">Время<select value={block.timeoutSeconds} onChange={e => setBlock(p => ({ ...p, timeoutSeconds: Number(e.target.value) }))} className="mt-1.5 min-h-11 w-full rounded-[11px] border border-white/[0.08] bg-[#171719] px-3 text-[13px] text-white outline-none"><option value={60}>1 мин</option><option value={180}>3 мин</option><option value={300}>5 мин</option><option value={600}>10 мин</option><option value={1800}>30 мин</option></select></label></div>
      <label className="mt-4 block text-[11px] text-[#8A8A93]">Если время истекло<select value={block.failureAction} onChange={e => setBlock(p => ({ ...p, failureAction: e.target.value as CaptchaBlock['failureAction'] }))} className="mt-1.5 min-h-11 w-full rounded-[11px] border border-white/[0.08] bg-[#171719] px-3 text-[13px] text-white outline-none"><option value="kick">Удалить из группы</option><option value="restrict">Оставить ограниченным</option></select></label>
      <div className="mt-4 space-y-3 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Удалять CAPTCHA после успеха" value={block.deleteOnSuccess} onChange={deleteOnSuccess => setBlock(p => ({ ...p, deleteOnSuccess }))} /><Switch label="Пропускать ботов" value={block.skipBots} onChange={skipBots => setBlock(p => ({ ...p, skipBots }))} /><Switch label="Пропускать админов" value={block.skipAdmins} onChange={skipAdmins => setBlock(p => ({ ...p, skipAdmins }))} /><Switch label="Пропускать доверенных" value={block.skipTrusted} onChange={skipTrusted => setBlock(p => ({ ...p, skipTrusted }))} /></div>
      <div className="mt-4 rounded-[14px] border border-white/[0.08] bg-[#0D0D0F] p-3"><p className="text-[13px] leading-relaxed text-white">{block.text.replace('{name}', 'Степан')}</p><div className="mt-3 rounded-[9px] border border-[#2E7CF6]/30 bg-[#2E7CF6]/10 px-3 py-2 text-center text-[12px] text-[#7FB0FF]">{block.buttonText}</div></div>
      {message && <p aria-live="polite" className="mt-3 text-[11px] text-[#8A8A93]">{message}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" onClick={() => void save()} disabled={saving || publishing} fullWidth>{saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} /> Сохранить</>}</Button><Button variant="primary" size="sm" onClick={() => void publish()} disabled={saving || publishing} fullWidth>{publishing ? <Loader2 size={14} className="animate-spin" /> : 'Применить'}</Button></div>
    </div>}
    <ModeratorHelpSheet kind="captcha" open={helpOpen} onClose={() => setHelpOpen(false)} />
  </GlassCard>
}
