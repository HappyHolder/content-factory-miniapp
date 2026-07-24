import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { verifyModeratorSession } from '../lib/moderatorSession';
import { answerBotCallback, banChatUser, buildInlineKeyboard, deleteBotMessage, getBotIdFromToken, getBotIdentity, getChatMember, kickChatUser, restrictChatUser, sendBotMessage, setBotWebhook, unbanChatUser, sendRichMessage, TelegramApiError, type TelegramInlineKeyboard } from '../lib/telegramBot';
import { blocksToRichHtml, parseInline, type PostBlock } from '../lib/richPost';
import { processIntervention, reserveModeratorAiCheck, simulateIntervention, syncModeratorEntitlement } from '../moderator/interventionEngine';
import { moderateWithTerra } from '../moderator/modelRouter';
import { activeWarningCount, issueWarning } from '../moderator/warningEngine';
import { decryptManagedBotToken, moderatorTokenForCommunity } from '../moderator/managedBotCrypto';
import { incomingManagedBot, managedBotPublic, updateManagedBotProfile } from '../moderator/managedBotService';
import { handleManualCommand } from '../moderator/manualCommands';
import { matchRegexWithTimeout } from '../moderator/regexGuard';
import { DEFAULT_BLOCKS, parseBlocks, type AiModerationBlock, type AntiSpamBlock, type CaptchaBlock, type ContentFiltersBlock, type ProbationBlock, type TextFilterCategory, type WarningPolicyBlock, type WelcomeBlock, type TriggersBlock, type TriggerReply } from '../moderator/config';
import { ownerFeedbackContext } from '../moderator/feedbackContext';
import { communityIdForChat, recordPulseMessage, recordPulseMembership } from '../lib/communityPulse';
import { TIER_LIMITS, getEffectiveSubscription, hasCustomBotSlot } from '../lib/subscriptionLimits';

const router = Router();
type ModeratorRuntime = { token: string; botId: number; managed: boolean };
const moderatorRuntime = new AsyncLocalStorage<ModeratorRuntime>();
const currentToken = () => moderatorRuntime.getStore()?.token ?? env.MODERATOR_BOT_TOKEN;
const currentBotId = () => moderatorRuntime.getStore()?.botId ?? getBotIdFromToken(env.MODERATOR_BOT_TOKEN);
const eventKey = (updateId: number) => String(currentBotId()) + ':' + updateId;
type TgAdmin = { status: string; can_delete_messages?: boolean; can_restrict_members?: boolean; can_invite_users?: boolean; can_pin_messages?: boolean };
type TgUser = { id: number; first_name: string; username?: string; is_bot?: boolean };
type TgEntity = { type: string; offset: number; length: number; url?: string };
type TgMessage = { message_id: number; chat: { id: number; title?: string; username?: string; type?: string }; from?: TgUser; text?: string; caption?: string; entities?: TgEntity[]; caption_entities?: TgEntity[]; new_chat_members?: TgUser[]; left_chat_member?: TgUser; photo?: unknown[]; video?: unknown; document?: unknown; audio?: unknown; voice?: unknown; video_note?: unknown; sticker?: unknown; animation?: unknown; poll?: unknown; contact?: unknown; location?: unknown; forward_origin?: unknown; forward_from?: unknown; forward_from_chat?: unknown; reply_to_message?: { message_id: number; from?: TgUser } };
type MyChatMemberUpdate = { chat: { id: number; title?: string; username?: string; type: string }; from?: { id: number }; new_chat_member: TgAdmin };
type CallbackQuery = { id: string; from: TgUser; data?: string; message?: TgMessage };
type ModeratorUpdate = { update_id: number; my_chat_member?: MyChatMemberUpdate; message?: TgMessage; edited_message?: TgMessage; callback_query?: CallbackQuery };
const REQUIRED_BASE_RIGHTS = { can_delete_messages: true, can_restrict_members: true };
const DEFAULT_WARNING_POLICY = DEFAULT_BLOCKS.find(block => block.type === 'warning_policy') as WarningPolicyBlock;

function russianCount(value: number, one: string, few: string, many: string): string {
  const lastTwo = value % 100, last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${value} ${many}`;
  if (last === 1) return `${value} ${one}`;
  if (last >= 2 && last <= 4) return `${value} ${few}`;
  return `${value} ${many}`;
}

function moderationDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return russianCount(seconds / 86_400, 'день', 'дня', 'дней');
  if (seconds % 3_600 === 0) return russianCount(seconds / 3_600, 'час', 'часа', 'часов');
  return russianCount(Math.max(1, Math.round(seconds / 60)), 'минуту', 'минуты', 'минут');
}

function warningNotice(action: 'NONE' | 'WARN' | 'MUTE' | 'BAN', count: number, policy?: WarningPolicyBlock): string {
  if (!policy?.notifyUser || action === 'NONE' || count < 1) return '';
  const threshold = policy.banAfterWarnings > 0 ? ` из ${policy.banAfterWarnings}` : '';
  if (action === 'BAN') return `⛔ Пользователь заблокирован после ${russianCount(count, 'предупреждения', 'предупреждений', 'предупреждений')}.`;
  if (action === 'MUTE') return `🔇 Предупреждение ${count}${threshold}. Пользователь не сможет писать ${moderationDuration(policy.muteDurationSeconds)}.`;
  return `⚠️ Предупреждение ${count}${threshold}.`;
}

const safeEqual = (a: string, b: string) => Boolean(a && b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)));
const rightsOf = (m: TgAdmin): Record<string, boolean> => ({ can_delete_messages: m.can_delete_messages === true, can_restrict_members: m.can_restrict_members === true, can_invite_users: m.can_invite_users === true, can_pin_messages: m.can_pin_messages === true });
const adminCache = new Map<string, { value: boolean; expiresAt: number }>();
async function isAdminCached(chatId: number, userId: number): Promise<boolean> {
  const key = chatId + ':' + userId, cached = adminCache.get(key), now = Date.now(); if (cached && cached.expiresAt > now) return cached.value;
  const role = await getChatMember(String(chatId), userId, currentToken()).catch(() => null); const value = role ? ['administrator', 'creator'].includes(role.status) : true; adminCache.set(key, { value, expiresAt: now + (role ? 5 * 60_000 : 15_000) });
  if (adminCache.size > 5000) for (const [k, v] of adminCache) if (v.expiresAt <= now) adminCache.delete(k); return value;
}

const variables = (text: string, member: TgUser, group: string, channel: string, rules = '') => text.replace(/\{(name|username|group|channel|rules)\}/g, (_, key: string) => ({ name: member.first_name || 'участник', username: member.username ? `@${member.username}` : member.first_name, group, channel, rules }[key] ?? ''));

async function authenticate(req: Request) {
  const session = verifyModeratorSession(req.headers.authorization);
  const user = await prisma.user.findUnique({ where: { telegramId: session.tgUserId }, select: { id: true, telegramId: true } });
  if (!user) throw new Error('USER_NOT_FOUND');
  return { user, tgUserId: session.tgUserId };
}
function authError(res: Response, err: unknown) { const m = err instanceof Error ? err.message : ''; if (m === 'USER_NOT_FOUND') res.status(401).json({ error: 'User not found. Re-open Publium.' }); else if (m === 'SESSION_EXPIRED') res.status(401).json({ error: 'Сессия Moderator истекла. Переоткройте Publium.' }); else res.status(401).json({ error: 'Invalid Moderator session' }); }

async function publishedContext(tgChatId: string) {
  const community = await prisma.community.findFirst({ where: { moderatorChat: { tgChatId }, moderator: { enabled: true, publishedVersion: { not: null } } }, include: { moderatorChat: true, channel: { select: { name: true, handle: true, userId: true, brandKit: true } }, moderator: true, managedBot: true } });
  if (!community?.moderator?.publishedVersion) return null;
  const expectedBotId = community.moderator.executorType === 'CUSTOM' ? Number(community.managedBot?.tgBotId) : getBotIdFromToken(env.MODERATOR_BOT_TOKEN);
  if (!Number.isFinite(expectedBotId) || expectedBotId !== currentBotId()) return null;
  const config = await prisma.moderatorConfig.findUnique({ where: { moderatorId_version: { moderatorId: community.moderator.id, version: community.moderator.publishedVersion } } });
  const blocks = parseBlocks(config?.blocks ?? []);
  const configuredWarningPolicy = blocks.find(b => b.type === 'warning_policy') as WarningPolicyBlock | undefined;
  const warningPolicy = configuredWarningPolicy ? (configuredWarningPolicy.enabled ? configuredWarningPolicy : undefined) : DEFAULT_WARNING_POLICY;
  return { community, welcome: blocks.find(b => b.type === 'welcome' && b.enabled) as WelcomeBlock | undefined, captcha: blocks.find(b => b.type === 'captcha' && b.enabled) as CaptchaBlock | undefined, antiSpam: blocks.find(b => b.type === 'antispam' && b.enabled) as AntiSpamBlock | undefined, filters: blocks.find(b => b.type === 'content_filters' && b.enabled) as ContentFiltersBlock | undefined, aiModeration: blocks.find(b => b.type === 'ai_moderation' && b.enabled) as AiModerationBlock | undefined, warningPolicy, triggers: blocks.find(b => b.type === 'triggers' && b.enabled) as TriggersBlock | undefined, probation: blocks.find(b => b.type === 'probation' && b.enabled) as ProbationBlock | undefined };
}

async function sendWelcome(ctx: NonNullable<Awaited<ReturnType<typeof publishedContext>>>, member: TgUser, chat: TgMessage['chat'], returning: boolean) {
  const w = ctx.welcome; if (!w || (returning && w.firstJoinOnly)) return null;
  const group = chat.title ?? ctx.community.moderatorChat?.title ?? 'сообщество';
  const channel = ctx.community.channel.name || (ctx.community.channel.handle ? `@${ctx.community.channel.handle}` : 'канал');
  const rules = w.buttons?.find(b => /правил/i.test(b.label))?.url ?? '';
  const template = returning && w.returnText ? w.returnText : w.text;
  const blocks: PostBlock[] = [...(w.imageUrl ? [{ type: 'image' as const, url: w.imageUrl }] : []), { type: 'paragraph', runs: parseInline(variables(template, member, group, channel, rules)) }];
  const keyboard = buildInlineKeyboard((w.buttons ?? []).map(b => ({ label: b.label, buttonLabel: b.label, url: b.url, kind: 'url' })));
  const ref = await sendRichMessage(chat.id, blocksToRichHtml(blocks), currentToken(), keyboard);
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
type FilterMatch = { reason: FilterReason; detail?: string; category?: TextFilterCategory };
function mediaTypeOf(message: TgMessage): ContentFiltersBlock['blockedMedia'][number] | null { for (const type of ['photo','video','document','audio','voice','video_note','sticker','animation','poll','contact','location'] as const) if (message[type] != null) return type; return null; }
function categoryTextMatch(categories: TextFilterCategory[], lower: string, tokens: Set<string>): { category: TextFilterCategory; term: string } | null {
  const severity = { standard: 1, serious: 2, critical: 3 };
  const matches = categories.flatMap(category => category.enabled ? category.terms.flatMap(term => {
    const phrase = term.includes(' ');
    return (phrase ? lower.includes(term) : tokens.has(term)) ? [{ category, term, phrase }] : [];
  }) : []);
  matches.sort((a, b) => Number(b.phrase) - Number(a.phrase) || severity[b.category.severity] - severity[a.category.severity] || b.term.length - a.term.length);
  return matches[0] ?? null;
}
export async function filterReason(block: ContentFiltersBlock, message: TgMessage): Promise<FilterMatch | null> {
  const text = (message.text ?? message.caption ?? '').trim(), lower = text.toLowerCase().replace(/\s+/g, ' '), tokens = new Set(lower.match(/[\p{L}\p{N}_]+/gu) ?? []);
  const media = mediaTypeOf(message); if (media && block.blockedMedia.includes(media)) return { reason: 'MEDIA_BLOCKED', detail: media };
  if (block.blockForwarded && (message.forward_origin || message.forward_from || message.forward_from_chat)) return { reason: 'FORWARD_BLOCKED' };
  const blockedDomain = domainsOf(message).find(domain => block.blacklistedDomains.some(blocked => domain === blocked || domain.endsWith('.' + blocked))); if (blockedDomain) return { reason: 'DOMAIN_BLOCKED', detail: blockedDomain };
  const categoryMatch = categoryTextMatch(block.textCategories ?? [], lower, tokens); if (categoryMatch) return { reason: 'STOP_WORD', detail: categoryMatch.term, category: categoryMatch.category };
  const word = block.stopWords.find(value => value.includes(' ') ? lower.includes(value) : tokens.has(value)); if (word) return { reason: 'STOP_WORD', detail: word };
  const matchedPattern = await matchRegexWithTimeout(block.regexPatterns, text); if (matchedPattern) return { reason: 'REGEX', detail: matchedPattern };
  const entities = [...(message.entities ?? []), ...(message.caption_entities ?? [])], mentionCount = entities.filter(e => e.type === 'mention' || e.type === 'text_mention').length; if (block.maxMentions > 0 && mentionCount > block.maxMentions) return { reason: 'MENTIONS', detail: String(mentionCount) };
  if (block.capsEnabled) { const letters = text.match(/\p{L}/gu) ?? [], upper = text.match(/\p{Lu}/gu) ?? []; if (letters.length >= block.capsMinLetters && upper.length * 100 / letters.length >= block.capsPercent) return { reason: 'CAPS', detail: String(Math.round(upper.length * 100 / letters.length)) }; }
  if (block.emojiEnabled) { const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length; if (emojiCount > block.maxEmoji) return { reason: 'EMOJI', detail: String(emojiCount) }; }
  return null;
}

async function handleContentFilters(update: ModeratorUpdate, message: TgMessage, edited: boolean, res: Response): Promise<boolean> {
  if (!message.from || message.new_chat_members?.length) return false;
  const ctx = await publishedContext(String(message.chat.id)), block = ctx?.filters;
  if (!ctx || !block) return false;
  if ((block.skipBots && message.from.is_bot) || (block.skipAdmins && await isAdminCached(message.chat.id, message.from.id))) return false;
  if (block.skipTrusted) { const member = await prisma.communityMember.findUnique({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(message.from.id) } }, select: { trusted: true } }); if (member?.trusted) return false; }
  const match = await filterReason(block, message); if (!match) return false;
  const duplicate = await prisma.moderationEvent.findUnique({ where: { telegramUpdateId: eventKey(update.update_id) }, select: { id: true } }); if (duplicate) { res.json({ ok: true, duplicate: true }); return true; }
  const action = match.category?.action ?? block.action;
  const audit = await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: eventKey(update.update_id), telegramMessageId: message.message_id, tgUserId: String(message.from.id), blockId: match.category?.id ?? block.id, eventType: edited ? 'CONTENT_FILTER_EDITED' : 'CONTENT_FILTER_TRIGGERED', decision: match.category?.name ?? match.reason, reason: match.reason, action: action === 'delete_warn' ? 'DELETE_WARN' : 'DELETE', status: 'RECEIVED', metadata: { detail: match.detail ?? null, categoryId: match.category?.id ?? null, categoryName: match.category?.name ?? null, edited } } });
  try { await deleteBotMessage(message.chat.id, message.message_id, currentToken()); } catch (err) { await prisma.scheduledModerationAction.upsert({ where: { tgChatId_telegramMessageId_actionType: { tgChatId: String(message.chat.id), telegramMessageId: message.message_id, actionType: 'DELETE_MESSAGE' } }, create: { communityId: ctx.community.id, actionType: 'DELETE_MESSAGE', tgChatId: String(message.chat.id), telegramMessageId: message.message_id, executeAt: new Date(Date.now() + 60_000), lastError: (err as Error).message.slice(0, 500) }, update: { status: 'PENDING', executeAt: new Date(Date.now() + 60_000), lastError: (err as Error).message.slice(0, 500) } }); }
  let warningCount = 0, sanctionAction = 'NONE';
  if (action === 'delete_warn') {
    if (ctx.warningPolicy) {
      const sanction = await issueWarning({ communityId: ctx.community.id, chatId: message.chat.id, tgUserId: String(message.from.id), telegramMessageId: message.message_id, reason: match.category?.name ?? match.reason, source: 'CONTENT_FILTER', eventId: audit.id, policy: ctx.warningPolicy, token: currentToken() });
      warningCount = sanction.count; sanctionAction = sanction.action;
      await prisma.moderationEvent.update({ where: { id: audit.id }, data: { action: 'DELETE_WARN_' + sanction.action } });
    } else {
      await prisma.moderationWarning.create({ data: { communityId: ctx.community.id, tgUserId: String(message.from.id), reason: match.category?.name ?? match.reason, source: 'CONTENT_FILTER', eventId: audit.id } });
      warningCount = await activeWarningCount(ctx.community.id, String(message.from.id));
    }
  }
  const categoryResponse = match.category?.responseMode === 'custom' ? match.category.responseText.trim() : '';
  const legacyResponse = !match.category && action === 'delete_warn' ? '{username}, сообщение удалено фильтром сообщества.' : '';
  const responseTemplate = categoryResponse || legacyResponse;
  const notice = warningNotice(sanctionAction as 'NONE' | 'WARN' | 'MUTE' | 'BAN', warningCount, ctx.warningPolicy);
  if (responseTemplate || notice) {
    if (!warningCount && responseTemplate.includes('{warnings}')) warningCount = await activeWarningCount(ctx.community.id, String(message.from.id));
    const label = message.from.username ? '@' + message.from.username : message.from.first_name;
    const banAfter = ctx.warningPolicy?.banAfterWarnings ?? 5;
    const customText = responseTemplate.replace(/\{(name|username|reason|warnings|ban_after)\}/g, (_, key: string) => ({ name: message.from?.first_name ?? 'Участник', username: label, reason: match.category?.name ?? match.reason, warnings: String(warningCount), ban_after: String(banAfter) }[key] ?? ''));
    const responseText = [customText, notice].filter(Boolean).join('\n\n');
    const ref = await sendBotMessage(message.chat.id, responseText.slice(0, 1000), currentToken(), sanctionAction !== 'NONE' && message.from ? appealKeyboard(ctx.community.id, String(message.from.id)) : undefined).catch(() => null);
    if (ref?.messageId && match.category?.autoDeleteSeconds) await prisma.scheduledModerationAction.upsert({ where: { tgChatId_telegramMessageId_actionType: { tgChatId: String(message.chat.id), telegramMessageId: ref.messageId, actionType: 'DELETE_MESSAGE' } }, create: { communityId: ctx.community.id, actionType: 'DELETE_MESSAGE', tgChatId: String(message.chat.id), telegramMessageId: ref.messageId, executeAt: new Date(Date.now() + match.category.autoDeleteSeconds * 1000) }, update: { executeAt: new Date(Date.now() + match.category.autoDeleteSeconds * 1000), status: 'PENDING', attempts: 0 } });
  }
  await prisma.moderationEvent.update({ where: { id: audit.id }, data: { status: 'PROCESSED', metadata: { detail: match.detail ?? null, categoryId: match.category?.id ?? null, categoryName: match.category?.name ?? null, edited, warningCount, sanctionAction } } });
  res.json({ ok: true, moderated: true, reason: match.reason, category: match.category?.name ?? null }); return true;
}
const RAID_CAPTCHA: CaptchaBlock = { id: 'raid-captcha', type: 'captcha', enabled: true, text: '**{name}**, в группе включена защита от наплыва участников. Подтвердите, что вы человек.', buttonText: 'Я человек', timeoutSeconds: 300, failureAction: 'kick', deleteOnSuccess: true, skipBots: false, skipAdmins: true, skipTrusted: true };

async function raidModeActive(communityId: string): Promise<boolean> {
  const state = await prisma.moderatorConversationState.findUnique({ where: { communityId }, select: { raidModeUntil: true } });
  return Boolean(state?.raidModeUntil && state.raidModeUntil > new Date());
}

const appealKeyboard = (communityId: string, tgUserId: string): TelegramInlineKeyboard => ({ inline_keyboard: [[{ text: 'Оспорить', callback_data: `appeal:${communityId}:${tgUserId}` }]] });

async function handleProbation(update: ModeratorUpdate, message: TgMessage, edited: boolean, res: Response): Promise<boolean> {
  if (!message.from || message.from.is_bot || message.new_chat_members?.length) return false;
  const ctx = await publishedContext(String(message.chat.id)); if (!ctx) return false;
  const block = ctx.probation;
  const raidGuard = ctx.antiSpam?.raidEnabled ? await raidModeActive(ctx.community.id) : false;
  if (!block && !raidGuard) return false;
  const member = await prisma.communityMember.findUnique({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(message.from.id) } }, select: { id: true, trusted: true, joinedAt: true, messagesCount: true } });
  if (member?.trusted) return false;
  const threshold = block?.messageThreshold ?? 0;
  const newcomer = Boolean(block && member?.joinedAt && Date.now() - member.joinedAt.getTime() < block.durationHours * 3600_000 && (threshold === 0 || member.messagesCount < threshold));
  const countMessage = async () => { if (member && newcomer && threshold > 0 && !edited) await prisma.communityMember.updateMany({ where: { id: member.id, messagesCount: { lt: threshold } }, data: { messagesCount: { increment: 1 } } }); };
  if (!newcomer && !raidGuard) { await countMessage(); return false; }
  let reason: 'LINK' | 'FORWARD' | 'MEDIA' | null = null;
  if ((raidGuard || block?.blockLinks) && domainsOf(message).length > 0) reason = 'LINK';
  else if ((raidGuard || block?.blockForwards) && (message.forward_origin || message.forward_from || message.forward_from_chat)) reason = 'FORWARD';
  else if ((raidGuard || block?.blockMedia) && mediaTypeOf(message)) reason = 'MEDIA';
  if (!reason) { await countMessage(); return false; }
  if (await isAdminCached(message.chat.id, message.from.id)) { await countMessage(); return false; }
  const duplicate = await prisma.moderationEvent.findUnique({ where: { telegramUpdateId: eventKey(update.update_id) }, select: { id: true } }); if (duplicate) { res.json({ ok: true, duplicate: true }); return true; }
  const warnable = Boolean(newcomer && block?.action === 'delete_warn');
  const audit = await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: eventKey(update.update_id), telegramMessageId: message.message_id, tgUserId: String(message.from.id), blockId: newcomer ? block?.id : ctx.antiSpam?.id, eventType: newcomer ? 'PROBATION_TRIGGERED' : 'RAID_GUARD_TRIGGERED', decision: reason, reason, action: warnable ? 'DELETE_WARN' : 'DELETE', status: 'RECEIVED', metadata: { edited, raidGuard, newcomer } } });
  try { await deleteBotMessage(message.chat.id, message.message_id, currentToken()); } catch (err) { await prisma.scheduledModerationAction.upsert({ where: { tgChatId_telegramMessageId_actionType: { tgChatId: String(message.chat.id), telegramMessageId: message.message_id, actionType: 'DELETE_MESSAGE' } }, create: { communityId: ctx.community.id, actionType: 'DELETE_MESSAGE', tgChatId: String(message.chat.id), telegramMessageId: message.message_id, executeAt: new Date(Date.now() + 60_000), lastError: (err as Error).message.slice(0, 500) }, update: { status: 'PENDING', executeAt: new Date(Date.now() + 60_000), lastError: (err as Error).message.slice(0, 500) } }); }
  let warningCount = 0, sanctionAction = 'NONE';
  if (warnable && ctx.warningPolicy) {
    const sanction = await issueWarning({ communityId: ctx.community.id, chatId: message.chat.id, tgUserId: String(message.from.id), telegramMessageId: message.message_id, reason: 'Ограничение для новых участников: ' + reason, source: 'PROBATION', eventId: audit.id, policy: ctx.warningPolicy, token: currentToken() });
    warningCount = sanction.count; sanctionAction = sanction.action;
    await prisma.moderationEvent.update({ where: { id: audit.id }, data: { action: 'DELETE_WARN_' + sanction.action } });
  }
  const thing = { LINK: 'ссылки', FORWARD: 'пересланные сообщения', MEDIA: 'медиафайлы' }[reason];
  const label = message.from.username ? '@' + message.from.username : message.from.first_name;
  const body = raidGuard && !newcomer ? `${label}, в группе временно включена защита от рейда — ${thing} недоступны.` : `${label}, ${thing} недоступны новым участникам. Немного пообщайтесь в группе — ограничение снимется.`;
  const notice = [body, warningNotice(sanctionAction as 'NONE' | 'WARN' | 'MUTE' | 'BAN', warningCount, ctx.warningPolicy)].filter(Boolean).join('\n\n');
  const keyboard = warnable && warningCount > 0 ? appealKeyboard(ctx.community.id, String(message.from.id)) : undefined;
  const ref = await sendBotMessage(message.chat.id, notice.slice(0, 1000), currentToken(), keyboard).catch(() => null);
  if (ref?.messageId) await prisma.scheduledModerationAction.upsert({ where: { tgChatId_telegramMessageId_actionType: { tgChatId: String(message.chat.id), telegramMessageId: ref.messageId, actionType: 'DELETE_MESSAGE' } }, create: { communityId: ctx.community.id, actionType: 'DELETE_MESSAGE', tgChatId: String(message.chat.id), telegramMessageId: ref.messageId, executeAt: new Date(Date.now() + 120_000) }, update: { executeAt: new Date(Date.now() + 120_000), status: 'PENDING', attempts: 0 } });
  await prisma.moderationEvent.update({ where: { id: audit.id }, data: { status: 'PROCESSED', metadata: { edited, raidGuard, newcomer, warningCount, sanctionAction } } });
  res.json({ ok: true, moderated: true, probation: true, reason }); return true;
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
    prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: eventKey(update.update_id), telegramMessageId: message.message_id, tgUserId: String(message.from.id), blockId: block.id, eventType: 'ANTISPAM_TRIGGERED', decision: reason, reason, action: block.action === 'delete_warn' ? 'DELETE_WARN' : 'DELETE', status: 'RECEIVED', metadata: { domains, sampleStored: true } } }),
  ]);
  try { await deleteBotMessage(message.chat.id, message.message_id, currentToken()); } catch (err) { await prisma.scheduledModerationAction.upsert({ where: { tgChatId_telegramMessageId_actionType: { tgChatId: String(message.chat.id), telegramMessageId: message.message_id, actionType: 'DELETE_MESSAGE' } }, create: { communityId: ctx.community.id, actionType: 'DELETE_MESSAGE', tgChatId: String(message.chat.id), telegramMessageId: message.message_id, executeAt: new Date(Date.now() + 60_000), lastError: (err as Error).message.slice(0, 500) }, update: { status: 'PENDING', executeAt: new Date(Date.now() + 60_000), lastError: (err as Error).message.slice(0, 500) } }); }
  if (block.action === 'delete_warn') { if (ctx.warningPolicy) { const sanction = await issueWarning({ communityId: ctx.community.id, chatId: message.chat.id, tgUserId: String(message.from.id), telegramMessageId: message.message_id, reason, source: 'ANTISPAM', eventId: audit.id, policy: ctx.warningPolicy, token: currentToken() }); await prisma.moderationEvent.update({ where: { id: audit.id }, data: { action: `DELETE_WARN_${sanction.action}` } }); } else await prisma.moderationWarning.create({ data: { communityId: ctx.community.id, tgUserId: String(message.from.id), reason, source: 'ANTISPAM', eventId: audit.id } }); const label = message.from.username ? '@' + message.from.username : message.from.first_name; await sendBotMessage(message.chat.id, label + ', сообщение удалено: ' + ({ LINK_BLOCKED: 'ссылка запрещена', DUPLICATE: 'повтор сообщения', FLOOD: 'слишком много сообщений' }[reason]), currentToken()).catch(() => undefined); }
  await prisma.moderationEvent.update({ where: { telegramUpdateId: eventKey(update.update_id) }, data: { status: 'PROCESSED' } });
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
  const duplicate = await prisma.moderationEvent.findUnique({ where: { telegramUpdateId: eventKey(update.update_id) }, select: { id: true } });
  if (duplicate) { res.json({ ok: true, duplicate: true }); return true; }
  const group = message.chat.title ?? ctx.community.moderatorChat?.title ?? 'сообщество';
  const channel = ctx.community.channel.name || (ctx.community.channel.handle ? '@' + ctx.community.channel.handle : 'канал');
  const richBlocks: PostBlock[] = [...(trigger.imageUrl ? [{ type: 'image' as const, url: trigger.imageUrl }] : []), { type: 'paragraph', runs: parseInline(variables(trigger.text, message.from, group, channel)) }];
  const keyboard = buildInlineKeyboard(trigger.buttons.map(b => ({ label: b.label, buttonLabel: b.label, url: b.url.startsWith('@') ? 'https://t.me/' + b.url.slice(1) : b.url, kind: 'url' })));
  const audit = await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: eventKey(update.update_id), telegramMessageId: message.message_id, tgUserId: String(message.from.id), blockId: trigger.id, eventType: 'TRIGGER_MATCHED', decision: trigger.matchMode.toUpperCase(), action: 'REPLY', status: 'RECEIVED', metadata: { name: trigger.name, matchMode: trigger.matchMode } } });
  try {
    const ref = await sendRichMessage(message.chat.id, blocksToRichHtml(richBlocks), currentToken(), keyboard);
    if (trigger.deleteTriggerMessage) await deleteBotMessage(message.chat.id, message.message_id, currentToken()).catch(() => undefined);
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
  if (block.interventionsEnabled) { const result = await processIntervention({ updateId: eventKey(update.update_id), communityId: ctx.community.id, ownerUserId: ctx.community.channel.userId, chatId: message.chat.id, tgUserId: String(message.from.id), username: message.from.username, displayName: message.from.first_name, telegramMessageId: message.message_id, text, block: effectiveBlock, warningPolicy: ctx.warningPolicy, channelContext: { channel: ctx.community.channel.name, handle: ctx.community.channel.handle, brandKit: ctx.community.channel.brandKit }, token: currentToken() }); res.json({ ok: true, aiIntervention: result }); return true; }
  const allowed = await reserveModeratorAiCheck(ctx.community.channel.userId, Math.ceil((text.length + effectiveBlock.rules.length + JSON.stringify(ctx.community.channel.brandKit ?? {}).length) / 4)); if (!allowed) return false;
  const ownerFeedback = await ownerFeedbackContext(ctx.community.id).catch(() => '');
  const decision = await moderateWithTerra({ text, rules: effectiveBlock.rules, channelContext: { channel: ctx.community.channel.name, handle: ctx.community.channel.handle, brandKit: ctx.community.channel.brandKit }, model: env.LAYOUT_MODEL, ownerFeedback });
  if (!decision || !decision.violation || decision.confidence < block.confidenceThreshold) return false;
  const audit = await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: eventKey(update.update_id), telegramMessageId: message.message_id, tgUserId: String(message.from.id), blockId: block.id, eventType: 'AI_MODERATION_TRIGGERED', decision: decision.category, confidence: decision.confidence, reason: decision.reason, action: block.action.toUpperCase(), status: 'RECEIVED', model: env.LAYOUT_MODEL, promptVersion: 'moderator-terra-v1' } });
  if (block.action !== 'review') await deleteBotMessage(message.chat.id, message.message_id, currentToken());
  if (block.action === 'delete_warn') { if (ctx.warningPolicy) { const sanction = await issueWarning({ communityId: ctx.community.id, chatId: message.chat.id, tgUserId: String(message.from.id), telegramMessageId: message.message_id, reason: decision.reason, source: 'AI', eventId: audit.id, policy: ctx.warningPolicy, token: currentToken() }); await prisma.moderationEvent.update({ where: { id: audit.id }, data: { action: 'DELETE_WARN_' + sanction.action } }); } else await prisma.moderationWarning.create({ data: { communityId: ctx.community.id, tgUserId: String(message.from.id), reason: decision.reason, source: 'AI', eventId: audit.id } }); }
  await prisma.moderationEvent.update({ where: { id: audit.id }, data: { status: 'PROCESSED' } });
  res.json({ ok: true, moderated: true, ai: true, decision }); return true;
}

async function handleCallback(update: ModeratorUpdate, query: CallbackQuery, res: Response) {
  const appeal = /^appeal:([^:]+):(\d+)$/.exec(query.data ?? '');
  if (appeal && query.message) {
    const [, communityId, targetId] = appeal;
    if (String(query.from.id) !== targetId) { await answerBotCallback(query.id, 'Эта кнопка для участника, получившего предупреждение.', currentToken()).catch(() => undefined); res.json({ ok: true, rejected: true }); return true; }
    const community = await prisma.community.findUnique({ where: { id: communityId }, select: { id: true, moderatorChat: { select: { title: true } }, channel: { select: { userId: true } } } });
    if (!community) { await answerBotCallback(query.id, 'Апелляция недоступна.', currentToken()).catch(() => undefined); res.json({ ok: true, expired: true }); return true; }
    const recent = await prisma.moderationEvent.findFirst({ where: { communityId, tgUserId: targetId, eventType: 'APPEAL', createdAt: { gte: new Date(Date.now() - 3600_000) } }, select: { id: true } });
    if (recent) { await answerBotCallback(query.id, 'Апелляция уже отправлена владельцу.', currentToken()).catch(() => undefined); res.json({ ok: true, duplicate: true }); return true; }
    const lastWarning = await prisma.moderationWarning.findFirst({ where: { communityId, tgUserId: targetId, revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { reason: true } });
    await prisma.moderationEvent.create({ data: { communityId, telegramUpdateId: eventKey(update.update_id), telegramMessageId: query.message.message_id, tgUserId: targetId, eventType: 'APPEAL', decision: 'APPEALED', reason: lastWarning?.reason?.slice(0, 500), status: 'PROCESSED', metadata: { username: query.from.username ?? null, firstName: query.from.first_name } } }).catch(() => undefined);
    const owner = await prisma.user.findUnique({ where: { id: community.channel.userId }, select: { telegramId: true } });
    const label = query.from.username ? '@' + query.from.username : query.from.first_name;
    if (owner?.telegramId) await sendBotMessage(Number(owner.telegramId), `⚖️ ${label} (ID ${targetId}) оспаривает предупреждение в «${community.moderatorChat?.title ?? 'группе'}»${lastWarning?.reason ? `\nПричина предупреждения: ${lastWarning.reason}` : ''}\nОтменить санкцию можно в журнале модерации Publium.`, currentToken()).catch(() => undefined);
    await answerBotCallback(query.id, 'Апелляция отправлена владельцу сообщества.', currentToken()).catch(() => undefined);
    res.json({ ok: true, appealed: true }); return true;
  }
  const match = /^captcha:([^:]+):(\d+)$/.exec(query.data ?? '');
  if (!match || !query.message) return false;
  const [, communityId, targetId] = match;
  if (String(query.from.id) !== targetId) { await answerBotCallback(query.id, 'Эта проверка предназначена другому участнику.', currentToken()).catch(() => undefined); res.json({ ok: true, rejected: true }); return true; }
  const ctx = await publishedContext(String(query.message.chat.id));
  if (!ctx || ctx.community.id !== communityId) { await answerBotCallback(query.id, 'Проверка уже недоступна.', currentToken()).catch(() => undefined); res.json({ ok: true, expired: true }); return true; }
  const member = await prisma.communityMember.findUnique({ where: { communityId_tgUserId: { communityId, tgUserId: targetId } } });
  if (!member || member.captchaStatus !== 'PENDING' || (member.captchaDeadline && member.captchaDeadline < new Date())) { await answerBotCallback(query.id, 'Время проверки истекло.', currentToken()).catch(() => undefined); res.json({ ok: true, expired: true }); return true; }
  const claimed = await prisma.communityMember.updateMany({ where: { id: member.id, captchaStatus: 'PENDING', captchaDeadline: { gte: new Date() } }, data: { captchaStatus: 'VERIFYING' } });
  if (claimed.count !== 1) { await answerBotCallback(query.id, 'Время проверки истекло.', currentToken()).catch(() => undefined); res.json({ ok: true, expired: true }); return true; }
  try { await restrictChatUser(query.message.chat.id, query.from.id, false, currentToken()); } catch (err) { await prisma.communityMember.update({ where: { id: member.id }, data: { captchaStatus: 'PENDING' } }).catch(() => undefined); throw err; }
  await prisma.$transaction([
    prisma.communityMember.update({ where: { id: member.id }, data: { captchaStatus: 'PASSED', captchaDeadline: null, verifiedAt: new Date(), status: 'ACTIVE' } }),
    prisma.scheduledModerationAction.updateMany({ where: { communityId, tgUserId: targetId, actionType: { startsWith: 'CAPTCHA_TIMEOUT' }, status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: new Date() } }),
    prisma.moderationEvent.create({ data: { communityId, telegramUpdateId: eventKey(update.update_id), telegramMessageId: query.message.message_id, tgUserId: targetId, blockId: ctx.captcha?.id, eventType: 'CAPTCHA_PASSED', action: 'UNRESTRICT', status: 'PROCESSED' } }),
  ]);
  if ((ctx.captcha ?? RAID_CAPTCHA).deleteOnSuccess) await deleteBotMessage(query.message.chat.id, query.message.message_id, currentToken()).catch(() => undefined);
  await answerBotCallback(query.id, 'Готово — доступ открыт.', currentToken()).catch(() => undefined);
  await sendWelcome(ctx, query.from, query.message.chat, member.joinCount > 1);
  res.json({ ok: true, passed: true }); return true;
}

async function trackRaidOnJoin(ctx: NonNullable<Awaited<ReturnType<typeof publishedContext>>>, joinedCount: number, chatTitle: string): Promise<boolean> {
  const antiSpam = ctx.antiSpam; if (!antiSpam?.raidEnabled) return false;
  const now = new Date();
  const state = await prisma.moderatorConversationState.upsert({ where: { communityId: ctx.community.id }, create: { communityId: ctx.community.id }, update: {} });
  const windowActive = Boolean(state.joinWindowStartedAt && now.getTime() - state.joinWindowStartedAt.getTime() < antiSpam.raidWindowSeconds * 1000);
  const joins = (windowActive ? state.joinsInWindow : 0) + joinedCount;
  const alreadyActive = Boolean(state.raidModeUntil && state.raidModeUntil > now);
  const triggered = !alreadyActive && joins >= antiSpam.raidJoinThreshold;
  const raidUntil = triggered ? new Date(now.getTime() + antiSpam.raidDurationMinutes * 60_000) : state.raidModeUntil;
  await prisma.moderatorConversationState.update({ where: { id: state.id }, data: { joinWindowStartedAt: windowActive ? state.joinWindowStartedAt : now, joinsInWindow: joins, ...(triggered ? { raidModeUntil: raidUntil } : {}) } });
  if (triggered && raidUntil) {
    await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: `raid:${ctx.community.id}:${raidUntil.getTime()}`, eventType: 'RAID_DETECTED', action: 'RAID_MODE_ON', status: 'PROCESSED', metadata: { joins, windowSeconds: antiSpam.raidWindowSeconds, durationMinutes: antiSpam.raidDurationMinutes, until: raidUntil.toISOString() } } }).catch(() => undefined);
    const owner = await prisma.user.findUnique({ where: { id: ctx.community.channel.userId }, select: { telegramId: true } });
    if (owner?.telegramId) await sendBotMessage(Number(owner.telegramId), `🚨 Похоже на рейд в «${chatTitle}»: ${joins} вступлений за ${antiSpam.raidWindowSeconds} сек. На ${antiSpam.raidDurationMinutes} мин включена защита: капча для всех новых участников, ссылки, пересылки и медиа заблокированы.`, currentToken()).catch(() => undefined);
  }
  return alreadyActive || triggered;
}

/**
 * Pulse analytics collection. Runs for EVERY group update, independent of which
 * moderator features are enabled — this webhook is the one place all messages
 * flow through, so it's the only honest source for community activity data.
 * Fire-and-forget: never blocks or fails message handling.
 */
async function recordPulseActivity(message: TgMessage): Promise<void> {
  const communityId = await communityIdForChat(String(message.chat.id));
  if (!communityId) return;
  const at = new Date();

  if (message.new_chat_members?.length) {
    await recordPulseMembership(communityId, 'join', message.new_chat_members.filter(m => !m.is_bot).length, at);
    return;
  }
  if (message.left_chat_member) {
    if (!message.left_chat_member.is_bot) await recordPulseMembership(communityId, 'leave', 1, at);
    return;
  }
  // A real human message (service messages carry no from / are bots).
  if (!message.from || message.from.is_bot) return;
  if (!message.text && !message.caption) return;
  await recordPulseMessage({ communityId, tgUserId: String(message.from.id), isReply: Boolean(message.reply_to_message), at });
}

async function recordCommunityManagerDisposition(update: ModeratorUpdate, message: TgMessage): Promise<void> {
  const community = await prisma.community.findFirst({
    where: { moderatorChat: { tgChatId: String(message.chat.id) }, moderator: { enabled: true } },
    select: { id: true, communityManager: { select: { id: true } } },
  });
  if (!community?.communityManager) return;
  const blocked = await prisma.moderationEvent.findFirst({
    where: { communityId: community.id, telegramMessageId: message.message_id, OR: [{ action: { contains: 'DELETE' } }, { eventType: { in: ['CONTENT_FILTER_TRIGGERED', 'ANTISPAM_TRIGGERED'] } }] },
    select: { id: true },
  });
  const handled = await prisma.moderationEvent.findFirst({ where: { communityId: community.id, telegramMessageId: message.message_id, eventType: 'TRIGGER_MATCHED' }, select: { id: true } });
  const action = blocked ? 'BLOCK' : handled ? 'IGNORE' : 'ALLOW';
  await prisma.moderationEvent.create({
    data: { communityId: community.id, telegramUpdateId: eventKey(update.update_id) + ':cm', telegramMessageId: message.message_id, tgUserId: message.from?.id ? String(message.from.id) : null, eventType: 'MESSAGE_DISPOSITION', action, status: 'PROCESSED' },
  }).catch(err => { if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err; });
  await prisma.communityManagerMessage.updateMany({
    where: { communityManagerId: community.communityManager.id, telegramMessageId: message.message_id },
    data: { moderationStatus: blocked ? 'BLOCKED' : handled ? 'IGNORED' : 'ALLOWED' },
  });
}
async function processModeratorWebhook(req: Request, res: Response): Promise<void> {
  const update = req.body as ModeratorUpdate;
  if (!Number.isInteger(update.update_id)) { res.json({ ok: true, ignored: true }); return; }
  const dispositionMessage = update.edited_message ?? update.message;
  if (dispositionMessage) res.once('finish', () => { void recordCommunityManagerDisposition(update, dispositionMessage).catch(err => console.error('[moderator/disposition]', (err as Error).message)); });
  // Pulse analytics: only fresh messages/events, never edits (an edit is not new activity).
  if (update.message) res.once('finish', () => { void recordPulseActivity(update.message!).catch(err => console.error('[pulse/record]', (err as Error).message)); });
  try {
    if (update.callback_query && await handleCallback(update, update.callback_query, res)) return;
    if (update.message) { const command = await handleManualCommand(eventKey(update.update_id), update.message, currentToken(), currentBotId()); if (command.handled) { res.json({ ok: true, command: command.command }); return; } }
    const filterMessage = update.edited_message ?? update.message;
    if (filterMessage && await handleProbation(update, filterMessage, Boolean(update.edited_message), res)) return;
    if (filterMessage && await handleContentFilters(update, filterMessage, Boolean(update.edited_message), res)) return;
    if (update.message && await handleAntiSpam(update, update.message, res)) return;
    if (update.message && await handleTriggers(update, update.message, res)) return;
    if (update.message && await handleAiModeration(update, update.message, res)) return;

  const joined = update.message?.new_chat_members ?? [];
  if (update.message && joined.length) {
    const ctx = await publishedContext(String(update.message.chat.id));
    if (!ctx) { res.json({ ok: true, ignored: true }); return; }
    try { await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: eventKey(update.update_id), telegramMessageId: update.message.message_id, eventType: 'MEMBER_JOINED', status: 'RECEIVED' } }); }
    catch (err) { if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { res.json({ ok: true, duplicate: true }); return; } throw err; }
    if (ctx.welcome?.deleteJoinMessage) await deleteBotMessage(update.message.chat.id, update.message.message_id, currentToken()).catch(() => undefined);
    const raidActive = await trackRaidOnJoin(ctx, joined.length, update.message.chat.title ?? ctx.community.moderatorChat?.title ?? 'группе');
    const captcha = ctx.captcha ?? (raidActive ? RAID_CAPTCHA : undefined);
    let challenged = 0, welcomed = 0, skipped = 0, flagged = 0;
    for (const member of joined) {
      const existing = await prisma.communityMember.findUnique({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(member.id) } }, select: { joinCount: true, trusted: true } });
      const returning = Boolean(existing?.joinCount);
      if (ctx.antiSpam?.blacklistEnabled && !existing?.trusted && !member.is_bot) {
        const bans = await prisma.communityMember.count({ where: { tgUserId: String(member.id), status: 'BANNED', communityId: { not: ctx.community.id } } });
        if (bans >= ctx.antiSpam.blacklistThreshold) {
          const blAction = ctx.antiSpam.blacklistAction;
          await prisma.moderationEvent.create({ data: { communityId: ctx.community.id, telegramUpdateId: eventKey(update.update_id) + ':bl:' + member.id, telegramMessageId: update.message.message_id, tgUserId: String(member.id), blockId: ctx.antiSpam.id, eventType: 'GLOBAL_BLACKLIST', decision: String(bans), reason: `Забанен в ${bans} других сообществах Publium`, action: blAction.toUpperCase(), status: 'PROCESSED', metadata: { bans, action: blAction } } }).catch(() => undefined);
          if (blAction === 'kick') {
            await kickChatUser(update.message.chat.id, member.id, currentToken()).catch(() => undefined);
            await prisma.communityMember.upsert({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(member.id) } }, create: { communityId: ctx.community.id, tgUserId: String(member.id), joinedAt: new Date(), joinCount: 1, status: 'REMOVED' }, update: { joinedAt: new Date(), joinCount: { increment: 1 }, status: 'REMOVED' } });
            flagged++; continue;
          }
          if (blAction === 'restrict') {
            await restrictChatUser(update.message.chat.id, member.id, true, currentToken()).catch(() => undefined);
            await prisma.communityMember.upsert({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(member.id) } }, create: { communityId: ctx.community.id, tgUserId: String(member.id), joinedAt: new Date(), joinCount: 1, status: 'RESTRICTED' }, update: { joinedAt: new Date(), joinCount: { increment: 1 }, status: 'RESTRICTED' } });
            flagged++; continue;
          }
        }
      }
      let exempt = Boolean(captcha && ((captcha.skipBots && member.is_bot) || (captcha.skipTrusted && existing?.trusted)));
      if (captcha?.skipAdmins && !exempt) { const role = await getChatMember(String(update.message.chat.id), member.id, currentToken()).catch(() => null); exempt = Boolean(role && ['administrator', 'creator'].includes(role.status)); }
      const deadline = captcha && !exempt ? new Date(Date.now() + captcha.timeoutSeconds * 1000) : null;
      await prisma.communityMember.upsert({ where: { communityId_tgUserId: { communityId: ctx.community.id, tgUserId: String(member.id) } }, create: { communityId: ctx.community.id, tgUserId: String(member.id), joinedAt: new Date(), joinCount: 1, status: deadline ? 'RESTRICTED' : 'ACTIVE', captchaStatus: deadline ? 'PENDING' : null, captchaDeadline: deadline }, update: { joinedAt: new Date(), joinCount: { increment: 1 }, status: deadline ? 'RESTRICTED' : 'ACTIVE', captchaStatus: deadline ? 'PENDING' : null, captchaDeadline: deadline } });
      if (captcha && deadline) {
        await restrictChatUser(update.message.chat.id, member.id, true, currentToken());
        const group = update.message.chat.title ?? ctx.community.moderatorChat?.title ?? 'сообщество';
        const keyboard: TelegramInlineKeyboard = { inline_keyboard: [[{ text: captcha.buttonText, callback_data: `captcha:${ctx.community.id}:${member.id}` }]] };
        const captchaBlocks: PostBlock[] = [{ type: 'paragraph', runs: parseInline(variables(captcha.text, member, group, ctx.community.channel.name)) }];
        const ref = await sendRichMessage(update.message.chat.id, blocksToRichHtml(captchaBlocks), currentToken(), keyboard);
        if (!ref) throw new Error('CAPTCHA_MESSAGE_REF_MISSING');
        const actionType = captcha.failureAction === 'kick' ? 'CAPTCHA_TIMEOUT_KICK' : 'CAPTCHA_TIMEOUT_RESTRICT';
        await prisma.scheduledModerationAction.create({ data: { communityId: ctx.community.id, actionType, tgChatId: String(update.message.chat.id), telegramMessageId: ref.messageId, tgUserId: String(member.id), executeAt: deadline } });
        challenged++;
      } else {
        let skipWelcome = Boolean(ctx.welcome?.skipBots && member.is_bot);
        if (ctx.welcome?.skipAdmins && !skipWelcome) { const role = await getChatMember(String(update.message.chat.id), member.id, currentToken()).catch(() => null); skipWelcome = Boolean(role && ['administrator', 'creator'].includes(role.status)); }
        if (skipWelcome) skipped++; else { const ref = await sendWelcome(ctx, member, update.message.chat, returning); if (ref || ctx.welcome) welcomed++; else skipped++; }
      }
    }
    await prisma.moderationEvent.update({ where: { telegramUpdateId: eventKey(update.update_id) }, data: { status: 'PROCESSED', action: challenged ? 'CAPTCHA_SENT' : 'WELCOME_SENT', metadata: { challenged, welcomed, skipped, flagged, raidActive } } });
    res.json({ ok: true, challenged, welcomed, skipped, flagged }); return;
  }

  if (!update.my_chat_member) { res.json({ ok: true, ignored: true }); return; }
  const id = eventKey(update.update_id);
  try { await prisma.moderationEvent.create({ data: { telegramUpdateId: id, eventType: 'BOT_MEMBERSHIP_CHANGED', status: 'RECEIVED' } }); } catch (err) { if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { res.json({ ok: true, duplicate: true }); return; } throw err; }
  const m = update.my_chat_member;
  if (['group', 'supergroup'].includes(m.chat.type)) { const rights = rightsOf(m.new_chat_member); const chat = await prisma.moderatorChat.upsert({ where: { tgChatId: String(m.chat.id) }, create: { tgChatId: String(m.chat.id), title: m.chat.title ?? 'Telegram group', username: m.chat.username ?? null, type: m.chat.type, botStatus: m.new_chat_member.status, grantedRights: rights, addedByTgId: m.from?.id ? String(m.from.id) : null, lastUpdateId: id }, update: { title: m.chat.title ?? 'Telegram group', username: m.chat.username ?? null, type: m.chat.type, botStatus: m.new_chat_member.status, grantedRights: rights, addedByTgId: m.from?.id ? String(m.from.id) : undefined, lastUpdateId: id } }); await prisma.moderationEvent.update({ where: { telegramUpdateId: id }, data: { status: 'PROCESSED', metadata: { moderatorChatId: chat.id, botStatus: chat.botStatus, rights } } }); }
  if (moderatorRuntime.getStore()?.managed && ['left', 'kicked'].includes(m.new_chat_member.status)) {
    const managed = await prisma.managedModeratorBot.findUnique({ where: { tgBotId: String(currentBotId()) }, select: { id: true, communityId: true } });
    if (managed) await prisma.$transaction([
      prisma.managedModeratorBot.update({ where: { id: managed.id }, data: { status: 'ERROR', lastError: 'Бот удалён из группы. Добавьте его снова и повторите подключение.' } }),
      prisma.moderator.updateMany({ where: { communityId: managed.communityId, executorType: 'CUSTOM' }, data: { enabled: false, status: 'PAUSED' } }),
    ]);
  }
  res.json({ ok: true });
  } catch (err) {
    console.error('[moderator/webhook] execution failed:', (err as Error).message);
    await prisma.moderationEvent.updateMany({ where: { telegramUpdateId: eventKey(update.update_id) }, data: { status: 'FAILED', reason: (err as Error).message.slice(0, 500) } }).catch(() => undefined);
    if (update.callback_query) await answerBotCallback(update.callback_query.id, 'Не удалось завершить проверку. Попробуйте ещё раз.', currentToken()).catch(() => undefined);
    res.status(200).json({ ok: true, executed: false });
  }}

router.post('/webhook/:botId', async (req: Request, res: Response): Promise<void> => {
  const incoming = req.headers['x-telegram-bot-api-secret-token'];
  const resolved = await incomingManagedBot(req.params['botId'] ?? '', typeof incoming === 'string' ? incoming : undefined).catch(() => null);
  if (!resolved) { res.status(401).json({ error: 'Unauthorized' }); return; }
  await moderatorRuntime.run({ token: resolved.token, botId: resolved.numericBotId, managed: true }, () => processModeratorWebhook(req, res));
});

router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const incoming = req.headers['x-telegram-bot-api-secret-token'];
  if (typeof incoming !== 'string' || !safeEqual(incoming, env.MODERATOR_WEBHOOK_SECRET)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  await moderatorRuntime.run({ token: env.MODERATOR_BOT_TOKEN, botId: getBotIdFromToken(env.MODERATOR_BOT_TOKEN), managed: false }, () => processModeratorWebhook(req, res));
});

router.get('/ai-entitlement', async (req, res) => { let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; } const entitlement = await syncModeratorEntitlement(auth.user.id); res.json({ entitlement }); });

router.post('/moderators/:moderatorId/simulate-intervention',async(req,res)=>{const{conversation}=req.body as{conversation?:unknown};let auth;try{auth=await authenticate(req)}catch(e){authError(res,e);return}if(typeof conversation!=='string'||conversation.trim().length<10){res.status(400).json({error:'Добавьте пример диалога'});return}const moderator=await prisma.moderator.findFirst({where:{id:req.params['moderatorId'],community:{channel:{userId:auth.user.id}}},include:{community:{include:{channel:{include:{brandKit:true}}}}}});if(!moderator){res.status(404).json({error:'Moderator not found'});return}const draft=await prisma.moderatorConfig.findUnique({where:{moderatorId_version:{moderatorId:moderator.id,version:moderator.draftVersion}}}),block=parseBlocks(draft?.blocks??[]).find(b=>b.type==='ai_moderation') as AiModerationBlock|undefined;if(!block){res.status(409).json({error:'Сначала сохраните AI-модерацию'});return}const allowed=await reserveModeratorAiCheck(auth.user.id,Math.ceil(conversation.length/4),100);if(!allowed){res.status(429).json({error:'Месячный лимит AI-модерации исчерпан'});return}const decision=await simulateIntervention({conversation:conversation.trim(),rules:block.rules,scenarios:block.interventionScenarios,tone:block.interventionTone,personality:block.personality,channelContext:{channel:moderator.community.channel.name,handle:moderator.community.channel.handle,brandKit:moderator.community.channel.brandKit}});if(!decision){res.status(502).json({error:'Terra не вернула решение'});return}res.json({decision})});

router.post('/moderators/:moderatorId/pause', async (req, res) => { const { enabled } = req.body as { enabled?: unknown }; let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; } if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled must be boolean' }); return; } const moderator = await prisma.moderator.findFirst({ where: { id: req.params['moderatorId'], community: { channel: { userId: auth.user.id } } } }); if (!moderator) { res.status(404).json({ error: 'Moderator not found' }); return; } const updated = await prisma.moderator.update({ where: { id: moderator.id }, data: { enabled, status: enabled ? 'ACTIVE' : 'PAUSED' } }); res.json({ moderator: updated }); });

router.get('/available-chats', async (req, res) => { let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; } res.json({ chats: await prisma.moderatorChat.findMany({ where: { addedByTgId: auth.tgUserId, botStatus: { in: ['administrator', 'creator', 'member'] }, community: null }, orderBy: { updatedAt: 'desc' }, select: { id: true, tgChatId: true, title: true, username: true, type: true, botStatus: true, grantedRights: true } }) }); });
router.get('/channels/:channelId/community', async (req, res) => {
  let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; }
  const channel = await prisma.channel.findFirst({ where: { id: req.params['channelId'], userId: auth.user.id }, select: { id: true } });
  if (!channel) { res.status(404).json({ error: 'Channel not found' }); return; }
  const [community, entitlement] = await Promise.all([
    prisma.community.findUnique({ where: { channelId: channel.id }, include: { moderatorChat: true, managedBot: true, moderator: { include: { configs: { orderBy: { version: 'desc' }, take: 1 } } } } }),
    prisma.aiModeratorEntitlement.findUnique({ where: { userId: auth.user.id }, select: { status: true, monthlyChecksLimit: true, checksUsed: true } }),
  ]);
  if (!community) { res.json({ community: null, requiredRights: REQUIRED_BASE_RIGHTS, botUsername: env.MODERATOR_BOT_USERNAME, aiModerator: entitlement }); return; }
  const { managedBot, ...safeCommunity } = community;
  res.json({ community: { ...safeCommunity, managedBot: managedBotPublic(managedBot) }, requiredRights: REQUIRED_BASE_RIGHTS, botUsername: env.MODERATOR_BOT_USERNAME, aiModerator: entitlement });
});
router.post('/channels/:channelId/community', async (req, res) => {
  const { moderatorChatId } = req.body as { moderatorChatId?: unknown };
  let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; }
  if (typeof moderatorChatId !== 'string') { res.status(400).json({ error: 'moderatorChatId is required' }); return; }

  const channel = await prisma.channel.findFirst({
    where: { id: req.params['channelId'], userId: auth.user.id },
    include: { community: { select: { id: true, moderatorChatId: true } } },
  });
  const chat = await prisma.moderatorChat.findFirst({ where: { id: moderatorChatId, addedByTgId: auth.tgUserId } });
  if (!channel || !chat) { res.status(404).json({ error: 'Channel or group not found' }); return; }

  const subscription = await getEffectiveSubscription(auth.user.id);
  const chatLimit = TIER_LIMITS[subscription.tier].communityChatLimit;
  if (!channel.community?.moderatorChatId) {
    const usedChats = await prisma.community.count({ where: { channel: { userId: auth.user.id }, moderatorChatId: { not: null } } });
    if (usedChats >= chatLimit) {
      res.status(403).json({ error: `Тариф ${subscription.tier} позволяет подключить до ${chatLimit} чатов.`, code: 'COMMUNITY_CHAT_LIMIT', limit: chatLimit });
      return;
    }
  }

  try {
    const [bot, user] = await Promise.all([
      getChatMember(chat.tgChatId, getBotIdFromToken(currentToken()), currentToken()),
      getChatMember(chat.tgChatId, Number(auth.tgUserId), currentToken()),
    ]);
    if (!['administrator', 'creator'].includes(bot.status) || !['administrator', 'creator'].includes(user.status)) {
      res.status(403).json({ error: 'ModerBot and you must be group administrators.' }); return;
    }
  } catch (e) {
    res.status(502).json({ error: e instanceof TelegramApiError ? e.message : 'Telegram check failed' }); return;
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
      update: { grantedRights: chat.grantedRights ?? undefined, lastRightsCheckAt: new Date() },
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
router.post('/communities/:communityId/managed-bot/request', async (req, res) => {
  const { displayName, username, avatarUrl } = req.body as { displayName?: unknown; username?: unknown; avatarUrl?: unknown };
  let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; }
  const community = await prisma.community.findFirst({ where: { id: req.params['communityId'], channel: { userId: auth.user.id } }, include: { channel: true, managedBot: true } });
  if (!community) { res.status(404).json({ error: 'Community not found' }); return; }
  const slot = await hasCustomBotSlot(auth.user.id, community.id);
  if (!slot.ok) { res.status(403).json({ error: `Лимит персональных ботов исчерпан (${slot.limit} чатов).`, code: 'CUSTOM_BOT_LIMIT', limit: slot.limit }); return; }
  const entitlement = await prisma.aiModeratorEntitlement.upsert({ where: { userId: auth.user.id }, create: { userId: auth.user.id, status: 'TRIAL' }, update: {} });
  if (entitlement.status === 'DISABLED') { res.status(402).json({ error: 'Подписка AI Moderator не активна' }); return; }
  const name = typeof displayName === 'string' ? displayName.trim().slice(0, 64) : '';
  const suggestedUsername = typeof username === 'string' ? username.trim().replace(/^@/, '') : '';
  if (name.length < 2) { res.status(400).json({ error: 'Название должно содержать минимум 2 символа' }); return; }
  if (!/^[A-Za-z][A-Za-z0-9_]{3,30}[Bb][Oo][Tt]$/.test(suggestedUsername)) { res.status(400).json({ error: 'Username: 5–32 символа, латиница/цифры/_ и окончание bot' }); return; }
  if (community.managedBot && ['READY', 'ACTIVE'].includes(community.managedBot.status)) {
    res.status(409).json({ error: 'Персональный бот уже создан — измените его оформление вместо повторного создания' }); return;
  }
  const manager = await getBotIdentity(env.TELEGRAM_BOT_TOKEN).catch(() => null);
  if (!manager?.username || manager.can_manage_bots !== true) {
    res.status(409).json({ error: 'Включите Bot Management Mode у @Publiumbot в BotFather и повторите', code: 'BOT_MANAGEMENT_DISABLED' }); return;
  }
  const expires = new Date(Date.now() + 30 * 60_000);
  await prisma.managedModeratorBot.updateMany({ where: { ownerUserId: auth.user.id, status: 'REQUESTED', communityId: { not: community.id } }, data: { status: 'CANCELLED', lastError: 'Создан новый запрос для другого сообщества' } });
  await prisma.managedCommunityManagerBot.updateMany({ where: { ownerUserId: auth.user.id, status: 'REQUESTED' }, data: { status: 'CANCELLED', lastError: 'Создан новый запрос для Moderator' } });
  const bot = await prisma.managedModeratorBot.upsert({
    where: { communityId: community.id },
    create: { communityId: community.id, ownerUserId: auth.user.id, displayName: name, expectedUsername: suggestedUsername.toLowerCase(), avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : null, status: 'REQUESTED', requestExpiresAt: expires },
    update: { ownerUserId: auth.user.id, tgBotId: null, username: null, expectedUsername: suggestedUsername.toLowerCase(), displayName: name, avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : null, tokenCipher: null, tokenIv: null, tokenTag: null, webhookSecret: null, status: 'REQUESTED', lastError: null, requestExpiresAt: expires },
  });
  const createUrl = 'https://t.me/newbot/' + manager.username + '/' + suggestedUsername + '?name=' + encodeURIComponent(name);
  res.json({ managedBot: managedBotPublic(bot), createUrl });
});

router.patch('/communities/:communityId/managed-bot/profile', async (req, res) => {
  const { displayName, avatarUrl } = req.body as { displayName?: unknown; avatarUrl?: unknown };
  let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; }
  const community = await prisma.community.findFirst({ where: { id: req.params['communityId'], channel: { userId: auth.user.id } }, include: { managedBot: true } });
  if (!community?.managedBot) { res.status(404).json({ error: 'Персональный бот не найден' }); return; }
  const name = typeof displayName === 'string' ? displayName.trim().slice(0, 64) : '';
  if (name.length < 2) { res.status(400).json({ error: 'Название должно содержать минимум 2 символа' }); return; }
  const warning = await updateManagedBotProfile(community.managedBot.id, name, typeof avatarUrl === 'string' ? avatarUrl : community.managedBot.avatarUrl).catch(error => {
    res.status(502).json({ error: (error as Error).message }); return undefined;
  });
  if (res.headersSent) return;
  const updated = await prisma.managedModeratorBot.findUnique({ where: { id: community.managedBot.id } });
  res.json({ managedBot: managedBotPublic(updated), warning });
});

router.post('/communities/:communityId/managed-bot/activate', async (req, res) => {
  let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; }
  const community = await prisma.community.findFirst({ where: { id: req.params['communityId'], channel: { userId: auth.user.id } }, include: { moderatorChat: true, moderator: true, managedBot: true } });
  if (!community?.moderatorChat || !community.moderator || !community.managedBot?.tgBotId || !community.managedBot.webhookSecret) { res.status(409).json({ error: 'Сначала создайте персонального бота' }); return; }
  let token: string;
  try { token = decryptManagedBotToken(community.managedBot); } catch { res.status(409).json({ error: 'Токен персонального бота недоступен — создайте его заново' }); return; }
  try {
    const [botRole, userRole] = await Promise.all([
      getChatMember(community.moderatorChat.tgChatId, Number(community.managedBot.tgBotId), token),
      getChatMember(community.moderatorChat.tgChatId, Number(auth.tgUserId), token),
    ]);
    if (!['administrator', 'creator'].includes(botRole.status) || !['administrator', 'creator'].includes(userRole.status)) {
      res.status(403).json({ error: 'Добавьте персонального бота администратором группы и выдайте права удаления и блокировки' }); return;
    }
    await setBotWebhook(token, env.PUBLIC_BASE_URL + '/api/moderator/webhook/' + community.managedBot.tgBotId, community.managedBot.webhookSecret);
    const [, bot] = await prisma.$transaction([
      prisma.moderator.update({ where: { id: community.moderator.id }, data: { executorType: 'CUSTOM', grantedRights: rightsOf(botRole as TgAdmin), lastRightsCheckAt: new Date() } }),
      prisma.managedModeratorBot.update({ where: { id: community.managedBot.id }, data: { status: 'ACTIVE', lastError: null } }),
    ]);
    res.json({ executorType: 'CUSTOM', managedBot: managedBotPublic(bot) });
  } catch (error) {
    res.status(502).json({ error: error instanceof TelegramApiError ? error.message : 'Не удалось проверить персонального бота' });
  }
});

router.post('/communities/:communityId/executor/shared', async (req, res) => {
  let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; }
  const community = await prisma.community.findFirst({ where: { id: req.params['communityId'], channel: { userId: auth.user.id } }, include: { moderatorChat: true, moderator: true, managedBot: true } });
  if (!community?.moderatorChat || !community.moderator) { res.status(404).json({ error: 'Community not found' }); return; }
  try {
    const [botRole, userRole] = await Promise.all([
      getChatMember(community.moderatorChat.tgChatId, getBotIdFromToken(env.MODERATOR_BOT_TOKEN), env.MODERATOR_BOT_TOKEN),
      getChatMember(community.moderatorChat.tgChatId, Number(auth.tgUserId), env.MODERATOR_BOT_TOKEN),
    ]);
    if (!['administrator', 'creator'].includes(botRole.status) || !['administrator', 'creator'].includes(userRole.status)) { res.status(403).json({ error: 'Сначала добавьте @' + env.MODERATOR_BOT_USERNAME + ' администратором группы' }); return; }
    await prisma.$transaction([
      prisma.moderator.update({ where: { id: community.moderator.id }, data: { executorType: 'SHARED', grantedRights: rightsOf(botRole as TgAdmin), lastRightsCheckAt: new Date() } }),
      ...(community.managedBot ? [prisma.managedModeratorBot.update({ where: { id: community.managedBot.id }, data: { status: 'READY' } })] : []),
    ]);
    res.json({ executorType: 'SHARED' });
  } catch (error) {
    res.status(502).json({ error: error instanceof TelegramApiError ? error.message : 'Не удалось проверить общего бота' });
  }
});

router.post('/communities/:communityId/events/:eventId/reverse', async (req, res) => {
  let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; }
  const event = await prisma.moderationEvent.findFirst({ where: { id: req.params['eventId'], communityId: req.params['communityId'], community: { channel: { userId: auth.user.id } } }, include: { community: { include: { moderatorChat: true } } } });
  if (!event?.tgUserId || !event.community?.moderatorChat) { res.status(404).json({ error: 'Event not found or cannot be reversed' }); return; }
  if (event.reversedAt) { res.json({ event, duplicate: true }); return; }
  const chatId = event.community.moderatorChat.tgChatId, userId = Number(event.tgUserId), action = event.action ?? '';
  const executorToken = await moderatorTokenForCommunity(event.communityId!);
  if (action.includes('BAN')) { await unbanChatUser(chatId, userId, executorToken); await prisma.communityMember.updateMany({ where: { communityId: event.communityId!, tgUserId: event.tgUserId }, data: { status: 'ACTIVE', bannedAt: null } }); }
  else if (action.includes('MUTE')) { await restrictChatUser(chatId, userId, false, executorToken); await prisma.communityMember.updateMany({ where: { communityId: event.communityId!, tgUserId: event.tgUserId }, data: { status: 'ACTIVE', muteUntil: null } }); await prisma.scheduledModerationAction.updateMany({ where: { communityId: event.communityId!, tgUserId: event.tgUserId, actionType: 'UNMUTE_USER', status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: new Date() } }); }
  await prisma.moderationWarning.updateMany({ where: { communityId: event.communityId!, tgUserId: event.tgUserId, eventId: event.id, revokedAt: null }, data: { revokedAt: new Date() } });
  const aiEvent = ['AI_INTERVENTION', 'AI_MODERATION_TRIGGERED'].includes(event.eventType);
  const reversed = await prisma.moderationEvent.update({ where: { id: event.id }, data: { reversedAt: new Date(), reversedById: auth.user.id, ...(aiEvent ? { feedback: 'FALSE_POSITIVE' } : {}) } });
  res.json({ event: reversed });
});

router.post('/communities/:communityId/events/:eventId/feedback', async (req, res) => {
  const { value } = req.body as { value?: unknown };
  let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; }
  if (value !== 'CONFIRMED' && value !== 'FALSE_POSITIVE') { res.status(400).json({ error: 'value must be CONFIRMED or FALSE_POSITIVE' }); return; }
  const event = await prisma.moderationEvent.findFirst({ where: { id: req.params['eventId'], communityId: req.params['communityId'], community: { channel: { userId: auth.user.id } } }, select: { id: true } });
  if (!event) { res.status(404).json({ error: 'Event not found' }); return; }
  const updated = await prisma.moderationEvent.update({ where: { id: event.id }, data: { feedback: value } });
  res.json({ event: updated });
});

router.get('/communities/:communityId/events', async (req, res) => {
  let auth; try { auth = await authenticate(req); } catch (e) { authError(res, e); return; }
  const community = await prisma.community.findFirst({ where: { id: req.params['communityId'], channel: { userId: auth.user.id } }, select: { id: true } });
  if (!community) { res.status(404).json({ error: 'Community not found' }); return; }
  const events = await prisma.moderationEvent.findMany({ where: { communityId: community.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ events });
});

export default router;
