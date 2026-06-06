import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import fs from 'fs';
import path from 'path';
import { sendBotMessage, sendBotPhoto, sendBotPhotoFile, answerPreCheckoutQuery, TelegramWebAppKeyboard } from '../lib/telegramBot';
import { createDraftPostForChannel, type DraftPost } from '../lib/draftGenerator';
import { isPostsLimitReached, applyMonthlyQuotaReset, canUseHtmlCovers } from '../lib/subscriptionLimits';
import { isPaidTier, grantSubscription } from '../lib/payments';
import { fetchArticle } from '../lib/urlContentExtractor';
import { extractImageContent } from '../lib/visionExtractor';

// ─── /start welcome ─────────────────────────────────────────────────────────
const WELCOME_TEXT =
  '👋 Content Factory — твоя AI-фабрика контента.\n\n' +
  'Кидаешь идею или пересылаешь пост с другого канала → получаешь 3 варианта ' +
  'оригинального поста с обложкой → публикуешь в канал в пару тапов.\n\nНачнём?';

// Welcome image bundled in the repo. Drop welcome.png (or .jpg) into assets/
// and it just works — no hosting/URL needed (sent as a direct file upload).
const WELCOME_IMAGE_CANDIDATES = ['welcome.png', 'welcome.jpg', 'welcome.jpeg'];

// Search several base dirs so it resolves regardless of the runtime cwd:
//  - __dirname is dist/routes (prod) or src/routes (tsx dev) → ../../assets = server/assets
//  - process.cwd() may be server/ or the repo root depending on the host
const WELCOME_IMAGE_BASES = [
  path.resolve(__dirname, '../../assets'),       // server/assets from dist|src/routes
  path.resolve(process.cwd(), 'assets'),         // cwd = server/
  path.resolve(process.cwd(), 'server/assets'),  // cwd = repo root
];

function findWelcomeImage(): string | null {
  for (const base of WELCOME_IMAGE_BASES) {
    for (const name of WELCOME_IMAGE_CANDIDATES) {
      const p = path.join(base, name);
      if (fs.existsSync(p)) return p;
    }
  }
  console.warn('[bot/webhook] welcome image not found. Checked bases:', WELCOME_IMAGE_BASES.join(' | '));
  return null;
}

/**
 * Sends the /start welcome: the bundled image (if present) + caption + an
 * optional Web App button. Falls back to a plain text message if no image file.
 */
async function sendWelcome(chatId: number): Promise<void> {
  const keyboard: TelegramWebAppKeyboard | undefined = env.MINI_APP_URL
    ? { inline_keyboard: [[{ text: '🚀 Открыть приложение', web_app: { url: env.MINI_APP_URL } }]] }
    : undefined;
  try {
    const imagePath = findWelcomeImage();
    if (imagePath) {
      const bytes = await fs.promises.readFile(imagePath);
      await sendBotPhotoFile(chatId, bytes, path.basename(imagePath), WELCOME_TEXT, env.TELEGRAM_BOT_TOKEN, keyboard);
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
  // attached photo sizes (ascending order; last element is the largest)
  photo?: { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }[];
  // forwarded messages carry a forward_date field
  forward_date?: number;
  // Telegram Stars payment confirmation
  successful_payment?: {
    currency: string;
    total_amount: number;
    invoice_payload: string;
    telegram_payment_charge_id?: string;
  };
}

interface TgPreCheckoutQuery {
  id: string;
  from?: { id: number };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TgMessage;
  pre_checkout_query?: TgPreCheckoutQuery;
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

/** An "Open the app" Web App button, or undefined when MINI_APP_URL is unset. */
function openAppKeyboard(label = '🚀 Открыть приложение'): TelegramWebAppKeyboard | undefined {
  return env.MINI_APP_URL
    ? { inline_keyboard: [[{ text: label, web_app: { url: env.MINI_APP_URL } }]] }
    : undefined;
}

/**
 * Rich "draft ready" notification: sends the generated cover as a preview image
 * (when available) with a localized caption and an "Open & review" button, so
 * the user jumps straight into the Mini App. Falls back to a text message when
 * there's no cover, and to a "generate manually" note when generation failed.
 */
async function sendDraftNotification(chatId: number, draft: DraftPost | null): Promise<void> {
  const keyboard = openAppKeyboard('🚀 Открыть и проверить');
  try {
    if (!draft) {
      await sendBotMessage(
        chatId,
        '✅ Источник сохранён, но черновик не сгенерировался. Открой приложение и сгенерируй вручную.',
        env.TELEGRAM_BOT_TOKEN,
        keyboard,
      );
      return;
    }

    const rawTitle = draft.title?.trim();
    const title    = rawTitle ? `«${rawTitle.length > 80 ? rawTitle.slice(0, 79) + '…' : rawTitle}»` : 'новый пост';
    const caption  = `✅ Черновик готов: ${title}\n\nОткрой приложение, чтобы проверить и опубликовать.`;
    const cover    = draft.variants?.find(v => v.bannerUrl)?.bannerUrl ?? null;

    if (cover) {
      await sendBotPhoto(chatId, cover, caption, env.TELEGRAM_BOT_TOKEN, keyboard);
    } else {
      await sendBotMessage(chatId, caption, env.TELEGRAM_BOT_TOKEN, keyboard);
    }
  } catch (err) {
    console.error('[bot/webhook] sendDraftNotification failed:', (err as Error).message);
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

  // ── Stars payments: pre-checkout must be answered within 10s ─────────────
  if (update.pre_checkout_query) {
    await answerPreCheckoutQuery(update.pre_checkout_query.id, true, env.TELEGRAM_BOT_TOKEN);
    res.status(200).json({ ok: true });
    return;
  }

  // ── Stars payments: successful_payment is the authoritative grant ────────
  if (update.message?.successful_payment) {
    const pay = update.message.successful_payment;
    const payChatId = update.message.chat.id;
    if (pay.currency === 'XTR') {
      try {
        const data = JSON.parse(pay.invoice_payload) as { t?: string; tier?: unknown; uid?: string };
        if (data.t === 'sub' && isPaidTier(data.tier) && typeof data.uid === 'string') {
          // Idempotency: record the charge first. Telegram may deliver the same
          // successful_payment more than once; the unique chargeId stops a repeat
          // delivery from re-granting (which would reset usage + push expiry forward).
          // Fail-open: only a unique-constraint violation (P2002) means "already
          // processed". Any other error (e.g. table not migrated yet) logs and still
          // grants, so payments are never blocked by this guard.
          let alreadyProcessed = false;
          const chargeId = pay.telegram_payment_charge_id;
          if (chargeId) {
            try {
              await prisma.starsPayment.create({
                data: { chargeId, userId: data.uid, tier: data.tier, amountStars: pay.total_amount },
              });
            } catch (e) {
              if ((e as { code?: string })?.code === 'P2002') {
                alreadyProcessed = true;
              } else {
                console.error('[bot/webhook] StarsPayment record failed (continuing to grant):', (e as Error).message);
              }
            }
          }
          if (!alreadyProcessed) {
            await grantSubscription(data.uid, data.tier);
            await trySendReply(payChatId, `✅ Оплата получена. Тариф ${data.tier} активирован на 30 дней. Открой приложение.`);
          }
        }
      } catch (err) {
        console.error('[bot/webhook] successful_payment grant failed:', (err as Error).message);
      }
    }
    res.status(200).json({ ok: true });
    return;
  }

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
  // Largest available size of an attached photo (if any).
  const photoFileId    = message.photo && message.photo.length > 0
    ? message.photo[message.photo.length - 1]!.file_id
    : null;

  if (!sourceText.trim() && !photoFileId) {
    await trySendReply(chatId, 'Пришли текст, ссылку или фото — сделаю пост.');
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
          type:    photoFileId ? 'PROMPT' : (sourceIsUrl ? 'URL' : 'TEXT'),
          content: sourceText || (photoFileId ? '[photo]' : ''),
          url:     extractedUrl ?? null,
          metadata: {
            telegramMessageId: message.message_id,
            telegramChatId:    chatId,
            source:            'telegram_bot',
            channelId:         targetChannel.id,
            hasCaption:        message.caption !== undefined,
            hasPhoto:          !!photoFileId,
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
      select: { tier: true, aiPostsLimit: true, aiPostsUsed: true, aiCreatesLimit: true, aiCreatesUsed: true, quotaResetAt: true },
    }).catch(() => null);

    const userSub = rawSub
      ? await applyMonthlyQuotaReset({ userId: dbUser.id, ...rawSub })
      : null;
    // HTML covers are a paid feature; unknown tier (no row) → don't block.
    const allowHtmlCovers = rawSub ? canUseHtmlCovers(rawSub.tier) : true;

    if (userSub && isPostsLimitReached(userSub.aiPostsUsed, userSub.aiPostsLimit)) {
      try {
        await sendBotMessage(
          chatId,
          `⚠️ Достигнут месячный лимит постов через бота (${userSub.aiPostsLimit}). Повысь тариф в приложении.`,
          env.TELEGRAM_BOT_TOKEN,
          openAppKeyboard('⭐ Тарифы'),
        );
      } catch (err) {
        console.error('[bot/webhook] quota notice failed:', (err as Error).message);
      }
      return;
    }

    // For link sources, fetch the page and extract the real article text so the
    // AI rewrites actual content instead of just seeing a bare URL. Any failure
    // falls back to the original message text — generation never blocks on this.
    let genInput = sourceText;
    if (photoFileId) {
      // Read the photo (OCR + scene) and feed it into generation.
      try {
        const extracted = await extractImageContent(photoFileId);
        if (extracted) genInput = sourceText.trim() ? `${sourceText.trim()}\n\n${extracted}` : extracted;
      } catch (err) {
        console.error('[bot/webhook] Image extraction failed (using caption):', (err as Error).message);
      }
    } else if (extractedUrl) {
      try {
        const article = await fetchArticle(extractedUrl);
        if (article?.text) {
          const commentary = sourceText.replace(extractedUrl, '').trim();
          genInput = commentary ? `${commentary}\n\n${article.text}` : article.text;
        }
      } catch (err) {
        console.error('[bot/webhook] Article extraction failed (using raw text):', (err as Error).message);
      }
    }

    // Nothing usable (e.g. a photo we couldn't read and no caption) → don't
    // produce an empty draft; tell the user instead.
    if (!genInput.trim()) {
      await sendDraftNotification(chatId, null);
      return;
    }

    let draft: DraftPost | null = null;
    try {
      draft = await createDraftPostForChannel({
        channelId:  targetChannel.id,
        input:      genInput,
        sourceType: photoFileId ? 'photo' : (extractedUrl ? 'link' : 'prompt'),
        sourceUrl:  extractedUrl ?? null,
        allowHtmlCovers,
      });
    } catch (err) {
      console.error('[bot/webhook] Draft generation failed:', (err as Error).message);
    }

    if (draft && userSub) {
      prisma.subscription.update({
        where: { userId: dbUser.id },
        data:  { aiPostsUsed: { increment: 1 } },
      }).catch(err => console.error('[bot/webhook] Usage increment failed:', (err as Error).message));
    }

    // Rich notification: cover preview + "Open & review" button (localized).
    await sendDraftNotification(chatId, draft);
  })();
});

export default router;
