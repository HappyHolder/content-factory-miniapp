import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { DEFAULT_BLOCKS, parseBlocks, requiredRightsFor, type ModeratorBlock } from '../moderator/config';

const router = Router();

async function ownedModerator(initData: unknown, moderatorId: string) {
  if (typeof initData !== 'string' || !initData.trim()) throw new Error('INVALID_AUTH');
  const parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const user = await prisma.user.findUnique({ where: { telegramId: String(parsed.user.id) }, select: { id: true } });
  if (!user) throw new Error('INVALID_AUTH');
  const moderator = await prisma.moderator.findFirst({
    where: { id: moderatorId, community: { channel: { userId: user.id } } },
    include: { community: { include: { moderatorChat: true, channel: { select: { id: true, handle: true } } } } },
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
  try { context = await ownedModerator(req.query['initData'], req.params['moderatorId'] ?? ''); } catch (err) { fail(res, err); return; }
  const draft = await prisma.moderatorConfig.findUnique({
    where: { moderatorId_version: { moderatorId: context.moderator.id, version: context.moderator.draftVersion } },
  });
  res.json({
    moderator: context.moderator,
    draft: draft ?? { version: context.moderator.draftVersion, status: 'DRAFT', blocks: DEFAULT_BLOCKS },
  });
});

router.patch('/:moderatorId/draft', async (req: Request, res: Response): Promise<void> => {
  const { initData, blocks: rawBlocks } = req.body as { initData?: unknown; blocks?: unknown };
  let context;
  try { context = await ownedModerator(initData, req.params['moderatorId'] ?? ''); } catch (err) { fail(res, err); return; }
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
  const { initData } = req.body as { initData?: unknown };
  let context;
  try { context = await ownedModerator(initData, req.params['moderatorId'] ?? ''); } catch (err) { fail(res, err); return; }
  const current = await prisma.moderatorConfig.findUnique({
    where: { moderatorId_version: { moderatorId: context.moderator.id, version: context.moderator.draftVersion } },
  });
  if (!current) { res.status(409).json({ error: 'Save the draft before publishing' }); return; }
  let blocks;
  try { blocks = parseBlocks(current.blocks); } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid blocks' }); return;
  }
  const requiredRights = requiredRightsFor(blocks);
  const granted = (context.moderator.community.moderatorChat?.grantedRights ?? {}) as Record<string, unknown>;
  if (requiredRights.can_restrict_members && granted['can_restrict_members'] !== true) { res.status(409).json({ error: 'Для CAPTCHA дайте ModerBot право ограничивать участников.' }); return; }
  if (requiredRights.can_delete_messages && granted['can_delete_messages'] !== true) {
    res.status(409).json({ error: 'Для автоудаления дайте ModerBot право удалять сообщения.' });
    return; // MISSING_DELETE_RIGHT
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
