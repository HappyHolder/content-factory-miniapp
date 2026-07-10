/**
 * carouselEngine/slideRenderer.ts
 *
 * Renders ONE slide: fill its slots, apply the channel's brand, screenshot it.
 *
 * Deliberately built from the same bricks the cover engines use — injectBrandTokens,
 * composeTemplateOverPhoto, renderHtmlString — so a slide and a cover from the same
 * pack come out visually identical. renderHtmlString already handles the emoji
 * fallback font, collapses slots that resolved to empty, shrinks overflowing text,
 * and uploads the PNG.
 *
 * `backgroundUrl` is the seam for the future `ai_html` carousel mode: the pack's
 * slide templates already ship `.photo-mode` CSS, and composeTemplateOverPhoto
 * already knows how to lay a filled template over a photo. Nothing passes a
 * background today — see CarouselScenario.ai_html_not_implemented.
 */

import { composeTemplateOverPhoto, injectBrandTokens } from '../claudeHtmlGenerator';
import { renderHtmlString } from '../playwrightRenderer';
import { deleteObject } from '../storage';
import type { TemplateBrand } from '../templateRenderer';
import type { SlotMap } from './slots';
import { SLIDE_ASPECT_RATIO } from './types';

/** Escapes a slot value so it can never inject markup into the slide. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Replaces every {{SLOT}}; an unmapped slot resolves to '' and collapses away. */
function replaceSlots(html: string, slots: SlotMap): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = slots[key];
    return val ? escapeHtml(val) : '';
  });
}

/**
 * Renders one slide to a stored PNG and returns its public URL, or null if the
 * screenshot or the upload failed (the caller decides whether the carousel can
 * survive without this slide).
 */
export async function renderSlide(params: {
  templateHtml: string;
  slots:        SlotMap;
  brand:        TemplateBrand;
  /** Reserved for `ai_html` mode. Unset today. */
  backgroundUrl?: string | null;
}): Promise<string | null> {
  const { templateHtml, slots, brand, backgroundUrl } = params;

  const filled = replaceSlots(templateHtml, slots);
  const html = backgroundUrl
    ? composeTemplateOverPhoto(filled, backgroundUrl, brand)
    : injectBrandTokens(filled, brand);

  const rendered = await renderHtmlString(html, SLIDE_ASPECT_RATIO);
  return rendered?.bannerUrl ?? null;
}

/**
 * Deletes slides we rendered but decided not to publish.
 *
 * Essential, not hygiene: putObject writes to disk immediately, while the
 * retention purge only ever deletes URLs it finds inside a post's blocks. An
 * abandoned slide would never enter a block, and so would sit on the VPS forever.
 */
export async function discardSlides(urls: string[]): Promise<void> {
  for (const url of urls) {
    await deleteObject(url).catch(() => { /* best-effort */ });
  }
}
