import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { primaryTextModel } from '../lib/assistantModel';
import { sendChannelPost } from '../lib/telegramBot';
import { parseCommunityManagerConfig } from './config';
import { communityManagerExecutor } from './managedBot';
import { normalizeCommunityManagerPunctuation } from './conversationStyle';
import { runCommunityManagerAgent } from './agentRuntime';
import { activitySessionKey } from './agentSession';

const RETENTION_DAYS=8,MAX_MESSAGES=5000,MAX_CLUSTERS=12,SESSION_GAP_MS=10*60_000,DIGEST_BODY_CHARS=850;
type ZonedParts={year:number;month:number;day:number;hour:number;minute:number};
export type DailyDigestWindow={dateKey:string;displayDate:string;from:Date;to:Date;due:boolean};
export type DigestSourceMessage={telegramMessageId:number;replyToMessageId:number|null;messageThreadId:number|null;messageType:string;tgUserId:string|null;text:string;createdAt:Date};
export type DigestCluster={id:string;messages:DigestSourceMessage[];firstMessageId:number;participantCount:number;replyCount:number;score:number};
type DigestSelection={topics:{clusterId:string;summary:string}[]};
type DigestTopic={summary:string;firstMessageId:number};

function zonedParts(date:Date,timeZone:string):ZonedParts{try{const values:Record<string,number>={};for(const part of new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date))if(part.type!=='literal')values[part.type]=Number(part.value);return{year:values.year,month:values.month,day:values.day,hour:values.hour,minute:values.minute}}catch{return{year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate(),hour:date.getUTCHours(),minute:date.getUTCMinutes()}}}
function localToUtc(parts:{year:number;month:number;day:number;hour:number;minute:number},timeZone:string):Date{const desired=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);let guess=desired;for(let i=0;i<4;i++){const actual=zonedParts(new Date(guess),timeZone),actualStamp=Date.UTC(actual.year,actual.month-1,actual.day,actual.hour,actual.minute),delta=desired-actualStamp;if(!delta)break;guess+=delta}return new Date(guess)}
const pad=(value:number)=>String(value).padStart(2,'0');
export function dailyDigestWindow(now:Date,timeZone:string,hour:number,minute:number):DailyDigestWindow{const current=zonedParts(now,timeZone),previous=new Date(Date.UTC(current.year,current.month-1,current.day-1)),year=previous.getUTCFullYear(),month=previous.getUTCMonth()+1,day=previous.getUTCDate();return{dateKey:year+'-'+pad(month)+'-'+pad(day),displayDate:pad(day)+'.'+pad(month)+'.'+year,from:localToUtc({year,month,day,hour:0,minute:0},timeZone),to:localToUtc({year:current.year,month:current.month,day:current.day,hour:0,minute:0},timeZone),due:current.hour*60+current.minute>=hour*60+minute}}
export const digestRetentionDate=(from=new Date())=>new Date(from.getTime()+RETENTION_DAYS*86400_000);
const cleanSummary=(text:string)=>normalizeCommunityManagerPunctuation(text.replace(/<[^>]+>/g,'').replace(/[*_#>]/g,'').replace(/\s+/g,' ').trim()).slice(0,260);

export function buildDigestClusters(source:DigestSourceMessage[],limit=MAX_CLUSTERS):DigestCluster[]{
  const messages=[...source].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()||a.telegramMessageId-b.telegramMessageId),parent=messages.map((_,index)=>index),byMessageId=new Map(messages.map((message,index)=>[message.telegramMessageId,index]));
  const find=(index:number):number=>{while(parent[index]!==index){parent[index]=parent[parent[index]];index=parent[index]}return index},union=(a:number,b:number)=>{const left=find(a),right=find(b);if(left!==right)parent[right]=left},lastInThread=new Map<number,number>();
  for(let index=0;index<messages.length;index++){const message=messages[index];if(message.replyToMessageId!=null){const target=byMessageId.get(message.replyToMessageId);if(target!=null)union(target,index)}if(message.messageThreadId!=null){const previous=lastInThread.get(message.messageThreadId);if(previous!=null)union(previous,index);lastInThread.set(message.messageThreadId,index)}if(index>0&&message.messageThreadId==null&&messages[index-1].messageThreadId==null&&message.createdAt.getTime()-messages[index-1].createdAt.getTime()<=SESSION_GAP_MS)union(index-1,index)}
  const groups=new Map<number,DigestSourceMessage[]>();for(let index=0;index<messages.length;index++){const root=find(index),group=groups.get(root)??[];group.push(messages[index]);groups.set(root,group)}
  return[...groups.values()].filter(group=>group.filter(message=>message.tgUserId).length>=2).map(group=>{const participants=new Set(group.map(message=>message.tgUserId).filter(Boolean)),replyCount=group.filter(message=>message.replyToMessageId!=null).length,duration=Math.max(0,(group[group.length-1].createdAt.getTime()-group[0].createdAt.getTime())/60_000);return{id:'cluster_'+group[0].telegramMessageId,messages:group,firstMessageId:group[0].telegramMessageId,participantCount:participants.size,replyCount,score:group.length*2+participants.size*3+replyCount*2+Math.min(6,duration/10)}}).sort((a,b)=>b.score-a.score||a.messages[0].createdAt.getTime()-b.messages[0].createdAt.getTime()).slice(0,limit);
}

export function telegramMessageLink(chat:{tgChatId:string;username?:string|null},messageId:number):string|null{const username=chat.username?.trim().replace(/^@/,'');if(username)return'https://t.me/'+username+'/'+messageId;const privateSupergroup=chat.tgChatId.match(/^-100(\d+)$/);return privateSupergroup?'https://t.me/c/'+privateSupergroup[1]+'/'+messageId:null}
export function topicsFromSelection(selection:DigestSelection,clusters:DigestCluster[],maxTopics:number):DigestTopic[]{const byId=new Map(clusters.map(cluster=>[cluster.id,cluster])),seen=new Set<string>(),topics:DigestTopic[]=[];for(const selected of selection.topics??[]){const cluster=byId.get(selected.clusterId),summary=cleanSummary(selected.summary??'');if(!cluster||!summary||seen.has(cluster.id))continue;seen.add(cluster.id);topics.push({summary,firstMessageId:cluster.firstMessageId});if(topics.length>=maxTopics)break}return topics}
export function buildDigestBody(topics:DigestTopic[],chat:{tgChatId:string;username?:string|null}):string{const blocks:string[]=[];for(const topic of topics){const link=telegramMessageLink(chat,topic.firstMessageId);if(!link)continue;const block='• '+topic.summary+'\n↳ '+link,next=(blocks.length?blocks.join('\n\n')+'\n\n':'')+block;if(next.length>DIGEST_BODY_CHARS)break;blocks.push(block)}return blocks.join('\n\n')}

async function hydrateRoots(managerId:string,period:DigestSourceMessage[]){
  const present=new Set(period.map(row=>row.telegramMessageId)),rootIds=[...new Set(period.flatMap(row=>[row.replyToMessageId,row.messageThreadId]).filter((id):id is number=>id!=null).filter(id=>!present.has(id)))];
  if(!rootIds.length)return period;
  const roots=await prisma.communityManagerMessage.findMany({where:{communityManagerId:managerId,telegramMessageId:{in:rootIds},text:{not:null}},select:{telegramMessageId:true,replyToMessageId:true,messageThreadId:true,messageType:true,tgUserId:true,text:true,createdAt:true}});
  return[...roots.map(row=>({...row,text:row.text??''})),...period];
}
async function claim(managerId:string,dateKey:string,scheduledAt:Date){
  const dedupeKey='daily-digest:'+managerId+':'+dateKey,existing=await prisma.communityManagerActivity.findUnique({where:{dedupeKey}});
  if(existing){
    if(existing.status!=='FAILED'||existing.updatedAt>new Date(Date.now()-5*60_000))return null;
    const retry=await prisma.communityManagerActivity.updateMany({where:{id:existing.id,status:'FAILED',updatedAt:existing.updatedAt},data:{status:'RUNNING',lastError:null}});
    return retry.count?{...existing,status:'RUNNING'}:null;
  }
  try{return await prisma.communityManagerActivity.create({data:{communityManagerId:managerId,type:'DAILY_DIGEST',topic:dateKey,dedupeKey,scheduledAt,status:'RUNNING',result:{automatic:true,evaluated:true,reason:'daily_digest',dateKey}}})}
  catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')return null;throw error}
}
export async function runDueDailyDigest(managerId:string,now=new Date()){
  const manager=await prisma.communityManager.findUnique({where:{id:managerId},include:{community:{include:{moderatorChat:true,chat:true,channel:true}}}});if(!manager?.enabled||!manager.publishedVersion||!manager.community.moderatorChat)return null;
  const communityName=manager.community.chat?.title??manager.community.channel?.name??'сообщество';
  const row=await prisma.communityManagerConfig.findUnique({where:{communityManagerId_version:{communityManagerId:manager.id,version:manager.publishedVersion}}});if(!row)return null;const config=parseCommunityManagerConfig(row.config);if(!config.activities.dailyDigestEnabled)return null;
  const window=dailyDigestWindow(now,config.limits.timezone,config.activities.dailyDigestHour,config.activities.dailyDigestMinute);if(!window.due)return null;const activity=await claim(manager.id,window.dateKey,now);if(!activity)return null;
  try{
    const raw=await prisma.communityManagerDigestMessage.findMany({where:{communityManagerId:manager.id,createdAt:{gte:window.from,lt:window.to}},orderBy:{createdAt:'asc'},take:MAX_MESSAGES,select:{telegramMessageId:true,replyToMessageId:true,messageThreadId:true,messageType:true,tgUserId:true,text:true,createdAt:true}}),period=raw.map(item=>({...item,text:item.text??''}));
    const messages=await hydrateRoots(manager.id,period),humanPeriod=period.filter(item=>item.tgUserId),participantIds=[...new Set(humanPeriod.map(item=>item.tgUserId).filter((id):id is string=>Boolean(id)))];
    const participants=participantIds.length?await prisma.communityManagerParticipant.findMany({where:{communityManagerId:manager.id,tgUserId:{in:participantIds}},select:{tgUserId:true,displayName:true,username:true}}):[],labels=new Map(participants.map(item=>[item.tgUserId,item.displayName+(item.username?' (@'+item.username.replace(/^@/,'')+')':'')]));
    const clusters=buildDigestClusters(messages),threads=clusters.map(cluster=>({reference:'msg:'+cluster.firstMessageId,rootMessageId:cluster.firstMessageId,participantCount:cluster.participantCount,replyCount:cluster.replyCount,messages:cluster.messages.map(message=>({reference:'msg:'+message.telegramMessageId,author:message.tgUserId?(labels.get(message.tgUserId)??'Участник'):'Канал',kind:message.messageType==='CHANNEL_POST'?'channel':'human',text:message.text,replyToMessageId:message.replyToMessageId}))}));
    const agent=await runCommunityManagerAgent({managerId:manager.id,communityId:manager.community.id,channelId:manager.community.channelId,channelName:communityName,chatId:manager.community.moderatorChat.tgChatId,config,sessionKey:activitySessionKey('daily_digest',window.dateKey),event:{kind:'DAILY_DIGEST',dedupeKey:'digest-agent:'+manager.id+':'+window.dateKey,activityId:activity.id,digest:{dateKey:window.dateKey,maxTopics:config.activities.dailyDigestMaxTopics,threads}}});
    const selected:DigestTopic[]=(agent.decision.action==='digest'?agent.decision.digestItems:[]).slice(0,config.activities.dailyDigestMaxTopics).map(item=>({summary:item.summary,firstMessageId:Number(item.reference.replace('msg:',''))})).filter(item=>Number.isInteger(item.firstMessageId)&&item.summary);
    const body=buildDigestBody(selected,manager.community.moderatorChat)||(humanPeriod.length?'Содержательных обсуждений для дайджеста не набралось.':'Вчера в чате было тихо.'),header='📅 Что обсуждали вчера · '+window.displayDate+'\n'+humanPeriod.length+' сообщений · '+participantIds.length+' участников',text=(header+'\n\n'+body).slice(0,1000),executor=await communityManagerExecutor(manager.community.id),ref=await sendChannelPost({chatId:manager.community.moderatorChat.tgChatId,text,bannerUrl:config.activities.dailyDigestImageUrl||null,title:'Итоги чата за '+window.displayDate,siteName:communityName,token:executor.token}),sentAt=new Date();
    await prisma.$transaction([
      prisma.communityManagerActivity.update({where:{id:activity.id},data:{status:'COMPLETED',sentAt,telegramMessageId:ref?.messageId,result:{automatic:true,evaluated:true,reason:'daily_digest',dateKey:window.dateKey,from:window.from.toISOString(),to:window.to.toISOString(),messageCount:humanPeriod.length,participantCount:participantIds.length,sourceMessageCount:messages.length,clusterCount:clusters.length,topicCount:selected.length,topicMessageIds:selected.map(topic=>topic.firstMessageId),agentEventId:agent.eventId,inputTokens:agent.inputTokens,outputTokens:agent.outputTokens,totalTokens:agent.totalTokens,image:Boolean(config.activities.dailyDigestImageUrl)}}}),
      prisma.communityManagerAction.create({data:{communityManagerId:manager.id,decision:'ACTIVITY',intent:'daily_digest',response:text,sources:agent.sources as any,model:primaryTextModel(),promptVersion:'community-agent-v1',telegramMessageId:ref?.messageId,inputTokens:agent.inputTokens,outputTokens:agent.outputTokens,metadata:{agentEventId:agent.eventId,references:agent.decision.references,digestItems:agent.decision.digestItems}}}),
      prisma.communityManager.update({where:{id:manager.id},data:{lastActionAt:sentAt,lastHealthyAt:sentAt,lastError:null}}),
    ]);
    return{activityId:activity.id,dateKey:window.dateKey,messageCount:humanPeriod.length,clusterCount:clusters.length,topicCount:selected.length,inputTokens:agent.inputTokens,outputTokens:agent.outputTokens,telegramMessageId:ref?.messageId};
  }catch(error){await prisma.communityManagerActivity.update({where:{id:activity.id},data:{status:'FAILED',lastError:error instanceof Error?error.message.slice(0,500):'Daily digest failed'}});throw error}
}
