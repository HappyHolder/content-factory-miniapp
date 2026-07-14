export type CommunityActivityType='DISCUSSION'|'POLL'|'GAME'|'DIGEST';

export function initiativeBackoffHours(baseHours:number,ignoredStreak:number){
  const base=Math.max(1,Math.min(168,Math.round(baseHours)||24));
  if(ignoredStreak>=3)return Math.max(base,168);
  if(ignoredStreak===2)return Math.max(base,72);
  if(ignoredStreak===1)return Math.max(base,24);
  return base;
}

export function consecutiveIgnored(results:Array<{automatic?:boolean;evaluated?:boolean;engaged?:boolean}>){
  let count=0;
  for(const result of results){
    if(!result.automatic||!result.evaluated)continue;
    if(result.engaged)break;
    count++;
  }
  return count;
}

export function chooseActivityType(enabled:CommunityActivityType[],recent:CommunityActivityType[]){
  if(!enabled.length)return null;
  const unused=enabled.filter(type=>!recent.slice(0,Math.max(1,enabled.length-1)).includes(type));
  return (unused.length?unused:enabled)[0]??null;
}