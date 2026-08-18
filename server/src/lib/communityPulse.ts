/**
 * communityPulse.ts — data collection for the community "Пульс" dashboard.
 *
 * Records what actually happened in the group chat, at the ONLY granularity that
 * makes long-period analytics correct: one row per participant per day. Unique
 * actives, DAU/MAU, cohorts, Orbit tiers and concentration cannot be derived by
 * summing daily numbers (a person active 20 days is ONE monthly active, not 20),
 * so month/quarter/year are always computed from these facts.
 *
 * Recording is fire-and-forget and never blocks or breaks message handling.
 */

import { prisma } from '../db';

const MSK_TZ = 'Europe/Moscow';

/** 'YYYY-MM-DD' in Moscow time — the canonical day key for every Pulse metric. */
export function pulseDayKey(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: MSK_TZ });
}

/** Hour 0–23 in Moscow time (for the hour × weekday heatmap). */
export function pulseHour(date = new Date()): number {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: MSK_TZ, hour: '2-digit', hourCycle: 'h23' }).format(date));
  return Number.isFinite(h) ? h : 0;
}

type PulseModerationEvent = { eventType: string; action: string | null; decision: string | null; tgUserId: string | null; metadata: unknown };
const pulseMeta = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

/** Weighted harm signal. Spam affects cleanliness; directed harassment affects climate much more. */
export function pulseToxicityWeight(event: PulseModerationEvent): number {
  const meta = pulseMeta(event.metadata), category = String(meta['category'] ?? event.decision ?? 'other'), severity = String(meta['severity'] ?? 'medium');
  if (event.eventType === 'CONVERSATION_EPISODE') {
    if (meta['source'] === 'MESSAGE_MODERATED') return 0;
    const state = String(meta['state'] ?? 'OBSERVING');
    if (state === 'RESOLVED') return 0;
    return category === 'harassment' ? (state === 'ESCALATING' ? 3 : 2) : category === 'conflict' ? (state === 'ESCALATING' ? 2 : 1) : .4;
  }
  if (event.eventType !== 'AI_MODERATION_TRIGGERED' && !['CONTENT_FILTER_TRIGGERED','ANTISPAM_TRIGGERED'].includes(event.eventType)) return 0;
  const severityWeight = severity === 'high' ? 2.5 : severity === 'low' ? .5 : 1;
  const categoryWeight: Record<string, number> = { harassment:2, threat:2.5, hate:2.5, insult:1.3, toxicity:1.2, profanity:.7, spam:.4, promotion:.4, fraud:1.2 };
  return severityWeight * (categoryWeight[category] ?? .7);
}

export function pulseClimateScore(messages: number, toxicityWeight: number): number {
  if (messages <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(100 - (toxicityWeight / messages) * 120)));
}

// chatId → communityId, so we don't hit the DB for every single message.
const communityByChat = new Map<string, { id: string | null; expiresAt: number }>();

/** Resolves the community for a group chat id (cached 5 min; null = not ours). */
export async function communityIdForChat(tgChatId: string): Promise<string | null> {
  const cached = communityByChat.get(tgChatId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.id;
  const community = await prisma.community.findFirst({ where: { moderatorChat: { tgChatId } }, select: { id: true } }).catch(() => null);
  const id = community?.id ?? null;
  communityByChat.set(tgChatId, { id, expiresAt: now + (id ? 300_000 : 60_000) });
  if (communityByChat.size > 2000) for (const [k, v] of communityByChat) if (v.expiresAt <= now) communityByChat.delete(k);
  return id;
}

const emptyHours = (): number[] => Array.from({ length: 24 }, () => 0);

/**
 * Records one human message: the participant-day fact + the day's hour bucket.
 * `isReply` feeds the engagement axis; `firstDay` marks a person's first ever
 * message here (lurker → contributor conversion).
 *
 * Three independent sources observe the chat (moderator webhook, CM webhook,
 * GramJS personas) so every call carries `telegramMessageId` and the first
 * writer claims it — otherwise an active chat would count 2–3× per message.
 */
export async function recordPulseMessage(input: { communityId: string; tgUserId: string; telegramMessageId: number; isReply: boolean; at?: Date }): Promise<void> {
  // Claim the message without using an expected duplicate as an exception.
  // Moderator, CM and Community Core can observe the same Telegram message;
  // createMany + skipDuplicates keeps the first writer and leaves production
  // error logs for actual database failures.
  const claim = await prisma.pulseMessageClaim.createMany({
    data: [{ communityId: input.communityId, telegramMessageId: input.telegramMessageId }],
    skipDuplicates: true,
  });
  if (claim.count === 0) return;

  const at = input.at ?? new Date();
  const day = pulseDayKey(at);
  const hour = pulseHour(at);

  // Has this person ever spoken here before today? (cheap: indexed lookup)
  const seenBefore = await prisma.communityDailyParticipant.findFirst({
    where: { communityId: input.communityId, tgUserId: input.tgUserId, day: { not: day } },
    select: { id: true },
  });

  await prisma.communityDailyParticipant.upsert({
    where: { communityId_tgUserId_day: { communityId: input.communityId, tgUserId: input.tgUserId, day } },
    create: { communityId: input.communityId, tgUserId: input.tgUserId, day, messages: 1, replies: input.isReply ? 1 : 0, firstDay: !seenBefore },
    update: { messages: { increment: 1 }, ...(input.isReply ? { replies: { increment: 1 } } : {}) },
  });

  // Hour histogram lives on the day row; read-modify-write is fine at chat volume.
  const stat = await prisma.communityDailyStat.findUnique({ where: { communityId_day: { communityId: input.communityId, day } }, select: { hourHistogram: true } });
  const hours = Array.isArray(stat?.hourHistogram) ? [...(stat!.hourHistogram as number[])] : emptyHours();
  while (hours.length < 24) hours.push(0);
  hours[hour] = (hours[hour] ?? 0) + 1;
  await prisma.communityDailyStat.upsert({
    where: { communityId_day: { communityId: input.communityId, day } },
    create: { communityId: input.communityId, day, hourHistogram: hours },
    update: { hourHistogram: hours },
  });
}

/** Counts a join or a leave on the day it happened (leaves = churn signal). */
export async function recordPulseMembership(communityId: string, kind: 'join' | 'leave', count = 1, at = new Date()): Promise<void> {
  if (count <= 0) return;
  const day = pulseDayKey(at);
  await prisma.communityDailyStat.upsert({
    where: { communityId_day: { communityId, day } },
    create: { communityId, day, ...(kind === 'join' ? { joins: count } : { leaves: count }) },
    update: kind === 'join' ? { joins: { increment: count } } : { leaves: { increment: count } },
  });
}

// ─── Nightly rollup ───────────────────────────────────────────────────────────

/** Day key N days before `from` (MSK). */
function dayKeyBefore(days: number, from = new Date()): string {
  return pulseDayKey(new Date(from.getTime() - days * 86_400_000));
}

/**
 * Recomputes the day row for one community from the participant facts + the
 * moderation journal. Idempotent by (communityId, day): safe to re-run after a
 * failed night, and safe to run for the last few days to pick up late data.
 * Counters written by the live recorder (joins/leaves/hourHistogram) are NOT
 * touched — they are the only record of those events.
 */
export async function rollupPulseDay(communityId: string, day: string): Promise<void> {
  const facts = await prisma.communityDailyParticipant.findMany({
    where: { communityId, day },
    select: { messages: true, replies: true, firstDay: true },
  });
  const messages = facts.reduce((n, f) => n + f.messages, 0);
  const replies = facts.reduce((n, f) => n + f.replies, 0);
  const activeUsers = facts.length; // one row per person per day → already distinct
  const newSpeakers = facts.filter(f => f.firstDay).length;

  // Moderation signals for the same MSK day.
  const from = new Date(`${day}T00:00:00+03:00`);
  const to = new Date(from.getTime() + 86_400_000);
  const events = await prisma.moderationEvent.findMany({
    where: { communityId, createdAt: { gte: from, lt: to } },
    select: { eventType: true, action: true, decision: true, tgUserId: true, metadata: true },
  }).catch(() => []);
  const blockedMsgs = events.filter(e => (e.action ?? '').includes('DELETE')).length;
  const interventions = events.filter(e => e.eventType === 'AI_INTERVENTION').length;
  const conversationEvents = events.filter(e => ['AI_INTERVENTION','CONVERSATION_EPISODE'].includes(e.eventType));
  const conflictEvents = conversationEvents.filter(e => e.decision === 'conflict').length;
  const harassmentEvents = conversationEvents.filter(e => e.decision === 'harassment').length;
  const culturalRewrites = events.filter(e => e.eventType === 'AI_MODERATION_TRIGGERED' && typeof pulseMeta(e.metadata)['suggestedRewrite'] === 'string').length;
  const affectedUsers = new Set(events.flatMap(e => {
    const meta = pulseMeta(e.metadata), targets = Array.isArray(meta['targetIds']) ? meta['targetIds'].flatMap(v => typeof v === 'string' ? [v] : []) : [];
    return [...targets, ...(e.tgUserId && pulseToxicityWeight(e) > 0 ? [e.tgUserId] : [])];
  })).size;
  const resolvedEpisodes = conversationEvents.filter(e => pulseMeta(e.metadata)['state'] === 'RESOLVED').length;
  const escalatedEpisodes = conversationEvents.filter(e => pulseMeta(e.metadata)['state'] === 'ESCALATING').length;
  const toxicityWeight = Math.round(events.reduce((sum,e)=>sum+pulseToxicityWeight(e),0)*100)/100;
  const climateScore = pulseClimateScore(messages,toxicityWeight);

  await prisma.communityDailyStat.upsert({
    where: { communityId_day: { communityId, day } },
    create: { communityId, day, messages, replies, activeUsers, newSpeakers, blockedMsgs, interventions, conflictEvents, harassmentEvents, culturalRewrites, affectedUsers, resolvedEpisodes, escalatedEpisodes, toxicityWeight, climateScore },
    update: { messages, replies, activeUsers, newSpeakers, blockedMsgs, interventions, conflictEvents, harassmentEvents, culturalRewrites, affectedUsers, resolvedEpisodes, escalatedEpisodes, toxicityWeight, climateScore, computedAt: new Date() },
  });
}

/**
 * Rolls up every community for the last `days` days (default 2 — today plus
 * yesterday, so messages landing either side of midnight are never lost), and
 * snapshots the chat's member count, which percentage metrics need.
 */
/** Drops message claims older than 6h — they only guard against concurrent
 *  double-counting by the three sources, which all observe within seconds. */
export async function purgePulseClaims(): Promise<number> {
  const { count } = await prisma.pulseMessageClaim.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 6 * 3_600_000) } } });
  return count;
}

export async function rollupAllCommunities(days = 2): Promise<number> {
  const communities = await prisma.community.findMany({
    where: { moderatorChat: { isNot: null } },
    select: { id: true, moderatorChat: { select: { tgChatId: true } } },
  }).catch(() => []);
  let rolled = 0;
  for (const community of communities) {
    for (let i = 0; i < days; i++) {
      await rollupPulseDay(community.id, dayKeyBefore(i)).catch(err => console.error('[pulse/rollup]', community.id, (err as Error).message));
      rolled++;
    }
    const chatId = community.moderatorChat?.tgChatId;
    if (chatId) await snapshotMemberCount(community.id, chatId).catch(() => undefined);
  }
  return rolled;
}

/** Stores today's total member count (needed for % of members metrics). */
async function snapshotMemberCount(communityId: string, tgChatId: string): Promise<void> {
  const { getChatMemberCount } = await import('./telegramBot');
  const { moderatorTokenForCommunity } = await import('../moderator/managedBotCrypto');
  const token = await moderatorTokenForCommunity(communityId).catch(() => null);
  if (!token) return;
  const count = await getChatMemberCount(tgChatId, token);
  if (count == null) return;
  const day = pulseDayKey();
  await prisma.communityDailyStat.upsert({
    where: { communityId_day: { communityId, day } },
    create: { communityId, day, memberCount: count },
    update: { memberCount: count },
  });
}

/**
 * One-time seed so the dashboard isn't empty on day one. Raw messages are long
 * gone (they purge within hours), but two things survive and can be replayed:
 * every member's joinedAt, and the per-participant activeDayKeys the CM/persona
 * memory keeps for the last 30 days. That yields real joins-per-day and a
 * coarse "was active that day" history. Skips days that already have facts.
 */
export async function seedPulseHistory(communityId: string): Promise<{ days: number; facts: number }> {
  const members = await prisma.communityMember.findMany({ where: { communityId }, select: { tgUserId: true, joinedAt: true } }).catch(() => []);
  const joinsByDay = new Map<string, number>();
  for (const m of members) if (m.joinedAt) joinsByDay.set(pulseDayKey(m.joinedAt), (joinsByDay.get(pulseDayKey(m.joinedAt)) ?? 0) + 1);

  // Active-day history from whichever memory exists for this community.
  const manager = await prisma.communityManager.findUnique({ where: { communityId }, select: { id: true } }).catch(() => null);
  const participants = manager
    ? await prisma.communityManagerParticipant.findMany({ where: { communityManagerId: manager.id }, select: { tgUserId: true, activeDayKeys: true } }).catch(() => [])
    : [];

  let facts = 0;
  for (const p of participants) {
    const days = Array.isArray(p.activeDayKeys) ? (p.activeDayKeys as unknown[]).filter((d): d is string => typeof d === 'string') : [];
    for (const day of days) {
      const exists = await prisma.communityDailyParticipant.findUnique({ where: { communityId_tgUserId_day: { communityId, tgUserId: p.tgUserId, day } }, select: { id: true } });
      if (exists) continue;
      // messages=1 is a floor, not a real count — the raw volume is unrecoverable.
      await prisma.communityDailyParticipant.create({ data: { communityId, tgUserId: p.tgUserId, day, messages: 1, replies: 0, firstDay: false } }).catch(() => undefined);
      facts++;
    }
  }

  for (const [day, joins] of joinsByDay) {
    await prisma.communityDailyStat.upsert({
      where: { communityId_day: { communityId, day } },
      create: { communityId, day, joins },
      update: { joins },
    }).catch(() => undefined);
  }
  for (const day of new Set([...joinsByDay.keys(), ...participants.flatMap(p => Array.isArray(p.activeDayKeys) ? (p.activeDayKeys as string[]) : [])])) {
    await rollupPulseDay(communityId, day).catch(() => undefined);
  }
  return { days: joinsByDay.size, facts };
}
