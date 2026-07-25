import { prisma } from '../db';
import { primaryTextModel, terraText } from '../lib/assistantModel';
import { sendBotMessage } from '../lib/telegramBot';
import { parseCommunityManagerConfig } from './config';
import { communityManagerExecutor } from './managedBot';
import { personalityPrompt } from './personality';

type State={endsAt?:string;reminderSent?:boolean;rewardDescription?:string;rewardMode?:string;[key:string]:unknown};
const stateOf=(value:unknown):State=>value&&typeof value==='object'?value as State:{};
const clean=(text:string)=>text.replace(/<[^>]+>/g,'').replace(/[*_#>]/g,'').replace(/\n{3,}/g,'\n\n').trim().slice(0,1000);

async function generate(system:string,prompt:string){
  const text=await terraText({system,prompt,maxTokens:700,timeoutMs:45000,effort:'low',verbosity:'low'});return clean(text??'');
}

export async function advanceActiveActivities(now=new Date()){
  const rows=await prisma.communityManagerActivity.findMany({where:{status:'ACTIVE',scheduledAt:{lte:now}},orderBy:{scheduledAt:'asc'},take:30,include:{communityManager:{include:{community:{include:{moderatorChat:true,channel:true}}}}}});
  for(const activity of rows){
    const claim=await prisma.communityManagerActivity.updateMany({where:{id:activity.id,status:'ACTIVE',scheduledAt:{lte:now}},data:{status:'PROCESSING'}});
    if(!claim.count)continue;
    try{
      const manager=activity.communityManager,state=stateOf(activity.result),endsAt=state.endsAt?new Date(state.endsAt):null;
    if(!manager.enabled||!manager.publishedVersion||!manager.community.moderatorChat||!endsAt){await prisma.communityManagerActivity.update({where:{id:activity.id},data:{status:'CANCELLED'}});continue}
    const row=await prisma.communityManagerConfig.findUnique({where:{communityManagerId_version:{communityManagerId:manager.id,version:manager.publishedVersion}}});if(!row){await prisma.communityManagerActivity.update({where:{id:activity.id},data:{status:'CANCELLED',lastError:'Config not applied'}});continue}
    const config=parseCommunityManagerConfig(row.config),executor=await communityManagerExecutor(manager.community.id),recent=await prisma.communityManagerMessage.findMany({where:{communityManagerId:manager.id,createdAt:{gte:activity.sentAt??activity.createdAt}},orderBy:{createdAt:'asc'},take:100,select:{text:true}}),history=recent.map(x=>x.text).filter(Boolean).join('\n').slice(-10000);
    const finished=endsAt<=now;
    const instruction=finished
      ?activity.type==='CONTEST'?'Close submissions naturally. Do not invent a winner. Say that the owner will verify entries and announce the result. Mention no automatic payment.':'Close the challenge naturally and briefly reflect participation without inventing names, results or winners.'
      :'Send the single allowed midpoint reminder. Keep it short, add useful context, and do not pressure or tag people.';
    const message=await generate(personalityPrompt(config)+'\nYou are continuing an already announced community activity. '+instruction+' Never restart it, change its rules or reward, greet, shame inactivity, or invent participation.',JSON.stringify({type:activity.type,topic:activity.topic,reward:state.rewardDescription||null,endsAt:endsAt.toISOString(),chatSinceLaunch:history}));
    if(message){const sent=await sendBotMessage(manager.community.moderatorChat.tgChatId,message,executor.token);await prisma.communityManagerAction.create({data:{communityManagerId:manager.id,decision:'ACTIVITY',intent:(activity.type+'_'+(finished?'finish':'reminder')).toLowerCase(),response:message,model:primaryTextModel(),promptVersion:'community-activity-lifecycle-v1',telegramMessageId:sent?.messageId}})}
      await prisma.communityManagerActivity.update({where:{id:activity.id},data:finished?{status:'COMPLETED',scheduledAt:now,result:{...state,reminderSent:Boolean(state.reminderSent),finishedAt:now.toISOString(),evaluated:true}}:{scheduledAt:endsAt,result:{...state,reminderSent:true,remindedAt:now.toISOString()}}});
    }catch(error){
      const retryAt=new Date(now.getTime()+15*60_000),message=error instanceof Error?error.message.slice(0,500):'Activity lifecycle failed';
      await prisma.communityManagerActivity.update({where:{id:activity.id},data:{status:'ACTIVE',scheduledAt:retryAt,lastError:message}}).catch(()=>undefined);
      await prisma.communityManager.update({where:{id:activity.communityManagerId},data:{lastError:message}}).catch(()=>undefined);
    }
  }
}
