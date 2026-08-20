import { prisma } from '../db';
import { env } from '../env';
import { moderatorTokenForCommunity } from '../moderator/managedBotCrypto';
import { getChatMemberCount } from './telegramBot';

export const CHANNEL_MEMBER_COUNT_TTL_MS = 5 * 60_000;

export type CountableChannel = {
  id: string;
  kind: string;
  tgChatId: string | null;
  handle: string | null;
  telegramMemberCount: number | null;
  memberCountUpdatedAt: Date | null;
  community: { id: string } | null;
};

export type CountableChat = {
  id: string;
  tgChatId: string;
  username: string | null;
  telegramMemberCount: number | null;
  memberCountUpdatedAt: Date | null;
  community: { id: string } | null;
};

export function channelMemberCountIsFresh(channel: Pick<CountableChannel, 'telegramMemberCount' | 'memberCountUpdatedAt'>, now = new Date()): boolean {
  return channel.telegramMemberCount != null
    && channel.memberCountUpdatedAt != null
    && now.getTime() - channel.memberCountUpdatedAt.getTime() < CHANNEL_MEMBER_COUNT_TTL_MS;
}

async function telegramCount(channel: CountableChannel): Promise<number | null> {
  const chatId = channel.tgChatId ?? (channel.handle ? `@${channel.handle}` : null);
  if (!chatId) return null;
  if (channel.kind !== 'CHAT') return getChatMemberCount(chatId, env.TELEGRAM_BOT_TOKEN);

  const moderatorToken = channel.community
    ? await moderatorTokenForCommunity(channel.community.id).catch(() => null)
    : null;
  const viaModerator = moderatorToken ? await getChatMemberCount(chatId, moderatorToken) : null;
  if (viaModerator != null) return viaModerator;
  return getChatMemberCount(chatId, env.TELEGRAM_BOT_TOKEN);
}

/** Refreshes stale counters in parallel; Telegram failures preserve the cache. */
export async function refreshChannelMemberCounts<T extends CountableChannel>(channels: T[], now = new Date()): Promise<T[]> {
  return Promise.all(channels.map(async channel => {
    if (channelMemberCountIsFresh(channel, now)) return channel;
    const count = await telegramCount(channel).catch(() => null);
    if (count == null || !Number.isInteger(count) || count < 0) return channel;
    await prisma.channel.update({
      where: { id: channel.id },
      data: { telegramMemberCount: count, memberCountUpdatedAt: now },
    }).catch(err => console.error('[channel/member-count]', channel.id, (err as Error).message));
    return { ...channel, telegramMemberCount: count, memberCountUpdatedAt: now };
  }));
}

/** Refreshes first-class chat member counters without manufacturing zeroes. */
export async function refreshChatMemberCounts<T extends CountableChat>(chats: T[], now = new Date()): Promise<T[]> {
  return Promise.all(chats.map(async chat => {
    if (channelMemberCountIsFresh(chat, now)) return chat;
    const token = chat.community
      ? await moderatorTokenForCommunity(chat.community.id).catch(() => null)
      : null;
    const count = token
      ? await getChatMemberCount(chat.tgChatId, token).catch(() => null)
      : null;
    const fallback = count ?? await getChatMemberCount(chat.tgChatId, env.TELEGRAM_BOT_TOKEN).catch(() => null);
    if (fallback == null || !Number.isInteger(fallback) || fallback < 0) return chat;
    await prisma.chat.update({
      where: { id: chat.id },
      data: { telegramMemberCount: fallback, memberCountUpdatedAt: now },
    }).catch(err => console.error('[chat/member-count]', chat.id, (err as Error).message));
    return { ...chat, telegramMemberCount: fallback, memberCountUpdatedAt: now };
  }));
}
