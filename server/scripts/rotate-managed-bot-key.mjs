import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const legacySecret = process.env.LEGACY_MANAGED_BOT_KEY ?? '';
const currentSecret = process.env.MANAGED_BOT_ENCRYPTION_KEY ?? '';
if (Buffer.byteLength(legacySecret, 'utf8') < 16) throw new Error('LEGACY_MANAGED_BOT_KEY is missing');
if (Buffer.byteLength(currentSecret, 'utf8') < 32) throw new Error('MANAGED_BOT_ENCRYPTION_KEY must be at least 32 bytes');

const legacyKey = crypto.createHash('sha256').update(legacySecret).digest();
const currentKey = crypto.createHash('sha256').update(currentSecret).digest();
const aad = communityId => Buffer.from(`publium:managed-bot:${communityId}`, 'utf8');
const prisma = new PrismaClient();

try {
  const rows = await prisma.managedModeratorBot.findMany({
    where: { tokenCipher: { not: null }, tokenKeyVersion: { lt: 2 } },
    select: { id: true, communityId: true, tokenCipher: true, tokenIv: true, tokenTag: true },
  });
  for (const row of rows) {
    if (!row.tokenCipher || !row.tokenIv || !row.tokenTag) continue;
    const decipher = crypto.createDecipheriv('aes-256-gcm', legacyKey, Buffer.from(row.tokenIv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.tokenTag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(row.tokenCipher, 'base64')), decipher.final()]);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', currentKey, iv);
    cipher.setAAD(aad(row.communityId));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    plaintext.fill(0);
    await prisma.managedModeratorBot.update({
      where: { id: row.id },
      data: {
        tokenCipher: encrypted.toString('base64'),
        tokenIv: iv.toString('base64'),
        tokenTag: cipher.getAuthTag().toString('base64'),
        tokenKeyVersion: 2,
      },
    });
  }
  console.log(`rotated managed bot tokens: ${rows.length}`);
} finally {
  await prisma.$disconnect();
}