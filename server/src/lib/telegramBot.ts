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
