import crypto from 'crypto';
import sharp from 'sharp';
import { prisma } from '../db';
import { env } from '../env';
import { getBotIdentity, getManagedBotToken, setBotName, setBotProfilePhoto, setBotTextProfile, setBotWebhook } from '../lib/telegramBot';
import { readObject } from '../lib/storage';
import { decryptManagedBotToken, encryptManagedBotToken } from '../moderator/managedBotCrypto';
import type { ManagedBotUpdate } from '../moderator/managedBotService';

export const managedCommunityBotPublic = (bot: { id:string;tgBotId:string|null;username:string|null;displayName:string;avatarUrl:string|null;status:string;lastError:string|null;requestExpiresAt:Date|null } | null) => bot ? ({
  id:bot.id,tgBotId:bot.tgBotId,username:bot.username,displayName:bot.displayName,avatarUrl:bot.avatarUrl,status:bot.status,lastError:bot.lastError,requestExpiresAt:bot.requestExpiresAt?.toISOString()??null,
}) : null;
const secret=()=>crypto.randomBytes(32).toString('base64url');
const profile=async(name:string,token:string)=>setBotTextProfile(`AI Community Manager сообщества «${name}» от Publium.`,`Общается с участниками сообщества «${name}», отвечает по базе знаний, помогает с вопросами и поддерживает активность. Это AI-личность от Publium.`,token);

export async function completeManagedCommunityBot(update:ManagedBotUpdate){
  const owner=await prisma.user.findUnique({where:{telegramId:String(update.user.id)},select:{id:true}});if(!owner)return null;
  const pending=await prisma.managedCommunityManagerBot.findFirst({where:{ownerUserId:owner.id,status:'REQUESTED',requestExpiresAt:{gt:new Date()}},orderBy:{updatedAt:'desc'}});
  const existing=pending?null:await prisma.managedCommunityManagerBot.findFirst({where:{ownerUserId:owner.id,tgBotId:String(update.bot.id)}});
  const target=pending??existing;if(!target)return null;
  try{
    const actual=update.bot.username?.toLowerCase();if(!target.expectedUsername||!actual||actual!==target.expectedUsername.toLowerCase())throw new Error('MANAGED_CM_BOT_USERNAME_MISMATCH');
    const token=await getManagedBotToken(update.bot.id,env.TELEGRAM_BOT_TOKEN),identity=await getBotIdentity(token),webhookSecret=target.webhookSecret??secret(),encrypted=encryptManagedBotToken(token,target.communityId);
    let warning:string|null=null;await setBotName(target.displayName,token).catch(e=>{warning=(e as Error).message.slice(0,500)});await profile(target.displayName,token).catch(e=>{warning=(e as Error).message.slice(0,500)});
    if(target.avatarUrl)try{const source=await readObject(target.avatarUrl);if(!source)throw new Error('Avatar file not found');const jpg=await sharp(source).resize(640,640,{fit:'cover'}).jpeg({quality:90}).toBuffer();await setBotProfilePhoto(jpg,token)}catch(e){warning=('Аватар не установлен: '+(e as Error).message).slice(0,500)}
    await setBotWebhook(token,`${env.PUBLIC_BASE_URL}/api/community-manager/webhook/${identity.id}`,webhookSecret);
    await prisma.managedCommunityManagerBot.update({where:{id:target.id},data:{tgBotId:String(identity.id),username:identity.username??update.bot.username??null,...encrypted,webhookSecret,status:pending?'READY':target.status,lastError:warning}});
    return{ownerTgId:update.user.id,username:identity.username,kind:'Community Manager' as const};
  }catch(e){await prisma.managedCommunityManagerBot.update({where:{id:target.id},data:{status:'ERROR',lastError:(e as Error).message.slice(0,500)}}).catch(()=>undefined);throw e}
}

export async function incomingManagedCommunityBot(botId:string,secretHeader:string|undefined){
  const bot=await prisma.managedCommunityManagerBot.findUnique({where:{tgBotId:botId}});if(!bot?.tgBotId||!bot.webhookSecret||!secretHeader)return null;
  const a=Buffer.from(secretHeader),b=Buffer.from(bot.webhookSecret);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  return{token:decryptManagedBotToken(bot),numericBotId:Number(bot.tgBotId),communityId:bot.communityId,username:bot.username??''};
}

export async function communityManagerExecutor(communityId:string){
  const c=await prisma.community.findUnique({where:{id:communityId},select:{communityManager:{select:{executorType:true}},managedCommunityManagerBot:true}});
  if(c?.communityManager?.executorType==='CUSTOM'){
    const bot=c.managedCommunityManagerBot;if(!bot||bot.status!=='ACTIVE'||!bot.tgBotId)throw new Error('MANAGED_CM_BOT_NOT_ACTIVE');
    return{type:'CUSTOM' as const,token:decryptManagedBotToken(bot),botId:Number(bot.tgBotId),username:bot.username??''};
  }
  return{type:'SHARED' as const,token:env.COMMUNITY_MANAGER_BOT_TOKEN,botId:Number(env.COMMUNITY_MANAGER_BOT_TOKEN.split(':')[0]),username:env.COMMUNITY_MANAGER_BOT_USERNAME};
}

export async function updateManagedCommunityBotProfile(id:string,displayName:string,avatarUrl:string|null){
  const bot=await prisma.managedCommunityManagerBot.findUnique({where:{id}});if(!bot)throw new Error('MANAGED_CM_BOT_NOT_FOUND');const token=decryptManagedBotToken(bot);let warning:string|null=null;
  await setBotName(displayName,token);await profile(displayName,token).catch(e=>{warning=(e as Error).message.slice(0,500)});
  if(avatarUrl)try{const source=await readObject(avatarUrl);if(!source)throw new Error('Avatar file not found');const jpg=await sharp(source).resize(640,640,{fit:'cover'}).jpeg({quality:90}).toBuffer();await setBotProfilePhoto(jpg,token)}catch(e){warning=('Аватар не установлен: '+(e as Error).message).slice(0,500)}
  await prisma.managedCommunityManagerBot.update({where:{id},data:{displayName,avatarUrl,lastError:warning}});return warning;
}