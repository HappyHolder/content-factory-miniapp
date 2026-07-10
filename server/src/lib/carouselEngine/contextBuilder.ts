/**
 * carouselEngine/contextBuilder.ts
 *
 * Reads the channel's VisualKit into a clean CarouselContext. Everything here is
 * defensive: VisualKit arrives from a Prisma Json column, so every field is
 * `unknown` until proven otherwise. A malformed blob yields an empty template
 * set, which the resolver then turns into a `no_template` refusal.
 */

import { extractBrand } from '../templateRenderer';
import type { CarouselContext, CarouselMode, CarouselTemplateSet } from './types';

/** Reads `visualKit.carouselTemplate` into a template set (missing keys → undefined). */
export function parseCarouselTemplates(vkObj: Record<string, unknown> | null): CarouselTemplateSet {
  const raw = vkObj?.['carouselTemplate'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const t = raw as Record<string, unknown>;
  const url = (k: string): string | undefined =>
    typeof t[k] === 'string' && (t[k] as string).trim() ? (t[k] as string) : undefined;
  // `previews` also lives on this object (rendered samples for the style card) —
  // it is display-only and deliberately ignored here.
  return { cover: url('cover'), item: url('item'), outro: url('outro') };
}

export interface BuildCarouselContextInput {
  useBrandKit: boolean;
  visualKit:   unknown;
  vkObj:       Record<string, unknown> | null;
  postText:    string;
  rubricName:  string | null;
  channelName: string | null;
  handle:      string | null;
  /** Cover-text language, already resolved by the caller. Defaults to ru. */
  coverLanguage?: 'ru' | 'en';
}

export function buildCarouselContext(input: BuildCarouselContextInput): CarouselContext {
  // `useBrandKit: false` means the user asked the model to ignore channel style
  // for this generation — so the channel's carousel templates must not apply.
  const vkObj = input.useBrandKit ? input.vkObj : null;

  const rawMode = vkObj?.['carouselMode'];
  const mode: CarouselMode = rawMode === 'ai_html' ? 'ai_html' : 'html';

  return {
    mode,
    templates:  parseCarouselTemplates(vkObj),
    postText:   input.postText.trim(),
    rubricName: input.rubricName?.trim() || null,
    brand:      extractBrand(input.useBrandKit ? input.visualKit : null),
    authorName: input.channelName?.trim() || null,
    handle:     input.handle?.trim() || null,
    lang:       input.coverLanguage ?? 'ru',
  };
}
