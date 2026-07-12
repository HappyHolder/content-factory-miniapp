import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { buildInlineKeyboard, getBotIdFromToken, getChatMember, sendRichMessage, TelegramApiError } from '../lib/telegramBot';
import { blocksToRichHtml, parseInline, type PostBlock } from '../lib/richPost';
import { parseBlocks } from '../moderator/config';

const router = Router();

type TgAdmin = {
  status: string;
  can_delete_messages?: boolean;
  can_restrict_members?: boolean;
  can_invite_users?: boolean;
  can_pin_messages?: boolean;
};

type MyChatMemberUpdate = {
  chat: { id: number; title?: string; username?: string; type: string };
  from?: { id: number };
  new_chat_member: TgAdmin;
};

type ModeratorUpdate = {
  update_id: number;
  my_chat_member?: MyChatMemberUpdate;
  message?: {
    message_id: number;
    chat: { id: number; type?: string };
    from?: { id: number };
    new_chat_members?: { id: number; first_name: string; username?: string; is_bot?: boolean }[];
  };
};

const REQUIRED_BASE_RIGHTS = { can_delete_messages: true, can_restrict_members: true };

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function rightsOf(member: TgAdmin): Record<string, boolean> {
  return {
    can_delete_messages: member.can_delete_messages === true,
    can_restrict_members: member.can_restrict_members === true,
    can_invite_users: member.can_invite_users === true,
    can_pin_messages: member.can_pin_messages === true,
  };
}

async function authenticate(initData: unknown) {
  if (typeof initData !== 'string' || !initData.trim()) throw new Error('INIT_DATA_REQUIRED');
  const parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const user = await prisma.user.findUnique({
    where: { telegramId: String(parsed.user.id) },
    select: { id: true, telegramId: true },
  });
  if (!user) throw new Error('USER_NOT_FOUND');
  return { user, tgUserId: String(parsed.user.id) };
}

function authError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : '';
  if (message === 'INIT_DATA_REQUIRED') res.status(400).json({ error: 'initData is required' });
  else if (message === 'USER_NOT_FOUND') res.status(401).json({ error: 'User not found. Re-open Publium.' });
  else res.status(401).json({ error: 'Invalid Telegram authorization' });
}

// Telegram webhook. Foundation-only: stores chat lifecycle and audit; executes no sanctions.
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const incoming = req.headers['x-telegram-bot-api-secret-token'];
  if (typeof incoming !== 'string' || !safeEqual(incoming, env.MODERATOR_WEBHOOK_SECRET)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const update = req.body as ModeratorUpdate;
  if (!Number.isInteger(update.update_id)) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const joined = update.message?.new_chat_members?.filter(member => !member.is_bot) ?? [];
  if (update.message && joined.length > 0) {
    const updateId = String(update.update_id);
    const community = await prisma.community.findFirst({
      where: { moderatorChat: { tgChatId: String(update.message.chat.id) }, moderator: { enabled: true, publishedVersion: { not: null } } },
      include: { moderator: true },
    });
    if (!community?.moderator?.publishedVersion) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    try {
      await prisma.moderationEvent.create({
        data: {
          communityId: community.id,
          telegramUpdateId: updateId,
          telegramMessageId: update.message.message_id,
          eventType: 'MEMBER_JOINED',
          status: 'RECEIVED',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      console.error('[moderator/welcome] audit create failed:', (err as Error).message);
      res.status(200).json({ ok: true, stored: false });
      return;
    }

    try {
      const config = await prisma.moderatorConfig.findUnique({
        where: { moderatorId_version: { moderatorId: community.moderator.id, version: community.moderator.publishedVersion } },
      });
      const welcome = parseBlocks(config?.blocks ?? []).find(block => block.type === 'welcome' && block.enabled);
      if (!welcome) {
        await prisma.moderationEvent.update({ where: { telegramUpdateId: updateId }, data: { status: 'SKIPPED', reason: 'WELCOME_DISABLED' } });
        res.status(200).json({ ok: true, skipped: true });
        return;
      }
      for (const member of joined) {
        const name = member.first_name.trim().slice(0, 128) || 'участник';
        const text = welcome.text.split('{name}').join(name);
        const blocks: PostBlock[] = [
          ...(welcome.imageUrl ? [{ type: 'image' as const, url: welcome.imageUrl }] : []),
          { type: 'paragraph', runs: parseInline(text) },
        ];
        const keyboard = buildInlineKeyboard((welcome.buttons ?? []).map(button => ({
          label: button.label, buttonLabel: button.label, url: button.url, kind: 'url',
        })));
        await sendRichMessage(update.message.chat.id, blocksToRichHtml(blocks), env.MODERATOR_BOT_TOKEN, keyboard);
      }
      await prisma.moderationEvent.update({
        where: { telegramUpdateId: updateId },
        data: { status: 'PROCESSED', action: 'WELCOME_SENT', metadata: { memberCount: joined.length, blockId: welcome.id } },
      });
      res.status(200).json({ ok: true });
      return;
    } catch (err) {
      console.error('[moderator/welcome] execution failed:', (err as Error).message);
      await prisma.moderationEvent.update({
        where: { telegramUpdateId: updateId },
        data: { status: 'FAILED', reason: (err as Error).message.slice(0, 500) },
      }).catch(() => undefined);
      res.status(200).json({ ok: true, executed: false });
      return;
    }
  }

  // Until more blocks are published, ignore all ordinary chat content.
  if (!update.my_chat_member) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const updateId = String(update.update_id);
  try {
    await prisma.moderationEvent.create({
      data: {
        telegramUpdateId: updateId,
        telegramMessageId: update.message?.message_id,
        tgUserId: update.message?.from?.id ? String(update.message.from.id) : undefined,
        eventType: update.my_chat_member ? 'BOT_MEMBERSHIP_CHANGED' : 'UPDATE_RECEIVED',
        status: 'RECEIVED',
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    console.error('[moderator/webhook] audit create failed:', (err as Error).message);
    res.status(200).json({ ok: true, stored: false });
    return;
  }

  const membership = update.my_chat_member;
  if (membership && ['group', 'supergroup'].includes(membership.chat.type)) {
    const rights = rightsOf(membership.new_chat_member);
    const chat = await prisma.moderatorChat.upsert({
      where: { tgChatId: String(membership.chat.id) },
      create: {
        tgChatId: String(membership.chat.id),
        title: membership.chat.title ?? 'Telegram group',
        username: membership.chat.username ?? null,
        type: membership.chat.type,
        botStatus: membership.new_chat_member.status,
        grantedRights: rights,
        addedByTgId: membership.from?.id ? String(membership.from.id) : null,
        lastUpdateId: updateId,
      },
      update: {
        title: membership.chat.title ?? 'Telegram group',
        username: membership.chat.username ?? null,
        type: membership.chat.type,
        botStatus: membership.new_chat_member.status,
        grantedRights: rights,
        addedByTgId: membership.from?.id ? String(membership.from.id) : undefined,
        lastUpdateId: updateId,
      },
    });
    await prisma.moderationEvent.update({
      where: { telegramUpdateId: updateId },
      data: { status: 'PROCESSED', metadata: { moderatorChatId: chat.id, botStatus: chat.botStatus, rights } },
    });
  }

  res.status(200).json({ ok: true });
});

router.get('/available-chats', async (req: Request, res: Response): Promise<void> => {
  let auth;
  try { auth = await authenticate(req.query['initData']); } catch (err) { authError(res, err); return; }
  const chats = await prisma.moderatorChat.findMany({
    where: {
      addedByTgId: auth.tgUserId,
      botStatus: { in: ['administrator', 'creator', 'member'] },
      community: null,
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, tgChatId: true, title: true, username: true, type: true, botStatus: true, grantedRights: true },
  });
  res.json({ chats });
});

router.get('/channels/:channelId/community', async (req: Request, res: Response): Promise<void> => {
  let auth;
  try { auth = await authenticate(req.query['initData']); } catch (err) { authError(res, err); return; }
  const channel = await prisma.channel.findFirst({ where: { id: req.params['channelId'], userId: auth.user.id }, select: { id: true } });
  if (!channel) { res.status(404).json({ error: 'Channel not found' }); return; }
  const community = await prisma.community.findUnique({
    where: { channelId: channel.id },
    include: { moderatorChat: true, moderator: { include: { configs: { orderBy: { version: 'desc' }, take: 1 } } } },
  });
  res.json({ community, requiredRights: REQUIRED_BASE_RIGHTS, botUsername: env.MODERATOR_BOT_USERNAME });
});

router.post('/channels/:channelId/community', async (req: Request, res: Response): Promise<void> => {
  const { initData, moderatorChatId } = req.body as { initData?: unknown; moderatorChatId?: unknown };
  let auth;
  try { auth = await authenticate(initData); } catch (err) { authError(res, err); return; }
  if (typeof moderatorChatId !== 'string') { res.status(400).json({ error: 'moderatorChatId is required' }); return; }

  const channel = await prisma.channel.findFirst({ where: { id: req.params['channelId'], userId: auth.user.id }, select: { id: true } });
  if (!channel) { res.status(404).json({ error: 'Channel not found' }); return; }
  const chat = await prisma.moderatorChat.findFirst({ where: { id: moderatorChatId, addedByTgId: auth.tgUserId } });
  if (!chat) { res.status(404).json({ error: 'Discussion group not found. Add ModerBot from this Telegram account.' }); return; }

  const token = env.MODERATOR_BOT_TOKEN;
  const botId = getBotIdFromToken(token);
  try {
    const [botMember, userMember] = await Promise.all([
      getChatMember(chat.tgChatId, botId, token),
      getChatMember(chat.tgChatId, Number(auth.tgUserId), token),
    ]);
    if (!['administrator', 'creator'].includes(botMember.status)) {
      res.status(403).json({ error: 'ModerBot must be an administrator of the group.' }); return;
    }
    if (!['administrator', 'creator'].includes(userMember.status)) {
      res.status(403).json({ error: 'Only a group administrator can connect it.' }); return;
    }
  } catch (err) {
    const message = err instanceof TelegramApiError ? err.message : 'Telegram check failed';
    res.status(502).json({ error: message }); return;
  }

  const community = await prisma.$transaction(async tx => {
    const base = await tx.community.upsert({
      where: { channelId: channel.id },
      create: { channelId: channel.id, moderatorChatId: chat.id },
      update: { moderatorChatId: chat.id },
    });
    const moderator = await tx.moderator.upsert({
      where: { communityId: base.id },
      create: { communityId: base.id, requiredRights: REQUIRED_BASE_RIGHTS, grantedRights: chat.grantedRights ?? undefined },
      update: { requiredRights: REQUIRED_BASE_RIGHTS, grantedRights: chat.grantedRights ?? undefined, lastRightsCheckAt: new Date() },
    });
    await tx.moderatorConfig.upsert({
      where: { moderatorId_version: { moderatorId: moderator.id, version: 1 } },
      create: { moderatorId: moderator.id, version: 1, blocks: [], createdById: auth.user.id },
      update: {},
    });
    return tx.community.findUnique({ where: { id: base.id }, include: { moderatorChat: true, moderator: true } });
  });
  res.status(201).json({ community });
});

export default router;
