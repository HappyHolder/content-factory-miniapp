import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Pause, Play, Plus, Trash2, UserRound, Phone, Sparkles, Eye, EyeOff } from 'lucide-react'
import { API_BASE } from '@/lib/api'
import { getTelegramInitData, moderatorFetch } from '@/lib/telegram'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { NumberStepper } from '@/components/ui/NumberStepper'
import { RoleKnowledgeDocs } from '@/components/community/RoleKnowledgeDocs'

const input = 'mt-1.5 min-h-11 w-full rounded-[11px] border border-white/[0.08] bg-[#0B0B0D] px-3 text-[13px] text-white outline-none focus:border-[rgba(255,106,0,0.5)]'
const area = input + ' resize-none py-3 leading-relaxed'
const label = 'block text-[11px] font-medium text-[#9A9AA2]'

type PersonaConfig = {
  identity: { displayName: string; gender: string; age: string; city: string; occupation: string; about: string }
  voice: { messageExamples: string[]; speechStyle: string; slang: string; emojiUse: string; messageLength: string; dynamism: number }
  canon: string[]; role: string; interests: string[]
  behavior: { repliesToMentions: boolean; joinsDiscussions: boolean; reacts: boolean; expertTopics: string[]; forbiddenTopics: string[]; extraInstructions: string; forbiddenClaims: string[] }
  presence: { timezone: string; activeFromHour: number; activeToHour: number }
  limits: { maxMessagesPerHour: number; maxMessagesPerDay: number; maxReactionsPerHour: number; replyCooldownSeconds: number; reactionShare: number }
  research: { mode: string; blockedDomains: string[]; dailyLimit: number }
  proactive: { enabled: boolean; quietMinutes: number; maxPerDay: number; topics: string[] }
}
type Persona = { id: string; status: string; enabled: boolean; username: string | null; tgUserId: string | null; lastError: string | null; connected: boolean; published: boolean; config: PersonaConfig }
type State = { enabled: boolean; communityId: string | null; chat: { title: string; tgChatId: string } | null; personas: Persona[] }

const STATUS_LABEL: Record<string, string> = { DRAFT: 'Черновик', CONNECTED: 'Аккаунт подключён', ACTIVE: 'Активна', PAUSED: 'Пауза', ERROR: 'Ошибка' }

export function CommunityCorePanel({ channelId }: { channelId: string }) {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const initData = getTelegramInitData()
  const api = useCallback(async (path: string, options?: RequestInit) => {
    const r = await moderatorFetch(API_BASE + '/api/community-core' + path, options); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Ошибка'); return d
  }, [])
  const load = useCallback(async () => { if (!initData) return; try { setState(await api('/channels/' + channelId)) } catch (e) { setMessage(e instanceof Error ? e.message : 'Не удалось загрузить') } finally { setLoading(false) } }, [api, channelId, initData])
  useEffect(() => { void load() }, [load])

  const act = async (key: string, fn: () => Promise<void>) => { setBusy(key); setMessage(''); try { await fn() } catch (e) { setMessage(e instanceof Error ? e.message : 'Ошибка') } finally { setBusy('') } }
  const create = () => act('create', async () => { await api('/channels/' + channelId + '/personas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await load() })

  if (loading) return <div className="flex justify-center py-20 text-[#66666E]"><Loader2 size={22} className="animate-spin" /></div>
  if (!state?.enabled) return <GlassCard strong><div className="text-center"><UserRound size={26} className="mx-auto text-[#FF6A00]" /><p className="mt-3 text-[14px] font-semibold text-white">Ядро комьюнити скоро</p><p className="mt-1 text-[12px] leading-relaxed text-[#777780]">Подключение Telegram-аккаунтов ещё настраивается на сервере.</p></div></GlassCard>
  if (!state.communityId) return <GlassCard strong><div className="text-center"><Sparkles size={26} className="mx-auto text-[#FF6A00]" /><p className="mt-3 text-[14px] font-semibold text-white">Сначала подключите группу</p><p className="mt-1 text-[12px] leading-relaxed text-[#777780]">Ядро комьюнити общается в группе, связанной с каналом через Moderator.</p></div></GlassCard>

  return <div className="space-y-3" role="tabpanel" aria-label="Ядро комьюнити">
    <GlassCard strong>
      <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[rgba(255,106,0,0.2)] bg-[rgba(255,106,0,0.1)] text-[#FF6A00]"><UserRound size={20} /></span>
        <div className="min-w-0 flex-1"><h2 className="text-[15px] font-semibold text-white">Ядро комьюнити</h2><p className="mt-1 text-[12px] leading-relaxed text-[#777780]">Живые AI-личности на ваших Telegram-аккаунтах. Общаются в чате {state.chat?.title ? '«' + state.chat.title + '»' : 'сообщества'}, оживляют его и втягивают участников.</p></div></div>
      <Button className="mt-3" variant="primary" size="sm" fullWidth disabled={busy === 'create'} onClick={create}>{busy === 'create' ? <Loader2 size={14} className="animate-spin" /> : <><Plus size={14} /> Создать личность</>}</Button>
    </GlassCard>

    {state.personas.map(p => <PersonaCard key={p.id} persona={p} api={api} reload={load} />)}
    {state.personas.length === 0 && <p className="px-1 text-center text-[12px] text-[#66666E]">Пока нет личностей. Создайте первую и подключите к ней Telegram-аккаунт.</p>}
    {message && <p role="status" className="rounded-[12px] border border-white/[.07] bg-white/[.03] px-3 py-2.5 text-[11px] text-[#A1A1AA]">{message}</p>}
  </div>
}

function PersonaCard({ persona, api, reload }: { persona: Persona; api: (p: string, o?: RequestInit) => Promise<any>; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [config, setConfig] = useState<PersonaConfig>(persona.config)
  // login flow
  const [loginStep, setLoginStep] = useState<'phone' | 'code' | 'password' | 'done'>(persona.connected ? 'done' : 'phone')
  const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false); const [hint, setHint] = useState('')
  const [brief, setBrief] = useState('')

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setErr(''); try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : 'Ошибка') } finally { setBusy('') } }
  const startLogin = () => run('login', async () => { await api('/' + persona.id + '/login/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) }); setLoginStep('code') })
  const sendCode = () => run('login', async () => { const d = await api('/' + persona.id + '/login/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }); if (d.status === 'PASSWORD_NEEDED') { setHint(typeof d.hint === 'string' ? d.hint : ''); setLoginStep('password') } else { setLoginStep('done'); await reload() } })
  const sendPassword = () => run('login', async () => { await api('/' + persona.id + '/login/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); setLoginStep('done'); await reload() })
  const generate = () => run('generate', async () => { const d = await api('/' + persona.id + '/generate-canon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief }) }); if (d.config) setConfig(d.config) })
  const saveDraft = () => run('save', async () => { await api('/' + persona.id + '/draft', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) }) })
  const apply = () => run('apply', async () => { await api('/' + persona.id + '/draft', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) }); await api('/' + persona.id + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await reload() })
  const start = () => run('start', async () => { await api('/' + persona.id + '/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await reload() })
  const pause = () => run('pause', async () => { await api('/' + persona.id + '/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await reload() })
  const remove = () => run('delete', async () => { if (!window.confirm('Удалить личность и отвязать аккаунт?')) return; await api('/' + persona.id, { method: 'DELETE' }); await reload() })

  const badge = persona.status === 'ACTIVE' ? 'bg-emerald-400/10 text-emerald-300' : persona.status === 'ERROR' ? 'bg-red-400/10 text-red-300' : 'bg-amber-400/10 text-amber-300'
  const c = config, setId = (k: keyof PersonaConfig['identity'], v: string) => setConfig({ ...c, identity: { ...c.identity, [k]: v } })

  return <GlassCard>
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[rgba(255,106,0,0.10)] text-[#FF6A00]"><UserRound size={18} /></span>
      <button type="button" onClick={() => setOpen(v => !v)} className="min-w-0 flex-1 text-left">
        <span className="block text-[14px] font-semibold text-white">{c.identity.displayName || 'Без имени'}{persona.username && <span className="ml-1 text-[11px] font-normal text-[#777780]">@{persona.username}</span>}</span>
        <span className="mt-0.5 block text-[11px] text-[#777780]">{c.role} · {c.identity.city}</span>
      </button>
      <span className={'rounded-full px-2 py-0.5 text-[10px] font-semibold ' + badge}>{STATUS_LABEL[persona.status] ?? persona.status}</span>
    </div>
    {persona.lastError && <p className="mt-2 rounded-[10px] bg-red-400/[.08] px-3 py-2 text-[11px] text-red-300">{persona.lastError}</p>}

    {open && <div className="mt-4 space-y-4 border-t border-white/[0.06] pt-4">
      {/* 1. Account connection */}
      {loginStep !== 'done' ? <div className="rounded-[12px] border border-[rgba(255,106,0,.16)] bg-[rgba(255,106,0,.04)] p-3">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-white"><Phone size={13} /> Подключение Telegram-аккаунта</p>
        <p className="mt-1 text-[10px] leading-relaxed text-[#8A8A93]">Войдите со второго аккаунта, который станет этой личностью. Код придёт в Telegram этого номера.</p>
        {loginStep === 'phone' && <><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+79991234567" inputMode="tel" className={input} /><Button className="mt-2" variant="primary" size="sm" fullWidth disabled={busy === 'login' || !phone} onClick={startLogin}>{busy === 'login' ? <Loader2 size={14} className="animate-spin" /> : 'Отправить код'}</Button></>}
        {loginStep === 'code' && <><input value={code} onChange={e => setCode(e.target.value)} placeholder="Код из Telegram" inputMode="numeric" className={input} /><Button className="mt-2" variant="primary" size="sm" fullWidth disabled={busy === 'login' || !code} onClick={sendCode}>{busy === 'login' ? <Loader2 size={14} className="animate-spin" /> : 'Подтвердить'}</Button></>}
        {loginStep === 'password' && <>
          {hint && <p className="mt-2 rounded-[10px] border border-white/[.08] bg-white/[.03] px-3 py-2 text-[11px] text-[#A1A1AA]">Подсказка к паролю: <span className="text-white">{hint}</span></p>}
          <div className="relative mt-1.5"><input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль 2FA (облачный)" className={'min-h-11 w-full rounded-[11px] border border-white/[0.08] bg-[#0B0B0D] pl-3 pr-11 text-[13px] text-white outline-none focus:border-[rgba(255,106,0,0.5)]'} /><button type="button" aria-label={showPass ? 'Скрыть пароль' : 'Показать пароль'} onClick={() => setShowPass(v => !v)} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[8px] text-[#8A8A93] hover:text-white">{showPass ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
          <Button className="mt-2" variant="primary" size="sm" fullWidth disabled={busy === 'login' || !password} onClick={sendPassword}>{busy === 'login' ? <Loader2 size={14} className="animate-spin" /> : 'Войти'}</Button>
        </>}
        {err && <p role="alert" className="mt-2 rounded-[10px] bg-red-400/[.1] px-3 py-2 text-[11px] font-medium text-red-300">{err}</p>}
      </div> : <div className="flex items-center gap-2 rounded-[12px] border border-emerald-400/15 bg-emerald-400/[.05] px-3 py-2.5 text-[11px] text-emerald-300"><Check size={14} /> Аккаунт подключён{persona.username ? ' · @' + persona.username : ''}</div>}

      {/* 2. Personality editor */}
      <div className="rounded-[12px] border border-[rgba(255,106,0,.16)] bg-[rgba(255,106,0,.04)] p-3">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-white"><Sparkles size={13} /> Сгенерировать по описанию</p>
        <p className="mt-1 text-[10px] leading-relaxed text-[#8A8A93]">Опиши в двух словах — Terra соберёт полную личность, дальше правишь руками.</p>
        <input value={brief} onChange={e => setBrief(e.target.value)} placeholder="крипто-скептик, 30, Питер, любит спорить" className={input} />
        <Button className="mt-2" variant="secondary" size="sm" fullWidth disabled={busy === 'generate' || brief.trim().length < 4} onClick={generate}>{busy === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <><Sparkles size={14} /> Сгенерировать</>}</Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>Имя<input value={c.identity.displayName} onChange={e => setId('displayName', e.target.value)} className={input} /></label>
        <label className={label}>Роль<input value={c.role} onChange={e => setConfig({ ...c, role: e.target.value })} className={input} placeholder="Заводила / Скептик / Эксперт" /></label>
        <label className={label}>Возраст<input value={c.identity.age} onChange={e => setId('age', e.target.value)} inputMode="numeric" className={input} /></label>
        <label className={label}>Город<input value={c.identity.city} onChange={e => setId('city', e.target.value)} className={input} /></label>
      </div>
      <label className={label}>Пол<select value={c.identity.gender} onChange={e => setId('gender', e.target.value)} className={input}><option value="unspecified">Не указан</option><option value="male">Мужской</option><option value="female">Женский</option></select></label>
      <label className={label}>Профессия / чем занимается<input value={c.identity.occupation} onChange={e => setId('occupation', e.target.value)} className={input} /></label>
      <label className={label}>О себе (био)<textarea rows={5} value={c.identity.about} onChange={e => setId('about', e.target.value)} className={area} placeholder="Суть личности, можно подробно" /><span className="mt-1 block text-right text-[10px] text-[#55555D]">{c.identity.about.length} / 8000</span></label>
      <label className={label}>Примеры реплик (по одной на строку) — задают голос сильнее всего<textarea rows={6} value={c.voice.messageExamples.join('\n')} onChange={e => setConfig({ ...c, voice: { ...c.voice, messageExamples: e.target.value.split('\n') } })} className={area} placeholder={'да ну, опять эти обещания\nпо факту L2 всё ещё сырые, сам обжигался'} /><span className="mt-1 block text-right text-[10px] text-[#55555D]">{c.voice.messageExamples.filter(Boolean).length} реплик · {c.voice.messageExamples.join('\n').length} симв.</span></label>
      <label className={label}>Канон-факты о себе (по одному на строку) — модель их не выдумывает<textarea rows={6} value={c.canon.join('\n')} onChange={e => setConfig({ ...c, canon: e.target.value.split('\n') })} className={area} placeholder={'8 лет в бэкенде\nпотерял депозит на FTX'} /><span className="mt-1 block text-right text-[10px] text-[#55555D]">{c.canon.filter(Boolean).length} фактов · {c.canon.join('\n').length} симв.</span></label>
      <RoleKnowledgeDocs targetType="PERSONA" targetId={persona.id} title={'\u0417\u043d\u0430\u043d\u0438\u044f \u044d\u0442\u043e\u0439 \u043b\u0438\u0447\u043d\u043e\u0441\u0442\u0438'} description={'\u041f\u0440\u043e\u0444\u0435\u0441\u0441\u0438\u043e\u043d\u0430\u043b\u044c\u043d\u0430\u044f \u0431\u0430\u0437\u0430, \u043b\u0438\u0447\u043d\u044b\u0439 \u0431\u044d\u043a\u0433\u0440\u0430\u0443\u043d\u0434 \u0438 \u0441\u043b\u043e\u0432\u0430\u0440\u044c \u043d\u0438\u0448\u0438. \u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b \u0442\u043e\u043b\u044c\u043a\u043e \u044d\u0442\u043e\u0439 \u043b\u0438\u0447\u043d\u043e\u0441\u0442\u0438 \u0438 \u043d\u0435 \u0441\u043c\u0435\u0448\u0438\u0432\u0430\u044e\u0442\u0441\u044f \u0441 \u0434\u0440\u0443\u0433\u0438\u043c\u0438.'}/>
      <label className={label}>Интересы (через запятую)<textarea rows={2} value={c.interests.join(', ')} onChange={e => setConfig({ ...c, interests: e.target.value.split(',').map(x => x.trim()) })} className={area} /><span className="mt-1 block text-right text-[10px] text-[#55555D]">{c.interests.filter(Boolean).length} тем · {c.interests.join(', ').length} симв.</span></label>
      <label className={label}>Манера речи<textarea rows={4} value={c.voice.speechStyle} onChange={e => setConfig({ ...c, voice: { ...c.voice, speechStyle: e.target.value } })} className={area} /><span className="mt-1 block text-right text-[10px] text-[#55555D]">{c.voice.speechStyle.length} / 4000</span></label>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>Эмодзи<select value={c.voice.emojiUse} onChange={e => setConfig({ ...c, voice: { ...c.voice, emojiUse: e.target.value } })} className={input}><option value="none">Нет</option><option value="rare">Редко</option><option value="normal">Обычно</option><option value="heavy">Часто</option></select></label>
        <label className={label}>Длина сообщений<select value={c.voice.messageLength} onChange={e => setConfig({ ...c, voice: { ...c.voice, messageLength: e.target.value } })} className={input}><option value="short">Короткие</option><option value="medium">Средние</option></select></label>
      </div>
      <label className={label}>Живость речи (dynamism)<NumberStepper value={c.voice.dynamism} min={0} max={2} onChange={v => setConfig({ ...c, voice: { ...c.voice, dynamism: v } })} /></label>
      <div className="rounded-[12px] border border-white/[.07] p-3 space-y-2">
        <Switch label="Отвечать на упоминания" value={c.behavior.repliesToMentions} onChange={v => setConfig({ ...c, behavior: { ...c.behavior, repliesToMentions: v } })} />
        <Switch label="Вступать в обсуждения" value={c.behavior.joinsDiscussions} onChange={v => setConfig({ ...c, behavior: { ...c.behavior, joinsDiscussions: v } })} />
        <Switch label="Ставить реакции" description="Лайкать понравившиеся сообщения людей и других личностей" value={c.behavior.reacts} onChange={v => setConfig({ ...c, behavior: { ...c.behavior, reacts: v } })} />
        <Switch label="Искать актуальное в своих темах" description="По вопросам про цену/новости/результат в своих интересах берёт свежие данные из сети" value={c.research.mode === 'topics'} onChange={v => setConfig({ ...c, research: { ...c.research, mode: v ? 'topics' : 'off' } })} />
        <Switch label="Оживлять тихий чат" description="Иногда сама заводит тему по своим интересам, когда долго тишина" value={c.proactive.enabled} onChange={v => setConfig({ ...c, proactive: { ...c.proactive, enabled: v } })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>Активна с (час)<NumberStepper value={c.presence.activeFromHour} min={0} max={23} suffix=":00" onChange={v => setConfig({ ...c, presence: { ...c.presence, activeFromHour: v } })} /></label>
        <label className={label}>До (час)<NumberStepper value={c.presence.activeToHour} min={0} max={23} suffix=":00" onChange={v => setConfig({ ...c, presence: { ...c.presence, activeToHour: v } })} /></label>
        <label className={label}>Сообщений в час<NumberStepper value={c.limits.maxMessagesPerHour} min={1} max={60} onChange={v => setConfig({ ...c, limits: { ...c.limits, maxMessagesPerHour: v } })} /></label>
        <label className={label}>Сообщений в сутки<NumberStepper value={c.limits.maxMessagesPerDay} min={1} max={400} step={5} onChange={v => setConfig({ ...c, limits: { ...c.limits, maxMessagesPerDay: v } })} /></label>
      </div>

      {err && <p role="alert" className="rounded-[10px] bg-red-400/[.08] px-3 py-2 text-[11px] text-red-300">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" fullWidth disabled={busy === 'save' || busy === 'apply'} onClick={saveDraft}>{busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : 'Сохранить'}</Button>
        <Button variant="primary" size="sm" fullWidth disabled={busy === 'apply' || busy === 'save'} onClick={apply}>{busy === 'apply' ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> Применить</>}</Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {persona.status === 'ACTIVE'
          ? <Button variant="secondary" size="sm" fullWidth disabled={busy === 'pause'} onClick={pause}>{busy === 'pause' ? <Loader2 size={14} className="animate-spin" /> : <><Pause size={14} /> Пауза</>}</Button>
          : <Button variant="primary" size="sm" fullWidth disabled={busy === 'start' || !persona.connected} onClick={start}>{busy === 'start' ? <Loader2 size={14} className="animate-spin" /> : <><Play size={14} /> Запустить</>}</Button>}
        <Button variant="secondary" size="sm" fullWidth disabled={busy === 'delete'} onClick={remove}>{busy === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <><Trash2 size={14} /> Удалить</>}</Button>
      </div>
    </div>}
  </GlassCard>
}
