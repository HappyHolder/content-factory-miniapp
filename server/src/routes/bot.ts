import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { sendBotMessage } from '../lib/telegramBot';

const router = Router();

// ─── Telegram Update types (only the fields we use) ──────────────────────────

interface TgMessageEntity {
  type: string;   // 'url', 'text_link', 'mention', etc.
  offset: number;
  length: number;
  url?: string;   // present when type === 'text_link'
}

interface TgMessage {
  message_id: number;
  from?: {
    id: number;
    first_name: string;
    username?: string;
    is_bot?: boolean;
  };
  chat: { id: number };
  text?: string;
  entities?: TgMessageEntity[];
}

interface TelegramUpdate {
  update_id: number;
  message?: TgMessage;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the first URL from a message.
 * Checks entities (type 'url' → slice from text; type 'text_link' → entity.url)
 * then falls back to a simple regex on the text itself.
 */
function extractFirstUrl(text: string, entities?: TgMessageEntity[]): string | null {
  if (entities) {
    for (const entity of entities) {
      if (entity.type === 'text_link' && entity.url) {
        return entity.url;
      }
      if (entity.type === 'url') {
        return text.slice(entity.offset, entity.offset + entity.length);
      }
    }
  }
  // Fallback: plain text starts with http(s)
  const match = /https?:\/\/\S+/i.exec(text);
  return match ? match[0] : null;
}

/**
 * Returns true if the message should be classified as SourceType URL.
 */
function isUrlSource(text: string, entities?: TgMessageEntity[]): boolean {
  if (entities?.some(e => e.type === 'url' || e.type === 'text_link')) return true;
  return /^https?:\/\//i.test(text.trim());
}

/**
 * Silently attempts to send a bot reply.
 * Logs a safe error string on failure — never logs the token or initData.
 */
async function trySendReply(chatId: number, text: string): Promise<void> {
  try {
    await sendBotMessage(chatId, text, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    console.error('[bot/webhook] sendMessage failed:', (err as Error).message);
  }
}

// ─── POST /api/bot/webhook ────────────────────────────────────────────────────
//
// Receives Telegram Update objects sent by Telegram's servers.
//
// Auth:    X-Telegram-Bot-Api-Secret-Token header (set via setWebhook secret_token).
//          Returns 401 if missing or wrong — this is the only non-200 response
//          allowed (we want Telegram to stop retrying a malformed/spoofed request).
//
// All valid bot-update paths return 200 so Telegram does not retry.
// User-facing errors are communicated via bot replies, not HTTP status codes.
//
// Happy path:
//   1. Validate secret token header.
//   2. Parse Update — ignore non-message, missing from, missing text (with 200).
//   3. Resolve User by message.from.id (telegramId).
//   4. Resolve user's first Channel (ordered by createdAt asc).
//   5. Detect SourceType (URL or TEXT), extract URL if present.
//   6. Persist SourceInput.
//   7. Reply to user and return 200.

router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  // ── 1. Authenticate the request ──────────────────────────────────────────
  const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (incomingSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
    // 401 is intentional here — tells Telegram this endpoint rejected the
    // delivery. Telegram will not endlessly retry a 401.
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // ── 2. Parse the Update ──────────────────────────────────────────────────
  const update = req.body as TelegramUpdate;

  // Ignore non-message updates (channel_post, callback_query, etc.)
  if (!update.message) {
    res.status(200).json({ ok: true });
    return;
  }

  const message = update.message;
  const chatId  = message.chat.id;

  // Ignore messages with no sender (e.g. anonymous channel posts forwarded to a group)
  if (!message.from) {
    res.status(200).json({ ok: true });
    return;
  }

  // Ignore non-text messages (stickers, photos, voice, etc.)
  // Optionally send a gentle nudge so the user knows what to do.
  if (!message.text) {
    await trySendReply(chatId, 'For now, send text or a link.');
    res.status(200).json({ ok: true });
    return;
  }

  const text       = message.text;
  const telegramId = String(message.from.id);

  // ── 3. Resolve authenticated user ────────────────────────────────────────
  let dbUser: { id: string } | null = null;
  try {
    dbUser = await prisma.user.findUnique({
      where:  { telegramId },
      select: { id: true },
    });
  } catch (err) {
    console.error('[bot/webhook] User lookup failed:', (err as Error).message);
    // DB error — return 200 so Telegram doesn't retry; no reply to user
    res.status(200).json({ ok: true });
    return;
  }

  if (!dbUser) {
    await trySendReply(chatId, 'Open the Mini App first to connect your account.');
    res.status(200).json({ ok: true });
    return;
  }

  // ── 4. Resolve user's channels ───────────────────────────────────────────
  let channels: { id: string; name: string; handle: string | null }[] = [];
  try {
    channels = await prisma.channel.findMany({
      where:   { userId: dbUser.id },
      orderBy: { createdAt: 'asc' },   // oldest first = default channel, consistent with auth.ts
      select:  { id: true, name: true, handle: true },
    });
  } catch (err) {
    console.error('[bot/webhook] Channel lookup failed:', (err as Error).message);
    res.status(200).json({ ok: true });
    return;
  }

  if (channels.length === 0) {
    await trySendReply(chatId, 'Connect a Telegram channel in the Mini App first.');
    res.status(200).json({ ok: true });
    return;
  }

  // MVP: use first channel only. Multi-channel selection is Phase D.
  const targetChannel = channels[0]!;

  // ── 5. Classify source and extract URL ───────────────────────────────────
  const sourceIsUrl  = isUrlSource(text, message.entities);
  const extractedUrl = sourceIsUrl ? extractFirstUrl(text, message.entities) : null;

  // ── 6. Persist SourceInput ───────────────────────────────────────────────
  try {
    await prisma.sourceInput.create({
      data: {
        userId:  dbUser.id,
        type:    sourceIsUrl ? 'URL' : 'TEXT',
        content: text,
        url:     extractedUrl ?? null,
        metadata: {
          telegramMessageId: message.message_id,
          telegramChatId:    chatId,
          source:            'telegram_bot',
          channelId:         targetChannel.id,
        },
      },
    });
  } catch (err) {
    console.error('[bot/webhook] SourceInput create failed:', (err as Error).message);
    // Non-fatal from Telegram's perspective — return 200, no reply (DB error is internal)
    res.status(200).json({ ok: true });
    return;
  }

  // ── 7. Confirm to the user and return ────────────────────────────────────
  await trySendReply(chatId, '✅ Source saved. Open the Mini App to generate a post.');
  res.status(200).json({ ok: true });
});

export default router;
