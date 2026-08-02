import { prisma } from '../db';
import type { RelationshipStyle } from './config';
import { DEFAULT_RELATIONSHIP_STATE, evolveRelationshipState } from './personalityState';

type TelegramAuthor={id:number;username?:string;first_name?:string;last_name?:string};
const clean=(value:unknown,max=120)=>typeof value==='string'?value.trim().slice(0,max):'';
const dayKey=(date=new Date())=>date.toISOString().slice(0,10);
const stringList=(value:unknown,max=20)=>Array.isArray(value)?value.flatMap(item=>typeof item==='string'&&item.trim()?[item.trim().slice(0,80)]:[]).slice(0,max):[];

function autoRelationship(messageCount:number,activeDays:number){
  if(activeDays>=3&&messageCount>=8)return'REGULAR';
  if(messageCount>=3)return'ACTIVE';
  return'NEW';
}
const effectiveRelationship=(automatic:string,override?:string|null,expert=false)=>expert?'EXPERT':override??automatic;

export async function rememberParticipant(communityManagerId:string,author:TelegramAuthor,text:string,style:RelationshipStyle){
  const tgUserId=String(author.id),existing=await prisma.communityManagerParticipant.findUnique({where:{communityManagerId_tgUserId:{communityManagerId,tgUserId}}});
  const days=[...new Set([...stringList(existing?.activeDayKeys,30),dayKey()])].slice(-30);
  const username=clean(author.username,64).replace(/^@/,'')||null;
  const firstName=clean(author.first_name,80)||null,lastName=clean(author.last_name,80)||null;
  const displayName=[firstName,lastName].filter(Boolean).join(' ')||username||('Участник '+tgUserId);
  const nextCount=(existing?.messageCount??0)+1,nextAutoRelationship=autoRelationship(nextCount,days.length),nextRelationship=effectiveRelationship(nextAutoRelationship,(existing as any)?.relationshipOverride,existing?.expertConfirmed);
  const optedOut=/\b(?:не\s+тегай|не\s+упоминай|не\s+зови\s+меня)\b/iu.test(text);
  return prisma.communityManagerParticipant.upsert({
    where:{communityManagerId_tgUserId:{communityManagerId,tgUserId}},
    create:{communityManagerId,tgUserId,username,firstName,lastName,displayName,messageCount:1,activeDayKeys:days,relationship:'NEW',autoRelationship:'NEW',relationshipState:evolveRelationshipState(DEFAULT_RELATIONSHIP_STATE,style,{message:true}),mentionEnabled:!optedOut,roles:[],expertise:[]} as any,
    update:{username,firstName,lastName,displayName,messageCount:{increment:1},activeDayKeys:days,relationship:nextRelationship,autoRelationship:nextAutoRelationship,relationshipState:evolveRelationshipState((existing as any)?.relationshipState,style,{message:true}),lastSeenAt:new Date(),...(optedOut?{mentionEnabled:false}:{})} as any,
  });
}

export async function rememberCmExchange(communityManagerId:string,tgUserId:string,style:RelationshipStyle,event:{positive?:boolean;conflict?:boolean;repair?:boolean}={}){
  const row=await prisma.communityManagerParticipant.findUnique({where:{communityManagerId_tgUserId:{communityManagerId,tgUserId}}});if(!row)return;
  const count=row.cmExchangeCount+1,days=stringList(row.activeDayKeys,30);
  await prisma.communityManagerParticipant.update({where:{id:row.id},data:{cmExchangeCount:count,lastCmExchangeAt:new Date(),relationship:effectiveRelationship((row as any).autoRelationship??autoRelationship(row.messageCount,days.length),(row as any).relationshipOverride,row.expertConfirmed),relationshipState:evolveRelationshipState((row as any).relationshipState,style,{exchange:true,...event})} as any});
}

export async function relevantExpert(communityManagerId:string,topic:string){
  if(!topic.trim())return null;
  const cutoff=new Date(Date.now()-7*86400_000),mentionCutoff=new Date(Date.now()-24*3600_000);
  const rows=await prisma.communityManagerParticipant.findMany({where:{communityManagerId,expertConfirmed:true,mentionEnabled:true,username:{not:null},lastSeenAt:{gte:cutoff},OR:[{lastMentionedAt:null},{lastMentionedAt:{lt:mentionCutoff}}]},orderBy:{lastSeenAt:'desc'},take:20});
  const terms=topic.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term=>term.length>3);
  return rows.find(row=>stringList(row.expertise).some(tag=>terms.some(term=>tag.toLowerCase().includes(term)||term.includes(tag.toLowerCase()))))??null;
}

export async function markExpertMentioned(id:string){await prisma.communityManagerParticipant.update({where:{id},data:{lastMentionedAt:new Date()}})}

export async function markMentionedExperts(communityManagerId:string,text:string){
  const usernames=(text.match(/@[A-Za-z0-9_]{5,32}/g)??[]).map(value=>value.slice(1).toLowerCase());if(!usernames.length)return;
  await prisma.communityManagerParticipant.updateMany({where:{communityManagerId,expertConfirmed:true,mentionEnabled:true,username:{in:usernames,mode:'insensitive'}},data:{lastMentionedAt:new Date()}});
}
export const participantPublic=(row:any)=>{
  const claims=Array.isArray(row.claims)?row.claims.flatMap((claim:any)=>typeof claim?.displayValue==='string'?[{kind:String(claim.kind),value:claim.displayValue,status:String(claim.status),confidence:Number(claim.confidence)}]:[]):[];
  const roles=[...new Set([...stringList(row.roles),...claims.filter((claim:any)=>claim.kind==='ROLE').map((claim:any)=>claim.value)])].slice(0,8);
  const expertise=[...new Set([...stringList(row.expertise),...claims.filter((claim:any)=>claim.kind==='EXPERTISE').map((claim:any)=>claim.value)])].slice(0,12);
  return{id:row.id,tgUserId:row.tgUserId,username:row.username,displayName:row.displayName,relationship:row.relationship,relationshipState:row.relationshipState,roles,expertise,memories:claims,messageCount:row.messageCount,cmExchangeCount:row.cmExchangeCount,expertConfirmed:row.expertConfirmed,mentionEnabled:row.mentionEnabled,lastSeenAt:row.lastSeenAt,lastCmExchangeAt:row.lastCmExchangeAt,lastMentionedAt:row.lastMentionedAt};
};
