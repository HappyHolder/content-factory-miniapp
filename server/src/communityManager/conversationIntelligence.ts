import type { CommunityManagerConfigData } from './config';

export type ConversationDecision={
  intent:string;respond:boolean;research:boolean;confidence:number;reason:string;
  engagementLevel:'ignore'|'acknowledge'|'contribute'|'lead';
  conversationScore:number;topic:string;valueAdd:string;moderatorFollowup:boolean;
  usage:{input:number;output:number};
};
const thresholds:Record<CommunityManagerConfigData['replies']['participationLevel'],number>={quiet:.86,selective:.72,active:.58};

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
