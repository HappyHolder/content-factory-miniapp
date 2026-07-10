/**
 * carouselEngine/slots.ts
 *
 * Builds the {{SLOT}} → value map for each slide. Unlike a cover, these values
 * are NOT asked from a model: the planner already extracted the points, so the
 * numbering, counters and identity slots are computed here, deterministically.
 * That is why a 5-point carousel always reads "01 / 05" and never "1 of five".
 *
 * The slot vocabulary is the one the pack's slide templates declare:
 *   cover: RUBRIC TOP_TAG COUNT TITLE_WHITE TITLE_ACCENT SUBTITLE TAG1..4
 *   item:  RUBRIC COUNT NUM TITLE_WHITE TITLE_ACCENT DESC     TAG1..4
 *   outro: RUBRIC TOP_TAG TITLE_WHITE TITLE_ACCENT CTA AUTHOR TAG1..4
 *
 * A template that omits a slot simply never sees its value; a slot we leave
 * empty is collapsed away by the renderer's collapseEmptyBlocks pass.
 */

import type { CarouselContent, CarouselContext, CarouselItem } from './types';

export type SlotMap = Record<string, string>;

/**
 * Splits a headline into its white part and its accent tail. Templates render
 * TITLE_ACCENT in the brand color, so the accent must be the FINAL key word(s) —
 * the two halves have to read left-to-right as one grammatical phrase.
 * A single-word headline stays entirely white (an accent-only title looks broken).
 */
function splitHeadline(title: string): { white: string; accent: string } {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { white: title.trim(), accent: '' };
  return { white: words.slice(0, -1).join(' '), accent: words[words.length - 1]! };
}

/** Zero-padded slide number: 1 → "01". */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "5 пунктов" / "5 points" — the cover's item counter. */
function countLabel(n: number, lang: 'ru' | 'en'): string {
  if (lang === 'en') return `${n} ${n === 1 ? 'point' : 'points'}`;
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  const word = teen || last === 0 || last >= 5 ? 'пунктов' : last === 1 ? 'пункт' : 'пункта';
  return `${n} ${word}`;
}

/** The channel's own section label. Templates draw the "//" prefix themselves. */
function rubricLabel(ctx: CarouselContext): string {
  if (ctx.rubricName) return ctx.rubricName.toLowerCase();
  return ctx.lang === 'en' ? 'list' : 'подборка';
}

/** TAG1..TAG4 — absent tags resolve to '' and collapse. */
function tagSlots(tags: string[]): SlotMap {
  const out: SlotMap = {};
  for (let i = 0; i < 4; i++) out[`TAG${i + 1}`] = tags[i] ?? '';
  return out;
}

/** The byline: the channel's project name, falling back to its @handle. */
function author(ctx: CarouselContext): string {
  if (ctx.authorName) return ctx.authorName;
  if (!ctx.handle) return '';
  return ctx.handle.startsWith('@') ? ctx.handle : `@${ctx.handle}`;
}

export function coverSlots(ctx: CarouselContext, content: CarouselContent): SlotMap {
  const { white, accent } = splitHeadline(content.title);
  return {
    RUBRIC:       rubricLabel(ctx),
    TOP_TAG:      content.topTag,
    COUNT:        countLabel(content.items.length, ctx.lang),
    TITLE_WHITE:  white,
    TITLE_ACCENT: accent,
    SUBTITLE:     content.subtitle,
    ...tagSlots(content.tags),
  };
}

export function itemSlots(
  ctx: CarouselContext,
  content: CarouselContent,
  item: CarouselItem,
  index: number,
): SlotMap {
  const { white, accent } = splitHeadline(item.title);
  const total = content.items.length;
  return {
    RUBRIC:       rubricLabel(ctx),
    COUNT:        `${pad(index + 1)} / ${pad(total)}`,
    NUM:          pad(index + 1),
    TITLE_WHITE:  white,
    TITLE_ACCENT: accent,
    DESC:         item.desc,
    ...tagSlots(content.tags),
  };
}

/** Closing-slide headline when the planner gave none. Chrome, not content — it
 *  states no fact about the post, so a fixed phrase is safe. */
const OUTRO_FALLBACK: Record<'ru' | 'en', string> = {
  ru: 'Сохрани подборку',
  en: 'Save this list',
};

export function outroSlots(ctx: CarouselContext, content: CarouselContent): SlotMap {
  // The closing slide gets its OWN headline. Echoing the intro's would end the
  // carousel by saying exactly what it opened with.
  const { white, accent } = splitHeadline(content.outroTitle || OUTRO_FALLBACK[ctx.lang]);
  return {
    RUBRIC:       ctx.lang === 'en' ? 'done' : 'готово',
    TOP_TAG:      content.topTag,
    TITLE_WHITE:  white,
    TITLE_ACCENT: accent,
    CTA:          content.cta,
    AUTHOR:       author(ctx),
    ...tagSlots(content.tags),
  };
}
