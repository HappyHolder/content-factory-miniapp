import { prisma } from '../db';

type TelegramAuthor={id:number;username?:string;first_name?:string;last_name?:string};
const clean=(value:unknown,max=120)=>typeof value==='string'?value.trim().slice(0,max):'';
const dayKey=(date=new Date())=>date.toISOString().slice(0,10);
const stringList=(value:unknown,max=20)=>Array.isArray(value)?value.flatMap(item=>typeof item==='string'&&item.trim()?[item.trim().slice(0,80)]:[]).slice(0,max):[];

function relationship(messageCount:number,activeDays:number,cmExchanges:number,current:string){
  if(current==='FRIEND'||current==='EXPERT')return current;
  if(cmExchanges>=5&&activeDays>=2)return'FRIEND';
  if(activeDays>=3&&messageCount>=8)return'REGULAR';
  if(messageCount>=3)return'ACTIVE';
  return'NEW';
}

export async function rememberParticipant(communityManagerId:string,author:TelegramAuthor,text:string){
  const tgUserId=String(author.id),existing=await prisma.communityManagerParticipant.findUnique({where:{communityManagerId_tgUserId:{communityManagerId,tgUserId}}});
  const days=[...new Set([...stringList(existing?.activeDayKeys,30),dayKey()])].slice(-30);
  const username=clean(author.username,64).replace(/^@/,'')||null;
  const firstName=clean(author.first_name,80)||null,lastName=clean(author.last_name,80)||null;
  const displayName=[firstName,lastName].filter(Boolean).join(' ')||username||('Участник '+tgUserId);
  const nextCount=(existing?.messageCount??0)+1,nextRelationship=relationship(nextCount,days.length,existing?.cmExchangeCount??0,existing?.relationship??'NEW');
  const optedOut=/\b(?:не\s+тегай|не\s+упоминай|не\s+зови\s+меня)\b/iu.test(text);
  return prisma.communityManagerParticipant.upsert({
    where:{communityManagerId_tgUserId:{communityManagerId,tgUserId}},
    create:{communityManagerId,tgUserId,username,firstName,lastName,displayName,messageCount:1,activeDayKeys:days,relationship:'NEW',mentionEnabled:!optedOut,roles:[],expertise:[]},
    update:{username,firstName,lastName,displayName,messageCount:{increment:1},activeDayKeys:days,relationship:nextRelationship,lastSeenAt:new Date(),...(optedOut?{mentionEnabled:false}:{})},
  });
}

export async function rememberCmExchange(communityManagerId:string,tgUserId:string){
  const row=await prisma.communityManagerParticipant.findUnique({where:{communityManagerId_tgUserId:{communityManagerId,tgUserId}}});if(!row)return;
  const count=row.cmExchangeCount+1,days=stringList(row.activeDayKeys,30);
  await prisma.communityManagerParticipant.update({where:{id:row.id},data:{cmExchangeCount:count,lastCmExchangeAt:new Date(),relationship:relationship(row.messageCount,days.length,count,row.relationship)}});
}

export async function relevantExpert(communityManagerId:string,topic:string){
  if(!topic.trim())return null;
  const cutoff=new Date(Date.now()-7*86400_000),mentionCutoff=new Date(Date.now()-24*3600_000);
  const rows=await prisma.communityManagerParticipant.findMany({where:{communityManagerId,expertConfirmed:true,mentionEnabled:true,username:{not:null},lastSeenAt:{gte:cutoff},OR:[{lastMentionedAt:null},{lastMentionedAt:{lt:mentionCutoff}}]},orderBy:{lastSeenAt:'desc'},take:20});
  const terms=topic.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term=>term.length>3);
  return rows.find(row=>stringList(row.expertise).some(tag=>terms.some(term=>tag.toLowerCase().includes(term)||term.includes(tag.toLowerCase()))))??null;
}

export async function markExpertMentioned(id:string){await prisma.communityManagerParticipant.update({where:{id},data:{lastMentionedAt:new Date()}})}
export const participantPublic=(row:any)=>({id:row.id,tgUserId:row.tgUserId,username:row.username,displayName:row.displayName,relationship:row.relationship,roles:stringList(row.roles),expertise:stringList(row.expertise),messageCount:row.messageCount,cmExchangeCount:row.cmExchangeCount,expertConfirmed:row.expertConfirmed,mentionEnabled:row.mentionEnabled,lastSeenAt:row.lastSeenAt,lastCmExchangeAt:row.lastCmExchangeAt,lastMentionedAt:row.lastMentionedAt});
