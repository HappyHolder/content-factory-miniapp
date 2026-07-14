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
  const blocks=text.split(/\n{2,}|(?=^#{1,4}\s)/gm).map(block=>block.trim()).filter(block=>block.length>40),chunks:string[]=[];
  for(const block of blocks){
    if(block.length<=maxChars){chunks.push(block);continue}
    for(let offset=0;offset<block.length;offset+=maxChars-200)chunks.push(block.slice(offset,offset+maxChars));
  }
  return chunks;
}
