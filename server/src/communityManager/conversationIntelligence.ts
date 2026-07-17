import type { CommunityManagerConfigData } from './config';


const normalized=(value:string)=>value.toLowerCase().replace(/\u0451/g,'\u0435').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const addressAliases=['cm','\u043a\u043c','\u043a\u043e\u043c\u044c\u044e\u043d\u0438\u0442\u0438 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440','\u043a\u043e\u043c\u044c\u044e\u043d\u0438\u0442\u0438\u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440'];

export function isAddressedToCommunityManager(text:string,config:CommunityManagerConfigData):boolean{
  const value=normalized(text);
  if(!value)return false;
  const padded=' '+value+' ';
  if(addressAliases.some(alias=>alias.length<=2?padded.includes(' '+alias+' '):value.includes(alias)))return true;
  const names=normalized(config.identity.displayName).split(' ').filter(x=>x.length>=2);
  return names.some(name=>padded.includes(' '+name+' '));
}

export function participationDecisionContext(config:CommunityManagerConfigData):string{
  const i=config.identity;
  return [
    'Participation level: '+config.replies.participationLevel+'.',
    'Social roles: '+(i.socialRoles.join(', ')||'community manager')+'.',
    'Character: '+(i.traits.join(', ')||i.tone)+'.',
    'Psychology: '+Object.entries(config.personality.psychology).map(([key,value])=>key+'='+value).join(', ')+'.',
    'Reactions: '+Object.entries(config.personality.reactions).map(([key,value])=>key+'='+value).join(', ')+'.',
    'Current goals: '+(config.personality.core.goals.join(', ')||'support the community')+'.',
    'Debate behavior: '+i.debateStyle+'. Initiative: '+i.initiativeLevel+'/3.',
    'Use personality to decide how readily to join, not to relax safety. A provocateur may challenge ideas or defuse with humor, but must never join harassment or attack a person.',
  ].join(' ');
}


export function safeMemoryArray(value:unknown,max=8):string[]{
  return Array.isArray(value)?value.flatMap(x=>typeof x==='string'&&x.trim()?[x.trim().slice(0,180)]:[]).slice(0,max):[];
}
