// Thin wrappers over the Telegram Bot API using native fetch (no extra deps).
// All functions throw TelegramApiError on a non-ok response.

import { env } from '../env';
import { blocksToRichHtml, blocksToPlainText, documentBlocks, firstImage, type PostBlock } from './richPost';
import { deleteObject, readObject } from './storage';

const TG_API = 'https://api.telegram.org';

// ─── Response shapes ──────────────────────────────────────────────────────────

interface TgApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/** Reference to a message the bot sent — kept so the post can be edited in place. */
export interface SentMessageRef {
  chatId:    number;
  messageId: number;
}

/** Extracts { chatId, messageId } from a Telegram sendX result, or null. */
function parseSentRef(result: unknown): SentMessageRef | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as { message_id?: number; chat?: { id?: number } };
  if (typeof r.message_id !== 'number' || typeof r.chat?.id !== 'number') return null;
  return { messageId: r.message_id, chatId: r.chat.id };
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
 * A single inline-keyboard button. A button is either a URL button or a
 * copy-to-clipboard button (`copy_text`). `style` recolors it — Bot API 10.1
 * accepts only `primary` | `success` | `danger` (verified live; `web_app`
 * buttons are rejected in channel posts, so they're intentionally absent here).
 */
export interface TelegramInlineButton {
  text: string;
  url?: string;
  callback_data?: string;
  copy_text?: { text: string };
  style?: 'primary' | 'success' | 'danger';
}

/**
 * Telegram Bot API inline_keyboard reply_markup. Each inner array is a row, so
 * multiple buttons per row form a grid.
 */
export interface TelegramInlineKeyboard {
  inline_keyboard: TelegramInlineButton[][];
}

/**
 * Inline keyboard with a Web App button — opens the Mini App inside Telegram.
 * Only valid in private chats. Used for the /start welcome message.
 */
export interface TelegramWebAppKeyboard {
  inline_keyboard: { text: string; web_app: { url: string } }[][];
}

export type AnyInlineKeyboard = TelegramInlineKeyboard | TelegramWebAppKeyboard;

const VALID_BUTTON_STYLES = new Set(['primary', 'success', 'danger']);

/**
 * Normalizes a stored button target into a Telegram-valid URL:
 *   "@handle" → "https://t.me/handle"; "http(s)://…" → unchanged; else null.
 */
function normalizeButtonUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const u = raw.trim();
  if (!u) return null;
  if (u.startsWith('https://') || u.startsWith('http://')) return u;
  if (u.startsWith('@')) return `https://t.me/${u.slice(1)}`;
  return null;
}

/**
 * Builds an inline-keyboard reply_markup from the post's stored linkButtons
 * (LinkItem-shaped JSON). Supports URL and copy-to-clipboard (`kind: 'copy'`)
 * buttons, per-button `style`, and row grouping (`sameRow: true` joins the
 * previous row into a grid). Invalid/empty buttons are skipped; returns
 * undefined when nothing valid remains.
 */
export function buildInlineKeyboard(linkButtons: unknown): TelegramInlineKeyboard | undefined {
  if (!Array.isArray(linkButtons) || linkButtons.length === 0) return undefined;

  const rows: TelegramInlineButton[][] = [];
  for (const raw of linkButtons as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue;

    const labelText = String(raw['buttonLabel'] || raw['label'] || '').trim();
    let button: TelegramInlineButton | null = null;

    if (raw['kind'] === 'copy') {
      const copyText = typeof raw['copyText'] === 'string' ? raw['copyText'].trim() : '';
      if (!copyText) continue;
      button = { text: labelText || copyText, copy_text: { text: copyText.slice(0, 256) } };
    } else {
      const url = normalizeButtonUrl(raw['url']);
      if (!url) continue;
      button = { text: labelText || url, url };
    }

    const styleRaw = typeof raw['style'] === 'string' ? raw['style'] : '';
    if (VALID_BUTTON_STYLES.has(styleRaw)) button.style = styleRaw as TelegramInlineButton['style'];

    if (raw['sameRow'] === true && rows.length > 0) {
      rows[rows.length - 1]!.push(button);
    } else {
      rows.push([button]);
    }
  }

  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

/**
 * Saves a prepared inline message (Bot API `savePreparedInlineMessage`) so the
 * user can send a post via the native Telegram share dialog — no channel
 * connection or bot-admin rights required (the "Fast Share" onboarding flow).
 *
 * Carries the same content as a normal publish: rich HTML (block posts) or plain
 * HTML text (legacy posts), plus the inline keyboard. Returns the prepared-message
 * id (passed to the Mini App's WebApp.shareMessage) and its expiry (unix seconds).
 */
export async function savePreparedPostMessage(params: {
  userId:       number | string;
  title:        string;
  html?:        string;
  text?:        string;
  replyMarkup?: TelegramInlineKeyboard;
  token:        string;
}): Promise<{ id: string; expirationDate: number }> {
  const { userId, title, html, text, replyMarkup, token } = params;

  const inputMessageContent = html && html.trim()
    ? { rich_message: { html } }
    : { message_text: (text && text.trim()) || title || ' ', parse_mode: 'HTML' };

  const result: Record<string, unknown> = {
    type:  'article',
    id:    'post',
    title: title || 'Post',
    input_message_content: inputMessageContent,
  };
  if (replyMarkup) result['reply_markup'] = replyMarkup;

  const url = `${TG_API}/bot${token}/savePreparedInlineMessage`;
  let res: Response;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id:             userId,
        result,
        allow_user_chats:    true,
        allow_group_chats:   true,
        allow_channel_chats: true,
      }),
    });
  } catch (err) {
    throw new TelegramApiError(`Network error calling savePreparedInlineMessage: ${(err as Error).message}`);
  }

  const body = (await res.json()) as TgApiResponse<{ id: string; expiration_date: number }>;
  if (!body.ok || !body.result) {
    throw new TelegramApiError(body.description ?? 'savePreparedInlineMessage returned not-ok', body.error_code);
  }
  return { id: body.result.id, expirationDate: body.result.expiration_date };
}

/**
 * Telegram Bot API LinkPreviewOptions (Bot API ≥ 7.0). Lets us attach a large
 * preview card (our OG page → cover image) to a plain text message and place it
 * above the text. `url` need not appear in the text itself.
 */
export interface LinkPreviewOptions {
  url:                  string;
  prefer_large_media?:  boolean;
  show_above_text?:     boolean;
  is_disabled?:         boolean;
}

/**
 * Sends a plain-text message to a Telegram chat via sendMessage.
 * chatId may be a numeric user/chat ID or a public username string ("@channelname").
 * Pass replyMarkup to attach an inline keyboard (link buttons) to the message.
 * Pass linkPreview to render a preview card (e.g. the cover as a large preview).
 * Throws TelegramApiError on a non-ok response or network failure.
 * Never logs the token.
 */
export async function sendBotMessage(
  chatId: number | string,
  text: string,
  token: string,
  replyMarkup?: AnyInlineKeyboard,
  linkPreview?: LinkPreviewOptions,
): Promise<SentMessageRef | null> {
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
        ...(linkPreview ? { link_preview_options: linkPreview } : {}),
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
  return parseSentRef(body.result);
}

// ─── Telegram length limits ─────────────────────────────────────────────────
// sendPhoto caption ≤ 1 024 chars; sendMessage text ≤ 4 096 chars.
// Short posts ride along as a photo caption (native attached image). Longer
// posts are sent as a full text message with the cover shown as a large
// link-preview card (see sendChannelPost), so no content is lost.

const TELEGRAM_CAPTION_LIMIT = 1_024;
const TELEGRAM_MESSAGE_LIMIT = 4_096;

/**
 * Truncates post text to fit the Telegram photo caption limit.
 * If the text is within the limit it is returned unchanged.
 */
export function buildPhotoCaption(text: string): string {
  if (text.length <= TELEGRAM_CAPTION_LIMIT) return text;
  return text.slice(0, TELEGRAM_CAPTION_LIMIT - 1) + '…';
}

/** Truncates post text to the Telegram sendMessage limit (4 096 chars). */
export function buildMessageText(text: string): string {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) return text;
  return text.slice(0, TELEGRAM_MESSAGE_LIMIT - 1) + '…';
}

/**
 * Builds the public URL of our OG preview page for a given cover image. Telegram
 * fetches this page, reads its og:image (the cover) and renders a large preview
 * card. Keyed by the cover URL so each post gets a unique, non-stale preview.
 */
export function buildOgPageUrl(imageUrl: string, title?: string, siteName?: string): string {
  const params = new URLSearchParams({ i: imageUrl });
  if (title && title.trim())    params.set('t', title.trim().slice(0, 200));
  // siteName → og:site_name → the preview's accent header shows the channel,
  // not our domain. Omit to fall back to the host (publium.ru).
  if (siteName && siteName.trim()) params.set('s', siteName.trim().slice(0, 120));
  return `${env.PUBLIC_BASE_URL}/api/og?${params.toString()}`;
}

/**
 * Publishes a post to a channel, choosing the right Telegram method:
 *   • cover + text ≤ 1024  → sendPhoto with the text as caption (native photo)
 *   • cover + text > 1024  → sendMessage with full text + the cover as a large
 *                            link-preview card above it (no content truncated)
 *   • no cover             → plain sendMessage
 * Throws TelegramApiError on failure (callers handle retry / status).
 */
export async function sendChannelPost(params: {
  chatId:      number | string;
  text:        string;
  bannerUrl:   string | null;
  title?:      string;
  /** Channel name/handle — shown as the preview's header instead of our domain. */
  siteName?:   string;
  token:       string;
  replyMarkup?: AnyInlineKeyboard;
}): Promise<SentMessageRef | null> {
  const { chatId, text, bannerUrl, title, siteName, token, replyMarkup } = params;

  if (bannerUrl && text.length <= TELEGRAM_CAPTION_LIMIT) {
    return await sendBotPhoto(chatId, bannerUrl, text, token, replyMarkup);
  }

  const linkPreview: LinkPreviewOptions | undefined = bannerUrl
    ? { url: buildOgPageUrl(bannerUrl, title, siteName), prefer_large_media: true, show_above_text: true }
    : undefined;

  return await sendBotMessage(chatId, buildMessageText(text), token, replyMarkup, linkPreview);
}

// ─── Rich Messages (Bot API 10.1) ───────────────────────────────────────────
// sendRichMessage takes structured rich content as an HTML string in
// rich_message.html. Telegram parses it into native blocks (headings, tables,
// lists, expandable quotes, slideshow/collage galleries…). See memory
// telegram-rich-messages for the verified tag set.

/**
 * Low-level sendRichMessage call. `html` is the rendered Rich Message HTML.
 * Throws TelegramApiError on a non-ok response (caller decides on fallback).
 */
export async function sendRichMessage(
  chatId: number | string,
  html: string,
  token: string,
  replyMarkup?: AnyInlineKeyboard,
): Promise<SentMessageRef | null> {
  const url = `${TG_API}/bot${token}/sendRichMessage`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:      chatId,
        rich_message: { html },
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } catch (err) {
    throw new TelegramApiError(`Network error calling sendRichMessage: ${(err as Error).message}`);
  }
  const body = (await res.json()) as TgApiResponse<unknown>;
  if (!body.ok) {
    throw new TelegramApiError(body.description ?? 'sendRichMessage returned not-ok', body.error_code);
  }
  return parseSentRef(body.result);
}

/**
 * Edits an already-published channel message in place — the 5-hour "fix a typo"
 * re-publish window. Formatted posts re-render as `rich_message` HTML (verified
 * supported by editMessageText); legacy posts as plain text. Link buttons are
 * refreshed too. A "message is not modified" response is treated as success.
 * Throws TelegramApiError on any real failure (caller surfaces it).
 */
export async function editChannelPost(params: {
  chatId:       number | string;
  messageId:    number;
  blocks:       PostBlock[] | null;
  text?:        string;
  replyMarkup?: AnyInlineKeyboard;
  token:        string;
}): Promise<void> {
  const { chatId, messageId, blocks, text, replyMarkup, token } = params;

  const payload: Record<string, unknown> = {
    chat_id:    chatId,
    message_id: messageId,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };
  if (blocks) payload['rich_message'] = { html: blocksToRichHtml(blocks) };
  else        payload['text'] = buildMessageText(text ?? '');

  const url = `${TG_API}/bot${token}/editMessageText`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new TelegramApiError(`Network error calling editMessageText: ${(err as Error).message}`);
  }
  const body = (await res.json()) as TgApiResponse<unknown>;
  if (!body.ok) {
    // Editing to identical content is a no-op success, not an error.
    if ((body.description ?? '').includes('message is not modified')) return;
    throw new TelegramApiError(body.description ?? 'editMessageText returned not-ok', body.error_code);
  }
}

/**
 * Publishes a structured (formatted) post to a channel via sendRichMessage.
 * On ANY rich failure it falls back to the legacy plain publish (flattened text
 * + first image as a preview card) so a post is never lost.
 */
export async function sendRichChannelPost(params: {
  chatId:       number | string;
  blocks:       PostBlock[];
  token:        string;
  title?:       string;
  siteName?:    string;
  replyMarkup?: AnyInlineKeyboard;
}): Promise<SentMessageRef | null> {
  const { chatId, blocks, token, title, siteName, replyMarkup } = params;
  const html = blocksToRichHtml(blocks);
  const docs = documentBlocks(blocks);

  // Docs-only post: no text to send, just the attachments.
  if (!html.trim() && docs.length > 0) {
    await sendChannelDocuments(chatId, docs, token);
    return null;
  }

  let ref: SentMessageRef | null = null;
  try {
    ref = await sendRichMessage(chatId, html, token, replyMarkup);
  } catch (err) {
    console.warn('[telegramBot] sendRichMessage failed, falling back to plain:', (err as Error).message);
    ref = await sendChannelPost({
      chatId,
      text:      blocksToPlainText(blocks),
      bannerUrl: firstImage(blocks),
      title,
      siteName,
      token,
      replyMarkup,
    });
  }

  await sendChannelDocuments(chatId, docs, token);
  return ref;
}

/**
 * Sends the post's document attachments after the main message.
 *
 * Best-effort by design: a failed attachment is logged and skipped, never
 * thrown. The main post has already been delivered at this point, so throwing
 * would make the scheduler treat the whole post as unpublished and re-send it
 * on the next sweep — duplicating it in the channel. Once Telegram has fetched
 * a file, the local copy is deleted (we don't keep uploaded files around).
 */
async function sendChannelDocuments(
  chatId: number | string,
  docs: { url: string; name: string }[],
  token: string,
): Promise<void> {
  for (const doc of docs) {
    try {
      await sendBotDocument(chatId, doc.url, doc.name, token);
      await deleteObject(doc.url); // Telegram has it now — drop our copy.
    } catch (err) {
      console.error(`[telegramBot] sendDocument failed for "${doc.name}":`, (err as Error).message);
    }
  }
}


/**
 * Sends a document attachment to a Telegram chat via sendDocument.
 *
 * The file bytes are read from local storage and uploaded as multipart form data
 * (not passed as a URL). Sending by URL fails for uploaded HTML/SVG, which the
 * edge server serves as `text/plain` with `Content-Disposition: attachment` to
 * neutralize stored XSS — Telegram then rejects the fetch ("wrong type of the
 * web page content"). Uploading the raw bytes sidesteps that entirely.
 */
export async function sendBotDocument(
  chatId: number | string,
  documentUrl: string,
  fileName: string,
  token: string,
): Promise<void> {
  const bytes = await readObject(documentUrl);
  if (!bytes) {
    throw new TelegramApiError(`Document file not found in storage: ${documentUrl}`);
  }

  const url = `${TG_API}/bot${token}/sendDocument`;
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', fileName.slice(0, 1024));
  form.append('document', new Blob([new Uint8Array(bytes)]), fileName);

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: form });
  } catch (err) {
    throw new TelegramApiError(`Network error calling sendDocument: ${(err as Error).message}`);
  }

  const body = (await res.json()) as TgApiResponse<unknown>;
  if (!body.ok) {
    throw new TelegramApiError(body.description ?? 'sendDocument returned not-ok', body.error_code);
  }
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
): Promise<SentMessageRef | null> {
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
  return parseSentRef(body.result);
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

export async function telegramAction(method:string,payload:Record<string,unknown>,token:string):Promise<void>{const r=await fetch(`${TG_API}/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const b=await r.json() as TgApiResponse<unknown>;if(!b.ok)throw new TelegramApiError(b.description??method+' failed',b.error_code);}
export const restrictChatUser=(chatId:number|string,userId:number,restricted:boolean,token:string)=>telegramAction('restrictChatMember',{chat_id:chatId,user_id:userId,permissions:restricted?{can_send_messages:false}:{can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true,can_change_info:true,can_invite_users:true,can_pin_messages:true,can_manage_topics:true}},token);
export const kickChatUser=async(chatId:number|string,userId:number,token:string)=>{await telegramAction('banChatMember',{chat_id:chatId,user_id:userId,revoke_messages:true},token);await telegramAction('unbanChatMember',{chat_id:chatId,user_id:userId,only_if_banned:true},token);};
export const answerBotCallback=(id:string,text:string,token:string)=>telegramAction('answerCallbackQuery',{callback_query_id:id,text},token);

/** Deletes a message sent in, or a service message from, a managed group. */
export async function deleteBotMessage(chatId: number | string, messageId: number, token: string): Promise<void> {
  const url = `${TG_API}/bot${token}/deleteMessage`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: messageId }) });
  } catch (err) {
    throw new TelegramApiError(`Network error calling deleteMessage: ${(err as Error).message}`);
  }
  const body = (await res.json()) as TgApiResponse<unknown>;
  if (!body.ok) throw new TelegramApiError(body.description ?? 'deleteMessage returned not-ok', body.error_code);
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
