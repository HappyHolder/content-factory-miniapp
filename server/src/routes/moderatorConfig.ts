import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { verifyModeratorSession } from '../lib/moderatorSession';
import { DEFAULT_BLOCKS, parseBlocks, requiredRightsFor, type ModeratorBlock } from '../moderator/config';
import { getBotIdFromToken, getChatMember, TelegramApiError } from '../lib/telegramBot';
import { moderatorTokenForCommunity } from '../moderator/managedBotCrypto';

const router = Router();

async function ownedModerator(req: Request, moderatorId: string) {
  const session = verifyModeratorSession(req.headers.authorization);
  const user = await prisma.user.findUnique({ where: { telegramId: session.tgUserId }, select: { id: true, telegramId: true } });
  if (!user) throw new Error('INVALID_AUTH');
  const moderator = await prisma.moderator.findFirst({
    where: { id: moderatorId, community: { channel: { userId: user.id } } },
    include: { community: { include: { moderatorChat: true, managedBot: true, channel: { select: { id: true, handle: true } } } } },
  });
  if (!moderator) throw new Error('NOT_FOUND');
  return { user, moderator };
}

function fail(res: Response, err: unknown): void {
  const code = err instanceof Error ? err.message : '';
  if (code === 'NOT_FOUND') res.status(404).json({ error: 'Moderator not found' });
  else res.status(401).json({ error: 'Invalid Telegram authorization' });
}

router.get('/:moderatorId/draft', async (req: Request, res: Response): Promise<void> => {
  let context;
  try { context = await ownedModerator(req, req.params['moderatorId'] ?? ''); } catch (err) { fail(res, err); return; }
  const draft = await prisma.moderatorConfig.findUnique({
    where: { moderatorId_version: { moderatorId: context.moderator.id, version: context.moderator.draftVersion } },
  });
  res.json({
    moderator: context.moderator,
    draft: draft ?? { version: context.moderator.draftVersion, status: 'DRAFT', blocks: DEFAULT_BLOCKS },
  });
});

router.patch('/:moderatorId/draft', async (req: Request, res: Response): Promise<void> => {
  const { blocks: rawBlocks } = req.body as { blocks?: unknown };
  let context;
  try { context = await ownedModerator(req, req.params['moderatorId'] ?? ''); } catch (err) { fail(res, err); return; }
  let blocks: ModeratorBlock[];
  try { blocks = parseBlocks(rawBlocks); } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid blocks' }); return;
  }
  const existing = await prisma.moderatorConfig.findUnique({ where: { moderatorId_version: { moderatorId: context.moderator.id, version: context.moderator.draftVersion } } });
  const previous = existing ? parseBlocks(existing.blocks) : DEFAULT_BLOCKS;
  const merged = [...previous.filter(old => !blocks.some(next => next.type === old.type)), ...blocks];
  blocks = merged;
  const draft = await prisma.moderatorConfig.upsert({
    where: { moderatorId_version: { moderatorId: context.moderator.id, version: context.moderator.draftVersion } },
    create: { moderatorId: context.moderator.id, version: context.moderator.draftVersion, blocks, createdById: context.user.id },
    update: { blocks },
  });
  await prisma.moderator.update({
    where: { id: context.moderator.id },
    data: { requiredRights: requiredRightsFor(blocks) },
  });
  res.json({ draft });
});

router.post('/:moderatorId/publish', async (req: Request, res: Response): Promise<void> => {
  let context;
  try { context = await ownedModerator(req, req.params['moderatorId'] ?? ''); } catch (err) { fail(res, err); return; }
  const current = await prisma.moderatorConfig.findUnique({
    where: { moderatorId_version: { moderatorId: context.moderator.id, version: context.moderator.draftVersion } },
  });
  if (!current) { res.status(409).json({ error: 'Save the draft before publishing' }); return; }
  let blocks;
  try { blocks = parseBlocks(current.blocks); } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid blocks' }); return;
  }
  const requiredRights = requiredRightsFor(blocks);
  const chat = context.moderator.community.moderatorChat;
  if (!chat) { res.status(409).json({ error: 'Сначала подключите группу обсуждений.' }); return; }
  let granted: Record<string, boolean>;
  try {
    const token = await moderatorTokenForCommunity(context.moderator.communityId);
    const [botRole, userRole] = await Promise.all([
      getChatMember(chat.tgChatId, getBotIdFromToken(token), token),
      getChatMember(chat.tgChatId, Number(context.user.telegramId), token),
    ]);
    if (!['administrator', 'creator'].includes(userRole.status)) { res.status(403).json({ error: 'Вы больше не являетесь администратором этой группы.' }); return; }
    if (!['administrator', 'creator'].includes(botRole.status)) { res.status(409).json({ error: 'Активный бот-исполнитель больше не является администратором группы.' }); return; }
    granted = {
      can_delete_messages: botRole.can_delete_messages === true,
      can_restrict_members: botRole.can_restrict_members === true,
      can_invite_users: botRole.can_invite_users === true,
      can_pin_messages: botRole.can_pin_messages === true,
    };
    await prisma.moderator.update({ where: { id: context.moderator.id }, data: { grantedRights: granted, lastRightsCheckAt: new Date() } });
    if (context.moderator.executorType === 'SHARED') await prisma.moderatorChat.update({ where: { id: chat.id }, data: { grantedRights: granted } });
  } catch (error) {
    res.status(502).json({ error: error instanceof TelegramApiError ? error.message : 'Не удалось безопасно проверить права активного бота.' }); return;
  }
  if (requiredRights.can_restrict_members && granted.can_restrict_members !== true) { res.status(409).json({ error: 'Для включённых функций дайте активному боту право ограничивать участников.' }); return; }
  if (requiredRights.can_delete_messages && granted.can_delete_messages !== true) {
    res.status(409).json({ error: 'Для включённых функций дайте активному боту право удалять сообщения.' });
    return;
  }
    const nextVersion = current.version + 1;
  const result = await prisma.$transaction(async tx => {
    await tx.moderatorConfig.updateMany({ where: { moderatorId: context.moderator.id, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
    const published = await tx.moderatorConfig.update({
      where: { id: current.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    await tx.moderatorConfig.create({
      data: { moderatorId: context.moderator.id, version: nextVersion, status: 'DRAFT', blocks, createdById: context.user.id },
    });
    const moderator = await tx.moderator.update({
      where: { id: context.moderator.id },
      data: {
        status: 'ACTIVE',
        enabled: true,
        publishedVersion: current.version,
        draftVersion: nextVersion,
        requiredRights: requiredRightsFor(blocks),
      },
    });
    return { published, moderator };
  });
  res.json(result);
});

export default router;
