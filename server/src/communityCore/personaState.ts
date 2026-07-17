/**
 * personaState.ts — the persona's own evolving mood and its per-person
 * relationship state. Adapted from the Community Manager's personalityState so
 * Community Core stays self-contained (no cross-module runtime coupling), but
 * driven by the simpler persona config (dynamism instead of a psychology block).
 */

import type { PersonaConfigData } from './personaConfig';

export type InnerState = { valence: number; arousal: number; energy: number; stress: number; irritation: number; confidence: number; curiosity: number; updatedAt: string };
export type RelationshipState = { familiarity: number; trust: number; closeness: number; respect: number; tension: number; reciprocity: number; emotionalSafety: number; updatedAt: string };

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const finite = (v: unknown, f: number) => (Number.isFinite(Number(v)) ? Number(v) : f);
const round = (v: number) => Math.round(clamp(v) * 1000) / 1000;

export const DEFAULT_INNER: InnerState = { valence: 0.1, arousal: 0.35, energy: 0.7, stress: 0.12, irritation: 0.04, confidence: 0.62, curiosity: 0.7, updatedAt: new Date(0).toISOString() };
export const DEFAULT_RELATIONSHIP: RelationshipState = { familiarity: 0.05, trust: 0.45, closeness: 0.1, respect: 0.55, tension: 0, reciprocity: 0.2, emotionalSafety: 0.5, updatedAt: new Date(0).toISOString() };

export function parseInner(v: unknown): InnerState {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { valence: finite(r.valence, DEFAULT_INNER.valence), arousal: round(finite(r.arousal, DEFAULT_INNER.arousal)), energy: round(finite(r.energy, DEFAULT_INNER.energy)), stress: round(finite(r.stress, DEFAULT_INNER.stress)), irritation: round(finite(r.irritation, DEFAULT_INNER.irritation)), confidence: round(finite(r.confidence, DEFAULT_INNER.confidence)), curiosity: round(finite(r.curiosity, DEFAULT_INNER.curiosity)), updatedAt: typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt)) ? r.updatedAt : DEFAULT_INNER.updatedAt };
}

/** Mood evolves with time-decay plus the current event, scaled by dynamism. */
export function evolveInner(previous: unknown, config: PersonaConfigData, event: { direct?: boolean; question?: boolean; positive?: boolean; conflict?: boolean }): InnerState {
  const old = parseInner(previous);
  const hours = Math.max(0, Math.min(72, (Date.now() - Date.parse(old.updatedAt)) / 3600_000));
  const decay = Math.exp(-hours / 8);
  const reactive = config.voice.dynamism >= 1.5 ? 1.35 : config.voice.dynamism <= 0.5 ? 0.65 : 1;
  let irritation = old.irritation * decay, stress = old.stress * Math.exp(-hours / 12), valence = old.valence * Math.exp(-hours / 18);
  let arousal = 0.3 + (old.arousal - 0.3) * decay, energy = clamp(old.energy - hours * 0.02, 0.25, 1), confidence = old.confidence, curiosity = old.curiosity;
  if (event.conflict) { irritation += 0.2 * reactive; stress += 0.15 * reactive; valence -= 0.13 * reactive; arousal += 0.16 * reactive; }
  if (event.positive) { valence += 0.12; stress -= 0.05; irritation -= 0.06; confidence += 0.03; }
  if (event.question) { curiosity += 0.08; arousal += 0.04; }
  if (event.direct) { energy += 0.04; confidence += 0.02; }
  return { valence: Math.max(-1, Math.min(1, Math.round(valence * 1000) / 1000)), arousal: round(arousal), energy: round(energy), stress: round(stress), irritation: round(irritation), confidence: round(confidence), curiosity: round(curiosity), updatedAt: new Date().toISOString() };
}

export function parseRelationship(v: unknown): RelationshipState {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { familiarity: round(finite(r.familiarity, 0.05)), trust: round(finite(r.trust, 0.45)), closeness: round(finite(r.closeness, 0.1)), respect: round(finite(r.respect, 0.55)), tension: round(finite(r.tension, 0)), reciprocity: round(finite(r.reciprocity, 0.2)), emotionalSafety: round(finite(r.emotionalSafety, 0.5)), updatedAt: typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt)) ? r.updatedAt : DEFAULT_RELATIONSHIP.updatedAt };
}

/** Relationship to one person warms with interaction, cools with conflict. */
export function evolveRelationship(previous: unknown, event: { message?: boolean; exchange?: boolean; positive?: boolean; conflict?: boolean; repair?: boolean }): RelationshipState {
  const old = parseRelationship(previous);
  let familiarity = old.familiarity + (event.message ? 0.012 : 0) + (event.exchange ? 0.025 : 0);
  let trust = old.trust + (event.positive ? 0.025 : 0), closeness = old.closeness + (event.exchange ? 0.018 : 0);
  let respect = old.respect + (event.positive ? 0.018 : 0), tension = old.tension, reciprocity = old.reciprocity + (event.exchange ? 0.02 : 0), emotionalSafety = old.emotionalSafety;
  if (event.conflict) { tension += 0.16; trust -= 0.05; emotionalSafety -= 0.07; }
  if (event.repair) { tension -= 0.18; trust += 0.025; emotionalSafety += 0.04; }
  return { familiarity: round(familiarity), trust: round(trust), closeness: round(closeness), respect: round(respect), tension: round(tension), reciprocity: round(reciprocity), emotionalSafety: round(emotionalSafety), updatedAt: new Date().toISOString() };
}

/** Lower number = more eager to speak. Tired/stressed personas hold back. */
export function engagementAdjustment(config: PersonaConfigData, state: InnerState): number {
  let value = 0;
  value -= (config.voice.dynamism - 1) * 0.05;
  if (state.energy < 0.35 || state.stress > 0.8) value += 0.08;
  if (state.irritation > 0.6) value += 0.05;
  return value;
}

/** Human-readable state summary for the model prompt. */
export function describeInner(state: InnerState): string {
  const bits: string[] = [];
  if (state.energy < 0.4) bits.push('немного устал'); else if (state.energy > 0.8) bits.push('бодрый');
  if (state.irritation > 0.5) bits.push('слегка раздражён');
  if (state.stress > 0.6) bits.push('на взводе');
  if (state.valence > 0.3) bits.push('в хорошем настроении'); else if (state.valence < -0.2) bits.push('не в духе');
  if (state.curiosity > 0.75) bits.push('любопытный');
  return bits.length ? bits.join(', ') : 'обычное ровное настроение';
}

export function describeRelationship(rel: RelationshipState, relationshipLevel: string): string {
  const bits = ['уровень: ' + relationshipLevel];
  if (rel.familiarity > 0.5) bits.push('хорошо знакомы'); else if (rel.familiarity < 0.15) bits.push('почти не знакомы');
  if (rel.tension > 0.35) bits.push('есть напряжение после спора');
  if (rel.trust > 0.6) bits.push('доверяешь'); else if (rel.trust < 0.35) bits.push('пока настороже');
  return bits.join(', ');
}
