import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export interface ParsedInitData {
  user: TelegramUser;
  auth_date: number;
  query_id?: string;
  chat_instance?: string;
  chat_type?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

// Maximum age of initData before it is rejected (24 hours).
// Prevents replay attacks with stale tokens.
const MAX_AGE_SECONDS = 86_400;

/**
 * Validates the HMAC signature of Telegram Mini App initData and parses
 * the contained user object.
 *
 * Algorithm per Telegram docs:
 *   1. Remove "hash" from params; sort remaining as "key=value" lines.
 *   2. secret_key = HMAC-SHA256(key="WebAppData", data=botToken)
 *   3. expected = HMAC-SHA256(key=secret_key, data=data_check_string)
 *   4. Compare expected === hash (constant-time).
 *
 * Throws with a descriptive message on any validation failure.
 */
export function validateAndParseTelegramInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; maxFutureSkewSeconds?: number } = {},
): ParsedInitData {
  if (!initData || typeof initData !== 'string') {
    throw new Error('initData must be a non-empty string');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new Error('Missing hash in initData');
  }

  // Build sorted data_check_string (all keys except hash)
  const entries: string[] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') {
      entries.push(`${key}=${value}`);
    }
  });
  entries.sort();
  const dataCheckString = entries.join('\n');

  // Derive secret key from bot token
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // Compute and compare hash (constant-time to prevent timing attacks)
  const expectedHashBuf = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest();
  const providedHashBuf = Buffer.from(hash, 'hex');

  if (
    expectedHashBuf.length !== providedHashBuf.length ||
    !crypto.timingSafeEqual(expectedHashBuf, providedHashBuf)
  ) {
    throw new Error('Invalid initData signature');
  }

  // Reject stale initData
  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) {
    throw new Error('Missing auth_date in initData');
  }
  const authDate = parseInt(authDateRaw, 10);
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  const maxAgeSeconds = options.maxAgeSeconds ?? MAX_AGE_SECONDS;
  const maxFutureSkewSeconds = options.maxFutureSkewSeconds ?? 30;
  if (!Number.isFinite(authDate) || ageSeconds < -maxFutureSkewSeconds) {
    throw new Error('initData auth_date is in the future');
  }
  if (ageSeconds > maxAgeSeconds) {
    throw new Error('initData has expired');
  }

  // Parse user object
  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('Missing user in initData');
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    throw new Error('Invalid user JSON in initData');
  }

  if (!user.id || typeof user.id !== 'number') {
    throw new Error('Missing or invalid user.id in initData');
  }
  if (!user.first_name || typeof user.first_name !== 'string') {
    throw new Error('Missing user.first_name in initData');
  }

  return {
    user,
    auth_date: authDate,
    query_id:      params.get('query_id')      ?? undefined,
    chat_instance: params.get('chat_instance') ?? undefined,
    chat_type:     params.get('chat_type')     ?? undefined,
  };
}
