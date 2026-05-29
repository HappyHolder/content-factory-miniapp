import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { getStickerSet, TelegramApiError } from '../lib/telegramBot';

const router = Router();

// The 7 Channel Style section keys stored as Json? columns in BrandKit.
// Only keys in this list are accepted from the client — unknown keys are ignored.
const VALID_SECTIONS = [
  'channelAbout',
  'voiceProfile',
  'emojiPack',
  'linkKit',
  'visualKit',
  'signature',
  'postRules',
] as const;

// ─── PATCH /api/brandkits/:channelId ─────────────────────────────────────────
// Persists one or more Channel Style sections for the given channel.
// Only the keys present in `sections` are written — other columns are left as-is.
//
// Request body:  { initData: string, sections: Partial<BrandKit sections> }
// Response 200:  { ok: true }
// Response 400:  missing / invalid body, or no recognised section keys
// Response 401:  invalid initData signature, or user not in DB
// Response 403:  channel belongs to a different user
// Response 404:  channel not found in DB
// Response 500:  DB error

router.patch('/:channelId', async (req: Request, res: Response): Promise<void> => {
  const { channelId } = req.params as { channelId: string };
  const { initData, sections } = req.body as {
    initData?: unknown;
    sections?: unknown;
  };

  // ── 1. Basic input validation ─────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' });
    return;
  }
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    res.status(400).json({ error: 'sections must be a non-null object' });
    return;
  }

  // ── 2. Extract only valid section keys, discard everything else ───────────
  const sectionsObj = sections as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};
  for (const key of VALID_SECTIONS) {
    if (key in sectionsObj && sectionsObj[key] !== undefined) {
      updateData[key] = sectionsObj[key];
    }
  }
  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: 'No valid section keys provided' });
    return;
  }

  // ── 3. Validate Telegram initData ────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid initData',
    });
    return;
  }

  // ── 4. Resolve authenticated user ────────────────────────────────────────
  const telegramId = String(parsed.user.id);
  let dbUser: { id: string } | null = null;
  try {
    dbUser = await prisma.user.findUnique({
      where:  { telegramId },
      select: { id: true },
    });
  } catch (err) {
    console.error('[brandkits/patch] User lookup failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' });
    return;
  }

  // ── 5. Find channel and verify ownership ─────────────────────────────────
  let channel: { id: string; userId: string } | null = null;
  try {
    channel = await prisma.channel.findUnique({
      where:  { id: channelId },
      select: { id: true, userId: true },
    });
  } catch (err) {
    console.error('[brandkits/patch] Channel lookup failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!channel) {
    res.status(404).json({ error: 'Channel not found.' });
    return;
  }
  if (channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This channel does not belong to your account.' });
    return;
  }

  // ── 6. Upsert BrandKit — write only the provided sections ────────────────
  // The values are JSON-parsed objects from Express, compatible with Prisma's
  // Json? column type at runtime. `as any` avoids re-typing the generated
  // Prisma input shape for nullable JSON fields.
  try {
    await prisma.brandKit.upsert({
      where:  { channelId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: updateData as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { channelId, ...(updateData as any) },
    });
  } catch (err) {
    console.error('[brandkits/patch] BrandKit upsert failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  res.json({ ok: true });
});

// ─── POST /api/brandkits/resolve-emoji-pack ──────────────────────────────────
//
// Resolves a Telegram emoji pack link into a list of { unicode, customEmojiId }
// entries. The caller merges these into the existing allowedEmojis list and
// then saves the BrandKit via the normal PATCH route.
//
// Only authenticated users may call this (anti-abuse). No DB write happens here.
//
// Request body:  { initData: string, packLink: string }
// Response 200:  { items: { unicode: string, customEmojiId: string }[] }
// Response 400:  missing fields / unparseable pack link
// Response 401:  invalid initData / user not found
// Response 502:  Telegram API error (set not found, network issue, etc.)

/**
 * Extracts the sticker set name from a variety of packLink formats:
 *   https://t.me/addemoji/theopenemojis  →  theopenemojis
 *   http://t.me/addemoji/theopenemojis   →  theopenemojis
 *   t.me/addemoji/theopenemojis          →  theopenemojis
 *   addemoji/theopenemojis               →  theopenemojis
 *   theopenemojis                        →  theopenemojis  (bare name)
 * Returns null when the input cannot be parsed.
 */
function parsePackLinkToSetName(raw: string): string | null {
  const s = raw.trim().replace(/^https?:\/\//i, '');  // strip protocol
  // Match t.me/addemoji/<name> or addemoji/<name>
  const m = s.match(/(?:t\.me\/addemoji\/|addemoji\/)(\w+)/i);
  if (m) return m[1]!;
  // Accept a bare set name: only word characters, no slashes or dots
  if (/^\w+$/.test(s)) return s;
  return null;
}

router.post('/resolve-emoji-pack', async (req: Request, res: Response): Promise<void> => {
  const { initData, packLink } = req.body as {
    initData?: unknown;
    packLink?: unknown;
  };

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' });
    return;
  }
  if (typeof packLink !== 'string' || !packLink.trim()) {
    res.status(400).json({ error: 'packLink is required' });
    return;
  }

  // ── 2. Validate Telegram initData ────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid initData',
    });
    return;
  }

  // ── 3. Confirm user exists (anti-abuse guard) ─────────────────────────────
  const telegramId = String(parsed.user.id);
  let dbUser: { id: string } | null = null;
  try {
    dbUser = await prisma.user.findUnique({
      where:  { telegramId },
      select: { id: true },
    });
  } catch (err) {
    console.error('[brandkits/resolve-emoji-pack] User lookup failed:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' });
    return;
  }

  // ── 4. Parse set name ─────────────────────────────────────────────────────
  const setName = parsePackLinkToSetName(packLink.trim());
  if (!setName) {
    res.status(400).json({
      error: 'Could not parse a sticker set name from the pack link. ' +
             'Expected a t.me/addemoji/… URL or bare set name.',
    });
    return;
  }

  // ── 5. Fetch from Telegram Bot API ───────────────────────────────────────
  let items: { unicode: string; customEmojiId: string }[];
  try {
    items = await getStickerSet(setName, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    const msg = err instanceof TelegramApiError
      ? err.message
      : (err as Error).message ?? 'Telegram API error';
    console.error('[brandkits/resolve-emoji-pack] getStickerSet failed:', msg);
    res.status(502).json({ error: `Telegram API error: ${msg}` });
    return;
  }

  res.json({ items });
});

export default router;
