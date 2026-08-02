import type { AgentInputItem, Session } from '@openai/agents';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';

const MAX_SESSION_ITEMS=40;

function cloneItem(value:unknown):AgentInputItem{
  return JSON.parse(JSON.stringify(value)) as AgentInputItem;
}

export const durableSessionItems=(items:AgentInputItem[])=>items.filter(item=>(item as {type?:unknown}).type==='message');

export class PrismaCommunityManagerSession implements Session {
  constructor(private readonly id:string){}

  async getSessionId(){return this.id}

  async getItems(limit=MAX_SESSION_ITEMS):Promise<AgentInputItem[]>{
    const rows=await prisma.communityManagerAgentSessionItem.findMany({where:{sessionId:this.id},orderBy:{id:'desc'},take:Math.min(MAX_SESSION_ITEMS,Math.max(1,limit))});
    return rows.reverse().map(row=>cloneItem(row.item));
  }

  async addItems(items:AgentInputItem[]){
    const durable=durableSessionItems(items);if(!durable.length)return;
    await prisma.communityManagerAgentSessionItem.createMany({data:durable.map(item=>({sessionId:this.id,item:cloneItem(item) as Prisma.InputJsonValue}))});
    const overflow=await prisma.communityManagerAgentSessionItem.findMany({where:{sessionId:this.id},orderBy:{id:'desc'},skip:MAX_SESSION_ITEMS,select:{id:true}});
    if(overflow.length)await prisma.communityManagerAgentSessionItem.deleteMany({where:{id:{in:overflow.map(row=>row.id)}}});
    await prisma.communityManagerAgentSession.update({where:{id:this.id},data:{lastEventAt:new Date()}});
  }

  async popItem():Promise<AgentInputItem|undefined>{
    const row=await prisma.communityManagerAgentSessionItem.findFirst({where:{sessionId:this.id},orderBy:{id:'desc'}});
    if(!row)return undefined;
    await prisma.communityManagerAgentSessionItem.delete({where:{id:row.id}});
    return cloneItem(row.item);
  }

  async clearSession(){
    await prisma.communityManagerAgentSessionItem.deleteMany({where:{sessionId:this.id}});
  }
}

export const conversationSessionKey=(threadId:string,segmentId:string)=>`conversation:${threadId}:${segmentId}`;
export const activitySessionKey=(kind:string,key:string)=>`activity:${kind}:${key}`;

export async function openCommunityManagerSession(input:{managerId:string;sessionKey:string;threadId?:string;segmentId?:string;summary?:string}){
  const row=await prisma.communityManagerAgentSession.upsert({
    where:{communityManagerId_sessionKey:{communityManagerId:input.managerId,sessionKey:input.sessionKey}},
    create:{communityManagerId:input.managerId,sessionKey:input.sessionKey,threadId:input.threadId,segmentId:input.segmentId,summary:input.summary??''},
    update:{threadId:input.threadId,segmentId:input.segmentId,summary:input.summary??'',status:'ACTIVE',lastEventAt:new Date()},
  });
  return{row,session:new PrismaCommunityManagerSession(row.id)};
}
