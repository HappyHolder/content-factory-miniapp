import type { CommunityManagerConfigData } from './config';

export type ConversationDecision={
  intent:string;respond:boolean;research:boolean;confidence:number;reason:string;
  engagementLevel:'ignore'|'acknowledge'|'contribute'|'lead';
  conversationScore:number;topic:string;valueAdd:string;moderatorFollowup:boolean;
  usage:{input:number;output:number};
};
const thresholds:Record<CommunityManagerConfigData['replies']['participationLevel'],number>={quiet:.84,selective:.68,active:.48};

const normalized=(value:string)=>value.toLowerCase().replace(/\u0451/g,'\u0435').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const addressAliases=['cm','\u043a\u043c','\u043a\u043e\u043c\u044c\u044e\u043d\u0438\u0442\u0438 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440','\u043a\u043e\u043c\u044c\u044e\u043d\u0438\u0442\u0438\u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440'];
const conflictTerms=['\u043e\u0431\u0438\u0436','\u043e\u0441\u043a\u043e\u0440\u0431','\u0431\u0443\u043b\u043b','\u0442\u0440\u0430\u0432\u043b','\u0443\u0433\u0440\u043e\u0436','\u0437\u0430\u0442\u043a','\u0441\u0440\u0430\u0447','\u043a\u043e\u043d\u0444\u043b\u0438\u043a\u0442','\u0440\u0443\u0433\u0430','\u043c\u0430\u0442','\u043d\u0430\u0445\u0443\u0439','\u0445\u0443\u0439','\u043f\u0438\u0437\u0434','\u0435\u0431','\u0434\u0443\u0448\u043d\u0438\u043b'];
const roleTerms=['\u0437\u0430\u0432\u043e\u0434\u0438\u043b','\u043c\u0435\u0434\u0438\u0430\u0442\u043e\u0440','\u043f\u0440\u043e\u0432\u043e\u043a\u0430\u0442\u043e\u0440','\u0441\u0432\u043e\u0439'];

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
    'Debate behavior: '+i.debateStyle+'. Initiative: '+i.initiativeLevel+'/3.',
    'Use personality to decide how readily to join, not to relax safety. A provocateur may challenge ideas or defuse with humor, but must never join harassment or attack a person.',
  ].join(' ');
}

export function applyConversationPolicy(input:{
  config:CommunityManagerConfigData;
  decision:ConversationDecision;
  text:string;
  socialAddress:boolean;
  recentModerator:boolean;
  participantCount:number;
  messageCount:number;
}):ConversationDecision{
  const d={...input.decision};
  if(d.intent==='unsafe')return d;
  if(input.socialAddress){
    d.respond=true;
    d.intent='conversation';
    if(d.engagementLevel==='ignore')d.engagementLevel='acknowledge';
    d.conversationScore=Math.max(d.conversationScore,input.config.replies.participationLevel==='active'?.7:.62);
    d.confidence=Math.max(d.confidence,.75);if(!d.valueAdd)d.valueAdd='React briefly and naturally to a direct social appeal to CM.';
    d.reason='Direct social appeal to CM';
  }
  const text=normalized(input.text);
  const continuedConflict=input.recentModerator&&input.config.replies.moderatorFollowups&&input.participantCount>=2&&input.messageCount>=3&&conflictTerms.some(term=>text.includes(term));
  const roles=normalized(input.config.identity.socialRoles.join(' '));
  const personalityAllows=input.config.replies.participationLevel==='active'||input.config.identity.debateStyle==='defuse'||roleTerms.some(term=>roles.includes(term));
  if(continuedConflict&&(input.socialAddress||personalityAllows)){
    d.respond=true;
    d.intent='conversation';
    d.engagementLevel='contribute';
    d.conversationScore=Math.max(d.conversationScore,.72);
    d.moderatorFollowup=true;d.confidence=Math.max(d.confidence,.8);
    d.valueAdd='Use one short independent reply to support the Moderator boundary and lower tension without attacking anyone.';
    d.reason='Conflict continued after Moderator; one human CM follow-up is appropriate';
  }
  return d;
}

export function canJoinThematicConversation(input:{config:CommunityManagerConfigData;decision:ConversationDecision;participantCount:number;messageCount:number;cooldownFree:boolean}):boolean{
  const {config,decision}=input;
  if(!config.replies.ambientConversation||!config.replies.thematicConversation||!input.cooldownFree)return false;
  if(input.participantCount<2||input.messageCount<3)return false;
  if(!['contribute','lead'].includes(decision.engagementLevel))return false;
  return decision.respond&&decision.conversationScore>=thresholds[config.replies.participationLevel];
}

export function safeMemoryArray(value:unknown,max=8):string[]{
  return Array.isArray(value)?value.flatMap(x=>typeof x==='string'&&x.trim()?[x.trim().slice(0,180)]:[]).slice(0,max):[];
}
