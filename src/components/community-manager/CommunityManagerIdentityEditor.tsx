import { useState } from 'react'
import { Check, Loader2, Plus, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export type CommunityManagerIdentity={
 displayName:string;role:string;bio:string;preset:string;tone:string;addressForm:string
 socialRoles:string[];traits:string[];speechStyles:string[];humorStyles:string[]
 profanityLevel:'none'|'mild'|'natural'|'rough';debateStyle:'avoid'|'gentle'|'fact_check'|'devils_advocate'|'provoke'|'defuse'
 expertiseStances:string[];collectiveAddress:string;verbalHabits:string[];customInstructions:string
 humorLevel:number;initiativeLevel:number;forbiddenClaims:string[]
}
type Props={value:CommunityManagerIdentity;onChange:(value:CommunityManagerIdentity)=>void;onPreview:()=>void;previewBusy:boolean;preview:null|Record<string,string>}
const input='mt-1.5 min-h-11 w-full rounded-[11px] border border-white/[0.08] bg-[#0B0B0D] px-3 text-[13px] text-white outline-none focus:border-[rgba(255,106,0,0.5)] focus-visible:ring-2 focus-visible:ring-[#FF6A00]/30'
const area=input+' resize-none py-3 leading-relaxed'
const label='block text-[11px] font-medium text-[#9A9AA2]'
const options={
 roles:['Заводила','Эксперт','Свой человек','Исследователь','Скептик','Провокатор','Медиатор','Помощник новичков','Представитель продукта','Адвокат дьявола'],
 traits:['Спокойный','Энергичный','Дерзкий','Прямолинейный','Азартный','Ироничный','Циничный','Тёплый','Любопытный','Уверенный','Самоироничный','Грубоватый','Хаотичный','Педантичный'],
 speech:['Деловая','Разговорная','Ламповая','Уличная','Чатовая','Мемная','Сленговая','Техническая','Простыми словами','Без официоза','Коротко и резко','Криптанская'],
 humor:['Без юмора','Лёгкий','Ирония','Самоирония','Сарказм','Абсурд','Мемы','Чёрный юмор','Подколы'],
 expertise:['Уверенный эксперт','Объясняет новичкам','Собеседник на равных','Сначала проверяет данные','Честно признаёт незнание','Учится вместе с участниками','Скептик-фактчекер','Представитель поддержки'],
 habits:['Эмодзи','Без эмодзи','Короткие сообщения','Несколько сообщений подряд','Иногда CAPS','Скобки вместо эмодзи','Мемные реакции','Английские термины','Риторические вопросы'],
 addresses:['Ребята','Народ','Коллеги','Друзья','Пацаны','Криптаны','Дегены','Без обращения'],
}
const presets:Array<{id:string;name:string;patch:Partial<CommunityManagerIdentity>}>= [
 {id:'serious_expert',name:'Серьёзный эксперт',patch:{socialRoles:['Эксперт','Исследователь'],traits:['Спокойный','Педантичный'],speechStyles:['Деловая','Техническая'],humorStyles:['Без юмора'],profanityLevel:'none',debateStyle:'fact_check',expertiseStances:['Уверенный эксперт','Сначала проверяет данные'],verbalHabits:['Короткие сообщения']}},
 {id:'friendly_guide',name:'Дружелюбный проводник',patch:{socialRoles:['Свой человек','Помощник новичков'],traits:['Тёплый','Любопытный'],speechStyles:['Разговорная','Простыми словами'],humorStyles:['Лёгкий'],profanityLevel:'none',debateStyle:'gentle',expertiseStances:['Собеседник на равных','Честно признаёт незнание'],verbalHabits:['Короткие сообщения']}},
 {id:'insider',name:'Свой в доску',patch:{socialRoles:['Свой человек','Заводила'],traits:['Прямолинейный','Самоироничный'],speechStyles:['Ламповая','Без официоза'],humorStyles:['Ирония','Подколы'],profanityLevel:'mild',debateStyle:'gentle',expertiseStances:['Собеседник на равных'],verbalHabits:['Короткие сообщения','Скобки вместо эмодзи']}},
 {id:'crypto_degen',name:'Криптодеген',patch:{socialRoles:['Заводила','Провокатор'],traits:['Азартный','Дерзкий','Самоироничный'],speechStyles:['Криптанская','Сленговая','Чатовая'],humorStyles:['Мемы','Подколы'],profanityLevel:'natural',debateStyle:'provoke',expertiseStances:['Собеседник на равных','Скептик-фактчекер'],collectiveAddress:'Дегены',verbalHabits:['Английские термины','Мемные реакции']}},
 {id:'skeptic',name:'Ироничный скептик',patch:{socialRoles:['Скептик','Исследователь'],traits:['Ироничный','Недоверчивый'],speechStyles:['Разговорная','Коротко и резко'],humorStyles:['Ирония','Сарказм'],profanityLevel:'mild',debateStyle:'fact_check',expertiseStances:['Скептик-фактчекер','Сначала проверяет данные'],verbalHabits:['Риторические вопросы']}},
 {id:'debate_host',name:'Провокатор дискуссий',patch:{socialRoles:['Провокатор','Адвокат дьявола'],traits:['Уверенный','Прямолинейный'],speechStyles:['Разговорная','Без официоза'],humorStyles:['Ирония'],profanityLevel:'mild',debateStyle:'provoke',expertiseStances:['Собеседник на равных'],verbalHabits:['Риторические вопросы']}},
 {id:'mediator',name:'Спокойный медиатор',patch:{socialRoles:['Медиатор','Свой человек'],traits:['Спокойный','Тёплый'],speechStyles:['Разговорная','Простыми словами'],humorStyles:['Лёгкий'],profanityLevel:'none',debateStyle:'defuse',expertiseStances:['Собеседник на равных'],verbalHabits:['Короткие сообщения']}},
]
function Chip({selected,onClick,children}:{selected:boolean;onClick:()=>void;children:React.ReactNode}){return <button type="button" aria-pressed={selected} onClick={onClick} className={'min-h-11 cursor-pointer rounded-full border px-3 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00] '+(selected?'border-[#FF6A00] bg-[rgba(255,106,0,.14)] text-[#FF9A57]':'border-white/[.09] bg-white/[.025] text-[#A1A1AA] hover:border-white/[.16]')}><span className="inline-flex items-center gap-1.5">{selected&&<Check size={12}/>} {children}</span></button>}
function MultiChips({title,items,value,max,onChange}:{title:string;items:string[];value:string[];max:number;onChange:(v:string[])=>void}){
 const[custom,setCustom]=useState('')
 const toggle=(item:string)=>onChange(value.includes(item)?value.filter(x=>x!==item):value.length<max?[...value,item]:value)
 const add=()=>{const item=custom.trim();if(item&&!value.includes(item)&&value.length<max)onChange([...value,item]);setCustom('')}
 return <div><div className="flex items-center justify-between gap-3"><p className={label}>{title}</p><span className="text-[10px] text-[#5F5F68]">до {max}</span></div><div className="mt-2 flex flex-wrap gap-2">{[...new Set([...items,...value])].map(item=><Chip key={item} selected={value.includes(item)} onClick={()=>toggle(item)}>{item}</Chip>)}</div><div className="mt-2 flex gap-2"><input aria-label={'Свой вариант: '+title} value={custom} onChange={e=>setCustom(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add()}}} className={input+' mt-0'} placeholder="Свой вариант"/><button type="button" aria-label="Добавить вариант" onClick={add} disabled={!custom.trim()||value.length>=max} className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[11px] border border-white/[.09] text-[#FF7A22] focus-visible:ring-2 focus-visible:ring-[#FF6A00] disabled:cursor-not-allowed disabled:opacity-30"><Plus size={16}/></button></div></div>
}
function SingleChips<T extends string>({title,items,value,onChange}:{title:string;items:Array<[T,string]>;value:T;onChange:(v:T)=>void}){return <div><p className={label}>{title}</p><div className="mt-2 flex flex-wrap gap-2">{items.map(([id,name])=><Chip key={id} selected={value===id} onClick={()=>onChange(id)}>{name}</Chip>)}</div></div>}

export function CommunityManagerIdentityEditor({value,onChange,onPreview,previewBusy,preview}:Props){
 const set=<K extends keyof CommunityManagerIdentity>(key:K,next:CommunityManagerIdentity[K])=>onChange({...value,[key]:next})
 const applyPreset=(preset:typeof presets[number])=>onChange({...value,...preset.patch,preset:preset.id})
 return <div className="space-y-5">
  <div><p className={label}>Готовый образ</p><p className="mt-1 text-[10px] leading-relaxed text-[#66666E]">Выберите основу и измените любые параметры.</p><div className="mt-2 flex flex-wrap gap-2">{presets.map(p=><Chip key={p.id} selected={value.preset===p.id} onClick={()=>applyPreset(p)}>{p.name}</Chip>)}</div></div>
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className={label}>Имя<input value={value.displayName} onChange={e=>set('displayName',e.target.value)} className={input}/></label><label className={label}>Роль<input value={value.role} onChange={e=>set('role',e.target.value)} className={input}/></label></div>
  <label className={label}>Биография<textarea rows={4} value={value.bio} onChange={e=>set('bio',e.target.value)} className={area} placeholder="Опыт, интересы, взгляды и отношение к сообществу"/></label>
  <MultiChips title="Роль в сообществе" items={options.roles} value={value.socialRoles} max={3} onChange={v=>set('socialRoles',v)}/>
  <MultiChips title="Характер" items={options.traits} value={value.traits} max={5} onChange={v=>set('traits',v)}/>
  <MultiChips title="Манера речи" items={options.speech} value={value.speechStyles} max={5} onChange={v=>set('speechStyles',v)}/>
  <MultiChips title="Юмор" items={options.humor} value={value.humorStyles} max={3} onChange={v=>set('humorStyles',v)}/>
  <SingleChips title="Мат и грубость" value={value.profanityLevel} onChange={v=>set('profanityLevel',v)} items={[[ 'none','Без мата'],['mild','Редкий мягкий'],['natural','Естественный'],['rough','Грубый чатовый']]}/>
  <SingleChips title="Поведение в споре" value={value.debateStyle} onChange={v=>set('debateStyle',v)} items={[[ 'avoid','Избегает'],['gentle','Мягко возражает'],['fact_check','Проверяет факты'],['devils_advocate','Адвокат дьявола'],['provoke','Провоцирует дискуссию'],['defuse','Снижает напряжение']]}/>
  <MultiChips title="Позиция эксперта" items={options.expertise} value={value.expertiseStances} max={4} onChange={v=>set('expertiseStances',v)}/>
  <div><p className={label}>Обращение к группе</p><div className="mt-2 flex flex-wrap gap-2">{[...new Set([...options.addresses,value.collectiveAddress].filter(Boolean))].map(x=><Chip key={x} selected={value.collectiveAddress===x} onClick={()=>set('collectiveAddress',x)}>{x}</Chip>)}</div><input aria-label="Своё обращение" value={options.addresses.includes(value.collectiveAddress)?'':value.collectiveAddress} onChange={e=>set('collectiveAddress',e.target.value)} className={input} placeholder="Своё обращение"/></div>
  <div><p className={label}>Обращение к человеку</p><div className="mt-2 flex gap-2"><Chip selected={value.addressForm==='ты'} onClick={()=>set('addressForm','ты')}>На ты</Chip><Chip selected={value.addressForm==='вы'} onClick={()=>set('addressForm','вы')}>На вы</Chip></div></div>
  <MultiChips title="Речевые привычки" items={options.habits} value={value.verbalHabits} max={6} onChange={v=>set('verbalHabits',v)}/>
  <label className={label}>Дополнительная инструкция<textarea rows={3} value={value.customInstructions} onChange={e=>set('customInstructions',e.target.value)} className={area} placeholder="Например: говорит как опытный криптан из закрытого чата, но нормально относится к новичкам"/></label>
  <label className={label}>Запрещённые обещания<textarea rows={3} value={value.forbiddenClaims.join('\n')} onChange={e=>set('forbiddenClaims',e.target.value.split('\n').map(x=>x.trim()).filter(Boolean))} className={area}/></label>
  <div className="rounded-[13px] border border-white/[.07] bg-white/[.02] p-3"><Button variant="secondary" size="sm" fullWidth onClick={onPreview} disabled={previewBusy}>{previewBusy?<Loader2 size={14} className="animate-spin"/>:<WandSparkles size={14}/>} Проверить личность</Button>{preview&&<div className="mt-3 space-y-2">{[['answer','Ответ на вопрос'],['disagreement','Несогласие'],['criticism','Ответ на критику'],['familiar','Знакомый участник'],['conflict','После конфликта']].map(([key,title])=><div key={key} className="rounded-[10px] bg-[#0B0B0D] p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#66666E]">{title}</p><p className="mt-1 text-[11px] leading-relaxed text-white">{preview[key]}</p></div>)}</div>}</div>
 </div>
}
