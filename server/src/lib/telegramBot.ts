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

// ─── Inline keyboard ─────────────────────────────────────────────────────────

/**
 * Telegram Bot API inline_keyboard reply_markup.
 * Each row is an array of buttons; we put one button per row for channel posts.
 */
export interface TelegramInlineKeyboard {
  inline_keyboard: { text: string; url: string }[][];
}

// ─── Message entities ─────────────────────────────────────────────────────────

/**
 * Telegram Bot API MessageEntity.
 * https://core.telegram.org/bots/api#messageentity
 *
 * offset and length are in UTF-16 code units (not JavaScript character count).
 * Emoji outside the BMP (e.g. 🚀 U+1F680) are 2 UTF-16 code units each.
 *
 * Fields used per type:
 *   custom_emoji   → type, offset, length, custom_emoji_id (required)
 *   text_link      → type, offset, length, url (required)
 *   text_mention   → type, offset, length, user (required)
 *   pre            → type, offset, length, language (optional)
 *   bold/italic/…  → type, offset, length only
 */
export interface TelegramMessageEntity {
  type:              string;
  offset:            number;
  length:            number;
  custom_emoji_id?:  string;   // required when type === 'custom_emoji'
  url?:              string;   // required when type === 'text_link'
  user?:             unknown;  // required when type === 'text_mention'
  language?:         string;   // optional when type === 'pre'
}

/**
 * Sends a plain-text message to a Telegram chat via sendMessage.
 * chatId may be a numeric user/chat ID or a public username string ("@channelname").
 * Pass replyMarkup to attach an inline keyboard (link buttons) to the message.
 * Pass entities to attach Telegram MessageEntity annotations (e.g. custom emoji).
 * Throws TelegramApiError on a non-ok response or network failure.
 * Never logs the token.
 *
 * Backward compatible: existing call sites that pass only (chatId, text, token)
 * or (chatId, text, token, replyMarkup) are unaffected — entities defaults to
 * undefined and is omitted from the request body when absent or empty.
 */
export async function sendBotMessage(
  chatId: number | string,
  text: string,
  token: string,
  replyMarkup?: TelegramInlineKeyboard,
  entities?: TelegramMessageEntity[],
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
        ...(replyMarkup                                  ? { reply_markup: replyMarkup } : {}),
        ...(Array.isArray(entities) && entities.length > 0 ? { entities }                : {}),
      }),
    });
  } catch (err) {
    throw new TelegramApiError(`Network error calling sendMessage: ${(err as Error).message}`);
  }

  const body = (await res.json()) as TgApiResponse<{ entities?: { type: string; custom_emoji_id?: string }[] }>;
  if (!body.ok) {
    throw new TelegramApiError(
      body.description ?? 'sendMessage returned not-ok',
      body.error_code,
    );
  }

  // ── DEBUG (temporary — remove after custom emoji diagnosis) ──────────────
  const echoedEntities = body.result?.entities ?? [];
  const customEmojiCount = echoedEntities.filter(e => e.type === 'custom_emoji').length;
  console.log(
    `[debug/sendMessage] Telegram echoed entities: total=${echoedEntities.length}, ` +
    `custom_emoji=${customEmojiCount}, ` +
    `types=[${echoedEntities.map(e => e.type).join(',')}]`
  );
  // ── END DEBUG ─────────────────────────────────────────────────────────────
}

// ─── Sticker / custom emoji set ───────────────────────────────────────────────

/**
 * Fetches a Telegram sticker set by name and returns only the entries that
 * carry a custom_emoji_id — suitable for populating emojiPack allowedEmojis.
 *
 * Set name is the last path segment of a t.me/addemoji/<name> link.
 * Throws TelegramApiError when the set is not found or the request fails.
 * Never logs the token.
 */
export async function getStickerSet(
  setName: string,
  token: string,
): Promise<{ unicode: string; customEmojiId: string }[]> {
  const url = `${TG_API}/bot${token}/getStickerSet?name=${encodeURIComponent(setName)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new TelegramApiError(`Network error calling getStickerSet: ${(err as Error).message}`);
  }

  const body = (await res.json()) as TgApiResponse<{
    stickers: { emoji?: string; custom_emoji_id?: string }[];
  }>;
  if (!body.ok || !body.result) {
    throw new TelegramApiError(
      body.description ?? 'getStickerSet returned not-ok',
      body.error_code,
    );
  }

  return body.result.stickers
    .filter((s): s is { emoji: string; custom_emoji_id: string } =>
      typeof s.emoji === 'string'           && s.emoji.length > 0 &&
      typeof s.custom_emoji_id === 'string' && s.custom_emoji_id.length > 0
    )
    .map(s => ({ unicode: s.emoji, customEmojiId: s.custom_emoji_id }));
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
