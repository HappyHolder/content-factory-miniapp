import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { answerBotCallback, buildInlineKeyboard, deleteBotMessage, getBotIdFromToken, getChatMember, restrictChatUser, sendBotMessage, sendRichMessage, TelegramApiError, type TelegramInlineKeyboard } from '../lib/telegramBot';
import { blocksToRichHtml, parseInline, type PostBlock } from '../lib/richPost';
import { parseBlocks, type AntiSpamBlock, type CaptchaBlock, type WelcomeBlock } from '../moderator/config';

const router = Router();
type TgAdmin = { status: string; can_delete_messages?: boolean; can_restrict_members?: boolean; can_invite_users?: boolean; can_pin_messages?: boolean };
type TgUser = { id: number; first_name: string; username?: string; is_bot?: boolean };
type TgEntity = { type: string; offset: number; length: number; url?: string };
type TgMessage = { message_id: number; chat: { id: number; title?: string; username?: string; type?: string }; from?: TgUser; text?: string; caption?: string; entities?: TgEntity[]; caption_entities?: TgEntity[]; new_chat_members?: TgUser[] };
type MyChatMemberUpdate = { chat: { id: number; title?: string; username?: string; type: string }; from?: { id: number }; new_chat_member: TgAdmin };
type CallbackQuery = { id: string; from: TgUser; data?: string; message?: TgMessage };
type ModeratorUpdate = { update_id: number; my_chat_member?: MyChatMemberUpdate; message?: TgMessage; callback_query?: CallbackQuery };
const REQUIRED_BASE_RIGHTS = { can_delete_messages: true, can_restrict_members: true };

const safeEqual = (a: string, b: string) => Boolean(a && b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)));
const rightsOf = (m: TgAdmin): Record<string, boolean> => ({ can_delete_messages: m.can_delete_messages === true, can_restrict_members: m.can_restrict_members === true, can_invite_users: m.can_invite_users === true, can_pin_messages: m.can_pin_messages === true });
const adminCache = new Map<string, { value: boolean; expiresAt: number }>();
async function isAdminCached(chatId: number, userId: number): Promise<boolean> {
  const key = chatId + ':' + userId, cached = adminCache.get(key), now = Date.now(); if (cached && cached.expiresAt > now) return cached.value;
  const role = await getChatMember(String(chatId), userId, env.MODERATOR_BOT_TOKEN).catch(() => null); const value = role ? ['administrator', 'creator'].includes(role.status) : true; adminCache.set(key, { value, expiresAt: now + 5 * 60_000 });
  if (adminCache.size > 5000) for (const [k, v] of adminCache) if (v.expiresAt <= now) adminCache.delete(k); return value;
}

const variables = (text: string, member: TgUser, group: string, channel: string, rules = '') => text.replace(/\{(name|username|group|channel|rules)\}/g, (_, key: string) => ({ name: member.first_name || 'участник', username: member.username ? `@${member.username}` : member.first_name, group, channel, rules }[key] ?? ''));

async function authenticate(initData: unknown) {
  if (typeof initData !== 'string' || !initData.trim()) throw new Error('INIT_DATA_REQUIRED');
  const parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  const user = await prisma.user.findUnique({ where: { telegramId: String(parsed.user.id) }, select: { id: true, telegramId: true } });
  if (!user) throw new Error('USER_NOT_FOUND');
  return { user, tgUserId: String(parsed.user.id) };
}
function authError(res: Response, err: unknown) { const m = err instanceof Error ? err.message : ''; if (m === 'INIT_DATA_REQUIRED') res.status(400).json({ error: 'initData is required' }); else if (m === 'USER_NOT_FOUND') res.status(401).json({ error: 'User not found. Re-open Publium.' }); else res.status(401).json({ error: 'Invalid Telegram authorization' }); }

async function publishedContext(tgChatId: string) {
  const community = await prisma.community.findFirst({ where: { moderatorChat: { tgChatId }, moderator: { enabled: true, publishedVersion: { not: null } } }, include: { moderatorChat: true, channel: { select: { name: true, handle: true } }, moderator: true } });
  if (!community?.moderator?.publishedVersion) return null;
  const config = await prisma.moderatorConfig.findUnique({ where: { moderatorId_version: { moderatorId: community.moderator.id, version: community.moderator.publishedVersion } } });
  const blocks = parseBlocks(config?.blocks ?? []);
  return { community, welcome: blocks.find(b => b.type === 'welcome' && b.enabled) as WelcomeBlock | undefined, captcha: blocks.find(b => b.type === 'captcha' && b.enabled) as CaptchaBlock | undefined, antiSpam: blocks.find(b => b.type === 'antispam' && b.enabled) as AntiSpamBlock | undefined };
}

async function sendWelcome(ctx: NonNullable<Awaited<ReturnType<typeof publishedContext>>>, member: TgUser, chat: TgMessage['chat'], returning: boolean) {
  const w = ctx.welcome; if (!w || (returning && w.firstJoinOnly)) return null;
  const group = chat.title ?? ctx.community.moderatorChat?.title ?? 'сообщество';
  const channel = ctx.community.channel.name || (ctx.community.channel.handle ? `@${ctx.community.channel.handle}` : 'канал');
  const rules = w.buttons?.find(b => /правил/i.test(b.label))?.url ?? '';
  const template = returning && w.returnText ? w.returnText : w.text;
  const blocks: PostBlock[] = [...(w.imageUrl ? [{ type: 'image' as const, url: w.imageUrl }] : []), { type: 'paragraph', runs: parseInline(variables(template, member, group, channel, rules)) }];
  const keyboard = buildInlineKeyboard((w.buttons ?? []).map(b => ({ label: b.label, buttonLabel: b.label, url: b.url, kind: 'url' })));
  const ref = await sendRichMessage(chat.id, blocksToRichHtml(blocks), env.MODERATOR_BOT_TOKEN, keyboard);
  if (ref?.messageId && w.autoDeleteSeconds) await prisma.scheduledModerationAction.upsert({ where: { tgChatId_telegramMessageId_actionType: { tgChatId: String(chat.id), telegramMessageId: ref.messageId, actionType: 'DELETE_MESSAGE' } }, create: { communityId: ctx.community.id, actionType: 'DELETE_MESSAGE', tgChatId: String(chat.id), telegramMessageId: ref.messageId, executeAt: new Date(Date.now() + w.autoDeleteSeconds * 1000) }, update: { executeAt: new Date(Date.now() + w.autoDeleteSeconds * 1000), status: 'PENDING', attempts: 0 } });
  return ref;
}

function domainsOf(message: TgMessage): string[] {
  const text = message.text ?? message.caption ?? '';
  const urls = [...text.matchAll(/(?:https?:\/\/|www\.)[^\s<>()]+/gi)].map(m => m[0]);
  for (const entity of [...(message.entities ?? []), ...(message.caption_entities ?? [])]) { if (entity.url) urls.push(entity.url); else if (entity.type === 'url') urls.push(text.slice(entity.offset, entity.offset + entity.length)); }
  return [...new Set(urls.flatMap(raw => { try { return [new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).hostname.toLowerCase().replace(/^www\./, '')]; } catch { return []; } }))];
}

async function handleAntiSpam(update: ModeratorUpdate, message: TgMessage, res: Response): Promise<boolean> {
  if (!message.from || message.new_chat_members?.length) return false;
  const text = (message.text ?? message.caption ?? '').trim(); if (!text) return false;
  const ctx = await publishedContext(String(message.chat.id)); const block = ctx?.antiSpam; if (!ctx || !block) return false;
  const duplicateDelivery = await prisma.moderationMessageSample.findUnique({ where: { communityId_telegramMessageId: { communityId: ctx.community.id, telegramMessageId: message.message_id } }, select: { id: true } });
  if (duplicateDelivery) { res.json({ ok: true, duplicate: true }); return true; }
    const member = await prisma.communityMember.findUnique({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(message.from.id) } }, select: { trusted: true } });
  if ((block.skipBots && message.from.is_bot) || (block.skipTrusted && member?.trusted)) return false;
  if (block.skipAdmins && await isAdminCached(message.chat.id, message.from.id)) return false;
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').slice(0, 4096);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  const domains = domainsOf(message); const hasLink = domains.length > 0; const now = new Date();
  const [floodCount, duplicateCount] = await Promise.all([
    block.floodEnabled ? prisma.moderationMessageSample.count({ where: { communityId: ctx.community.id, tgUserId: String(message.from.id), createdAt: { gte: new Date(now.getTime() - block.windowSeconds * 1000) } } }) : Promise.resolve(0),
    block.duplicateEnabled ? prisma.moderationMessageSample.count({ where: { communityId: ctx.community.id, tgUserId: String(message.from.id), contentHash: hash, createdAt: { gte: new Date(now.getTime() - block.duplicateWindowSeconds * 1000) } } }) : Promise.resolve(0),
  ]);
  let reason: 'LINK_BLOCKED' | 'DUPLICATE' | 'FLOOD' | null = null;
  if (hasLink && block.linksMode === 'block_all') reason = 'LINK_BLOCKED';
  else if (hasLink && block.linksMode === 'allowlist' && domains.some(domain => !block.allowedDomains.some(allowed => domain === allowed || domain.endsWith('.' + allowed)))) reason = 'LINK_BLOCKED';
  else if (block.duplicateEnabled && duplicateCount >= block.maxDuplicates - 1) reason = 'DUPLICATE';
  else if (block.floodEnabled && floodCount >= block.maxMessages - 1) reason = 'FLOOD';
  const sampleData = { communityId: ctx.community.id, tgUserId: String(message.from.id), telegramMessageId: message.message_id, contentHash: hash, hasLink };
  if (!reason) { await prisma.moderationMessageSample.create({ data: sampleData }); return false; }
  const [, audit] = await prisma.$transaction([
    prisma.moderationMessageSample.create({ data: sampleData }),
    prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: String(update.update_id), telegramMessageId: message.message_id, tgUserId: String(message.from.id), blockId: block.id, eventType: 'ANTISPAM_TRIGGERED', decision: reason, reason, action: block.action === 'delete_warn' ? 'DELETE_WARN' : 'DELETE', status: 'RECEIVED', metadata: { domains, sampleStored: true } } }),
  ]);
  try { await deleteBotMessage(message.chat.id, message.message_id, env.MODERATOR_BOT_TOKEN); } catch (err) { await prisma.scheduledModerationAction.upsert({ where: { tgChatId_telegramMessageId_actionType: { tgChatId: String(message.chat.id), telegramMessageId: message.message_id, actionType: 'DELETE_MESSAGE' } }, create: { communityId: ctx.community.id, actionType: 'DELETE_MESSAGE', tgChatId: String(message.chat.id), telegramMessageId: message.message_id, executeAt: new Date(Date.now() + 60_000), lastError: (err as Error).message.slice(0, 500) }, update: { status: 'PENDING', executeAt: new Date(Date.now() + 60_000), lastError: (err as Error).message.slice(0, 500) } }); }
  if (block.action === 'delete_warn') { await prisma.moderationWarning.create({ data: { communityId: ctx.community.id, tgUserId: String(message.from.id), reason, source: 'ANTISPAM', eventId: audit.id } }); const label = message.from.username ? '@' + message.from.username : message.from.first_name; await sendBotMessage(message.chat.id, label + ', сообщение удалено: ' + ({ LINK_BLOCKED: 'ссылка запрещена', DUPLICATE: 'повтор сообщения', FLOOD: 'слишком много сообщений' }[reason]), env.MODERATOR_BOT_TOKEN).catch(() => undefined); }
  await prisma.moderationEvent.update({ where: { telegramUpdateId: String(update.update_id) }, data: { status: 'PROCESSED' } });
  res.json({ ok: true, moderated: true, reason }); return true;
}

async function handleCallback(update: ModeratorUpdate, query: CallbackQuery, res: Response) {
  const match = /^captcha:([^:]+):(\d+)$/.exec(query.data ?? '');
  if (!match || !query.message) return false;
  const [, communityId, targetId] = match;
  if (String(query.from.id) !== targetId) { await answerBotCallback(query.id, 'Эта проверка предназначена другому участнику.', env.MODERATOR_BOT_TOKEN).catch(() => undefined); res.json({ ok: true, rejected: true }); return true; }
  const ctx = await publishedContext(String(query.message.chat.id));
  if (!ctx || ctx.community.id !== communityId) { await answerBotCallback(query.id, 'Проверка уже недоступна.', env.MODERATOR_BOT_TOKEN).catch(() => undefined); res.json({ ok: true, expired: true }); return true; }
  const member = await prisma.communityMember.findUnique({ where: { communityId_tgUserId: { communityId, tgUserId: targetId } } });
  if (!member || member.captchaStatus !== 'PENDING' || (member.captchaDeadline && member.captchaDeadline < new Date())) { await answerBotCallback(query.id, 'Время проверки истекло.', env.MODERATOR_BOT_TOKEN).catch(() => undefined); res.json({ ok: true, expired: true }); return true; }
  const claimed = await prisma.communityMember.updateMany({ where: { id: member.id, captchaStatus: 'PENDING', captchaDeadline: { gte: new Date() } }, data: { captchaStatus: 'VERIFYING' } });
  if (claimed.count !== 1) { await answerBotCallback(query.id, 'Время проверки истекло.', env.MODERATOR_BOT_TOKEN).catch(() => undefined); res.json({ ok: true, expired: true }); return true; }
  try { await restrictChatUser(query.message.chat.id, query.from.id, false, env.MODERATOR_BOT_TOKEN); } catch (err) { await prisma.communityMember.update({ where: { id: member.id }, data: { captchaStatus: 'PENDING' } }).catch(() => undefined); throw err; }
  await prisma.$transaction([
    prisma.communityMember.update({ where: { id: member.id }, data: { captchaStatus: 'PASSED', captchaDeadline: null, verifiedAt: new Date(), status: 'ACTIVE' } }),
    prisma.scheduledModerationAction.updateMany({ where: { communityId, tgUserId: targetId, actionType: { startsWith: 'CAPTCHA_TIMEOUT' }, status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: new Date() } }),
    prisma.moderationEvent.create({ data: { communityId, telegramUpdateId: String(update.update_id), telegramMessageId: query.message.message_id, tgUserId: targetId, blockId: ctx.captcha?.id, eventType: 'CAPTCHA_PASSED', action: 'UNRESTRICT', status: 'PROCESSED' } }),
  ]);
  if (ctx.captcha?.deleteOnSuccess) await deleteBotMessage(query.message.chat.id, query.message.message_id, env.MODERATOR_BOT_TOKEN).catch(() => undefined);
  await answerBotCallback(query.id, 'Готово — доступ открыт.', env.MODERATOR_BOT_TOKEN).catch(() => undefined);
  await sendWelcome(ctx, query.from, query.message.chat, member.joinCount > 1);
  res.json({ ok: true, passed: true }); return true;
}

router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const incoming = req.headers['x-telegram-bot-api-secret-token'];
  if (typeof incoming !== 'string' || !safeEqual(incoming, env.MODERATOR_WEBHOOK_SECRET)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const update = req.body as ModeratorUpdate;
  if (!Number.isInteger(update.update_id)) { res.json({ ok: true, ignored: true }); return; }
  try {
    if (update.callback_query && await handleCallback(update, update.callback_query, res)) return;
    if (update.message && await handleAntiSpam(update, update.message, res)) return;

  const joined = update.message?.new_chat_members ?? [];
  if (update.message && joined.length) {
    const ctx = await publishedContext(String(update.message.chat.id));
    if (!ctx) { res.json({ ok: true, ignored: true }); return; }
    try { await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: String(update.update_id), telegramMessageId: update.message.message_id, eventType: 'MEMBER_JOINED', status: 'RECEIVED' } }); }
    catch (err) { if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { res.json({ ok: true, duplicate: true }); return; } throw err; }
    if (ctx.welcome?.deleteJoinMessage) await deleteBotMessage(update.message.chat.id, update.message.message_id, env.MODERATOR_BOT_TOKEN).catch(() => undefined);
    let challenged = 0, welcomed = 0, skipped = 0;
    for (const member of joined) {
      const existing = await prisma.communityMember.findUnique({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(member.id) } }, select: { joinCount: true, trusted: true } });
      const returning = Boolean(existing?.joinCount);
      let exempt = Boolean(ctx.captcha && ((ctx.captcha.skipBots && member.is_bot) || (ctx.captcha.skipTrusted && existing?.trusted)));
      if (ctx.captcha?.skipAdmins && !exempt) { const role = await getChatMember(String(update.message.chat.id), member.id, env.MODERATOR_BOT_TOKEN).catch(() => null); exempt = Boolean(role && ['administrator', 'creator'].includes(role.status)); }
      const deadline = ctx.captcha && !exempt ? new Date(Date.now() + ctx.captcha.timeoutSeconds * 1000) : null;
      await prisma.communityMember.upsert({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(member.id) } }, create: { communityId: ctx.community.id, tgUserId: String(member.id), joinedAt: new Date(), joinCount: 1, status: deadline ? 'RESTRICTED' : 'ACTIVE', captchaStatus: deadline ? 'PENDING' : null, captchaDeadline: deadline }, update: { joinedAt: new Date(), joinCount: { increment: 1 }, status: deadline ? 'RESTRICTED' : 'ACTIVE', captchaStatus: deadline ? 'PENDING' : null, captchaDeadline: deadline } });
      if (ctx.captcha && deadline) {
        await restrictChatUser(update.message.chat.id, member.id, true, env.MODERATOR_BOT_TOKEN);
        const group = update.message.chat.title ?? ctx.community.moderatorChat?.title ?? 'сообщество';
        const keyboard: TelegramInlineKeyboard = { inline_keyboard: [[{ text: ctx.captcha.buttonText, callback_data: `captcha:${ctx.community.id}:${member.id}` }]] };
        const captchaBlocks: PostBlock[] = [{ type: 'paragraph', runs: parseInline(variables(ctx.captcha.text, member, group, ctx.community.channel.name)) }];
        const ref = await sendRichMessage(update.message.chat.id, blocksToRichHtml(captchaBlocks), env.MODERATOR_BOT_TOKEN, keyboard);
        if (!ref) throw new Error('CAPTCHA_MESSAGE_REF_MISSING');
        const actionType = ctx.captcha.failureAction === 'kick' ? 'CAPTCHA_TIMEOUT_KICK' : 'CAPTCHA_TIMEOUT_RESTRICT';
        await prisma.scheduledModerationAction.create({ data: { communityId: ctx.community.id, actionType, tgChatId: String(update.message.chat.id), telegramMessageId: ref.messageId, tgUserId: String(member.id), executeAt: deadline } });
        challenged++;
      } else {
        let skipWelcome = Boolean(ctx.welcome?.skipBots && member.is_bot);
        if (ctx.welcome?.skipAdmins && !skipWelcome) { const role = await getChatMember(String(update.message.chat.id), member.id, env.MODERATOR_BOT_TOKEN).catch(() => null); skipWelcome = Boolean(role && ['administrator', 'creator'].includes(role.status)); }
        if (skipWelcome) skipped++; else { const ref = await sendWelcome(ctx, member, update.message.chat, returning); if (ref || ctx.welcome) welcomed++; else skipped++; }
      }
    }
    await prisma.moderationEvent.update({ where: { telegramUpdateId: String(update.update_id) }, data: { status: 'PROCESSED', action: challenged ? 'CAPTCHA_SENT' : 'WELCOME_SENT', metadata: { challenged, welcomed, skipped } } });
    res.json({ ok: true, challenged, welcomed, skipped }); return;
  }

  if (!update.my_chat_member) { res.json({ ok: true, ignored: true }); return; }
  const id = String(update.update_id);
  try { await prisma.moderationEvent.create({ data: { telegramUpdateId: id, eventType: 'BOT_MEMBERSHIP_CHANGED', status: 'RECEIVED' } }); } catch (err) { if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { res.json({ ok: true, duplicate: true }); return; } throw err; }
  const m = update.my_chat_member;
  if (['group', 'supergroup'].includes(m.chat.type)) { const rights = rightsOf(m.new_chat_member); const chat = await prisma.moderatorChat.upsert({ where: { tgChatId: String(m.chat.id) }, create: { tgChatId: String(m.chat.id), title: m.chat.title ?? 'Telegram group', username: m.chat.username ?? null, type: m.chat.type, botStatus: m.new_chat_member.status, grantedRights: rights, addedByTgId: m.from?.id ? String(m.from.id) : null, lastUpdateId: id }, update: { title: m.chat.title ?? 'Telegram group', username: m.chat.username ?? null, type: m.chat.type, botStatus: m.new_chat_member.status, grantedRights: rights, addedByTgId: m.from?.id ? String(m.from.id) : undefined, lastUpdateId: id } }); await prisma.moderationEvent.update({ where: { telegramUpdateId: id }, data: { status: 'PROCESSED', metadata: { moderatorChatId: chat.id, botStatus: chat.botStatus, rights } } }); }
  res.json({ ok: true });
  } catch (err) {
    console.error('[moderator/webhook] execution failed:', (err as Error).message);
    await prisma.moderationEvent.updateMany({ where: { telegramUpdateId: String(update.update_id) }, data: { status: 'FAILED', reason: (err as Error).message.slice(0, 500) } }).catch(() => undefined);
    if (update.callback_query) await answerBotCallback(update.callback_query.id, 'Не удалось завершить проверку. Попробуйте ещё раз.', env.MODERATOR_BOT_TOKEN).catch(() => undefined);
    res.status(200).json({ ok: true, executed: false });
  }
});

router.get('/available-chats', async (req, res) => { let auth; try { auth = await authenticate(req.query['initData']); } catch (e) { authError(res, e); return; } res.json({ chats: await prisma.moderatorChat.findMany({ where: { addedByTgId: auth.tgUserId, botStatus: { in: ['administrator', 'creator', 'member'] }, community: null }, orderBy: { updatedAt: 'desc' }, select: { id: true, tgChatId: true, title: true, username: true, type: true, botStatus: true, grantedRights: true } }) }); });
router.get('/channels/:channelId/community', async (req, res) => { let auth; try { auth = await authenticate(req.query['initData']); } catch (e) { authError(res, e); return; } const channel = await prisma.channel.findFirst({ where: { id: req.params['channelId'], userId: auth.user.id }, select: { id: true } }); if (!channel) { res.status(404).json({ error: 'Channel not found' }); return; } res.json({ community: await prisma.community.findUnique({ where: { channelId: channel.id }, include: { moderatorChat: true, moderator: { include: { configs: { orderBy: { version: 'desc' }, take: 1 } } } } }), requiredRights: REQUIRED_BASE_RIGHTS, botUsername: env.MODERATOR_BOT_USERNAME }); });
router.post('/channels/:channelId/community', async (req, res) => { const { initData, moderatorChatId } = req.body as { initData?: unknown; moderatorChatId?: unknown }; let auth; try { auth = await authenticate(initData); } catch (e) { authError(res, e); return; } if (typeof moderatorChatId !== 'string') { res.status(400).json({ error: 'moderatorChatId is required' }); return; } const channel = await prisma.channel.findFirst({ where: { id: req.params['channelId'], userId: auth.user.id }, select: { id: true } }); const chat = await prisma.moderatorChat.findFirst({ where: { id: moderatorChatId, addedByTgId: auth.tgUserId } }); if (!channel || !chat) { res.status(404).json({ error: 'Channel or group not found' }); return; } try { const [bot, user] = await Promise.all([getChatMember(chat.tgChatId, getBotIdFromToken(env.MODERATOR_BOT_TOKEN), env.MODERATOR_BOT_TOKEN), getChatMember(chat.tgChatId, Number(auth.tgUserId), env.MODERATOR_BOT_TOKEN)]); if (!['administrator', 'creator'].includes(bot.status) || !['administrator', 'creator'].includes(user.status)) { res.status(403).json({ error: 'ModerBot and you must be group administrators.' }); return; } } catch (e) { res.status(502).json({ error: e instanceof TelegramApiError ? e.message : 'Telegram check failed' }); return; } const community = await prisma.$transaction(async tx => { const base = await tx.community.upsert({ where: { channelId: channel.id }, create: { channelId: channel.id, moderatorChatId: chat.id }, update: { moderatorChatId: chat.id } }); const moderator = await tx.moderator.upsert({ where: { communityId: base.id }, create: { communityId: base.id, requiredRights: REQUIRED_BASE_RIGHTS, grantedRights: chat.grantedRights ?? undefined }, update: { grantedRights: chat.grantedRights ?? undefined, lastRightsCheckAt: new Date() } }); await tx.moderatorConfig.upsert({ where: { moderatorId_version: { moderatorId: moderator.id, version: 1 } }, create: { moderatorId: moderator.id, version: 1, blocks: [], createdById: auth.user.id }, update: {} }); return tx.community.findUnique({ where: { id: base.id }, include: { moderatorChat: true, moderator: true } }); }); res.status(201).json({ community }); });

export default router;
