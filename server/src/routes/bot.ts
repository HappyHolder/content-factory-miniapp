import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { sendBotMessage, sendBotPhoto, TelegramWebAppKeyboard } from '../lib/telegramBot';
import { createDraftPostForChannel } from '../lib/draftGenerator';
import { isPostsLimitReached, applyMonthlyQuotaReset } from '../lib/subscriptionLimits';

// ─── /start welcome ─────────────────────────────────────────────────────────
const WELCOME_TEXT =
  '👋 Content Factory — твоя AI-фабрика контента.\n\n' +
  'Кидаешь идею или пересылаешь пост с другого канала → получаешь 3 варианта ' +
  'оригинального поста с обложкой → публикуешь в канал в пару тапов.\n\nНачнём?';

/**
 * Sends the /start welcome: image (if configured) + caption + a Web App button
 * that opens the Mini App. Falls back to a plain message if no image/app URL set.
 */
async function sendWelcome(chatId: number): Promise<void> {
  const keyboard: TelegramWebAppKeyboard | undefined = env.MINI_APP_URL
    ? { inline_keyboard: [[{ text: '🚀 Открыть приложение', web_app: { url: env.MINI_APP_URL } }]] }
    : undefined;
  try {
    if (env.WELCOME_IMAGE_URL) {
      await sendBotPhoto(chatId, env.WELCOME_IMAGE_URL, WELCOME_TEXT, env.TELEGRAM_BOT_TOKEN, keyboard);
    } else {
      await sendBotMessage(chatId, WELCOME_TEXT, env.TELEGRAM_BOT_TOKEN, keyboard);
    }
  } catch (err) {
    console.error('[bot/webhook] sendWelcome failed:', (err as Error).message);
  }
}

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
  // text-only messages
  text?: string;
  entities?: TgMessageEntity[];
  // photo / video / document captions
  caption?: string;
  caption_entities?: TgMessageEntity[];
  // forwarded messages carry a forward_date field
  forward_date?: number;
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
//          Returns 401 if missing or wrong — the only non-200 response allowed
//          (Telegram stops retrying a 401).
//
// All valid bot-update paths return 200 so Telegram does not retry.
// User-facing errors are communicated via bot replies, not HTTP status codes.
//
// Happy path:
//   1. Validate secret token header.
//   2. Parse Update — ignore non-message, missing from, empty source text.
//   3. Resolve User by message.from.id (telegramId).
//   4. Resolve user's first Channel (ordered by createdAt asc).
//   5. Classify SourceType (URL or TEXT), extract URL if present.
//   6. Persist SourceInput.
//   7. Auto-generate draft via DeepSeek + Channel Style (non-fatal).
//   8. Reply to user and return 200.

router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  // ── 1. Authenticate the request ──────────────────────────────────────────
  const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (incomingSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
    // 401 tells Telegram this endpoint rejected the delivery → no endless retry.
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

  // Accept both plain text messages and photo/video/document captions.
  const sourceText     = message.text ?? message.caption ?? '';
  const sourceEntities = message.entities ?? message.caption_entities ?? [];

  if (!sourceText.trim()) {
    await trySendReply(chatId, 'For now, send text or a link.');
    res.status(200).json({ ok: true });
    return;
  }

  // ── /start → welcome message with Open-app button ────────────────────────
  if (sourceText.trim().toLowerCase().startsWith('/start')) {
    await sendWelcome(chatId);
    res.status(200).json({ ok: true });
    return;
  }

  const telegramId = String(message.from.id);

  // ── 3. Resolve authenticated user ────────────────────────────────────────
  let dbUser: { id: string; activeChannelId: string | null } | null = null;
  try {
    dbUser = await prisma.user.findUnique({
      where:  { telegramId },
      select: { id: true, activeChannelId: true },
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
      orderBy: { createdAt: 'asc' },
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

  // Priority: activeChannelId from DB → channel with most recent post → most recently created channel
  let targetChannel = dbUser.activeChannelId
    ? channels.find(c => c.id === dbUser!.activeChannelId)
    : undefined;

  if (!targetChannel) {
    // Find channel with the most recently created post
    try {
      const recentPost = await prisma.generatedPost.findFirst({
        where:   { channel: { userId: dbUser.id } },
        orderBy: { createdAt: 'desc' },
        select:  { channelId: true },
      });
      if (recentPost) {
        targetChannel = channels.find(c => c.id === recentPost.channelId);
      }
    } catch { /* non-fatal */ }
  }

  // Last resort: most recently created channel
  if (!targetChannel) {
    targetChannel = channels[channels.length - 1]!;
  }

  console.log(`[bot/webhook] activeChannelId=${dbUser.activeChannelId ?? 'null'} allChannels=${channels.map(c => c.handle ?? c.name).join(',')} → using=${targetChannel.handle ?? targetChannel.name}`);

  // ── 5. Classify source and extract URL ───────────────────────────────────
  const sourceIsUrl  = isUrlSource(sourceText, sourceEntities);
  const extractedUrl = sourceIsUrl ? extractFirstUrl(sourceText, sourceEntities) : null;

  // ── 6. Persist SourceInput (idempotent via telegramMessageId) ───────────
  // Check for duplicate before inserting to handle Telegram retries.
  let alreadyProcessed = false;
  try {
    const existing = await prisma.sourceInput.findFirst({
      where: {
        userId: dbUser.id,
        metadata: { path: ['telegramMessageId'], equals: message.message_id },
      },
      select: { id: true },
    });
    if (existing) {
      alreadyProcessed = true;
    } else {
      await prisma.sourceInput.create({
        data: {
          userId:  dbUser.id,
          type:    sourceIsUrl ? 'URL' : 'TEXT',
          content: sourceText,
          url:     extractedUrl ?? null,
          metadata: {
            telegramMessageId: message.message_id,
            telegramChatId:    chatId,
            source:            'telegram_bot',
            channelId:         targetChannel.id,
            hasCaption:        message.caption !== undefined,
            isForwarded:       message.forward_date !== undefined,
          },
        },
      });
    }
  } catch (err) {
    console.error('[bot/webhook] SourceInput create failed:', (err as Error).message);
    res.status(200).json({ ok: true });
    return;
  }

  if (alreadyProcessed) {
    res.status(200).json({ ok: true });
    return;
  }

  // ── 7. Return 200 immediately so Telegram doesn't retry ─────────────────
  // Draft generation (DeepSeek call) runs in the background after the response.
  res.status(200).json({ ok: true });

  // ── 8. Generate draft and notify user asynchronously ─────────────────────
  (async () => {
    // Check bot-posts quota before generating (with lazy monthly reset)
    const rawSub = await prisma.subscription.findUnique({
      where:  { userId: dbUser.id },
      select: { aiPostsLimit: true, aiPostsUsed: true, aiCreatesLimit: true, aiCreatesUsed: true, quotaResetAt: true },
    }).catch(() => null);

    const userSub = rawSub
      ? await applyMonthlyQuotaReset({ userId: dbUser.id, ...rawSub })
      : null;

    if (userSub && isPostsLimitReached(userSub.aiPostsUsed, userSub.aiPostsLimit)) {
      await trySendReply(chatId, `⚠️ You've reached your monthly bot-post limit (${userSub.aiPostsLimit}). Upgrade your plan in the Mini App.`);
      return;
    }

    let draftCreated = false;
    try {
      await createDraftPostForChannel({
        channelId:  targetChannel.id,
        input:      sourceText,
        sourceType: extractedUrl ? 'link' : 'prompt',
        sourceUrl:  extractedUrl ?? null,
      });
      draftCreated = true;
    } catch (err) {
      console.error('[bot/webhook] Draft generation failed:', (err as Error).message);
    }

    if (draftCreated && userSub) {
      prisma.subscription.update({
        where: { userId: dbUser.id },
        data:  { aiPostsUsed: { increment: 1 } },
      }).catch(err => console.error('[bot/webhook] Usage increment failed:', (err as Error).message));
    }

    const reply = draftCreated
      ? '✅ Draft created. Open the Mini App to review and publish.'
      : '✅ Source saved, but draft generation failed. Open the Mini App to generate manually.';

    await trySendReply(chatId, reply);
  })();
});

export default router;
