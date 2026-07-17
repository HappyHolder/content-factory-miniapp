export type CommunityActivityType='DISCUSSION'|'POLL'|'GAME'|'DIGEST';


export function chooseActivityType(enabled:CommunityActivityType[],recent:CommunityActivityType[]){
  if(!enabled.length)return null;
  const unused=enabled.filter(type=>!recent.slice(0,Math.max(1,enabled.length-1)).includes(type));
  return (unused.length?unused:enabled)[0]??null;
}
export function chooseAdaptiveActivityType(enabled:CommunityActivityType[],history:Array<{type:string;engaged?:boolean;evaluated?:boolean}>){
  if(!enabled.length)return null;
  const last=history[0]?.type,scores=new Map(enabled.map((type,index)=>[type,enabled.length-index]));
  for(const item of history){
    if(!scores.has(item.type as CommunityActivityType)||!item.evaluated)continue;
    scores.set(item.type as CommunityActivityType,(scores.get(item.type as CommunityActivityType)??0)+(item.engaged?3:-2));
  }
  return [...enabled].sort((a,b)=>(a===last?1:0)-(b===last?1:0)||(scores.get(b)??0)-(scores.get(a)??0))[0]??null;
}

export function chooseActivityTopic(topics:string[],recentTopics:Array<string|null|undefined>){
  const clean=[...new Set(topics.map(topic=>topic.trim()).filter(Boolean))];if(!clean.length)return undefined;
  const blocked=new Set(recentTopics.slice(0,Math.max(1,clean.length-1)).filter(Boolean));
  return clean.find(topic=>!blocked.has(topic))??clean[0];
}
export type CommunityPulse={energy:'silent'|'low'|'active';tension:boolean;openQuestions:boolean;participants:number;messages:number};

export function communityPulse(input:{messages:number;participants:number;tension:boolean;openQuestions:number}):CommunityPulse{
  return{energy:input.messages===0?'silent':input.messages<6?'low':'active',tension:input.tension,openQuestions:input.openQuestions>0,participants:input.participants,messages:input.messages};
}

export function chooseActivityForPulse(enabled:CommunityActivityType[],history:Array<{type:string;engaged?:boolean;evaluated?:boolean}>,pulse:CommunityPulse){
  if(pulse.tension||pulse.energy==='active')return null;
  if(pulse.openQuestions&&enabled.includes('DISCUSSION'))return'DISCUSSION';
  if(pulse.energy==='silent'&&enabled.includes('POLL'))return'POLL';
  if(pulse.energy==='low'&&enabled.includes('GAME'))return'GAME';
  return chooseAdaptiveActivityType(enabled,history);
}