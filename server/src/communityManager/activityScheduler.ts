import { prisma } from '../db';
import { isQuietHour, parseCommunityManagerConfig } from './config';
import { chooseActivity, intensityWindow, type CommunityActivityType } from './activityDirector';
import { runActivity } from './activityRuntime';
import { advanceActiveActivities } from './activityLifecycle';
import { chooseActivityTopic } from './activityPolicy';
import { runDueDailyDigest } from './dailyDigest';
import { processSilentContentReleases } from './contentRelease';
import { initiativeAllowed } from './conversationCoordinator';

const CHECK_INTERVAL_MS=7*60_000;
let sweeping=false;
let timer:NodeJS.Timeout|undefined;
type Result={automatic?:boolean;evaluated?:boolean;engaged?:boolean;messageCount?:number;participantCount?:number;reason?:string;postId?:string;phase?:string};
const resultOf=(value:unknown):Result=>value&&typeof value==='object'?value as Result:{};
const nextDate=(intensity:'quiet'|'balanced'|'active',from:Date)=>{const w=intensityWindow(intensity);return new Date(from.getTime()+(w.min+Math.floor(Math.random()*(w.max-w.min+1)))*60_000)};
const stableChance=(key:string,phase:string,chance:number)=>{let hash=2166136261;for(const char of key+phase){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return(hash>>>0)/4294967295<chance};
export const initiativeScheduleBase=(silenceFrom:Date,now:Date,intensity:'quiet'|'balanced'|'active')=>{
  const {max}=intensityWindow(intensity);
  return now.getTime()-silenceFrom.getTime()>max*60_000?now:silenceFrom;
};
export const ignoredActivityBackoff=(streak:number,intensity:'quiet'|'balanced'|'active',now:Date)=>{
  if(streak<1)return null;
  const base=streak>=4?72:streak===3?36:streak===2?18:6;
  const factor=intensity==='quiet'?2:intensity==='active'?.75:1;
  return new Date(now.getTime()+base*factor*3600_000);
};


async function evaluateFinishedActivities(now:Date){
  const candidates=await prisma.communityManagerActivity.findMany({where:{status:'COMPLETED',sentAt:{not:null,lte:new Date(now.getTime()-15*60_000)}},orderBy:{sentAt:'desc'},take:200});
  for(const activity of candidates){
    const result=resultOf(activity.result);if(!result.automatic||result.evaluated||!activity.sentAt)continue;
    const manager=await prisma.communityManager.findUnique({where:{id:activity.communityManagerId},select:{publishedVersion:true}});if(!manager?.publishedVersion)continue;
    const row=await prisma.communityManagerConfig.findUnique({where:{communityManagerId_version:{communityManagerId:activity.communityManagerId,version:manager.publishedVersion}}});if(!row)continue;
    const config=parseCommunityManagerConfig(row.config),windowEnd=new Date(activity.sentAt.getTime()+config.activities.responseWindowMinutes*60_000);if(windowEnd>now)continue;
    const messages=await prisma.communityManagerMessage.findMany({where:{communityManagerId:activity.communityManagerId,createdAt:{gt:activity.sentAt,lte:windowEnd}},select:{tgUserId:true}}),participants=new Set(messages.map(x=>x.tgUserId).filter(Boolean));
    await prisma.communityManagerActivity.update({where:{id:activity.id},data:{result:{...result,evaluated:true,engaged:messages.length>0,messageCount:messages.length,participantCount:participants.size,evaluatedAt:now.toISOString()}}});
  }
}

function enabledTypes(config:ReturnType<typeof parseCommunityManagerConfig>):CommunityActivityType[]{
  const types:CommunityActivityType[]=[];
  if(config.activities.discussionEnabled)types.push('DISCUSSION');
  if(config.activities.pollEnabled)types.push('POLL');
  if(config.activities.quizEnabled)types.push('QUIZ');
  if(config.activities.lightEnabled)types.push('LIGHT');
  if(config.activities.hotNewsEnabled&&config.research.dailyLimit>0&&config.research.mode!=='off'&&(config.research.sourcePolicy==='open'||config.research.allowedDomains.length>0))types.push('HOT_NEWS');
  if(config.activities.digestEnabled)types.push('DIGEST');
  if(config.activities.predictionEnabled)types.push('PREDICTION');
  if(config.activities.contentSupportEnabled)types.push('CONTENT_TEASER','CONTENT_RELEASE');
  return types;
}

async function contentSignal(manager:any,types:CommunityActivityType[],recent:any[],now:Date){
  if(!manager.community.channel||!types.some(x=>x.startsWith('CONTENT_')))return null;
  const already=(postId:string,phase:string)=>recent.some(row=>{const result=resultOf(row.result),failedBackoff=row.status==='FAILED'&&now.getTime()-row.createdAt.getTime()<60*60_000;return result.postId===postId&&result.phase===phase&&(['RUNNING','ACTIVE','COMPLETED'].includes(row.status)||failedBackoff)});
  const upcoming=await prisma.generatedPost.findFirst({where:{channelId:manager.community.channelId,status:'SCHEDULED',scheduledAt:{gte:new Date(now.getTime()+45*60_000),lte:new Date(now.getTime()+3*3600_000)}},orderBy:{scheduledAt:'asc'},select:{id:true,title:true}});
  if(upcoming&&!already(upcoming.id,'teaser')&&stableChance(upcoming.id,'teaser',.45))return{type:'CONTENT_TEASER' as const,post:upcoming,phase:'teaser'};
  return null;
}

async function considerManager(manager:any,now:Date){
  if(!manager.publishedVersion||!manager.community.moderatorChat)return;
  const row=await prisma.communityManagerConfig.findUnique({where:{communityManagerId_version:{communityManagerId:manager.id,version:manager.publishedVersion}}});if(!row)return;
  const config=parseCommunityManagerConfig(row.config);if(!config.activities.enabled||config.activities.requireApproval||isQuietHour(config,now))return;
  const types=enabledTypes(config);if(!types.length)return;
  const weekAgo=new Date(now.getTime()-7*86400_000),recent=await prisma.communityManagerActivity.findMany({where:{communityManagerId:manager.id,createdAt:{gte:weekAgo}},orderBy:{createdAt:'desc'},take:40});

  const content=await contentSignal(manager,types,recent,now);
  let ignoredStreak=0;
  for(const item of recent){
    const result=resultOf(item.result);
    if(!result.automatic)continue;
    if(!result.evaluated)break;
    if(result.engaged)break;
    ignoredStreak++;
  }
  if(content&&ignoredStreak<2&&await initiativeAllowed(manager.id,content.post.title??content.type,now)){await runActivity(manager.id,content.type,content.post.title,{automatic:true,origin:'CONTENT',reason:'content_lifecycle',postId:content.post.id,phase:content.phase,ignoredStreak});return}

  const lastHuman=await prisma.communityManagerMessage.findFirst({where:{communityManagerId:manager.id},orderBy:{createdAt:'desc'},select:{createdAt:true}}),silenceFrom=lastHuman?.createdAt??manager.updatedAt;
  const latestAutomaticAt=recent.find(item=>resultOf(item.result).automatic&&item.sentAt)?.sentAt;
  if(lastHuman?.createdAt&&latestAutomaticAt&&lastHuman.createdAt>latestAutomaticAt)ignoredStreak=0;
  let state=await prisma.communityManagerConversationState.findUnique({where:{communityManagerId:manager.id}});
  if(!state?.nextInitiativeAt||state.nextInitiativeAt<=silenceFrom){
    const base=initiativeScheduleBase(silenceFrom,now,config.activities.intensity),target=nextDate(config.activities.intensity,base);
    state=await prisma.communityManagerConversationState.upsert({where:{communityManagerId:manager.id},create:{communityManagerId:manager.id,lastHumanAt:lastHuman?.createdAt,nextInitiativeAt:target},update:{lastHumanAt:lastHuman?.createdAt,nextInitiativeAt:target}});
  }
  if(!state.nextInitiativeAt||state.nextInitiativeAt>now)return;
  const lastIgnoredAt=recent.find(item=>{const result=resultOf(item.result);return result.automatic&&result.evaluated&&!result.engaged})?.sentAt??now;
  const backoff=ignoredActivityBackoff(ignoredStreak,config.activities.intensity,lastIgnoredAt);
  const nextInitiativeAt=backoff&&backoff>now?backoff:nextDate(config.activities.intensity,ignoredStreak===1?new Date(now.getTime()+intensityWindow(config.activities.intensity).max*60_000):now);
  const claim=await prisma.communityManagerConversationState.updateMany({where:{communityManagerId:manager.id,nextInitiativeAt:state.nextInitiativeAt},data:{nextInitiativeAt}});
  if(claim.count!==1)return;
  const pulseSince=new Date(now.getTime()-2*3600_000),pulseMessages=await prisma.communityManagerMessage.findMany({where:{communityManagerId:manager.id,createdAt:{gte:pulseSince}},select:{tgUserId:true}}),messages=pulseMessages.length,participants=new Set(pulseMessages.map(x=>x.tgUserId).filter(Boolean)).size;
  const type=chooseActivity({enabled:types,history:recent.map(x=>{const result=resultOf(x.result);return{type:x.type,engaged:result.engaged,evaluated:result.evaluated}}),pulse:{energy:messages===0?'silent':messages<6?'low':'active',tension:Boolean(state.pendingModeratorAt&&now.getTime()-state.pendingModeratorAt.getTime()<20*60_000),openQuestions:Array.isArray(state.openQuestions)&&state.openQuestions.length>0,participants,messages,researchAvailable:config.research.mode!=='off'&&config.research.dailyLimit>0}});
  if(backoff&&backoff>now)return;
  const topic=chooseActivityTopic(config.activities.topics,recent.map(item=>item.topic));
  if(type&&await initiativeAllowed(manager.id,topic??type,now))await runActivity(manager.id,type,topic,{automatic:true,reason:'activity_director_'+config.activities.intensity,ignoredStreak});
}

export async function sweepCommunityActivities(now=new Date()){
  if(sweeping)return;sweeping=true;
  try{await advanceActiveActivities(now);await evaluateFinishedActivities(now);await processSilentContentReleases(now);const managers=await prisma.communityManager.findMany({where:{enabled:true,publishedVersion:{not:null}},include:{community:{include:{moderatorChat:true,channel:true}}}});for(const manager of managers){await runDueDailyDigest(manager.id,now).catch(async error=>{await prisma.communityManager.update({where:{id:manager.id},data:{lastError:error instanceof Error?error.message.slice(0,500):'Daily digest failed'}}).catch(()=>undefined)});await considerManager(manager,now).catch(async error=>{await prisma.communityManager.update({where:{id:manager.id},data:{lastError:error instanceof Error?error.message.slice(0,500):'Activity scheduler failed'}}).catch(()=>undefined)})}}finally{sweeping=false}
}
export function startCommunityActivityScheduler(){if(timer)return;const tick=()=>void sweepCommunityActivities().catch(error=>console.error('[community-activity]',error instanceof Error?error.message:error));setTimeout(tick,20_000+Math.floor(Math.random()*40_000)).unref();timer=setInterval(tick,CHECK_INTERVAL_MS);timer.unref();console.log('[community-activity] Activity director started - checking every 7 minutes')}
