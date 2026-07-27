import { prisma } from '../db';
import { isQuietHour, parseCommunityManagerConfig } from './config';
import { runActivity } from './activityRuntime';
import { createInitiativeLocation, initiativeAllowed } from './conversationCoordinator';

const DEFAULT_SILENCE_MINUTES=20;
const RETRY_MINUTES=5;
const MAX_ATTEMPTS=3;
export type ContentTriggerResult={
  automatic?:boolean;reason?:string;postId?:string;phase?:string;channelId?:string;
  channelMessageId?:number;discussionChatId?:string;discussionMessageId?:number;
  postText?:string;sourceUrl?:string;publishedAt?:string;attempts?:number;
};
const resultOf=(value:unknown):ContentTriggerResult=>value&&typeof value==='object'?value as ContentTriggerResult:{};
const key=(managerId:string,channelMessageId:number)=>'content-release:'+managerId+':'+channelMessageId;

export const contentReleaseDueAt=(publishedAt:Date,silenceMinutes=DEFAULT_SILENCE_MINUTES)=>new Date(publishedAt.getTime()+silenceMinutes*60_000);
export function contentThreadMatchesMessage(result:ContentTriggerResult,message:{replyToMessageId?:number|null;messageThreadId?:number|null}){
  const root=result.discussionMessageId;
  return Boolean(root&&(message.replyToMessageId===root||message.messageThreadId===root));
}

async function publishedConfig(managerId:string){
  const manager=await prisma.communityManager.findUnique({where:{id:managerId},select:{enabled:true,mode:true,publishedVersion:true}});
  if(!manager?.enabled||manager.mode!=='AUTOPILOT'||!manager.publishedVersion)return null;
  const row=await prisma.communityManagerConfig.findUnique({where:{communityManagerId_version:{communityManagerId:managerId,version:manager.publishedVersion}}});
  if(!row)return null;
  const config=parseCommunityManagerConfig(row.config);
  return config.activities.enabled&&!config.activities.requireApproval&&config.activities.contentSupportEnabled?config:null;
}

async function mergeRelease(managerId:string,channelMessageId:number,patch:ContentTriggerResult,topic?:string){
  const dedupeKey=key(managerId,channelMessageId),existing=await prisma.communityManagerActivity.findUnique({where:{dedupeKey}});
  const merged={...resultOf(existing?.result),...patch,automatic:true,reason:'content_silence',phase:'release',channelMessageId};
  const config=await publishedConfig(managerId);if(!config)return null;
  const publishedAt=merged.publishedAt?new Date(merged.publishedAt):new Date(),scheduledAt=contentReleaseDueAt(publishedAt,config.activities.contentSilenceMinutes);
  if(existing){
    const mergedTopic=patch.postId?(topic??existing.topic):(existing.topic??topic);
    return prisma.communityManagerActivity.update({where:{id:existing.id},data:{topic:mergedTopic,result:merged,scheduledAt,origin:'CONTENT',sourcePostId:merged.postId,...(['CANCELLED','COMPLETED'].includes(existing.status)?{}:{status:'WAITING'})}});
  }
  return prisma.communityManagerActivity.create({data:{communityManagerId:managerId,type:'CONTENT_RELEASE',origin:'CONTENT',sourcePostId:merged.postId,topic,dedupeKey,status:'WAITING',scheduledAt,result:merged}});
}

export async function queuePublishedPostContentSupport(postId:string){
  const post=await prisma.generatedPost.findUnique({where:{id:postId},include:{channel:{include:{community:{include:{communityManager:true}}}},variants:{select:{id:true,text:true}}}});
  const manager=post?.channel.community?.communityManager;
  if(!post||!manager||!post.tgMessageId||!post.publishedAt)return null;
  const text=post.variants.find(item=>item.id===post.selectedVariantId)?.text??post.variants[0]?.text??'';
  return mergeRelease(manager.id,post.tgMessageId,{postId:post.id,channelId:post.channelId,postText:text.slice(0,12000),sourceUrl:post.sourceUrl??undefined,publishedAt:post.publishedAt.toISOString()},post.title);
}

export async function captureAutomaticChannelPost(managerId:string,input:{channelId?:string;channelMessageId:number;discussionChatId:string;discussionMessageId:number;text:string;publishedAt:Date}){
  return mergeRelease(managerId,input.channelMessageId,{channelId:input.channelId,discussionChatId:input.discussionChatId,discussionMessageId:input.discussionMessageId,postText:input.text.slice(0,12000),publishedAt:input.publishedAt.toISOString()},input.text.replace(/\s+/g,' ').slice(0,160));
}

export async function cancelSilentContentRelease(managerId:string,message:{replyToMessageId?:number|null;messageThreadId?:number|null}){
  if(!message.replyToMessageId&&!message.messageThreadId)return false;
  const waiting=await prisma.communityManagerActivity.findMany({where:{communityManagerId:managerId,type:'CONTENT_RELEASE',origin:'CONTENT',status:{in:['WAITING','PROCESSING']}},orderBy:{createdAt:'desc'},take:20});
  const matched=waiting.filter(row=>contentThreadMatchesMessage(resultOf(row.result),message)).map(row=>row.id);
  if(!matched.length)return false;
  await prisma.communityManagerActivity.updateMany({where:{id:{in:matched},status:{in:['WAITING','PROCESSING']}},data:{status:'CANCELLED',lastError:'Human discussion started'}});
  return true;
}

export async function processSilentContentReleases(now=new Date()){
  for(let index=0;index<10;index++){
    const release=await prisma.communityManagerActivity.findFirst({where:{type:'CONTENT_RELEASE',origin:'CONTENT',status:'WAITING',scheduledAt:{lte:now}},orderBy:{scheduledAt:'asc'}});
    if(!release)break;
    const claim=await prisma.communityManagerActivity.updateMany({where:{id:release.id,status:'WAITING'},data:{status:'PROCESSING'}});if(!claim.count)continue;
    const result=resultOf(release.result),attempts=(result.attempts??0)+1;
    try{
      const config=await publishedConfig(release.communityManagerId);
      if(!config){await prisma.communityManagerActivity.update({where:{id:release.id},data:{status:'CANCELLED',lastError:'Content support disabled'}});continue}
      if(isQuietHour(config,now)){await prisma.communityManagerActivity.update({where:{id:release.id},data:{status:'WAITING',scheduledAt:new Date(now.getTime()+15*60_000)}});continue}
      const humanReply=result.discussionMessageId?await prisma.communityManagerDigestMessage.findFirst({where:{communityManagerId:release.communityManagerId,createdAt:{gte:result.publishedAt?new Date(result.publishedAt):release.createdAt},OR:[{replyToMessageId:result.discussionMessageId},{messageThreadId:result.discussionMessageId}],tgUserId:{not:null}},select:{id:true}}):null;
      if(humanReply){await prisma.communityManagerActivity.update({where:{id:release.id},data:{status:'CANCELLED',lastError:'Human discussion started'}});continue}
      if(!result.discussionMessageId&&attempts<=MAX_ATTEMPTS){await prisma.communityManagerActivity.update({where:{id:release.id},data:{status:'WAITING',scheduledAt:new Date(now.getTime()+RETRY_MINUTES*60_000),result:{...result,attempts}}});continue}
      if(!await initiativeAllowed(release.communityManagerId,release.topic??'content_release',now)){await prisma.communityManagerActivity.update({where:{id:release.id},data:{status:'WAITING',scheduledAt:new Date(now.getTime()+15*60_000)}});continue}
      const location=result.discussionMessageId&&result.discussionChatId?await createInitiativeLocation({managerId:release.communityManagerId,tgChatId:result.discussionChatId,telegramRootMessageId:result.discussionMessageId,topicKey:release.topic??'content_release',origin:'CONTENT',sourcePostId:result.postId}):null;
      await runActivity(release.communityManagerId,'CONTENT_RELEASE',release.topic??undefined,{activityId:release.id,automatic:true,origin:'CONTENT',context:{...result,attempts},reason:'content_silence',postId:result.postId,phase:'release',postText:result.postText,sourceUrl:result.sourceUrl,replyToMessageId:result.discussionMessageId,threadId:location?.threadId,segmentId:location?.segmentId});
    }catch(error){
      const message=error instanceof Error?error.message:'Content release failed';
      await prisma.communityManagerActivity.update({where:{id:release.id},data:attempts<MAX_ATTEMPTS?{status:'WAITING',scheduledAt:new Date(now.getTime()+RETRY_MINUTES*60_000),lastError:message.slice(0,500),result:{...result,attempts}}:{status:'FAILED',lastError:message.slice(0,500),result:{...result,attempts}}});
    }
  }
}
