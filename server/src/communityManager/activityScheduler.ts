import { prisma } from '../db';
import { isQuietHour, parseCommunityManagerConfig, randomInitiativeDate } from './config';
import { chooseActivityTopic, chooseAdaptiveActivityType, consecutiveIgnored, initiativeBackoffHours, type CommunityActivityType } from './activityPolicy';
import { runCommunityActivity } from './engine';

const CHECK_INTERVAL_MS=7*60_000;
let sweeping=false;
let timer:NodeJS.Timeout|undefined;
type Result={automatic?:boolean;evaluated?:boolean;engaged?:boolean;messageCount?:number;participantCount?:number;reason?:string};
const resultOf=(value:unknown):Result=>value&&typeof value==='object'?value as Result:{};

async function evaluateFinishedActivities(now:Date){
  const candidates=await prisma.communityManagerActivity.findMany({where:{status:'COMPLETED',sentAt:{not:null,lte:new Date(now.getTime()-15*60_000)}},orderBy:{sentAt:'desc'},take:200});
  for(const activity of candidates){
    const result=resultOf(activity.result);
    if(!result.automatic||result.evaluated||!activity.sentAt)continue;
    const manager=await prisma.communityManager.findUnique({where:{id:activity.communityManagerId},select:{publishedVersion:true}});
    if(!manager?.publishedVersion)continue;
    const row=await prisma.communityManagerConfig.findUnique({where:{communityManagerId_version:{communityManagerId:activity.communityManagerId,version:manager.publishedVersion}}});
    if(!row)continue;
    const config=parseCommunityManagerConfig(row.config),windowEnd=new Date(activity.sentAt.getTime()+config.activities.responseWindowMinutes*60_000);
    if(windowEnd>now)continue;
    const messages=await prisma.communityManagerMessage.findMany({where:{communityManagerId:activity.communityManagerId,createdAt:{gt:activity.sentAt,lte:windowEnd}},select:{tgUserId:true}});
    const participants=new Set(messages.map(x=>x.tgUserId).filter(Boolean));
    await prisma.communityManagerActivity.update({where:{id:activity.id},data:{result:{...result,evaluated:true,engaged:messages.length>0,messageCount:messages.length,participantCount:participants.size,evaluatedAt:now.toISOString()}}});
  }
}

async function considerManager(manager:any,now:Date){
  if(!manager.publishedVersion||!manager.community.moderatorChat)return;
  const row=await prisma.communityManagerConfig.findUnique({where:{communityManagerId_version:{communityManagerId:manager.id,version:manager.publishedVersion}}});
  if(!row)return;
  const config=parseCommunityManagerConfig(row.config);
  if(!config.activities.enabled||config.activities.requireApproval||isQuietHour(config,now)||config.limits.maxInitiativesPerDay<1)return;
  const types:CommunityActivityType[]=[];
  if(config.activities.discussionEnabled)types.push('DISCUSSION');
  if(config.activities.pollEnabled)types.push('POLL');
  if(config.activities.gameEnabled)types.push('GAME');
  if(config.activities.digestEnabled)types.push('DIGEST');
  if(!types.length)return;

  const dayAgo=new Date(now.getTime()-86400_000),weekAgo=new Date(now.getTime()-7*86400_000);
  const recent=await prisma.communityManagerActivity.findMany({where:{communityManagerId:manager.id,status:'COMPLETED',sentAt:{gte:weekAgo}},orderBy:{sentAt:'desc'},take:30});
  const automatic=recent.filter(x=>resultOf(x.result).automatic);
  if(automatic.filter(x=>x.sentAt&&x.sentAt>=dayAgo).length>=config.limits.maxInitiativesPerDay)return;
  if(automatic.length>=config.activities.maxInitiativesPerWeek)return;
  const latestAuto=automatic[0],latestAutoResult=latestAuto?resultOf(latestAuto.result):null;
  if(latestAuto&&latestAutoResult&&!latestAutoResult.evaluated)return;
  const ignored=consecutiveIgnored(automatic.map(x=>resultOf(x.result)));
  const minGap=ignored?initiativeBackoffHours(Math.max(1,config.activities.everyHours),ignored)*3600_000:0;
  const latestActivity=recent[0];
  if(latestActivity?.sentAt&&now.getTime()-latestActivity.sentAt.getTime()<minGap)return;

  const lastHuman=await prisma.communityManagerMessage.findFirst({where:{communityManagerId:manager.id},orderBy:{createdAt:'desc'},select:{createdAt:true}});
  const silenceFrom=lastHuman?.createdAt??manager.updatedAt;
  let state=await prisma.communityManagerConversationState.findUnique({where:{communityManagerId:manager.id}});
  if(!state?.nextInitiativeAt){
    const target=randomInitiativeDate(config,silenceFrom);
    state=await prisma.communityManagerConversationState.upsert({where:{communityManagerId:manager.id},create:{communityManagerId:manager.id,lastHumanAt:lastHuman?.createdAt,nextInitiativeAt:target},update:{lastHumanAt:lastHuman?.createdAt,nextInitiativeAt:target}});
  }
  if(!state.nextInitiativeAt||state.nextInitiativeAt>now)return;
  const newer=await prisma.communityManagerMessage.findFirst({where:{communityManagerId:manager.id,createdAt:{gt:silenceFrom}},select:{id:true}});
  if(newer)return;
  const type=chooseAdaptiveActivityType(types,recent.map(x=>{const result=resultOf(x.result);return{type:x.type,engaged:result.engaged,evaluated:result.evaluated}}));
  if(!type)return;
  const topic=chooseActivityTopic(config.activities.topics,recent.map(x=>x.topic));
  await runCommunityActivity(manager.id,type,topic,{automatic:true,reason:'chat_idle_random_'+config.activities.silenceMinMinutes+'-'+config.activities.silenceMaxMinutes+'m'});
  await prisma.communityManagerConversationState.update({where:{communityManagerId:manager.id},data:{nextInitiativeAt:randomInitiativeDate(config,now)}});
}

export async function sweepCommunityActivities(now=new Date()){
  if(sweeping)return;sweeping=true;
  try{
    await evaluateFinishedActivities(now);
    const managers=await prisma.communityManager.findMany({where:{enabled:true,publishedVersion:{not:null}},include:{community:{include:{moderatorChat:true}}}});
    for(const manager of managers)await considerManager(manager,now).catch(async error=>{
      await prisma.communityManager.update({where:{id:manager.id},data:{lastError:error instanceof Error?error.message.slice(0,500):'Activity scheduler failed'}}).catch(()=>undefined);
    });
  }finally{sweeping=false}
}

export function startCommunityActivityScheduler(){
  if(timer)return;
  const tick=()=>void sweepCommunityActivities().catch(error=>console.error('[community-activity]',error instanceof Error?error.message:error));
  setTimeout(tick,20_000+Math.floor(Math.random()*40_000)).unref();
  timer=setInterval(tick,CHECK_INTERVAL_MS);timer.unref();
  console.log('[community-activity] Started - checking every 7 minutes');
}