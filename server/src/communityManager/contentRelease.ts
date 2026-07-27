import { prisma } from '../db';
import { isQuietHour, parseCommunityManagerConfig } from './config';
import { runActivity } from './activityRuntime';

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

async function mergeTrigger(managerId:string,channelMessageId:number,patch:ContentTriggerResult,topic?:string){
  const dedupeKey=key(managerId,channelMessageId),existing=await prisma.communityManagerActivity.findUnique({where:{dedupeKey}});
  const merged={...resultOf(existing?.result),...patch,automatic:false,reason:'content_silence',phase:'release',channelMessageId};
  const config=await publishedConfig(managerId);if(!config)return null;
  const publishedAt=merged.publishedAt?new Date(merged.publishedAt):new Date();
  const scheduledAt=contentReleaseDueAt(publishedAt,config.activities.contentSilenceMinutes);
  if(existing){
    const mergedTopic=patch.postId?(topic??existing.topic):(existing.topic??topic);
    return prisma.communityManagerActivity.update({where:{id:existing.id},data:{topic:mergedTopic,result:merged,scheduledAt,...(['CANCELLED','COMPLETED'].includes(existing.status)?{}:{status:'WAITING'})}});
  }
  return prisma.communityManagerActivity.create({data:{communityManagerId:managerId,type:'CONTENT_RELEASE_TRIGGER',topic,dedupeKey,status:'WAITING',scheduledAt,result:merged}});
}

export async function queuePublishedPostContentSupport(postId:string){
  const post=await prisma.generatedPost.findUnique({where:{id:postId},include:{channel:{include:{community:{include:{communityManager:true}}}},variants:{select:{id:true,text:true}}}});
  const manager=post?.channel.community?.communityManager;
  if(!post||!manager||!post.tgMessageId||!post.publishedAt)return null;
  const text=post.variants.find(item=>item.id===post.selectedVariantId)?.text??post.variants[0]?.text??'';
  return mergeTrigger(manager.id,post.tgMessageId,{postId:post.id,channelId:post.channelId,postText:text.slice(0,12000),sourceUrl:post.sourceUrl??undefined,publishedAt:post.publishedAt.toISOString()},post.title);
}

export async function captureAutomaticChannelPost(managerId:string,input:{channelId?:string;channelMessageId:number;discussionChatId:string;discussionMessageId:number;text:string;publishedAt:Date}){
  return mergeTrigger(managerId,input.channelMessageId,{channelId:input.channelId,discussionChatId:input.discussionChatId,discussionMessageId:input.discussionMessageId,postText:input.text.slice(0,12000),publishedAt:input.publishedAt.toISOString()},input.text.replace(/\s+/g,' ').slice(0,160));
}

export async function cancelSilentContentRelease(managerId:string,message:{replyToMessageId?:number|null;messageThreadId?:number|null}){
  if(!message.replyToMessageId&&!message.messageThreadId)return false;
  const waiting=await prisma.communityManagerActivity.findMany({where:{communityManagerId:managerId,type:'CONTENT_RELEASE_TRIGGER',status:{in:['WAITING','PROCESSING']}},orderBy:{createdAt:'desc'},take:20});
  const matched=waiting.filter(row=>contentThreadMatchesMessage(resultOf(row.result),message)).map(row=>row.id);
  if(!matched.length)return false;
  await prisma.communityManagerActivity.updateMany({where:{id:{in:matched},status:{in:['WAITING','PROCESSING']}},data:{status:'CANCELLED',lastError:'Human discussion started'}});
  return true;
}

export async function processSilentContentReleases(now=new Date()){
  for(let index=0;index<10;index++){
    const trigger=await prisma.communityManagerActivity.findFirst({where:{type:'CONTENT_RELEASE_TRIGGER',status:'WAITING',scheduledAt:{lte:now}},orderBy:{scheduledAt:'asc'}});
    if(!trigger)break;
    const claim=await prisma.communityManagerActivity.updateMany({where:{id:trigger.id,status:'WAITING'},data:{status:'PROCESSING'}});
    if(!claim.count)continue;
    const result=resultOf(trigger.result),attempts=(result.attempts??0)+1;
    try{
      const config=await publishedConfig(trigger.communityManagerId);
      if(!config){await prisma.communityManagerActivity.update({where:{id:trigger.id},data:{status:'CANCELLED',lastError:'Content support disabled'}});continue}
      if(isQuietHour(config,now)){await prisma.communityManagerActivity.update({where:{id:trigger.id},data:{status:'WAITING',scheduledAt:new Date(now.getTime()+15*60_000)}});continue}
      const humanReply=result.discussionMessageId?await prisma.communityManagerDigestMessage.findFirst({where:{communityManagerId:trigger.communityManagerId,createdAt:{gte:result.publishedAt?new Date(result.publishedAt):trigger.createdAt},OR:[{replyToMessageId:result.discussionMessageId},{messageThreadId:result.discussionMessageId}],tgUserId:{not:null}},select:{id:true}}):null;
      if(humanReply){await prisma.communityManagerActivity.update({where:{id:trigger.id},data:{status:'CANCELLED',lastError:'Human discussion started'}});continue}
      if(!result.discussionMessageId&&attempts<=MAX_ATTEMPTS){await prisma.communityManagerActivity.update({where:{id:trigger.id},data:{status:'WAITING',scheduledAt:new Date(now.getTime()+RETRY_MINUTES*60_000),result:{...result,attempts}}});continue}
      await runActivity(trigger.communityManagerId,'CONTENT_RELEASE',trigger.topic??undefined,{automatic:true,reason:'content_silence',postId:result.postId,phase:'release',postText:result.postText,sourceUrl:result.sourceUrl,replyToMessageId:result.discussionMessageId,triggerId:trigger.id});
      await prisma.communityManagerActivity.update({where:{id:trigger.id},data:{status:'COMPLETED',lastError:null,result:{...result,attempts}}});
    }catch(error){
      const message=error instanceof Error?error.message:'Content release failed';
      if(message==='CONTENT_THREAD_ACTIVE'){await prisma.communityManagerActivity.updateMany({where:{id:trigger.id,status:'PROCESSING'},data:{status:'CANCELLED',lastError:'Human discussion started'}});continue}
      await prisma.communityManagerActivity.update({where:{id:trigger.id},data:attempts<MAX_ATTEMPTS?{status:'WAITING',scheduledAt:new Date(now.getTime()+RETRY_MINUTES*60_000),lastError:message.slice(0,500),result:{...result,attempts}}:{status:'FAILED',lastError:message.slice(0,500),result:{...result,attempts}}});
    }
  }
  await prisma.communityManagerActivity.deleteMany({where:{type:'CONTENT_RELEASE_TRIGGER',createdAt:{lt:new Date(now.getTime()-8*86400_000)}}});
}

let timer:NodeJS.Timeout|undefined;
export function startSilentContentReleaseWorker(){
  if(timer)return;
  const tick=()=>void processSilentContentReleases().catch(error=>console.error('[community-content-release]',error instanceof Error?error.message:error));
  setTimeout(tick,30_000).unref();
  timer=setInterval(tick,60_000);timer.unref();
}
