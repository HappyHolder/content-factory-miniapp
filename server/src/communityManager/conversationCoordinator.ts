import { prisma } from '../db';

export type ConversationAnalysis={
  topicKey:string;sameSegment:boolean;expectsReply:boolean;conversationComplete:boolean;newContribution:string;
  speechAct:'question'|'request'|'argument'|'acknowledgement'|'closure'|'abuse'|'other';
  possibleClaims:Array<{kind:'ROLE'|'EXPERTISE'|'PREFERENCE'|'FACT';value:string;confidence:number}>;
};
export type ConversationLocation={threadId:string;segmentId:string;threadVersion:number;segmentVersion:number;topicKey:string};
const clean=(value:unknown,max=160)=>typeof value==='string'?value.trim().replace(/\s+/g,' ').slice(0,max):'';
export const normalizeTopicKey=(value:unknown)=>clean(value,80).toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_+|_+$/g,'')||'conversation';
export const isReplyContentRelevant=(analysis:Pick<ConversationAnalysis,'sameSegment'>)=>analysis.sameSegment;

export async function resolveConversationLocation(managerId:string,message:{id:string;tgChatId:string;telegramMessageId:number;replyToMessageId?:number|null;messageThreadId?:number|null;createdAt:Date}){
  let root=message.messageThreadId??message.telegramMessageId,origin='HUMAN',parentActionId:string|undefined;
  if(!message.messageThreadId&&message.replyToMessageId){
    const [parent,action]=await Promise.all([
      prisma.communityManagerMessage.findFirst({where:{communityManagerId:managerId,telegramMessageId:message.replyToMessageId},select:{messageThreadId:true,threadId:true}}),
      prisma.communityManagerAction.findFirst({where:{communityManagerId:managerId,telegramMessageId:message.replyToMessageId},orderBy:{createdAt:'desc'},select:{id:true,threadId:true}}),
    ]);
    parentActionId=action?.id;const knownThreadId=parent?.threadId??action?.threadId;
    if(knownThreadId){
      const thread=await prisma.communityManagerThread.findUnique({where:{id:knownThreadId},include:{segments:{where:{status:'ACTIVE'},orderBy:{updatedAt:'desc'},take:1}}});
      if(thread){const segment=thread.segments[0]??await prisma.communityManagerSegment.create({data:{communityManagerId:managerId,threadId:thread.id,topicKey:'conversation'}});await prisma.communityManagerMessage.update({where:{id:message.id},data:{threadId:thread.id,segmentId:segment.id,messageThreadId:thread.messageThreadId}});return{threadId:thread.id,segmentId:segment.id,threadVersion:thread.version,segmentVersion:segment.version,topicKey:segment.topicKey}}
    }
    root=parent?.messageThreadId??message.replyToMessageId;origin=action?'CM_ACTIVITY':'HUMAN';
  }
  const thread=await prisma.communityManagerThread.upsert({where:{communityManagerId_tgChatId_telegramRootMessageId:{communityManagerId:managerId,tgChatId:message.tgChatId,telegramRootMessageId:root}},create:{communityManagerId:managerId,tgChatId:message.tgChatId,telegramRootMessageId:root,messageThreadId:message.messageThreadId??root,origin,lastHumanAt:message.createdAt},update:{status:'ACTIVE',lastHumanAt:message.createdAt,version:{increment:1}}});
  const segment=await prisma.communityManagerSegment.findFirst({where:{threadId:thread.id,status:'ACTIVE'},orderBy:{updatedAt:'desc'}})??await prisma.communityManagerSegment.create({data:{communityManagerId:managerId,threadId:thread.id,topicKey:'conversation',lastMeaningfulTurnAt:message.createdAt}});
  await prisma.communityManagerMessage.update({where:{id:message.id},data:{threadId:thread.id,segmentId:segment.id,messageThreadId:message.messageThreadId??root}});
  if(parentActionId)await prisma.communityManagerAction.update({where:{id:parentActionId},data:{threadId:thread.id,segmentId:segment.id}});
  return{threadId:thread.id,segmentId:segment.id,threadVersion:thread.version,segmentVersion:segment.version,topicKey:segment.topicKey};
}

export async function applyConversationAnalysis(managerId:string,messageId:string,location:ConversationLocation,analysis:ConversationAnalysis,at=new Date()):Promise<ConversationLocation>{
  const topicKey=normalizeTopicKey(analysis.topicKey),change=!analysis.sameSegment&&topicKey!==location.topicKey;
  let segmentId=location.segmentId,segmentVersion=location.segmentVersion;
  if(change){
    await prisma.communityManagerSegment.updateMany({where:{id:location.segmentId,status:'ACTIVE'},data:{status:'RESOLVED',version:{increment:1}}});
    const segment=await prisma.communityManagerSegment.create({data:{communityManagerId:managerId,threadId:location.threadId,topicKey,summary:clean(analysis.newContribution||topicKey,500),lastMeaningfulTurnAt:at}});segmentId=segment.id;segmentVersion=segment.version;
  }else{
    const segment=await prisma.communityManagerSegment.update({where:{id:location.segmentId},data:{topicKey,...(analysis.newContribution?{summary:clean(analysis.newContribution,500)}:{}),lastMeaningfulTurnAt:at,version:{increment:1},...(analysis.conversationComplete?{status:'RESOLVED'}:{})}});segmentVersion=segment.version;
  }
  await prisma.communityManagerMessage.update({where:{id:messageId},data:{segmentId}});
  const thread=await prisma.communityManagerThread.update({where:{id:location.threadId},data:{lastHumanAt:at,status:analysis.conversationComplete?'IDLE':'ACTIVE',version:{increment:1}}});
  return{threadId:thread.id,segmentId,threadVersion:thread.version,segmentVersion,topicKey};
}

export async function segmentContext(managerId:string,currentMessageId:string,location:ConversationLocation,cmName:string){
  const [messages,actions,segment]=await Promise.all([
    prisma.communityManagerMessage.findMany({where:{communityManagerId:managerId,segmentId:location.segmentId,id:{not:currentMessageId}},orderBy:{createdAt:'desc'},take:24,select:{text:true,tgUserId:true,telegramMessageId:true,replyToMessageId:true,createdAt:true}}),
    prisma.communityManagerAction.findMany({where:{communityManagerId:managerId,segmentId:location.segmentId,response:{not:null}},orderBy:{createdAt:'desc'},take:16,select:{response:true,createdAt:true}}),
    prisma.communityManagerSegment.findUnique({where:{id:location.segmentId},select:{summary:true,topicKey:true,thesisLedger:true}}),
  ]);
  const ids=[...new Set(messages.map(x=>x.tgUserId).filter((x):x is string=>Boolean(x)))],people=ids.length?await prisma.communityManagerParticipant.findMany({where:{communityManagerId:managerId,tgUserId:{in:ids}},select:{tgUserId:true,displayName:true,username:true}}):[];
  const labels=new Map(people.map(x=>[x.tgUserId,x.displayName+(x.username?' (@'+x.username+')':'')]));
  const timeline=[...messages.map(x=>({at:x.createdAt,line:(x.tgUserId?(labels.get(x.tgUserId)??'Participant'):'Channel post')+': '+(x.text??'')})),...actions.map(x=>({at:x.createdAt,line:cmName+': '+x.response}))].sort((a,b)=>a.at.getTime()-b.at.getTime());
  return{history:timeline.map(x=>x.line).join('\n').slice(-10000),summary:segment?.summary??'',topicKey:segment?.topicKey??location.topicKey,theses:segment?.thesisLedger};
}

export async function confirmedParticipantMemory(participantId?:string){if(!participantId)return[];return prisma.communityManagerParticipantClaim.findMany({where:{participantId,status:'CONFIRMED'},orderBy:{updatedAt:'desc'},take:20,select:{kind:true,displayValue:true,confidence:true}})}
export async function participantEpisodes(participantId?:string,topicKey?:string){if(!participantId)return[];return prisma.communityManagerEpisode.findMany({where:{participantId,...(topicKey?{segment:{topicKey}}:{})},orderBy:{createdAt:'desc'},take:8,select:{kind:true,summary:true,outcome:true,createdAt:true}})}

export async function recordParticipantClaims(managerId:string,participantId:string,messageId:string,text:string,claims:ConversationAnalysis['possibleClaims']){
  for(const item of claims.slice(0,5)){
    const value=clean(item.value,100),kind=String(item.kind).toUpperCase();if(!value||!['ROLE','EXPERTISE','PREFERENCE','FACT'].includes(kind)||item.confidence<.7)continue;
    const normalizedValue=normalizeTopicKey(value),existing=await prisma.communityManagerParticipantClaim.findUnique({where:{participantId_kind_normalizedValue:{participantId,kind,normalizedValue}}});
    if(existing&&await prisma.communityManagerParticipantClaimEvidence.findUnique({where:{claimId_messageId:{claimId:existing.id,messageId}},select:{id:true}}))continue;
    const claim=existing?await prisma.communityManagerParticipantClaim.update({where:{id:existing.id},data:{displayValue:value,lastSeenAt:new Date(),confidence:Math.min(.98,Math.max(existing.confidence,item.confidence)),evidenceCount:{increment:1},...(existing.evidenceCount+1>=2?{status:'CONFIRMED'}:{})}}):await prisma.communityManagerParticipantClaim.create({data:{communityManagerId:managerId,participantId,kind,normalizedValue,displayValue:value,confidence:item.confidence,status:item.confidence>=.9?'CONFIRMED':'TENTATIVE'}});
    await prisma.communityManagerParticipantClaimEvidence.create({data:{claimId:claim.id,messageId,excerpt:text.slice(0,500)}});
  }
}

export async function recordEpisode(input:{managerId:string;participantId?:string;location:ConversationLocation;kind:string;summary:string;outcome:string}){const summary=clean(input.summary,500);if(!summary)return;const duplicate=await prisma.communityManagerEpisode.findFirst({where:{communityManagerId:input.managerId,participantId:input.participantId,threadId:input.location.threadId,segmentId:input.location.segmentId,kind:input.kind,summary},select:{id:true}});if(duplicate)return;await prisma.communityManagerEpisode.create({data:{communityManagerId:input.managerId,participantId:input.participantId,threadId:input.location.threadId,segmentId:input.location.segmentId,kind:input.kind,summary,outcome:input.outcome}})}
async function appendThesis(location:ConversationLocation,author:string,text:string){const value=clean(text,500);if(!value)return;const row=await prisma.communityManagerSegment.findUnique({where:{id:location.segmentId},select:{thesisLedger:true}}),list=Array.isArray(row?.thesisLedger)?row.thesisLedger:[];await prisma.communityManagerSegment.update({where:{id:location.segmentId},data:{thesisLedger:[...list,{author:clean(author,100),text:value,at:new Date().toISOString()}].slice(-30)}})}
export const appendCmThesis=(location:ConversationLocation,text:string)=>appendThesis(location,'CM',text);
export const appendHumanThesis=(location:ConversationLocation,author:string,text:string)=>appendThesis(location,author,text);
export async function conversationStillCurrent(location:ConversationLocation){const row=await prisma.communityManagerSegment.findUnique({where:{id:location.segmentId},select:{version:true,status:true}});return Boolean(row&&row.status==='ACTIVE'&&row.version===location.segmentVersion)}

export async function initiativeAllowed(managerId:string,topicKey:string,now=new Date()){
  const activeSince=new Date(now.getTime()-30*60_000),duplicateSince=new Date(now.getTime()-24*3600_000),normalized=normalizeTopicKey(topicKey);
  const [active,recentActivities]=await Promise.all([
    prisma.communityManagerSegment.findFirst({where:{communityManagerId:managerId,status:'ACTIVE',lastMeaningfulTurnAt:{gte:activeSince}},select:{id:true}}),
    prisma.communityManagerActivity.findMany({where:{communityManagerId:managerId,createdAt:{gte:duplicateSince},status:{in:['RUNNING','ACTIVE','COMPLETED']}},select:{topic:true,type:true},take:100}),
  ]);
  const duplicate=recentActivities.some(item=>normalizeTopicKey(item.topic??item.type)===normalized);
  return!active&&!duplicate;
}
export async function createInitiativeLocation(input:{managerId:string;tgChatId:string;telegramRootMessageId:number;topicKey:string;origin:'CONTENT'|'DIRECTOR';sourcePostId?:string}){
  const topicKey=normalizeTopicKey(input.topicKey);
  const thread=await prisma.communityManagerThread.upsert({where:{communityManagerId_tgChatId_telegramRootMessageId:{communityManagerId:input.managerId,tgChatId:input.tgChatId,telegramRootMessageId:input.telegramRootMessageId}},create:{communityManagerId:input.managerId,tgChatId:input.tgChatId,telegramRootMessageId:input.telegramRootMessageId,messageThreadId:input.telegramRootMessageId,origin:input.origin,sourcePostId:input.sourcePostId,status:'ACTIVE'},update:{origin:input.origin,sourcePostId:input.sourcePostId,status:'ACTIVE',version:{increment:1}}});
  const existing=await prisma.communityManagerSegment.findFirst({where:{threadId:thread.id,status:'ACTIVE',topicKey},orderBy:{updatedAt:'desc'}});
  const segment=existing??await prisma.communityManagerSegment.create({data:{communityManagerId:input.managerId,threadId:thread.id,topicKey,lastMeaningfulTurnAt:new Date()}});
  return{threadId:thread.id,segmentId:segment.id,threadVersion:thread.version,segmentVersion:segment.version,topicKey};
}
