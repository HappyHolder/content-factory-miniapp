// Thin wrappers over the Telegram Bot API using native fetch (no extra deps).
// All functions throw TelegramApiError on a non-ok response.

const TG_API = 'https://api.telegram.org';

// ─── Response shapes ──────────────────────────────────────────────────────────

interface TgApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  member_count?: number;   // present for channels/supergroups (Bot API ≥ 5.0)
}

export interface TgChatMember {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  user: { id: number; is_bot: boolean; first_name: string };
  // Only present when status === 'administrator' and chat is a channel
  can_post_messages?: boolean;
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class TelegramApiError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the numeric bot ID from a bot token.
 * Token format: "{botId}:{hash}"
 */
export function getBotIdFromToken(token: string): number {
  const id = parseInt(token.split(':')[0]!, 10);
  if (isNaN(id)) throw new Error('Invalid bot token format — cannot derive bot ID');
  return id;
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Fetches chat info for a public channel/supergroup.
 * chatId should be in the form "@username".
 * Throws TelegramApiError if the chat is not found or the request fails.
 */
export async function getChat(chatId: string, token: string): Promise<TgChat> {
  const url = `${TG_API}/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new TelegramApiError(`Network error calling getChat: ${(err as Error).message}`);
  }

  const body = (await res.json()) as TgApiResponse<TgChat>;

  if (!body.ok || !body.result) {
    throw new TelegramApiError(
      body.description ?? 'getChat returned not-ok',
      body.error_code,
    );
  }
  return body.result;
}

/**
 * Resolves a Telegram file_id to its temporary file_path via getFile.
 * The downloadable URL is `${TG_API}/file/bot{token}/{file_path}`.
 * Throws TelegramApiError on a non-ok response or network failure.
 */
export async function getFilePath(fileId: string, token: string): Promise<string> {
  const url = `${TG_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new TelegramApiError(`Network error calling getFile: ${(err as Error).message}`);
  }
  const body = (await res.json()) as TgApiResponse<{ file_path?: string }>;
  if (!body.ok || !body.result?.file_path) {
    throw new TelegramApiError(body.description ?? 'getFile returned no file_path', body.error_code);
  }
  return body.result.file_path;
}

// ─── Inline keyboard ─────────────────────────────────────────────────────────

/**
 * Telegram Bot API inline_keyboard reply_markup.
 * Each row is an array of buttons; we put one button per row for channel posts.
 */
export interface TelegramInlineKeyboard {
  inline_keyboard: { text: string; url: string }[][];
}

/**
 * Inline keyboard with a Web App button — opens the Mini App inside Telegram.
 * Only valid in private chats. Used for the /start welcome message.
 */
export interface TelegramWebAppKeyboard {
  inline_keyboard: { text: string; web_app: { url: string } }[][];
}

export type AnyInlineKeyboard = TelegramInlineKeyboard | TelegramWebAppKeyboard;

/**
 * Sends a plain-text message to a Telegram chat via sendMessage.
 * chatId may be a numeric user/chat ID or a public username string ("@channelname").
 * Pass replyMarkup to attach an inline keyboard (link buttons) to the message.
 * Throws TelegramApiError on a non-ok response or network failure.
 * Never logs the token.
 */
export async function sendBotMessage(
  chatId: number | string,
  text: string,
  token: string,
  replyMarkup?: AnyInlineKeyboard,
): Promise<void> {
  const url = `${TG_API}/bot${token}/sendMessage`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } catch (err) {
    throw new TelegramApiError(`Network error calling sendMessage: ${(err as Error).message}`);
  }

  const body = (await res.json()) as TgApiResponse<unknown>;
  if (!body.ok) {
    throw new TelegramApiError(
      body.description ?? 'sendMessage returned not-ok',
      body.error_code,
    );
  }
}

// ─── Photo caption limit ──────────────────────────────────────────────────────
// Telegram enforces a 1 024-character limit on sendPhoto captions.
// Posts longer than this are truncated to 1 021 chars + "…" rather than
// failing the publish. The full text is not sent in a follow-up message
// (multi-message threading is out of scope for Phase 2 MVP).

const TELEGRAM_CAPTION_LIMIT = 1_024;

/**
 * Truncates post text to fit the Telegram photo caption limit.
 * If the text is within the limit it is returned unchanged.
 */
export function buildPhotoCaption(text: string): string {
  if (text.length <= TELEGRAM_CAPTION_LIMIT) return text;
  return text.slice(0, TELEGRAM_CAPTION_LIMIT - 1) + '…';
}

/**
 * Sends a photo to a Telegram chat via sendPhoto, with an optional caption
 * (truncated to the 1 024-char Telegram limit) and optional inline keyboard.
 * chatId may be a numeric ID or a public username string ("@channelname").
 * Throws TelegramApiError on a non-ok response or network failure.
 * Never logs the token or full caption text.
 */
export async function sendBotPhoto(
  chatId: number | string,
  photoUrl: string,
  caption: string,
  token: string,
  replyMarkup?: AnyInlineKeyboard,
): Promise<void> {
  const url = `${TG_API}/bot${token}/sendPhoto`;
  const safeCaption = buildPhotoCaption(caption);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:  chatId,
        photo:    photoUrl,
        caption:  safeCaption,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } catch (err) {
    throw new TelegramApiError(`Network error calling sendPhoto: ${(err as Error).message}`);
  }

  const body = (await res.json()) as TgApiResponse<unknown>;
  if (!body.ok) {
    throw new TelegramApiError(
      body.description ?? 'sendPhoto returned not-ok',
      body.error_code,
    );
  }
}

/**
 * Sends a local image file as a photo via multipart upload (no public URL needed).
 * Reads the file from disk and uploads the bytes directly to Telegram.
 * Throws TelegramApiError on a non-ok response or network failure.
 */
export async function sendBotPhotoFile(
  chatId: number | string,
  fileBytes: Buffer,
  fileName: string,
  caption: string,
  token: string,
  replyMarkup?: AnyInlineKeyboard,
): Promise<void> {
  const url = `${TG_API}/bot${token}/sendPhoto`;
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', buildPhotoCaption(caption));
  if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
  form.append('photo', new Blob([new Uint8Array(fileBytes)]), fileName);

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: form });
  } catch (err) {
    throw new TelegramApiError(`Network error calling sendPhoto (file): ${(err as Error).message}`);
  }

  const body = (await res.json()) as TgApiResponse<unknown>;
  if (!body.ok) {
    throw new TelegramApiError(body.description ?? 'sendPhoto (file) returned not-ok', body.error_code);
  }
}

// ─── Telegram Stars (XTR) payments ──────────────────────────────────────────

/**
 * Creates a Telegram Stars invoice link (Bot API createInvoiceLink).
 * For Stars: provider_token is empty and currency is "XTR".
 * `amountStars` is the integer number of Stars; `payload` (≤128 bytes) is echoed
 * back in the successful_payment update so we can identify what was bought.
 * Returns the invoice URL to hand to WebApp.openInvoice().
 */
export async function createStarsInvoiceLink(params: {
  title: string;
  description: string;
  payload: string;
  amountStars: number;
  token: string;
}): Promise<string> {
  const { title, description, payload, amountStars, token } = params;
  const url = `${TG_API}/bot${token}/createInvoiceLink`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        payload,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: title, amount: amountStars }],
      }),
    });
  } catch (err) {
    throw new TelegramApiError(`Network error calling createInvoiceLink: ${(err as Error).message}`);
  }
  const body = (await res.json()) as TgApiResponse<string>;
  if (!body.ok || !body.result) {
    throw new TelegramApiError(body.description ?? 'createInvoiceLink returned not-ok', body.error_code);
  }
  return body.result;
}

/** Answers a pre_checkout_query. Telegram requires this within 10s of the query. */
export async function answerPreCheckoutQuery(
  queryId: string,
  ok: boolean,
  token: string,
  errorMessage?: string,
): Promise<void> {
  const url = `${TG_API}/bot${token}/answerPreCheckoutQuery`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pre_checkout_query_id: queryId,
        ok,
        ...(ok ? {} : { error_message: errorMessage ?? 'Payment cannot be processed' }),
      }),
    });
  } catch (err) {
    console.error('[telegramBot] answerPreCheckoutQuery failed:', (err as Error).message);
  }
}

/**
 * Returns the membership/role info for a user in a chat.
 * chatId should be in the form "@username".
 * Throws TelegramApiError if the user is not found or the request fails.
 */
export async function getChatMember(
  chatId: string,
  userId: number,
  token: string,
): Promise<TgChatMember> {
  const url =
    `${TG_API}/bot${token}/getChatMember` +
    `?chat_id=${encodeURIComponent(chatId)}&user_id=${userId}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new TelegramApiError(`Network error calling getChatMember: ${(err as Error).message}`);
  }

  const body = (await res.json()) as TgApiResponse<TgChatMember>;

  if (!body.ok || !body.result) {
    throw new TelegramApiError(
      body.description ?? 'getChatMember returned not-ok',
      body.error_code,
    );
  }
  return body.result;
}
