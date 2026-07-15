import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, Globe2, Send } from 'lucide-react'

export type CommunityManagerActionRow={
 id:string;decision:string;intent:string|null;reason:string|null;response:string|null;status:string;createdAt:string;confidence?:number|null;error?:string|null
 presentation?:{decisionLabel:string;intentLabel:string;reasonLabel:string|null;domains:string[];usedResearch:boolean;researchRequested?:boolean;expertInvite?:string|null;tokens:number;latencyMs:number;engagementLabel?:string|null;conversationScore?:number|null;topic?:string|null;thematic?:boolean;moderatorFollowup?:boolean}
}
type Health={pending:number;retrying:number;failed24h:number;lastHealthyAt:string|null;lastError:string|null}

const tone=(action:CommunityManagerActionRow)=>action.decision==='ERROR'||action.status==='FAILED'?'border-red-400/15 bg-red-400/[.035] text-red-300':action.decision==='RESPOND'||action.decision==='ACTIVITY'?'border-emerald-400/15 bg-emerald-400/[.035] text-emerald-300':'border-white/[.07] bg-white/[.025] text-[#A1A1AA]'

export function CommunityManagerDecisionLog({actions,health,onSendDraft}:{actions:CommunityManagerActionRow[];health:Health|null;onSendDraft:(id:string)=>void}){
 const [open,setOpen]=useState<string|null>(null)
 return <div className="space-y-3">
  {health&&<div className="grid grid-cols-3 gap-2" aria-label="Состояние Community Manager">
   <Status icon={<Clock3 size={13}/>} label="В очереди" value={health.pending}/>
   <Status icon={<Clock3 size={13}/>} label="Повторы" value={health.retrying}/>
   <Status icon={health.failed24h?<AlertTriangle size={13}/>:<CheckCircle2 size={13}/>} label="Ошибки 24 ч." value={health.failed24h} danger={health.failed24h>0}/>
  </div>}
  {health?.lastError&&<p role="alert" className="rounded-[11px] border border-red-400/15 bg-red-400/[.05] px-3 py-2 text-[10px] leading-relaxed text-red-200">{health.lastError}</p>}
  {actions.length===0&&<p className="text-[11px] text-[#777780]">После запуска здесь появятся ответы, активности и понятные причины молчания.</p>}
  {actions.map(action=>{const expanded=open===action.id,p=action.presentation;return <article key={action.id} className={'rounded-[13px] border p-3 '+tone(action)}>
   <button type="button" aria-expanded={expanded} onClick={()=>setOpen(expanded?null:action.id)} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-[9px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]">
    <span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold text-white">{p?.decisionLabel??action.decision} · {p?.intentLabel??action.intent??'Системное действие'}</span><span className="mt-1 block line-clamp-2 text-[10px] leading-relaxed text-[#8A8A93]">{p?.reasonLabel??action.reason??'Без дополнительной причины'}</span></span>
    <span className="shrink-0 text-right"><span className="block text-[9px] text-[#66666E]">{new Date(action.createdAt).toLocaleString('ru')}</span><ChevronDown size={15} className={'ml-auto mt-1 transition-transform '+(expanded?'rotate-180':'')}/></span>
   </button>
   {expanded&&<div className="mt-2 space-y-2 border-t border-white/[.06] pt-3 text-[10px] text-[#8A8A93]">
    {action.response&&<div><p className="font-semibold text-[#B4B4BC]">Текст CM</p><p className="mt-1 whitespace-pre-wrap leading-relaxed text-[#D4D4D8]">{action.response}</p></div>}
    <div className="flex flex-wrap gap-2"><Chip>{Math.round((action.confidence??0)*100)}% уверенности</Chip>{p?.engagementLabel&&<Chip>{p.engagementLabel}</Chip>}{typeof p?.conversationScore==='number'&&<Chip>ценность {Math.round(p.conversationScore*100)}%</Chip>}{p?.thematic&&<Chip>тематическая беседа</Chip>}{p?.moderatorFollowup&&<Chip>после Moderator</Chip>}{p?.researchRequested&&<Chip>запрос свежих данных</Chip>}{p?.expertInvite&&<Chip>приглашён {p.expertInvite}</Chip>}{p?.latencyMs?<Chip>{(p.latencyMs/1000).toFixed(1)} с</Chip>:null}{p?.tokens?<Chip>{p.tokens} токенов</Chip>:null}</div>
    {p?.topic&&<p>Тема: {p.topic}</p>}{p?.domains?.length?<div className="flex items-start gap-2"><Globe2 size={13} className="mt-0.5 shrink-0"/><p>Внутренний ресёрч: {p.domains.join(', ')}</p></div>:null}
    {action.error&&<p className="text-red-300">Ошибка: {action.error}</p>}
    {action.decision==='DRAFT'&&<button type="button" onClick={()=>onSendDraft(action.id)} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[9px] bg-[rgba(255,106,0,.12)] px-3 font-semibold text-[#FF8A3D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]"><Send size={13}/> Отправить</button>}
   </div>}
  </article>})}
 </div>
}
function Status({icon,label,value,danger=false}:{icon:React.ReactNode;label:string;value:number;danger?:boolean}){return <div className={'rounded-[11px] border px-2 py-2.5 '+(danger?'border-red-400/15 bg-red-400/[.05]':'border-white/[.07] bg-white/[.025]')}><span className={'flex items-center gap-1 text-[9px] '+(danger?'text-red-300':'text-[#777780]')}>{icon}{label}</span><b className="mt-1 block text-[13px] text-white">{value}</b></div>}
function Chip({children}:{children:React.ReactNode}){return <span className="rounded-full border border-white/[.07] bg-white/[.03] px-2 py-1 text-[9px] text-[#A1A1AA]">{children}</span>}
