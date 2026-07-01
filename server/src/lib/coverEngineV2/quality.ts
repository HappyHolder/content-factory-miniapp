import type { PromptPlanV2, VisualBriefV2 } from './types';

export interface QualityCheckV2 {
  ok: boolean;
  reason?: string;
}

export function assessPromptQualityV2(promptPlan: PromptPlanV2 | null, brief: VisualBriefV2 | null): QualityCheckV2 {
  if (!promptPlan || !brief) return { ok: true };
  if (promptPlan.builder === 'legacy_brand_scene') return { ok: true };
  const p = promptPlan.prompt.toLowerCase();
  const generic = /\b(cityscape|skyscraper|office tower|empty room|server room|abstract gradient|galaxy|nebula)\b/.test(p);
  const terms = Array.from(new Set([
    ...brief.keywords,
    ...brief.actors,
    brief.coreEvent,
    brief.conflict,
  ].join(' ').toLowerCase().match(/[a-zа-яё]{4,}/gi) ?? [])).slice(0, 12);
  const hits = terms.filter(t => p.includes(t)).length;
  if (generic && hits < 2) return { ok: false, reason: 'template prompt is too generic for the post brief' };
  return { ok: true };
}
