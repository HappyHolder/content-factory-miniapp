import type { CommunityManagerConfigData } from './config';
import type { SocialState } from './socialState';
import { personalityEngagementAdjustment, type PersonalInnerState } from './personalityState';

export type SocialAction='SILENT'|'REACT'|'REPLY'|'JOIN'|'SUPPORT_MODERATOR';

export type SocialDecision={
  intent:string;
  respond:boolean;
  research:boolean;
  confidence:number;
  reason:string;
  engagementLevel:'ignore'|'acknowledge'|'contribute'|'lead';
  conversationScore:number;
  topic:string;
  valueAdd:string;
  moderatorFollowup:boolean;
  speechAct?:'question'|'request'|'argument'|'acknowledgement'|'closure'|'abuse'|'other';
  expectsReply?:boolean;
  conversationComplete?:boolean;
  sameSegment?:boolean;
  newContribution?:string;
  possibleClaims?:Array<{kind:'ROLE'|'EXPERTISE'|'PREFERENCE'|'FACT';value:string;confidence:number}>;
  usage:{input:number;output:number};
};

export type SocialRoute={
  action:SocialAction;
  shouldSpeak:boolean;
  priority:boolean;
  replyToCurrent:boolean;
  reason:string;
};

const threshold=(level:CommunityManagerConfigData['replies']['participationLevel'])=>level==='active'?.42:level==='selective'?.58:.74;

/** The single final authority deciding whether CM speaks. No second policy layer may veto this route. */
export function routeSocialAction(input:{
  personalState?:PersonalInnerState;
  config:CommunityManagerConfigData;
  decision:SocialDecision;
  telegramDirect:boolean;
  socialAddress:boolean;
  addressedToOtherHuman?:boolean;
  productContext:boolean;
  recentModerator:boolean;
  cooldownFree:boolean;
  hasQuestion:boolean;
  unansweredQuestion?:boolean;
  socialState?:SocialState;
}):SocialRoute{
  const {config,decision}=input;
  if(decision.intent==='unsafe')return{action:'SILENT',shouldSpeak:false,priority:false,replyToCurrent:false,reason:'unsafe'};

  const addressed=input.telegramDirect||input.socialAddress;
  if(addressed){
    if(decision.speechAct==='abuse')return{action:'SILENT',shouldSpeak:false,priority:false,replyToCurrent:false,reason:'direct_abuse'};
    if(decision.speechAct==='acknowledgement'&&!(decision.newContribution??'').trim())return{action:'REACT',shouldSpeak:true,priority:true,replyToCurrent:true,reason:'direct_acknowledgement'};
    if(decision.speechAct==='closure'||(!decision.respond&&!decision.expectsReply))return{action:'SILENT',shouldSpeak:false,priority:false,replyToCurrent:false,reason:'direct_conversation_complete'};
    if(decision.respond&&(decision.expectsReply||input.hasQuestion||Boolean((decision.newContribution??decision.valueAdd).trim())))return{action:'REPLY',shouldSpeak:true,priority:true,replyToCurrent:true,reason:'addressed_to_cm_with_value'};
    return{action:'SILENT',shouldSpeak:false,priority:false,replyToCurrent:false,reason:'direct_without_value'};
  }
  if(input.addressedToOtherHuman&&input.hasQuestion){
    return{action:'SILENT',shouldSpeak:false,priority:false,replyToCurrent:false,reason:'question_addressed_to_human'};
  }
  if(input.productContext&&config.support.answerProductQuestions&&decision.respond){
    return{action:'REPLY',shouldSpeak:true,priority:true,replyToCurrent:true,reason:'project_question'};
  }
  if(input.recentModerator&&config.replies.moderatorFollowups&&decision.moderatorFollowup){
    return{action:'SUPPORT_MODERATOR',shouldSpeak:true,priority:true,replyToCurrent:false,reason:'moderator_followup'};
  }
  if(input.unansweredQuestion&&config.replies.replyToUnansweredQuestion){
    return{action:'REPLY',shouldSpeak:true,priority:true,replyToCurrent:true,reason:'unanswered_question'};
  }
  if(input.socialState?.tension==='heated'&&!input.recentModerator){
    return{action:'SILENT',shouldSpeak:false,priority:false,replyToCurrent:false,reason:'heated_wait_for_moderator'};
  }
  if(!config.replies.ambientConversation||!input.cooldownFree){
    return{action:'SILENT',shouldSpeak:false,priority:false,replyToCurrent:false,reason:!config.replies.ambientConversation?'ambient_disabled':'social_rhythm'};
  }
  if(!decision.respond||decision.intent==='no_response'||decision.intent==='request_human'){
    return{action:'SILENT',shouldSpeak:false,priority:false,replyToCurrent:false,reason:decision.reason||'no_value'};
  }

  const hasValue=Boolean(decision.valueAdd.trim())||input.hasQuestion;
  const stateAdjustment=(input.socialState?.initiative==='join'?-.06:input.socialState?.initiative==='lead'?-.1:0)+personalityEngagementAdjustment(config,input.personalState??{valence:0,arousal:.3,dominance:.55,energy:.7,stress:.15,irritation:.05,confidence:.65,curiosity:.7,activeGoal:'support the conversation',updatedAt:new Date(0).toISOString()});
  const enoughSignal=decision.confidence>=.55&&decision.conversationScore>=threshold(config.replies.participationLevel)+stateAdjustment;
  if(config.replies.thematicConversation&&hasValue&&enoughSignal&&['contribute','lead'].includes(decision.engagementLevel)){
    return{action:'JOIN',shouldSpeak:true,priority:false,replyToCurrent:true,reason:'useful_contribution'};
  }
  if(decision.engagementLevel==='acknowledge'&&decision.confidence>=.72&&decision.conversationScore>=threshold(config.replies.participationLevel)+.08){
    return{action:'REACT',shouldSpeak:true,priority:false,replyToCurrent:true,reason:'timely_reaction'};
  }
  return{action:'SILENT',shouldSpeak:false,priority:false,replyToCurrent:false,reason:'insufficient_social_value'};
}
