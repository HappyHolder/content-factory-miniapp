import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { verifyModeratorSession } from '../lib/moderatorSession';
import { getBotIdFromToken, getChatMember, sendBotMessage } from '../lib/telegramBot';
import { DEFAULT_CM_CONFIG, parseCommunityManagerConfig } from '../communityManager/config';
import { acceptCommunityManagerUpdate, runCommunityActivity, simulateCommunityManager, verifyCommunityManagerWebhookSecret } from '../communityManager/engine';

const router=Router();
async function auth(req:Request){
  const session=verifyModeratorSession(req.headers.authorization);
  const user=await prisma.user.findUnique({where:{telegramId:session.tgUserId},select:{id:true,telegramId:true}});
  if(!user)throw new Error('USER_NOT_FOUND');return{user,tgUserId:session.tgUserId};
}
function fail(res:Response,e:unknown){const m=e instanceof Error?e.message:'';res.status(m==='NOT_FOUND'?404:401).json({error:m==='SESSION_EXPIRED'?'Сессия истекла. Переоткройте Publium.':'Недействительная авторизация'})}
async function owned(req:Request,id:string){
  const a=await auth(req),manager=await prisma.communityManager.findFirst({where:{id,community:{channel:{userId:a.user.id}}},include:{community:{include:{moderatorChat:true,channel:true}}}});
  if(!manager)throw new Error('NOT_FOUND');return{...a,manager};
}
const publicManager=(m:any)=>m?{id:m.id,status:m.status,enabled:m.enabled,mode:m.mode,draftVersion:m.draftVersion,publishedVersion:m.publishedVersion,lastActionAt:m.lastActionAt,lastHealthyAt:m.lastHealthyAt,lastError:m.lastError}:null;

router.get('/channels/:channelId',async(req,res)=>{
  let a;try{a=await auth(req)}catch(e){fail(res,e);return}
  const channel=await prisma.channel.findFirst({where:{id:req.params.channelId,userId:a.user.id},include:{community:{include:{moderatorChat:true,communityManager:true}}}});
  if(!channel){res.status(404).json({error:'Channel not found'});return}
  const manager=channel.community?.communityManager;
  const [docs,faqs,actions]=manager?await Promise.all([prisma.projectDoc.count({where:{channelId:channel.id}}),prisma.communityManagerFaq.count({where:{communityManagerId:manager.id,enabled:true}}),prisma.communityManagerAction.findMany({where:{communityManagerId:manager.id},orderBy:{createdAt:'desc'},take:10})]):[await prisma.projectDoc.count({where:{channelId:channel.id}}),0,[]];
  res.json({communityId:channel.community?.id??null,chat:channel.community?.moderatorChat??null,manager:publicManager(manager),botUsername:env.COMMUNITY_MANAGER_BOT_USERNAME,docsCount:docs,faqCount:faqs,actions});
});

router.post('/channels/:channelId/create',async(req,res)=>{
  let a;try{a=await auth(req)}catch(e){fail(res,e);return}
  const community=await prisma.community.findFirst({where:{channelId:req.params.channelId,channel:{userId:a.user.id}},include:{moderatorChat:true}});
  if(!community){res.status(409).json({error:'Сначала подключите группу в Moderator'});return}
  const manager=await prisma.communityManager.upsert({where:{communityId:community.id},create:{communityId:community.id,configs:{create:{version:1,config:DEFAULT_CM_CONFIG}}},update:{}});
  res.json({manager:publicManager(manager),chat:community.moderatorChat,botUsername:env.COMMUNITY_MANAGER_BOT_USERNAME});
});

router.get('/:id/draft',async(req,res)=>{
  let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}
  const draft=await prisma.communityManagerConfig.findUnique({where:{communityManagerId_version:{communityManagerId:c.manager.id,version:c.manager.draftVersion}}});
  res.json({manager:publicManager(c.manager),config:parseCommunityManagerConfig(draft?.config??DEFAULT_CM_CONFIG)});
});

router.patch('/:id/draft',async(req,res)=>{
  let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}
  let config;try{config=parseCommunityManagerConfig(req.body?.config)}catch(e){res.status(400).json({error:e instanceof Error?e.message:'Invalid config'});return}
  const row=await prisma.communityManagerConfig.upsert({where:{communityManagerId_version:{communityManagerId:c.manager.id,version:c.manager.draftVersion}},create:{communityManagerId:c.manager.id,version:c.manager.draftVersion,config},update:{config}});
  if(['OBSERVE','DRAFTS','AUTOPILOT'].includes(req.body?.mode))await prisma.communityManager.update({where:{id:c.manager.id},data:{mode:req.body.mode}});
  res.json({config:row.config});
});

router.post('/:id/apply',async(req,res)=>{
  let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}
  if(!env.COMMUNITY_MANAGER_BOT_TOKEN||!env.COMMUNITY_MANAGER_WEBHOOK_SECRET){res.status(503).json({error:'Community Manager bot не настроен'});return}
  if(!c.manager.community.moderatorChat){res.status(409).json({error:'Группа не подключена'});return}
  const draft=await prisma.communityManagerConfig.findUnique({where:{communityManagerId_version:{communityManagerId:c.manager.id,version:c.manager.draftVersion}}});
  if(!draft){res.status(409).json({error:'Сначала сохраните настройки'});return}
  try{
    const [bot,user]=await Promise.all([getChatMember(c.manager.community.moderatorChat.tgChatId,getBotIdFromToken(env.COMMUNITY_MANAGER_BOT_TOKEN),env.COMMUNITY_MANAGER_BOT_TOKEN),getChatMember(c.manager.community.moderatorChat.tgChatId,Number(c.tgUserId),env.COMMUNITY_MANAGER_BOT_TOKEN)]);
    if(!['member','administrator','creator'].includes(bot.status)){res.status(409).json({error:'Добавьте @'+env.COMMUNITY_MANAGER_BOT_USERNAME+' в группу'});return}
    if(!['administrator','creator'].includes(user.status)){res.status(403).json({error:'Вы больше не администратор группы'});return}
  }catch(e){res.status(502).json({error:e instanceof Error?e.message:'Не удалось проверить бота'});return}
  const next=draft.version+1;
  const result=await prisma.$transaction(async tx=>{
    await tx.communityManagerConfig.updateMany({where:{communityManagerId:c.manager.id,status:'PUBLISHED'},data:{status:'ARCHIVED'}});
    await tx.communityManagerConfig.update({where:{id:draft.id},data:{status:'PUBLISHED',publishedAt:new Date()}});
    await tx.communityManagerConfig.create({data:{communityManagerId:c.manager.id,version:next,config:parseCommunityManagerConfig(draft.config)}});
    return tx.communityManager.update({where:{id:c.manager.id},data:{status:'ACTIVE',enabled:true,publishedVersion:draft.version,draftVersion:next,lastError:null,lastHealthyAt:new Date()}});
  });
  res.json({manager:publicManager(result)});
});

router.post('/:id/pause',async(req,res)=>{
  let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}
  const enabled=typeof req.body?.enabled==='boolean'?req.body.enabled:!c.manager.enabled;
  const mode=['OBSERVE','DRAFTS','AUTOPILOT'].includes(req.body?.mode)?req.body.mode:c.manager.mode;
  if(enabled&&!c.manager.publishedVersion){res.status(409).json({error:'Сначала примените настройки'});return}
  const manager=await prisma.communityManager.update({where:{id:c.manager.id},data:{enabled,mode,status:enabled?'ACTIVE':'PAUSED'}});
  if(!enabled)await prisma.communityManagerJob.updateMany({where:{communityManagerId:manager.id,status:{in:['PENDING','RETRY_WAIT','CLAIMED']}},data:{status:'CANCELLED'}});
  res.json({manager:publicManager(manager)});
});

router.get('/:id/health',async(req,res)=>{
  let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}
  let botStatus='missing';try{if(c.manager.community.moderatorChat&&env.COMMUNITY_MANAGER_BOT_TOKEN)botStatus=(await getChatMember(c.manager.community.moderatorChat.tgChatId,getBotIdFromToken(env.COMMUNITY_MANAGER_BOT_TOKEN),env.COMMUNITY_MANAGER_BOT_TOKEN)).status}catch{botStatus='error'}
  const pending=await prisma.communityManagerJob.count({where:{communityManagerId:c.manager.id,status:{in:['PENDING','RETRY_WAIT','CLAIMED']}}});
  res.json({executor:botStatus,webhook:Boolean(env.COMMUNITY_MANAGER_WEBHOOK_SECRET),published:Boolean(c.manager.publishedVersion),enabled:c.manager.enabled,ai:env.AI_PROVIDER==='deepseek'&&Boolean(env.DEEPSEEK_API_KEY),research:Boolean(env.ANTHROPIC_API_KEY||env.TAVILY_API_KEY||process.env.SERPER_API_KEY),pending});
});

router.post('/:id/simulate',async(req,res)=>{
  let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}
  const text=typeof req.body?.text==='string'?req.body.text.trim():'';
  if(text.length<3){res.status(400).json({error:'Добавьте сообщение'});return}
  try{res.json(await simulateCommunityManager(c.manager.id,text,req.body?.config))}catch(e){res.status(502).json({error:e instanceof Error?e.message:'Simulation failed'})}
});

router.get('/:id/actions',async(req,res)=>{
  let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}
  const take=Math.min(100,Math.max(1,Number(req.query.take)||30));
  res.json({actions:await prisma.communityManagerAction.findMany({where:{communityManagerId:c.manager.id},orderBy:{createdAt:'desc'},take})});
});

router.post('/:id/actions/:actionId/send',async(req,res)=>{
  let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}
  const action=await prisma.communityManagerAction.findFirst({where:{id:req.params.actionId,communityManagerId:c.manager.id,decision:'DRAFT'}});
  if(!action?.response||!c.manager.community.moderatorChat){res.status(404).json({error:'Черновик не найден'});return}
  try{const ref=await sendBotMessage(c.manager.community.moderatorChat.tgChatId,action.response,env.COMMUNITY_MANAGER_BOT_TOKEN);await prisma.communityManagerAction.update({where:{id:action.id},data:{decision:'RESPOND',telegramMessageId:ref?.messageId}});res.json({ok:true})}catch(e){res.status(502).json({error:e instanceof Error?e.message:'Send failed'})}
});

router.get('/:id/faq',async(req,res)=>{let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}res.json({faqs:await prisma.communityManagerFaq.findMany({where:{communityManagerId:c.manager.id},orderBy:[{priority:'desc'},{createdAt:'desc'}]})})});
router.post('/:id/faq',async(req,res)=>{let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}const q=String(req.body?.question??'').trim().slice(0,1000),a=String(req.body?.answer??'').trim().slice(0,5000);if(!q||!a){res.status(400).json({error:'Нужны вопрос и ответ'});return}res.json({faq:await prisma.communityManagerFaq.create({data:{communityManagerId:c.manager.id,question:q,answer:a}})})});
router.delete('/:id/faq/:faqId',async(req,res)=>{let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}const x=await prisma.communityManagerFaq.deleteMany({where:{id:req.params.faqId,communityManagerId:c.manager.id}});res.status(x.count?200:404).json(x.count?{ok:true}:{error:'FAQ not found'})});

router.post('/:id/activities/run',async(req,res)=>{
  let c;try{c=await owned(req,req.params.id)}catch(e){fail(res,e);return}
  const type=['DISCUSSION','POLL','DIGEST'].includes(req.body?.type)?req.body.type:'DISCUSSION';
  try{res.json(await runCommunityActivity(c.manager.id,type,typeof req.body?.topic==='string'?req.body.topic:undefined))}catch(e){res.status(502).json({error:e instanceof Error?e.message:'Activity failed'})}
});

router.post('/webhook',async(req,res)=>{
  const secret=req.headers['x-telegram-bot-api-secret-token'];
  if(!verifyCommunityManagerWebhookSecret(secret)){res.status(401).json({error:'Unauthorized'});return}
  try{const status=await acceptCommunityManagerUpdate(req.body);res.json({ok:true,status})}catch(e){console.error('[community-manager/webhook]',e instanceof Error?e.message:e);res.status(200).json({ok:true,status:'failed'})}
});

export default router;