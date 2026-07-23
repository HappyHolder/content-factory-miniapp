import crypto from 'crypto';

export type CachedInlineResult = Record<string, unknown>;

interface InlineShareEntry {
  ownerTelegramId: string;
  result: CachedInlineResult;
  expiresAt: number;
}

const INLINE_SHARE_TTL_MS = 10 * 60 * 1000;
const INLINE_SHARE_MAX_ENTRIES = 500;
const INLINE_SHARE_PREFIX = 'publium_';
const inlineShares = new Map<string, InlineShareEntry>();

function pruneInlineShares(now = Date.now()): void {
  for (const [query, entry] of inlineShares) {
    if (entry.expiresAt <= now) inlineShares.delete(query);
  }
  while (inlineShares.size >= INLINE_SHARE_MAX_ENTRIES) {
    const oldest = inlineShares.keys().next().value as string | undefined;
    if (!oldest) break;
    inlineShares.delete(oldest);
  }
}

export function createInlineShare(ownerTelegramId: number | string, result: CachedInlineResult): string {
  pruneInlineShares();
  const query = `${INLINE_SHARE_PREFIX}${crypto.randomBytes(18).toString('base64url')}`;
  inlineShares.set(query, {
    ownerTelegramId: String(ownerTelegramId),
    result,
    expiresAt: Date.now() + INLINE_SHARE_TTL_MS,
  });
  return query;
}

export function resolveInlineShare(query: string, requesterTelegramId: number | string): CachedInlineResult | null {
  pruneInlineShares();
  const entry = inlineShares.get(query.trim());
  if (!entry || entry.ownerTelegramId !== String(requesterTelegramId)) return null;
  return entry.result;
}
