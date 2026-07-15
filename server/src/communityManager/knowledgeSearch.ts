const tokens=(value:string)=>[...new Set(value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(token=>token.length>2))];

export type KnowledgeCandidate={text:string;source:string;priority?:number};
export type KnowledgeMatch=KnowledgeCandidate&{score:number;matchedTerms:string[]};

export function rankKnowledge(query:string,candidates:KnowledgeCandidate[],limit=5):KnowledgeMatch[]{
  const terms=tokens(query),phrase=query.trim().toLowerCase();
  if(!terms.length)return[];
  return candidates.map(candidate=>{
    const haystack=(candidate.source+' '+candidate.text).toLowerCase(),matchedTerms=terms.filter(term=>haystack.includes(term));
    const coverage=matchedTerms.length/terms.length,exact=phrase.length>8&&haystack.includes(phrase)?8:0,sourceHits=terms.filter(term=>candidate.source.toLowerCase().includes(term)).length*3;
    return{...candidate,matchedTerms,score:Math.round((matchedTerms.length*2+coverage*6+exact+sourceHits+(candidate.priority??0))*100)/100};
  }).filter(item=>item.matchedTerms.length>0).sort((a,b)=>b.score-a.score||b.matchedTerms.length-a.matchedTerms.length).slice(0,limit);
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
