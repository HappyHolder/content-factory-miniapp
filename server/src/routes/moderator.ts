import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';
import { answerBotCallback, banChatUser, buildInlineKeyboard, deleteBotMessage, getBotIdFromToken, getChatMember, restrictChatUser, sendBotMessage, unbanChatUser, sendRichMessage, TelegramApiError, type TelegramInlineKeyboard } from '../lib/telegramBot';
import { blocksToRichHtml, parseInline, type PostBlock } from '../lib/richPost';
import { processIntervention, reserveModeratorAiCheck, simulateIntervention } from '../moderator/interventionEngine';
import { moderateWithTerra } from '../moderator/modelRouter';
import { issueWarning } from '../moderator/warningEngine';
import { handleManualCommand } from '../moderator/manualCommands';
import { parseBlocks, type AiModerationBlock, type AntiSpamBlock, type CaptchaBlock, type ContentFiltersBlock, type WarningPolicyBlock, type WelcomeBlock, type TriggersBlock, type TriggerReply } from '../moderator/config';

const router = Router();
type TgAdmin = { status: string; can_delete_messages?: boolean; can_restrict_members?: boolean; can_invite_users?: boolean; can_pin_messages?: boolean };
type TgUser = { id: number; first_name: string; username?: string; is_bot?: boolean };
type TgEntity = { type: string; offset: number; length: number; url?: string };
type TgMessage = { message_id: number; chat: { id: number; title?: string; username?: string; type?: string }; from?: TgUser; text?: string; caption?: string; entities?: TgEntity[]; caption_entities?: TgEntity[]; new_chat_members?: TgUser[]; photo?: unknown[]; video?: unknown; document?: unknown; audio?: unknown; voice?: unknown; video_note?: unknown; sticker?: unknown; animation?: unknown; poll?: unknown; contact?: unknown; location?: unknown; forward_origin?: unknown; forward_from?: unknown; forward_from_chat?: unknown; reply_to_message?: { message_id: number; from?: TgUser } };
type MyChatMemberUpdate = { chat: { id: number; title?: string; username?: string; type: string }; from?: { id: number }; new_chat_member: TgAdmin };
type CallbackQuery = { id: string; from: TgUser; data?: string; message?: TgMessage };
type ModeratorUpdate = { update_id: number; my_chat_member?: MyChatMemberUpdate; message?: TgMessage; edited_message?: TgMessage; callback_query?: CallbackQuery };
const REQUIRED_BASE_RIGHTS = { can_delete_messages: true, can_restrict_members: true };

const safeEqual = (a: string, b: string) => Boolean(a && b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)));
const rightsOf = (m: TgAdmin): Record<string, boolean> => ({ can_delete_messages: m.can_delete_messages === true, can_restrict_members: m.can_restrict_members === true, can_invite_users: m.can_invite_users === true, can_pin_messages: m.can_pin_messages === true });
const adminCache = new Map<string, { value: boolean; expiresAt: number }>();
async function isAdminCached(chatId: number, userId: number): Promise<boolean> {
  const key = chatId + ':' + userId, cached = adminCache.get(key), now = Date.now(); if (cached && cached.expiresAt > now) return cached.value;
  const role = await getChatMember(String(chatId), userId, env.MODERATOR_BOT_TOKEN).catch(() => null); const value = role ? ['administrator', 'creator'].includes(role.status) : true; adminCache.set(key, { value, expiresAt: now + (role ? 5 * 60_000 : 15_000) });
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
  const community = await prisma.community.findFirst({ where: { moderatorChat: { tgChatId }, moderator: { enabled: true, publishedVersion: { not: null } } }, include: { moderatorChat: true, channel: { select: { name: true, handle: true, userId: true, brandKit: true } }, moderator: true } });
  if (!community?.moderator?.publishedVersion) return null;
  const config = await prisma.moderatorConfig.findUnique({ where: { moderatorId_version: { moderatorId: community.moderator.id, version: community.moderator.publishedVersion } } });
  const blocks = parseBlocks(config?.blocks ?? []);
  return { community, welcome: blocks.find(b => b.type === 'welcome' && b.enabled) as WelcomeBlock | undefined, captcha: blocks.find(b => b.type === 'captcha' && b.enabled) as CaptchaBlock | undefined, antiSpam: blocks.find(b => b.type === 'antispam' && b.enabled) as AntiSpamBlock | undefined, filters: blocks.find(b => b.type === 'content_filters' && b.enabled) as ContentFiltersBlock | undefined, aiModeration: blocks.find(b => b.type === 'ai_moderation' && b.enabled) as AiModerationBlock | undefined, warningPolicy: blocks.find(b => b.type === 'warning_policy' && b.enabled) as WarningPolicyBlock | undefined, triggers: blocks.find(b => b.type === 'triggers' && b.enabled) as TriggersBlock | undefined };
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

type FilterReason = 'STOP_WORD' | 'REGEX' | 'DOMAIN_BLOCKED' | 'MENTIONS' | 'CAPS' | 'EMOJI' | 'MEDIA_BLOCKED' | 'FORWARD_BLOCKED';
function mediaTypeOf(message: TgMessage): ContentFiltersBlock['blockedMedia'][number] | null { for (const type of ['photo','video','document','audio','voice','video_note','sticker','animation','poll','contact','location'] as const) if (message[type] != null) return type; return null; }
export function filterReason(block: ContentFiltersBlock, message: TgMessage): { reason: FilterReason; detail?: string } | null {
  const text = (message.text ?? message.caption ?? '').trim(), lower = text.toLowerCase().replace(/\s+/g, ' '), tokens = new Set(lower.match(/[\p{L}\p{N}_]+/gu) ?? []);
  const media = mediaTypeOf(message); if (media && block.blockedMedia.includes(media)) return { reason: 'MEDIA_BLOCKED', detail: media };
  if (block.blockForwarded && (message.forward_origin || message.forward_from || message.forward_from_chat)) return { reason: 'FORWARD_BLOCKED' };
  const blockedDomain = domainsOf(message).find(domain => block.blacklistedDomains.some(blocked => domain === blocked || domain.endsWith('.' + blocked))); if (blockedDomain) return { reason: 'DOMAIN_BLOCKED', detail: blockedDomain };
  const word = block.stopWords.find(value => value.includes(' ') ? lower.includes(value) : tokens.has(value)); if (word) return { reason: 'STOP_WORD', detail: word };
  for (const pattern of block.regexPatterns) if (new RegExp(pattern, 'iu').test(text)) return { reason: 'REGEX', detail: pattern };
  const entities = [...(message.entities ?? []), ...(message.caption_entities ?? [])], mentionCount = entities.filter(e => e.type === 'mention' || e.type === 'text_mention').length; if (block.maxMentions > 0 && mentionCount > block.maxMentions) return { reason: 'MENTIONS', detail: String(mentionCount) };
  if (block.capsEnabled) { const letters = text.match(/\p{L}/gu) ?? [], upper = text.match(/\p{Lu}/gu) ?? []; if (letters.length >= block.capsMinLetters && upper.length * 100 / letters.length >= block.capsPercent) return { reason: 'CAPS', detail: String(Math.round(upper.length * 100 / letters.length)) }; }
  if (block.emojiEnabled) { const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length; if (emojiCount > block.maxEmoji) return { reason: 'EMOJI', detail: String(emojiCount) }; }
  return null;
}

async function handleContentFilters(update: ModeratorUpdate, message: TgMessage, edited: boolean, res: Response): Promise<boolean> {
  if (!message.from || message.new_chat_members?.length) return false; const ctx = await publishedContext(String(message.chat.id)); const block = ctx?.filters; if (!ctx || !block) return false;
  if ((block.skipBots && message.from.is_bot) || (block.skipAdmins && await isAdminCached(message.chat.id, message.from.id))) return false;
  if (block.skipTrusted) { const member = await prisma.communityMember.findUnique({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(message.from.id) } }, select: { trusted: true } }); if (member?.trusted) return false; }
  const match = filterReason(block, message); if (!match) return false;
  const duplicate = await prisma.moderationEvent.findUnique({ where: { telegramUpdateId: String(update.update_id) }, select: { id: true } }); if (duplicate) { res.json({ ok: true, duplicate: true }); return true; }
  const audit = await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: String(update.update_id), telegramMessageId: message.message_id, tgUserId: String(message.from.id), blockId: block.id, eventType: edited ? 'CONTENT_FILTER_EDITED' : 'CONTENT_FILTER_TRIGGERED', decision: match.reason, reason: match.reason, action: block.action === 'delete_warn' ? 'DELETE_WARN' : 'DELETE', status: 'RECEIVED', metadata: { detail: match.detail ?? null, edited } } });
  try { await deleteBotMessage(message.chat.id, message.message_id, env.MODERATOR_BOT_TOKEN); } catch (err) { await prisma.scheduledModerationAction.upsert({ where: { tgChatId_telegramMessageId_actionType: { tgChatId: String(message.chat.id), telegramMessageId: message.message_id, actionType: 'DELETE_MESSAGE' } }, create: { communityId: ctx.community.id, actionType: 'DELETE_MESSAGE', tgChatId: String(message.chat.id), telegramMessageId: message.message_id, executeAt: new Date(Date.now() + 60_000), lastError: (err as Error).message.slice(0, 500) }, update: { status: 'PENDING', executeAt: new Date(Date.now() + 60_000), lastError: (err as Error).message.slice(0, 500) } }); }
  if (block.action === 'delete_warn') { if (ctx.warningPolicy) { const sanction = await issueWarning({ communityId: ctx.community.id, chatId: message.chat.id, tgUserId: String(message.from.id), telegramMessageId: message.message_id, reason: match.reason, source: 'CONTENT_FILTER', eventId: audit.id, policy: ctx.warningPolicy, token: env.MODERATOR_BOT_TOKEN }); await prisma.moderationEvent.update({ where: { id: audit.id }, data: { action: `DELETE_WARN_${sanction.action}` } }); } else await prisma.moderationWarning.create({ data: { communityId: ctx.community.id, tgUserId: String(message.from.id), reason: match.reason, source: 'CONTENT_FILTER', eventId: audit.id } }); const label = message.from.username ? '@' + message.from.username : message.from.first_name; await sendBotMessage(message.chat.id, label + ', сообщение удалено фильтром сообщества.', env.MODERATOR_BOT_TOKEN).catch(() => undefined); }
  await prisma.moderationEvent.update({ where: { id: audit.id }, data: { status: 'PROCESSED' } }); res.json({ ok: true, moderated: true, reason: match.reason }); return true;
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
  if (block.action === 'delete_warn') { if (ctx.warningPolicy) { const sanction = await issueWarning({ communityId: ctx.community.id, chatId: message.chat.id, tgUserId: String(message.from.id), telegramMessageId: message.message_id, reason, source: 'ANTISPAM', eventId: audit.id, policy: ctx.warningPolicy, token: env.MODERATOR_BOT_TOKEN }); await prisma.moderationEvent.update({ where: { id: audit.id }, data: { action: `DELETE_WARN_${sanction.action}` } }); } else await prisma.moderationWarning.create({ data: { communityId: ctx.community.id, tgUserId: String(message.from.id), reason, source: 'ANTISPAM', eventId: audit.id } }); const label = message.from.username ? '@' + message.from.username : message.from.first_name; await sendBotMessage(message.chat.id, label + ', сообщение удалено: ' + ({ LINK_BLOCKED: 'ссылка запрещена', DUPLICATE: 'повтор сообщения', FLOOD: 'слишком много сообщений' }[reason]), env.MODERATOR_BOT_TOKEN).catch(() => undefined); }
  await prisma.moderationEvent.update({ where: { telegramUpdateId: String(update.update_id) }, data: { status: 'PROCESSED' } });
  res.json({ ok: true, moderated: true, reason }); return true;
}

const triggerCooldowns = new Map<string, number>();
function triggerMatches(trigger: TriggerReply, normalized: string): boolean {
  return trigger.phrases.some(phrase => {
    if (trigger.matchMode === 'exact') return normalized === phrase;
    if (trigger.matchMode === 'prefix') return normalized === phrase || normalized.startsWith(phrase + ' ');
    return phrase.includes(' ') ? normalized.includes(phrase) : new Set(normalized.match(/[\p{L}\p{N}_/]+/gu) ?? []).has(phrase);
  });
}
async function handleTriggers(update: ModeratorUpdate, message: TgMessage, res: Response): Promise<boolean> {
  if (!message.from || message.new_chat_members?.length || (!message.text && !message.caption)) return false;
  const ctx = await publishedContext(String(message.chat.id)), block = ctx?.triggers;
  if (!ctx || !block || (block.skipBots && message.from.is_bot)) return false;
  const normalized = (message.text ?? message.caption ?? '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
  const ranked = block.triggers.filter(t => t.enabled && triggerMatches(t, normalized)).sort((a, b) => ({ exact: 0, prefix: 1, contains: 2 }[a.matchMode] - { exact: 0, prefix: 1, contains: 2 }[b.matchMode]));
  const trigger = ranked[0]; if (!trigger) return false;
  const admin = trigger.access === 'admins' ? await isAdminCached(message.chat.id, message.from.id) : false;
  if (trigger.access === 'admins' && !admin) return false;
  const cooldownKey = ctx.community.id + ':' + trigger.id + ':' + message.from.id, now = Date.now();
  if ((triggerCooldowns.get(cooldownKey) ?? 0) > now) { res.json({ ok: true, trigger: trigger.id, cooldown: true }); return true; }
  if (trigger.cooldownSeconds) triggerCooldowns.set(cooldownKey, now + trigger.cooldownSeconds * 1000);
  if (triggerCooldowns.size > 10000) for (const [key, expiry] of triggerCooldowns) if (expiry <= now) triggerCooldowns.delete(key);
  const duplicate = await prisma.moderationEvent.findUnique({ where: { telegramUpdateId: String(update.update_id) }, select: { id: true } });
  if (duplicate) { res.json({ ok: true, duplicate: true }); return true; }
  const group = message.chat.title ?? ctx.community.moderatorChat?.title ?? 'сообщество';
  const channel = ctx.community.channel.name || (ctx.community.channel.handle ? '@' + ctx.community.channel.handle : 'канал');
  const richBlocks: PostBlock[] = [...(trigger.imageUrl ? [{ type: 'image' as const, url: trigger.imageUrl }] : []), { type: 'paragraph', runs: parseInline(variables(trigger.text, message.from, group, channel)) }];
  const keyboard = buildInlineKeyboard(trigger.buttons.map(b => ({ label: b.label, buttonLabel: b.label, url: b.url.startsWith('@') ? 'https://t.me/' + b.url.slice(1) : b.url, kind: 'url' })));
  const audit = await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: String(update.update_id), telegramMessageId: message.message_id, tgUserId: String(message.from.id), blockId: trigger.id, eventType: 'TRIGGER_MATCHED', decision: trigger.matchMode.toUpperCase(), action: 'REPLY', status: 'RECEIVED', metadata: { name: trigger.name, normalized: normalized.slice(0, 200) } } });
  try {
    const ref = await sendRichMessage(message.chat.id, blocksToRichHtml(richBlocks), env.MODERATOR_BOT_TOKEN, keyboard);
    if (trigger.deleteTriggerMessage) await deleteBotMessage(message.chat.id, message.message_id, env.MODERATOR_BOT_TOKEN).catch(() => undefined);
    if (ref?.messageId && trigger.autoDeleteSeconds) await prisma.scheduledModerationAction.upsert({ where: { tgChatId_telegramMessageId_actionType: { tgChatId: String(message.chat.id), telegramMessageId: ref.messageId, actionType: 'DELETE_MESSAGE' } }, create: { communityId: ctx.community.id, actionType: 'DELETE_MESSAGE', tgChatId: String(message.chat.id), telegramMessageId: ref.messageId, executeAt: new Date(now + trigger.autoDeleteSeconds * 1000) }, update: { executeAt: new Date(now + trigger.autoDeleteSeconds * 1000), status: 'PENDING', attempts: 0 } });
    await prisma.moderationEvent.update({ where: { id: audit.id }, data: { status: 'PROCESSED' } });
  } catch (error) {
    await prisma.moderationEvent.update({ where: { id: audit.id }, data: { status: 'FAILED', reason: (error as Error).message.slice(0, 500) } }); throw error;
  }
  res.json({ ok: true, triggered: true, trigger: trigger.id }); return true;
}
async function handleAiModeration(update: ModeratorUpdate, message: TgMessage, res: Response): Promise<boolean> {
  if (!message.from || message.new_chat_members?.length) return false;
  const text = (message.text ?? message.caption ?? '').trim();
  const ctx = await publishedContext(String(message.chat.id)), block = ctx?.aiModeration;
  if (!ctx || !block || text.length < block.minLength) return false;
  if ((block.skipBots && message.from.is_bot) || (block.skipAdmins && await isAdminCached(message.chat.id, message.from.id))) return false;
  if (block.skipTrusted) { const member = await prisma.communityMember.findUnique({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(message.from.id) } }, select: { trusted: true } }); if (member?.trusted) return false; }
  const triggerKnowledge = ctx.triggers?.triggers.filter(t => t.enabled && t.useAsAiKnowledge).map(t => t.name + ': ' + t.text.replace(/[*_~=[\]()|]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n') ?? '';
  const effectiveBlock = triggerKnowledge ? { ...block, rules: (block.rules + '\n\nЗнания сообщества:\n' + triggerKnowledge).slice(0, 6000) } : block;
  if (block.interventionsEnabled) { const result = await processIntervention({ updateId: update.update_id, communityId: ctx.community.id, ownerUserId: ctx.community.channel.userId, chatId: message.chat.id, tgUserId: String(message.from.id), telegramMessageId: message.message_id, text, block: effectiveBlock, warningPolicy: ctx.warningPolicy, channelContext: { channel: ctx.community.channel.name, handle: ctx.community.channel.handle, brandKit: ctx.community.channel.brandKit }, token: env.MODERATOR_BOT_TOKEN }); res.json({ ok: true, aiIntervention: result }); return true; }
  const allowed = await reserveModeratorAiCheck(ctx.community.channel.userId, Math.ceil((text.length + effectiveBlock.rules.length + JSON.stringify(ctx.community.channel.brandKit ?? {}).length) / 4)); if (!allowed) return false;
  const decision = await moderateWithTerra({ text, rules: effectiveBlock.rules, channelContext: { channel: ctx.community.channel.name, handle: ctx.community.channel.handle, brandKit: ctx.community.channel.brandKit }, model: env.LAYOUT_MODEL });
  if (!decision || !decision.violation || decision.confidence < block.confidenceThreshold) return false;
  const audit = await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: String(update.update_id), telegramMessageId: message.message_id, tgUserId: String(message.from.id), blockId: block.id, eventType: 'AI_MODERATION_TRIGGERED', decision: decision.category, confidence: decision.confidence, reason: decision.reason, action: block.action.toUpperCase(), status: 'RECEIVED', model: env.LAYOUT_MODEL, promptVersion: 'moderator-terra-v1' } });
  if (block.action !== 'review') await deleteBotMessage(message.chat.id, message.message_id, env.MODERATOR_BOT_TOKEN);
  if (block.action === 'delete_warn') { if (ctx.warningPolicy) { const sanction = await issueWarning({ communityId: ctx.community.id, chatId: message.chat.id, tgUserId: String(message.from.id), telegramMessageId: message.message_id, reason: decision.reason, source: 'AI', eventId: audit.id, policy: ctx.warningPolicy, token: env.MODERATOR_BOT_TOKEN }); await prisma.moderationEvent.update({ where: { id: audit.id }, data: { action: 'DELETE_WARN_' + sanction.action } }); } else await prisma.moderationWarning.create({ data: { communityId: ctx.community.id, tgUserId: String(message.from.id), reason: decision.reason, source: 'AI', eventId: audit.id } }); }
  await prisma.moderationEvent.update({ where: { id: audit.id }, data: { status: 'PROCESSED' } });
  res.json({ ok: true, moderated: true, ai: true, decision }); return true;
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
    if (update.message) { const command = await handleManualCommand(update.update_id, update.message, env.MODERATOR_BOT_TOKEN); if (command.handled) { res.json({ ok: true, command: command.command }); return; } }
    const filterMessage = update.edited_message ?? update.message;
    if (filterMessage && await handleContentFilters(update, filterMessage, Boolean(update.edited_message), res)) return;
    if (update.message && await handleAntiSpam(update, update.message, res)) return;
    if (update.message && await handleTriggers(update, update.message, res)) return;
    if (update.message && await handleAiModeration(update, update.message, res)) return;

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

router.get('/ai-entitlement', async (req,res)=>{let auth;try{auth=await authenticate(req.query['initData'])}catch(e){authError(res,e);return}const now=new Date(),reset=new Date(now);reset.setMonth(reset.getMonth()+1);const entitlement=await prisma.aiModeratorEntitlement.upsert({where:{userId:auth.user.id},create:{userId:auth.user.id,status:'TRIAL',quotaResetAt:reset},update:{}});res.json({entitlement})});

router.post('/moderators/:moderatorId/simulate-intervention',async(req,res)=>{const{initData,conversation}=req.body as{initData?:unknown;conversation?:unknown};let auth;try{auth=await authenticate(initData)}catch(e){authError(res,e);return}if(typeof conversation!=='string'||conversation.trim().length<10){res.status(400).json({error:'Добавьте пример диалога'});return}const moderator=await prisma.moderator.findFirst({where:{id:req.params['moderatorId'],community:{channel:{userId:auth.user.id}}},include:{community:{include:{channel:{include:{brandKit:true}}}}}});if(!moderator){res.status(404).json({error:'Moderator not found'});return}const draft=await prisma.moderatorConfig.findUnique({where:{moderatorId_version:{moderatorId:moderator.id,version:moderator.draftVersion}}}),block=parseBlocks(draft?.blocks??[]).find(b=>b.type==='ai_moderation') as AiModerationBlock|undefined;if(!block){res.status(409).json({error:'Сначала сохраните AI-модерацию'});return}const allowed=await reserveModeratorAiCheck(auth.user.id,Math.ceil(conversation.length/4),100);if(!allowed){res.status(429).json({error:'Месячный лимит AI-модерации исчерпан'});return}const decision=await simulateIntervention({conversation:conversation.trim(),rules:block.rules,scenarios:block.interventionScenarios,tone:block.interventionTone,channelContext:{channel:moderator.community.channel.name,handle:moderator.community.channel.handle,brandKit:moderator.community.channel.brandKit}});if(!decision){res.status(502).json({error:'Terra не вернула решение'});return}res.json({decision})});

router.post('/moderators/:moderatorId/pause', async (req, res) => { const { initData, enabled } = req.body as { initData?: unknown; enabled?: unknown }; let auth; try { auth = await authenticate(initData); } catch (e) { authError(res, e); return; } if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled must be boolean' }); return; } const moderator = await prisma.moderator.findFirst({ where: { id: req.params['moderatorId'], community: { channel: { userId: auth.user.id } } } }); if (!moderator) { res.status(404).json({ error: 'Moderator not found' }); return; } const updated = await prisma.moderator.update({ where: { id: moderator.id }, data: { enabled, status: enabled ? 'ACTIVE' : 'PAUSED' } }); res.json({ moderator: updated }); });

router.get('/available-chats', async (req, res) => { let auth; try { auth = await authenticate(req.query['initData']); } catch (e) { authError(res, e); return; } res.json({ chats: await prisma.moderatorChat.findMany({ where: { addedByTgId: auth.tgUserId, botStatus: { in: ['administrator', 'creator', 'member'] }, community: null }, orderBy: { updatedAt: 'desc' }, select: { id: true, tgChatId: true, title: true, username: true, type: true, botStatus: true, grantedRights: true } }) }); });
router.get('/channels/:channelId/community', async (req, res) => { let auth; try { auth = await authenticate(req.query['initData']); } catch (e) { authError(res, e); return; } const channel = await prisma.channel.findFirst({ where: { id: req.params['channelId'], userId: auth.user.id }, select: { id: true } }); if (!channel) { res.status(404).json({ error: 'Channel not found' }); return; } res.json({ community: await prisma.community.findUnique({ where: { channelId: channel.id }, include: { moderatorChat: true, moderator: { include: { configs: { orderBy: { version: 'desc' }, take: 1 } } } } }), requiredRights: REQUIRED_BASE_RIGHTS, botUsername: env.MODERATOR_BOT_USERNAME }); });
router.post('/channels/:channelId/community', async (req, res) => { const { initData, moderatorChatId } = req.body as { initData?: unknown; moderatorChatId?: unknown }; let auth; try { auth = await authenticate(initData); } catch (e) { authError(res, e); return; } if (typeof moderatorChatId !== 'string') { res.status(400).json({ error: 'moderatorChatId is required' }); return; } const channel = await prisma.channel.findFirst({ where: { id: req.params['channelId'], userId: auth.user.id }, select: { id: true } }); const chat = await prisma.moderatorChat.findFirst({ where: { id: moderatorChatId, addedByTgId: auth.tgUserId } }); if (!channel || !chat) { res.status(404).json({ error: 'Channel or group not found' }); return; } try { const [bot, user] = await Promise.all([getChatMember(chat.tgChatId, getBotIdFromToken(env.MODERATOR_BOT_TOKEN), env.MODERATOR_BOT_TOKEN), getChatMember(chat.tgChatId, Number(auth.tgUserId), env.MODERATOR_BOT_TOKEN)]); if (!['administrator', 'creator'].includes(bot.status) || !['administrator', 'creator'].includes(user.status)) { res.status(403).json({ error: 'ModerBot and you must be group administrators.' }); return; } } catch (e) { res.status(502).json({ error: e instanceof TelegramApiError ? e.message : 'Telegram check failed' }); return; } const community = await prisma.$transaction(async tx => { const base = await tx.community.upsert({ where: { channelId: channel.id }, create: { channelId: channel.id, moderatorChatId: chat.id }, update: { moderatorChatId: chat.id } }); const moderator = await tx.moderator.upsert({ where: { communityId: base.id }, create: { communityId: base.id, requiredRights: REQUIRED_BASE_RIGHTS, grantedRights: chat.grantedRights ?? undefined }, update: { grantedRights: chat.grantedRights ?? undefined, lastRightsCheckAt: new Date() } }); await tx.moderatorConfig.upsert({ where: { moderatorId_version: { moderatorId: moderator.id, version: 1 } }, create: { moderatorId: moderator.id, version: 1, blocks: [], createdById: auth.user.id }, update: {} }); return tx.community.findUnique({ where: { id: base.id }, include: { moderatorChat: true, moderator: true } }); }); res.status(201).json({ community }); });

router.post('/communities/:communityId/events/:eventId/reverse', async (req, res) => {
  const { initData } = req.body as { initData?: unknown }; let auth; try { auth = await authenticate(initData); } catch (e) { authError(res, e); return; }
  const event = await prisma.moderationEvent.findFirst({ where: { id: req.params['eventId'], communityId: req.params['communityId'], community: { channel: { userId: auth.user.id } } }, include: { community: { include: { moderatorChat: true } } } });
  if (!event?.tgUserId || !event.community?.moderatorChat) { res.status(404).json({ error: 'Event not found or cannot be reversed' }); return; }
  if (event.reversedAt) { res.json({ event, duplicate: true }); return; }
  const chatId = event.community.moderatorChat.tgChatId, userId = Number(event.tgUserId), action = event.action ?? '';
  if (action.includes('BAN')) { await unbanChatUser(chatId, userId, env.MODERATOR_BOT_TOKEN); await prisma.communityMember.updateMany({ where: { communityId: event.communityId!, tgUserId: event.tgUserId }, data: { status: 'ACTIVE', bannedAt: null } }); }
  else if (action.includes('MUTE')) { await restrictChatUser(chatId, userId, false, env.MODERATOR_BOT_TOKEN); await prisma.communityMember.updateMany({ where: { communityId: event.communityId!, tgUserId: event.tgUserId }, data: { status: 'ACTIVE', muteUntil: null } }); await prisma.scheduledModerationAction.updateMany({ where: { communityId: event.communityId!, tgUserId: event.tgUserId, actionType: 'UNMUTE_USER', status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: new Date() } }); }
  await prisma.moderationWarning.updateMany({ where: { communityId: event.communityId!, tgUserId: event.tgUserId, eventId: event.id, revokedAt: null }, data: { revokedAt: new Date() } });
  const reversed = await prisma.moderationEvent.update({ where: { id: event.id }, data: { reversedAt: new Date(), reversedById: auth.user.id } });
  res.json({ event: reversed });
});

router.get('/communities/:communityId/events', async (req, res) => {
  let auth; try { auth = await authenticate(req.query['initData']); } catch (e) { authError(res, e); return; }
  const community = await prisma.community.findFirst({ where: { id: req.params['communityId'], channel: { userId: auth.user.id } }, select: { id: true } });
  if (!community) { res.status(404).json({ error: 'Community not found' }); return; }
  const events = await prisma.moderationEvent.findMany({ where: { communityId: community.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ events });
});

export default router;
