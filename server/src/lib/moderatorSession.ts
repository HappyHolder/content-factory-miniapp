import crypto from 'crypto';
import { env } from '../env';

const SESSION_TTL_SECONDS = 30 * 60;
const sessionKey = crypto
  .createHmac('sha256', env.TELEGRAM_WEBHOOK_SECRET)
  .update('publium:moderator-session:v1')
  .digest();

type ModeratorSessionPayload = {
  v: 1;
  tgUserId: string;
  iat: number;
  exp: number;
  nonce: string;
};

const encode = (value: Buffer | string) => Buffer.from(value).toString('base64url');
const sign = (payload: string) => crypto.createHmac('sha256', sessionKey).update(payload).digest('base64url');

export function issueModeratorSession(tgUserId: string): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const payload: ModeratorSessionPayload = {
    v: 1,
    tgUserId,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    nonce: crypto.randomBytes(12).toString('base64url'),
  };
  const encoded = encode(JSON.stringify(payload));
  return { token: encoded + '.' + sign(encoded), expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export function verifyModeratorSession(authorization: unknown): ModeratorSessionPayload {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) throw new Error('SESSION_REQUIRED');
  const token = authorization.slice(7).trim();
  const [encoded, provided] = token.split('.');
  if (!encoded || !provided) throw new Error('SESSION_INVALID');
  const expected = sign(encoded);
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('SESSION_INVALID');
  let payload: ModeratorSessionPayload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ModeratorSessionPayload; }
  catch { throw new Error('SESSION_INVALID'); }
  const now = Math.floor(Date.now() / 1000);
  if (payload.v !== 1 || typeof payload.tgUserId !== 'string' || !/^\d+$/.test(payload.tgUserId)) throw new Error('SESSION_INVALID');
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.iat > now + 30 || payload.exp <= now || payload.exp - payload.iat > SESSION_TTL_SECONDS) throw new Error('SESSION_EXPIRED');
  return payload;
}
