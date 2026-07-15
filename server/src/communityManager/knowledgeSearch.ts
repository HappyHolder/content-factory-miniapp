// Generic filler that must not dominate lexical coverage. Kept language-neutral
// (no product- or tenant-specific vocabulary): this ranker is only a fallback
// used when a knowledge base is too large to hand to the model in full.
const STOP=new Set(['как','или','что','это','для','его','ему','свой','свое','своего','своих','лучше','использовать','подскажите','пожалуйста','можно','если','при','про','там','где','чтобы','вообще','нужно','надо','быть','есть','этот','весь','все','так','под','чем','тут','вот','они','оно','кто','тоже','уже','еще','ещё','the','and','for','you','with','your']);
// Light Russian suffix stripping so declensions collapse to a shared stem.
const RU_SUFFIX=/(ами|ями|ого|его|ому|ему|ыми|ими|ов|ев|ей|ий|ый|ая|яя|ое|ее|ую|юю|ам|ям|ом|ем|ах|ях|ы|и|а|я|о|е|у|ю|й|ь)$/u;
const stem=(t:string)=>{const s=t.replace(RU_SUFFIX,'');return s.length>=4?s:t;};
const tokens=(value:string)=>[...new Set(value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(t=>t.length>2&&!STOP.has(t)).map(stem))];

export type KnowledgeCandidate={text:string;source:string;priority?:number};
export type KnowledgeMatch=KnowledgeCandidate&{score:number;matchedTerms:string[]};

export function rankKnowledge(query:string,candidates:KnowledgeCandidate[],limit=6):KnowledgeMatch[]{
  const terms=tokens(query),phrase=query.trim().toLowerCase();
  if(!terms.length)return[];
  const scored=candidates.map(candidate=>{
    const hay=(candidate.source+' '+candidate.text).toLowerCase(),haySet=new Set(tokens(candidate.source+' '+candidate.text));
    const matchedTerms=terms.filter(term=>haySet.has(term));
    const coverage=matchedTerms.length/terms.length,exact=phrase.length>8&&hay.includes(phrase)?8:0;
    const srcSet=new Set(tokens(candidate.source)),sourceHits=terms.filter(term=>srcSet.has(term)).length*3;
    return{...candidate,matchedTerms,score:Math.round((matchedTerms.length*2+coverage*6+exact+sourceHits+(candidate.priority??0))*100)/100};
  }).filter(item=>item.matchedTerms.length>0).sort((a,b)=>b.score-a.score||b.matchedTerms.length-a.matchedTerms.length);
  // Keep at most two chunks per heading so one section cannot crowd out the rest.
  const out:KnowledgeMatch[]=[],perSection=new Map<string,number>();
  for(const item of scored){
    const section=(item.source+'|'+item.text.split('\n')[0]).toLowerCase(),used=perSection.get(section)??0;
    if(used>=2)continue;
    perSection.set(section,used+1);out.push(item);
    if(out.length>=limit)break;
  }
  return out;
}

export function documentChunks(text:string,maxChars=2200){
  const blocks=text.split(/\n{2,}/g).map(block=>block.trim()).filter(Boolean),chunks:string[]=[];
  let heading='';
  for(const block of blocks){
    if(/^#{1,4}\s/.test(block)){heading=block;continue}
    const contextual=heading?heading+'\n'+block:block;
    if(contextual.length<=40)continue;
    if(contextual.length<=maxChars){chunks.push(contextual);continue}
    for(let offset=0;offset<contextual.length;offset+=maxChars-200)chunks.push(contextual.slice(offset,offset+maxChars));
  }
  return chunks;
}
