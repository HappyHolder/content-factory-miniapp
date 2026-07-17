const clean=(value:unknown,max=240)=>typeof value==='string'?value.trim().replace(/\s+/g,' ').slice(0,max):'';

export type Episode={at:string;participant:string;kind:'question'|'answer'|'agreement'|'disagreement'|'promise'|'support'|'correction';summary:string;outcome:'open'|'resolved'|'neutral'};

export function parseEpisodes(value:unknown):Episode[]{
  if(!Array.isArray(value))return[];
  return value.flatMap(item=>{
    if(!item||typeof item!=='object')return[];
    const row=item as Partial<Episode>,participant=clean(row.participant,120),summary=clean(row.summary);
    if(!participant||!summary)return[];
    const kind=(['question','answer','agreement','disagreement','promise','support','correction'].includes(String(row.kind))?row.kind:'answer') as Episode['kind'];
    const outcome=(['open','resolved','neutral'].includes(String(row.outcome))?row.outcome:'neutral') as Episode['outcome'];
    const at=Number.isFinite(Date.parse(String(row.at)))?new Date(String(row.at)).toISOString():new Date().toISOString();
    return[{at,participant,kind,summary,outcome}];
  });
}

export function consolidateEpisodes(current:unknown,incoming:unknown,max=24){
  const all=[...parseEpisodes(current),...parseEpisodes(incoming)].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const deduped=new Map<string,Episode>();
  for(const item of all){
    const key=(item.participant+'|'+item.kind+'|'+item.summary).toLocaleLowerCase('ru-RU');
    deduped.set(key,item);
  }
  const cutoff=Date.now()-90*86400_000;
  return[...deduped.values()].filter(item=>item.outcome==='open'||Date.parse(item.at)>=cutoff).slice(-Math.max(1,max));
}

export function consolidateNotes(value:unknown,max=16){
  const notes=Array.isArray(value)?value.map(item=>clean(item,300)).filter(Boolean):[];
  return[...new Map(notes.map(note=>[note.toLocaleLowerCase('ru-RU'),note])).values()].slice(-max);
}
