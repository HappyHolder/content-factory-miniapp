import crypto from 'crypto';
import sharp from 'sharp';
import { prisma } from '../db';
import { env } from '../env';
import { getBotIdentity, getManagedBotToken, setBotDescription, setBotName, setBotProfilePhoto, setBotWebhook } from '../lib/telegramBot';
import { readObject } from '../lib/storage';
import { decryptManagedBotToken, encryptManagedBotToken } from './managedBotCrypto';

export type ManagedBotUpdate = {
  user: { id: number };
  bot: { id: number; first_name: string; username?: string };
};

export const managedBotPublic = (bot: {
  id: string; tgBotId: string | null; username: string | null; displayName: string; avatarUrl: string | null;
  status: string; lastError: string | null; requestExpiresAt: Date | null;
} | null) => bot ? {
  id: bot.id, tgBotId: bot.tgBotId, username: bot.username, displayName: bot.displayName, avatarUrl: bot.avatarUrl,
  status: bot.status, lastError: bot.lastError, requestExpiresAt: bot.requestExpiresAt?.toISOString() ?? null,
} : null;

const newWebhookSecret = () => crypto.randomBytes(32).toString('base64url');

export async function completeManagedBot(update: ManagedBotUpdate): Promise<{ ownerTgId: number; username?: string } | null> {
  const owner = await prisma.user.findUnique({ where: { telegramId: String(update.user.id) }, select: { id: true } });
  if (!owner) return null;
  const pending = await prisma.managedModeratorBot.findFirst({ where: { ownerUserId: owner.id, status: 'REQUESTED', requestExpiresAt: { gt: new Date() } }, orderBy: { updatedAt: 'desc' } });
  const existing = pending ? null : await prisma.managedModeratorBot.findFirst({ where: { ownerUserId: owner.id, tgBotId: String(update.bot.id) } });
  const target = pending ?? existing;
  if (!target) return null;
  try {
    const token = await getManagedBotToken(update.bot.id, env.TELEGRAM_BOT_TOKEN);
    const identity = await getBotIdentity(token);
    if (identity.id !== update.bot.id || !identity.is_bot) throw new Error('Telegram вернул некорректные данные созданного бота');
    const webhookSecret = target.webhookSecret ?? newWebhookSecret();
    const encrypted = encryptManagedBotToken(token, target.communityId);
    let nonCriticalError: string | null = null;
    await setBotName(target.displayName, token).catch(error => { nonCriticalError = (error as Error).message.slice(0, 500); });
    await setBotDescription(target.displayName, token).catch(error => { nonCriticalError = (error as Error).message.slice(0, 500); });
    if (target.avatarUrl) {
      try {
        const source = await readObject(target.avatarUrl);
        if (!source) throw new Error('Avatar file not found');
        const jpg = await sharp(source).resize(640, 640, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
        await setBotProfilePhoto(jpg, token);
      } catch (error) {
        nonCriticalError = `Аватар не установлен: ${(error as Error).message}`.slice(0, 500);
      }
    }
    await setBotWebhook(token, `${env.PUBLIC_BASE_URL}/api/moderator/webhook/${identity.id}`, webhookSecret);
    await prisma.managedModeratorBot.update({ where: { id: target.id }, data: {
      tgBotId: String(identity.id), username: identity.username ?? update.bot.username ?? null, displayName: target.displayName,
      ...encrypted, webhookSecret, status: pending ? 'READY' : target.status, lastError: nonCriticalError,
    } });
    return { ownerTgId: update.user.id, username: identity.username };
  } catch (error) {
    await prisma.managedModeratorBot.update({ where: { id: target.id }, data: { status: 'ERROR', lastError: (error as Error).message.slice(0, 500) } }).catch(() => undefined);
    throw error;
  }
}

export async function incomingManagedBot(botId: string, secret: string | undefined): Promise<{ token: string; numericBotId: number } | null> {
  const bot = await prisma.managedModeratorBot.findUnique({ where: { tgBotId: botId }, select: { tgBotId: true, webhookSecret: true, communityId: true, tokenCipher: true, tokenIv: true, tokenTag: true, tokenKeyVersion: true, status: true } });
  if (!bot?.tgBotId || bot.status !== 'ACTIVE' || !bot.webhookSecret || !secret) return null;
  const actual = Buffer.from(secret), expected = Buffer.from(bot.webhookSecret);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  return { token: decryptManagedBotToken(bot), numericBotId: Number(bot.tgBotId) };
}
export async function updateManagedBotProfile(botId: string, displayName: string, avatarUrl: string | null): Promise<string | null> {
  const bot = await prisma.managedModeratorBot.findUnique({ where: { id: botId } });
  if (!bot) throw new Error('MANAGED_BOT_NOT_FOUND');
  const token = decryptManagedBotToken(bot);
  let warning: string | null = null;
  await setBotName(displayName, token);
  await setBotDescription(displayName, token).catch(error => { warning = (error as Error).message.slice(0, 500); });
  if (avatarUrl) {
    try {
      const source = await readObject(avatarUrl);
      if (!source) throw new Error('Avatar file not found');
      const jpg = await sharp(source).resize(640, 640, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
      await setBotProfilePhoto(jpg, token);
    } catch (error) {
      warning = ('Аватар не установлен: ' + (error as Error).message).slice(0, 500);
    }
  }
  await prisma.managedModeratorBot.update({ where: { id: bot.id }, data: { displayName, avatarUrl, lastError: warning } });
  return warning;
}
