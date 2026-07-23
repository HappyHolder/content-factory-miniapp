/**
 * accountService.ts
 *
 * The ONLY place GramJS (MTProto user accounts) is touched. Wraps the phone→code
 * →2FA login and the runtime actions a persona performs from its own account:
 * send message (with a human "typing" delay), set a reaction, update profile,
 * join the community chat. Sessions are encrypted at rest (personaCrypto).
 *
 * Isolated from Moderator and Community Manager — nothing there imports this.
 */

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { computeCheck } from 'telegram/Password';
import { env } from '../env';

export const communityCoreEnabled = () => env.TELEGRAM_API_ID > 0 && Boolean(env.TELEGRAM_API_HASH);

const clientOpts = { connectionRetries: 3, useWSS: false, autoReconnect: true } as const;

async function makeClient(session: string): Promise<TelegramClient> {
  if (!communityCoreEnabled()) throw new Error('COMMUNITY_CORE_NOT_CONFIGURED');
  const client = new TelegramClient(new StringSession(session), env.TELEGRAM_API_ID, env.TELEGRAM_API_HASH, clientOpts);
  await client.connect();
  return client;
}

export type LoginStart = { phoneCodeHash: string; tempSession: string };

/** Step 1: request the login code for a phone number. Returns transient state. */
export async function startLogin(phone: string): Promise<LoginStart> {
  const client = await makeClient('');
  try {
    const result = await client.sendCode({ apiId: env.TELEGRAM_API_ID, apiHash: env.TELEGRAM_API_HASH }, phone);
    return { phoneCodeHash: result.phoneCodeHash, tempSession: (client.session.save() as unknown as string) || '' };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

export type LoginResult =
  | { status: 'DONE'; session: string; tgUserId: string; username: string | null }
  | { status: 'PASSWORD_NEEDED'; tempSession: string; hint: string };

/** Step 2: submit the code. May return PASSWORD_NEEDED for 2FA accounts. */
export async function confirmCode(tempSession: string, phone: string, phoneCodeHash: string, code: string): Promise<LoginResult> {
  const client = await makeClient(tempSession);
  try {
    try {
      await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
    } catch (err) {
      if ((err as Error).message?.includes('SESSION_PASSWORD_NEEDED')) {
        let hint = '';
        try { const pwd = await client.invoke(new Api.account.GetPassword()); hint = pwd.hint ?? ''; } catch { /* hint is optional */ }
        return { status: 'PASSWORD_NEEDED', tempSession: (client.session.save() as unknown as string) || tempSession, hint };
      }
      throw err;
    }
    return await finishLogin(client);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Step 3 (only for 2FA accounts): submit the cloud password. */
export async function confirmPassword(tempSession: string, password: string): Promise<LoginResult> {
  const client = await makeClient(tempSession);
  try {
    const pwd = await client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(pwd, password);
    await client.invoke(new Api.auth.CheckPassword({ password: check }));
    return await finishLogin(client);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

async function finishLogin(client: TelegramClient): Promise<LoginResult> {
  const me = await client.getMe();
  const user = me as Api.User;
  return {
    status: 'DONE',
    session: (client.session.save() as unknown as string) || '',
    tgUserId: String(user.id),
    username: user.username ?? null,
  };
}

/** Runs a callback with a connected client from a stored session, always cleaning up. */
export async function withPersonaClient<T>(session: string, fn: (client: TelegramClient) => Promise<T>): Promise<T> {
  const client = await makeClient(session);
  try {
    return await fn(client);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Sends one message with a human-scaled "typing" delay, optionally as a reply. */
export interface HumanPacing {
  /** Length of the message being answered — you read a long text longer than "ок". */
  incomingLength?: number;
  /** Allow the occasional "I was away and saw it later" delay. Off for follow-up
   *  parts of one burst (a person sends those right after the first). */
  allowDistraction?: boolean;
}

/**
 * Sends a message with human pacing: read → think → type. Timing is derived from
 * how much there was to read and how much is being written, and a real person is
 * sometimes simply away — so the delay is genuinely variable, not a fixed 2–14s
 * band (that uniformity is itself a bot tell).
 */
export async function sendHumanMessage(client: TelegramClient, chatId: string, text: string, replyTo?: number, pacing?: HumanPacing): Promise<number | null> {
  const entity = await client.getInputEntity(chatId);

  // 1. Read & think — scales with the incoming message, no typing indicator yet.
  const incoming = Math.max(0, pacing?.incomingLength ?? 0);
  const readMs = 1500 + Math.min(7000, incoming * 22) + Math.random() * 2500; // ~1.5–11s
  // 2. Sometimes a person just isn't at the phone and answers noticeably later.
  const distracted = pacing?.allowDistraction !== false && Math.random() < 0.25
    ? 25_000 + Math.random() * 155_000 // 25s–3min
    : 0;
  await sleep(readMs + distracted);

  // 3. Typing — ~14 chars/sec with jitter; long replies genuinely take longer,
  //    so no tight cap. Telegram's indicator expires after ~6s, so re-send it.
  const typingMs = Math.min(26_000, Math.max(900, (text.length / 14) * 1000 * (0.6 + Math.random() * 0.8)));
  const deadline = Date.now() + typingMs;
  while (Date.now() < deadline) {
    await client.invoke(new Api.messages.SetTyping({ peer: entity, action: new Api.SendMessageTypingAction() })).catch(() => undefined);
    await sleep(Math.min(4500, Math.max(0, deadline - Date.now())));
  }

  const sent = await client.sendMessage(entity, { message: text, ...(replyTo ? { replyTo } : {}) });
  return typeof sent?.id === 'number' ? sent.id : null;
}

/** Adds a single emoji reaction after a human "noticed it" pause — usually a few
 *  seconds, occasionally much later (you scroll back and tap it). */
export async function reactToMessage(client: TelegramClient, chatId: string, messageId: number, emoji: string): Promise<void> {
  const entity = await client.getInputEntity(chatId);
  const late = Math.random() < 0.15 ? 20_000 + Math.random() * 70_000 : 0; // 20–90s
  await sleep(1500 + Math.random() * 8000 + late);
  await client.invoke(new Api.messages.SendReaction({
    peer: entity,
    msgId: messageId,
    reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
  }));
}

/** Applies the persona's public identity to the connected account's profile. */
export async function updateProfile(client: TelegramClient, opts: { firstName?: string; lastName?: string; about?: string }): Promise<void> {
  await client.invoke(new Api.account.UpdateProfile({
    firstName: opts.firstName?.slice(0, 64),
    lastName: opts.lastName?.slice(0, 64),
    about: opts.about?.slice(0, 70),
  }));
}

/** Joins the account to the community's discussion group by @username or invite. */
export async function joinChat(client: TelegramClient, chat: string): Promise<void> {
  const invite = chat.match(/(?:t\.me\/\+|joinchat\/)([\w-]+)/i)?.[1];
  if (invite) {
    await client.invoke(new Api.messages.ImportChatInvite({ hash: invite }));
    return;
  }
  const entity = await client.getInputEntity(chat.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, ''));
  await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
}
