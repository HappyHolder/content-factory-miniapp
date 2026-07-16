import crypto from 'crypto';

/**
 * AES-256-GCM encryption for GramJS string sessions, mirroring the audited
 * managed-bot token scheme: same key, per-community AAD so a session ciphertext
 * cannot be transplanted to another community. Sessions never leave the backend.
 */

type EncryptedSession = { sessionCipher: string; sessionIv: string; sessionTag: string; sessionKeyVersion: number };
type StoredSession = {
  communityId: string;
  sessionCipher: string | null;
  sessionIv: string | null;
  sessionTag: string | null;
  sessionKeyVersion?: number;
};

const CURRENT_KEY_VERSION = 1;
let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) {
    // Lazy import so env validation errors surface at call time, not module load.
    const { env } = require('../env') as typeof import('../env');
    cachedKey = crypto.createHash('sha256').update(env.MANAGED_BOT_ENCRYPTION_KEY).digest();
  }
  return cachedKey;
}
const aad = (communityId: string) => Buffer.from(`publium:persona-session:${communityId}`, 'utf8');

export function encryptPersonaSession(session: string, communityId: string): EncryptedSession {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(aad(communityId));
  const encrypted = Buffer.concat([cipher.update(session, 'utf8'), cipher.final()]);
  return {
    sessionCipher: encrypted.toString('base64'),
    sessionIv: iv.toString('base64'),
    sessionTag: cipher.getAuthTag().toString('base64'),
    sessionKeyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptPersonaSession(stored: StoredSession): string {
  if (!stored.sessionCipher || !stored.sessionIv || !stored.sessionTag) throw new Error('PERSONA_SESSION_MISSING');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(stored.sessionIv, 'base64'));
  decipher.setAAD(aad(stored.communityId));
  decipher.setAuthTag(Buffer.from(stored.sessionTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(stored.sessionCipher, 'base64')), decipher.final()]).toString('utf8');
}
