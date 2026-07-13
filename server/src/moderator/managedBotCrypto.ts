import crypto from 'crypto';
import { prisma } from '../db';
import { env } from '../env';

type EncryptedToken = { tokenCipher: string; tokenIv: string; tokenTag: string; tokenKeyVersion: number };
type StoredToken = {
  communityId: string;
  tokenCipher: string | null;
  tokenIv: string | null;
  tokenTag: string | null;
  tokenKeyVersion?: number;
};

const CURRENT_KEY_VERSION = 2;
const key = crypto.createHash('sha256')
  .update(env.MANAGED_BOT_ENCRYPTION_KEY)
  .digest();
const aadForCommunity = (communityId: string) => Buffer.from(`publium:managed-bot:${communityId}`, 'utf8');

export function encryptManagedBotToken(token: string, communityId: string): EncryptedToken {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadForCommunity(communityId));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    tokenCipher: encrypted.toString('base64'),
    tokenIv: iv.toString('base64'),
    tokenTag: cipher.getAuthTag().toString('base64'),
    tokenKeyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptManagedBotToken(stored: StoredToken): string {
  if (!stored.tokenCipher || !stored.tokenIv || !stored.tokenTag) throw new Error('MANAGED_BOT_TOKEN_MISSING');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(stored.tokenIv, 'base64'));
  // Version 1 rows predate AAD. New ciphertext is bound to its community and cannot be transplanted.
  if ((stored.tokenKeyVersion ?? 1) >= 2) decipher.setAAD(aadForCommunity(stored.communityId));
  decipher.setAuthTag(Buffer.from(stored.tokenTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(stored.tokenCipher, 'base64')), decipher.final()]).toString('utf8');
}

export async function moderatorTokenForCommunity(communityId: string): Promise<string> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: {
      moderator: { select: { executorType: true } },
      managedBot: { select: { status: true, communityId: true, tokenCipher: true, tokenIv: true, tokenTag: true, tokenKeyVersion: true } },
    },
  });
  if (community?.moderator?.executorType === 'CUSTOM') {
    if (community.managedBot?.status !== 'ACTIVE') throw new Error('MANAGED_MODERATOR_BOT_NOT_ACTIVE');
    return decryptManagedBotToken(community.managedBot);
  }
  return env.MODERATOR_BOT_TOKEN;
}