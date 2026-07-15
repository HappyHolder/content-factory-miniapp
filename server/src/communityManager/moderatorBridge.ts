import { prisma } from '../db';

export async function rememberModeratorIntervention(input:{communityId:string;messageId?:number;text:string;category:string;severity:string}):Promise<void>{
  if(!input.messageId||!input.text.trim())return;
  const manager=await prisma.communityManager.findFirst({where:{communityId:input.communityId,enabled:true,publishedVersion:{not:null}},select:{id:true}});
  if(!manager)return;
  await prisma.communityManagerConversationState.upsert({
    where:{communityManagerId:manager.id},
    create:{communityManagerId:manager.id,pendingModeratorMessageId:input.messageId,pendingModeratorText:input.text.slice(0,1000),pendingModeratorAt:new Date()},
    update:{pendingModeratorMessageId:input.messageId,pendingModeratorText:input.text.slice(0,1000),pendingModeratorAt:new Date()},
  });
}
