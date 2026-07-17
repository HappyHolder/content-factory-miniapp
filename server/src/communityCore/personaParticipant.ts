/**
 * personaParticipant.ts — per-person memory for a persona: who they are, how
 * often they talk, the relationship level, and a few durable notes. Mirrors the
 * Community Manager's participant memory but scoped to a persona and self-contained.
 */

import { prisma } from '../db';
import { DEFAULT_RELATIONSHIP, evolveRelationship, parseRelationship, describeRelationship, type RelationshipState } from './personaState';

export type Author = { id: string; username?: string | null; firstName?: string | null; lastName?: string | null };

const clean = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const strList = (v: unknown, max = 20) => (Array.isArray(v) ? v.flatMap(x => (typeof x === 'string' && x.trim() ? [x.trim().slice(0, 200)] : [])).slice(0, max) : []);

function level(messageCount: number, activeDays: number, exchanges: number, current: string): string {
  if (current === 'FRIEND') return current;
  if (exchanges >= 5 && activeDays >= 2) return 'FRIEND';
  if (activeDays >= 3 && messageCount >= 8) return 'REGULAR';
  if (messageCount >= 3) return 'ACTIVE';
  return 'NEW';
}

export function displayNameOf(author: Author): string {
  const first = clean(author.firstName, 80), last = clean(author.lastName, 80), user = clean(author.username, 64).replace(/^@/, '');
  return [first, last].filter(Boolean).join(' ') || user || ('Участник ' + author.id);
}

/** Upsert the sender on every message and advance the relationship a touch. */
export async function rememberParticipant(personaId: string, author: Author, event: { conflict?: boolean; positive?: boolean } = {}) {
  const tgUserId = String(author.id);
  const existing = await prisma.personaParticipant.findUnique({ where: { personaId_tgUserId: { personaId, tgUserId } } });
  const days = [...new Set([...strList(existing?.activeDayKeys, 30), dayKey()])].slice(-30);
  const username = clean(author.username, 64).replace(/^@/, '') || null;
  const firstName = clean(author.firstName, 80) || null, lastName = clean(author.lastName, 80) || null;
  const displayName = displayNameOf(author);
  const nextCount = (existing?.messageCount ?? 0) + 1;
  const nextLevel = level(nextCount, days.length, existing?.exchangeCount ?? 0, existing?.relationship ?? 'NEW');
  const rel = evolveRelationship(existing?.relationshipState ?? DEFAULT_RELATIONSHIP, { message: true, conflict: event.conflict, positive: event.positive });
  return prisma.personaParticipant.upsert({
    where: { personaId_tgUserId: { personaId, tgUserId } },
    create: { personaId, tgUserId, username, firstName, lastName, displayName, messageCount: 1, activeDayKeys: days as any, relationship: 'NEW', relationshipState: rel as any },
    update: { username, firstName, lastName, displayName, messageCount: { increment: 1 }, activeDayKeys: days as any, relationship: nextLevel, relationshipState: rel as any, lastSeenAt: new Date() },
  });
}

/** After the persona actually replies to someone, deepen the relationship. */
export async function rememberExchange(personaId: string, tgUserId: string, notes: string[], event: { positive?: boolean; conflict?: boolean; repair?: boolean } = {}) {
  const row = await prisma.personaParticipant.findUnique({ where: { personaId_tgUserId: { personaId, tgUserId } } });
  if (!row) return;
  const count = row.exchangeCount + 1, days = strList(row.activeDayKeys, 30);
  const rel = evolveRelationship(row.relationshipState ?? DEFAULT_RELATIONSHIP, { exchange: true, ...event });
  const mergedNotes = [...new Map([...strList(row.notes, 12), ...notes].map(n => [n.toLocaleLowerCase('ru-RU'), n])).values()].slice(-12);
  await prisma.personaParticipant.update({ where: { id: row.id }, data: { exchangeCount: count, lastExchangeAt: new Date(), relationship: level(row.messageCount, days.length, count, row.relationship), relationshipState: rel as any, notes: mergedNotes as any } });
}

export type ParticipantView = { tgUserId: string; displayName: string; username: string | null; relationship: string; relationshipState: RelationshipState; notes: string[]; messageCount: number; exchangeCount: number };

export async function loadParticipant(personaId: string, tgUserId: string): Promise<ParticipantView | null> {
  const row = await prisma.personaParticipant.findUnique({ where: { personaId_tgUserId: { personaId, tgUserId } } });
  if (!row) return null;
  return { tgUserId: row.tgUserId, displayName: row.displayName, username: row.username, relationship: row.relationship, relationshipState: parseRelationship(row.relationshipState), notes: strList(row.notes, 12), messageCount: row.messageCount, exchangeCount: row.exchangeCount };
}

/** Prompt block describing what the persona knows and feels about this person. */
export function describeParticipant(p: ParticipantView | null): string {
  if (!p) return '(новый человек, ты его ещё не знаешь)';
  const who = p.displayName + (p.username ? ' (@' + p.username + ')' : '');
  const rel = describeRelationship(p.relationshipState, p.relationship);
  const notes = p.notes.length ? '. Что ты о нём помнишь: ' + p.notes.join('; ') : '';
  return who + ' — ' + rel + '. Вы общались ' + p.exchangeCount + ' раз' + notes;
}

export const participantPublic = (row: any) => ({ id: row.id, tgUserId: row.tgUserId, username: row.username, displayName: row.displayName, relationship: row.relationship, notes: strList(row.notes, 12), messageCount: row.messageCount, exchangeCount: row.exchangeCount, lastSeenAt: row.lastSeenAt });
