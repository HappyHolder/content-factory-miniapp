import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, Loader2, Save, ShieldAlert } from 'lucide-react'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData, moderatorFetch } from '@/lib/telegram'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { ModeratorHelpSheet, ModeratorInfoButton } from '@/components/moderator/ModeratorHelpSheet'

type AntiSpamBlock = {
  id: string; type: 'antispam'; enabled: boolean
  floodEnabled: boolean; maxMessages: number; windowSeconds: number
  duplicateEnabled: boolean; maxDuplicates: number; duplicateWindowSeconds: number
  linksMode: 'allow' | 'block_all' | 'allowlist'; allowedDomains: string[]
  telegramBotsMode: 'allow' | 'block_all' | 'allowlist'; allowedBotUsernames: string[]
  action: 'delete' | 'delete_warn'; skipBots: boolean; skipAdmins: boolean; skipTrusted: boolean
  raidEnabled: boolean; raidJoinThreshold: number; raidWindowSeconds: number; raidDurationMinutes: number
  blacklistEnabled: boolean; blacklistThreshold: number; blacklistAction: 'observe' | 'restrict' | 'kick'
}
const DEFAULT: AntiSpamBlock = { id: 'antispam-default', type: 'antispam', enabled: false, floodEnabled: true, maxMessages: 6, windowSeconds: 10, duplicateEnabled: true, maxDuplicates: 3, duplicateWindowSeconds: 60, linksMode: 'allow', allowedDomains: [], telegramBotsMode: 'allow', allowedBotUsernames: [], action: 'delete', skipBots: true, skipAdmins: true, skipTrusted: true, raidEnabled: false, raidJoinThreshold: 10, raidWindowSeconds: 60, raidDurationMinutes: 30, blacklistEnabled: false, blacklistThreshold: 2, blacklistAction: 'observe' }

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block text-[11px] text-[#8A8A93]">{label}{children}</label>
const selectClass = 'mt-1.5 min-h-11 w-full rounded-[11px] border border-white/[0.08] bg-[#171719] px-3 text-[13px] text-white outline-none focus:border-[rgba(255,106,0,0.45)]'

export function ModeratorAntiSpamEditor({ moderatorId }: { moderatorId: string }) {
  const [block, setBlock] = useState(DEFAULT)
  const [domains, setDomains] = useState('')
  const [botUsernames, setBotUsernames] = useState('')
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
      const data = await r.json() as { draft?: { blocks?: AntiSpamBlock[] }; moderator?: { publishedVersion?: number | null }; error?: string }
      if (!r.ok) throw new Error(data.error ?? 'Не удалось загрузить антиспам')
      const found = data.draft?.blocks?.find(x => x.type === 'antispam'); if (found) { setBlock({ ...DEFAULT, ...found }); setDomains((found.allowedDomains ?? []).join('\n')); setBotUsernames((found.allowedBotUsernames ?? []).map(username => '@' + username).join('\n')) }
      const yes = Boolean(data.moderator?.publishedVersion); setPublished(yes); if (yes) setCollapsed(true)
    }).catch(e => setMessage(e instanceof Error ? e.message : 'Не удалось загрузить антиспам')).finally(() => setLoading(false))
  }, [initData, moderatorId])

  const save = useCallback(async () => {
    if (!initData) return false
    setSaving(true); setMessage('')
    const allowedDomains = domains.split(/[\n,]+/).map(x => x.trim()).filter(Boolean)
    const rawBotUsernames = botUsernames.split(/[\n,]+/).map(x => x.trim()).filter(Boolean)
    const allowedBotUsernames = rawBotUsernames.map(value => value.replace(/^@/, '').toLowerCase())
    if (block.telegramBotsMode === 'allowlist' && allowedBotUsernames.some(value => !/^[a-z0-9_]{2,29}bot$/.test(value))) { setMessage('Проверьте список: нужны Telegram-юзернеймы ботов, по одному на строку.'); setSaving(false); return false }
    try { const r = await moderatorFetch(`${API_BASE}/api/moderator-config/${moderatorId}/draft`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: [{ ...block, allowedDomains, allowedBotUsernames }] }) }); const data = await r.json() as { error?: string }; if (!r.ok) throw new Error(data.error ?? 'Не удалось сохранить'); setBlock(p => ({ ...p, allowedDomains, allowedBotUsernames })); setMessage('Черновик сохранён'); return true }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось сохранить'); return false } finally { setSaving(false) }
  }, [block, botUsernames, domains, initData, moderatorId])
  const publish = async () => { if (!initData || publishing) return; setPublishing(true); if (!await save()) { setPublishing(false); return } try { const r = await moderatorFetch(`${API_BASE}/api/moderator-config/${moderatorId}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockType: 'antispam' }) }); const data = await r.json() as { error?: string }; if (!r.ok) throw new Error(data.error ?? 'Не удалось применить'); setPublished(true); setMessage('Антиспам применён') } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось применить') } finally { setPublishing(false) } }
  if (loading) return <div className="flex justify-center py-6 text-[#66666E]"><Loader2 size={20} className="animate-spin" /></div>

  return <GlassCard>
    <div className={`flex items-center gap-1 ${collapsed ? '' : 'mb-4'}`}>
      <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)} className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[14px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[rgba(255,106,0,0.10)] text-[#FF6A00]"><ShieldAlert size={18} /></span>
        <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[14px] font-semibold text-white">Антиспам {published && <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-400"><Check size={11} /> применено</span>}</span><span className="mt-0.5 block truncate text-[11px] text-[#66666E]">{collapsed ? `${block.enabled ? 'Включён' : 'Выключен'} · флуд · повторы · ссылки` : 'Флуд, повторы и общая политика ссылок'}</span></span>
        <ChevronDown size={18} className={`shrink-0 text-[#66666E] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <ModeratorInfoButton onClick={() => setHelpOpen(true)} label="Открыть справку: Антиспам" />
    </div>
    {!collapsed && <div>
      <div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Включить антиспам" description="Проверять новые сообщения в группе" value={block.enabled} onChange={enabled => setBlock(p => ({ ...p, enabled }))} /></div>
      <section className="mt-4 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Антифлуд" description="Лимит сообщений за короткий интервал" value={block.floodEnabled} onChange={floodEnabled => setBlock(p => ({ ...p, floodEnabled }))} />{block.floodEnabled && <div className="mt-3 grid grid-cols-2 gap-3"><Field label="Сообщений"><select value={block.maxMessages} onChange={e => setBlock(p => ({ ...p, maxMessages: Number(e.target.value) }))} className={selectClass}>{[3,4,5,6,8,10,15,20].map(v => <option key={v} value={v}>{v}</option>)}</select></Field><Field label="За период"><select value={block.windowSeconds} onChange={e => setBlock(p => ({ ...p, windowSeconds: Number(e.target.value) }))} className={selectClass}>{[5,10,15,30,60].map(v => <option key={v} value={v}>{v} сек</option>)}</select></Field></div>}</section>
      <section className="mt-4 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Повторы" description="Ловить одинаковые сообщения" value={block.duplicateEnabled} onChange={duplicateEnabled => setBlock(p => ({ ...p, duplicateEnabled }))} />{block.duplicateEnabled && <div className="mt-3 grid grid-cols-2 gap-3"><Field label="Повторов"><select value={block.maxDuplicates} onChange={e => setBlock(p => ({ ...p, maxDuplicates: Number(e.target.value) }))} className={selectClass}>{[2,3,4,5,7,10].map(v => <option key={v} value={v}>{v}</option>)}</select></Field><Field label="За период"><select value={block.duplicateWindowSeconds} onChange={e => setBlock(p => ({ ...p, duplicateWindowSeconds: Number(e.target.value) }))} className={selectClass}>{[10,30,60,120,300].map(v => <option key={v} value={v}>{v < 60 ? `${v} сек` : `${v / 60} мин`}</option>)}</select></Field></div>}</section>
      <section className="mt-4 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Field label="Ссылки"><select value={block.linksMode} onChange={e => setBlock(p => ({ ...p, linksMode: e.target.value as AntiSpamBlock['linksMode'] }))} className={selectClass}><option value="allow">Разрешить все</option><option value="block_all">Запретить все</option><option value="allowlist">Только разрешённые домены</option></select></Field>{block.linksMode === 'allowlist' && <Field label="Разрешённые домены"><textarea value={domains} onChange={e => setDomains(e.target.value)} rows={4} placeholder={'telegram.org\nexample.com'} className="mt-1.5 w-full resize-none rounded-[11px] border border-white/[0.08] bg-[#0B0B0D] px-3 py-2.5 text-[13px] text-white outline-none focus:border-[rgba(255,106,0,0.45)]" /><span className="mt-1 block text-[10px] text-[#55555D]">По одному домену на строку; поддомены разрешаются автоматически.</span></Field>}</section>
      <section className="mt-4 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Field label="Сторонние Telegram-боты"><select value={block.telegramBotsMode} onChange={e => setBlock(p => ({ ...p, telegramBotsMode: e.target.value as AntiSpamBlock['telegramBotsMode'] }))} className={selectClass}><option value="allow">Разрешить</option><option value="block_all">Запретить</option><option value="allowlist">Только разрешённые боты</option></select></Field><span className="mt-2 block text-[10px] leading-4 text-[#66666E]">Проверяются inline-публикации, @username, t.me-ссылки и ссылки в кнопках.</span>{block.telegramBotsMode === 'allowlist' && <Field label="Разрешённые боты"><textarea value={botUsernames} onChange={e => setBotUsernames(e.target.value)} rows={4} placeholder={'@UsefulBot\n@AnotherBot'} className="mt-1.5 w-full resize-none rounded-[11px] border border-white/[0.08] bg-[#0B0B0D] px-3 py-2.5 text-[13px] text-white outline-none focus:border-[rgba(255,106,0,0.45)]" /><span className="mt-1 block text-[10px] text-[#55555D]">По одному @username на строку.</span></Field>}</section>
      <section className="mt-4 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Защита от рейда" description="Строгий режим при массовом вступлении" value={block.raidEnabled} onChange={raidEnabled => setBlock(p => ({ ...p, raidEnabled }))} />{block.raidEnabled && <><div className="mt-3 grid grid-cols-2 gap-3"><Field label="Вступлений"><select value={block.raidJoinThreshold} onChange={e => setBlock(p => ({ ...p, raidJoinThreshold: Number(e.target.value) }))} className={selectClass}>{[5,10,15,20,30,50].map(v => <option key={v} value={v}>{v}</option>)}</select></Field><Field label="За период"><select value={block.raidWindowSeconds} onChange={e => setBlock(p => ({ ...p, raidWindowSeconds: Number(e.target.value) }))} className={selectClass}>{[30,60,120,300].map(v => <option key={v} value={v}>{v < 60 ? `${v} сек` : `${v / 60} мин`}</option>)}</select></Field></div><Field label="Длительность защиты"><select value={block.raidDurationMinutes} onChange={e => setBlock(p => ({ ...p, raidDurationMinutes: Number(e.target.value) }))} className={selectClass}>{[15,30,60,120,180].map(v => <option key={v} value={v}>{v < 60 ? `${v} мин` : `${v / 60} ч`}</option>)}</select></Field><span className="mt-2 block text-[10px] text-[#55555D]">В режиме защиты все новые участники проходят капчу, их ссылки, пересылки и медиа удаляются. Вы получите уведомление от бота.</span></>}</section>
      <section className="mt-4 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Switch label="Чёрный список Publium" description="Реагировать на забаненных в других сообществах" value={block.blacklistEnabled} onChange={blacklistEnabled => setBlock(p => ({ ...p, blacklistEnabled }))} />{block.blacklistEnabled && <><div className="mt-3 grid grid-cols-2 gap-3"><Field label="Банов в других группах"><select value={block.blacklistThreshold} onChange={e => setBlock(p => ({ ...p, blacklistThreshold: Number(e.target.value) }))} className={selectClass}>{[1,2,3,5].map(v => <option key={v} value={v}>{v}+</option>)}</select></Field><Field label="Действие при входе"><select value={block.blacklistAction} onChange={e => setBlock(p => ({ ...p, blacklistAction: e.target.value as AntiSpamBlock['blacklistAction'] }))} className={selectClass}><option value="observe">Отметить в журнале</option><option value="restrict">Ограничить</option><option value="kick">Удалить из группы</option></select></Field></div><span className="mt-2 block text-[10px] text-[#55555D]">Учитываются только действующие баны, выданные модерацией других сообществ Publium.</span></>}</section>
      <section className="mt-4 space-y-3 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3"><Field label="Реакция"><select value={block.action} onChange={e => setBlock(p => ({ ...p, action: e.target.value as AntiSpamBlock['action'] }))} className={selectClass}><option value="delete">Удалить сообщение</option><option value="delete_warn">Удалить и предупредить</option></select></Field><Switch label="Пропускать ботов" value={block.skipBots} onChange={skipBots => setBlock(p => ({ ...p, skipBots }))} /><Switch label="Пропускать админов" value={block.skipAdmins} onChange={skipAdmins => setBlock(p => ({ ...p, skipAdmins }))} /><Switch label="Пропускать доверенных" value={block.skipTrusted} onChange={skipTrusted => setBlock(p => ({ ...p, skipTrusted }))} /></section>
      {message && <p aria-live="polite" className="mt-3 text-[11px] text-[#8A8A93]">{message}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" onClick={() => void save()} disabled={saving || publishing} fullWidth>{saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} /> Сохранить</>}</Button><Button variant="primary" size="sm" onClick={() => void publish()} disabled={saving || publishing} fullWidth>{publishing ? <Loader2 size={14} className="animate-spin" /> : 'Применить'}</Button></div>
    </div>}
    <ModeratorHelpSheet kind="antispam" open={helpOpen} onClose={() => setHelpOpen(false)} />
  </GlassCard>
}
