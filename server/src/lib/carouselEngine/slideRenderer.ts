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
import { SLIDE_ASPECT_RATIO, SLIDE_WIDTH, STRIP_ATTR } from './types';

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

// ─── Running bottom strip ─────────────────────────────────────────────────────
// Each slide is screenshotted independently, so a template's ticker band renders
// the same clipped fragment on all of them. To make it read as ONE band running
// under the whole carousel, we lengthen the strip past the full sequence width
// and show slide i the window [i·W, (i+1)·W).
//
// `width:max-content` matters beyond layout: it makes the strip's clientWidth
// equal its scrollWidth, so renderHtmlString's autoFitText pass does not read the
// long strip as overflowing text and shrink the ticker font to nothing.

/** Appends a snippet just before </body> (or at the end if there is no body). */
function insertBeforeBodyEnd(html: string, snippet: string): string {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${snippet}</body>`) : html + snippet;
}

function injectRunningStrip(html: string, slideIndex: number, slideCount: number): string {
  if (slideCount < 2 || !html.includes(STRIP_ATTR)) return html;
  const needed = (slideCount + 1) * SLIDE_WIDTH;
  const offset = slideIndex * SLIDE_WIDTH;
  const snippet =
    `<style id="cf-carousel-strip">[${STRIP_ATTR}]{flex:0 0 auto !important;width:max-content !important;}</style>` +
    `<script id="cf-carousel-strip-js">(function(){` +
    `var el=document.querySelector('[${STRIP_ATTR}]');if(!el)return;` +
    `var unit=el.innerHTML,guard=0;` +
    `while(el.scrollWidth<${needed}&&guard++<60){el.insertAdjacentHTML('beforeend',unit);}` +
    `el.style.transform='translateX(-${offset}px)';` +
    `})();</script>`;
  return insertBeforeBodyEnd(html, snippet);
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
  /** Position of this slide in the full sequence (cover = 0), for the running strip. */
  slideIndex:   number;
  /** Total slides in the sequence, so the strip is lengthened far enough. */
  slideCount:   number;
  /** Reserved for `ai_html` mode. Unset today. */
  backgroundUrl?: string | null;
}): Promise<string | null> {
  const { templateHtml, slots, brand, slideIndex, slideCount, backgroundUrl } = params;

  const filled = replaceSlots(templateHtml, slots);
  const branded = backgroundUrl
    ? composeTemplateOverPhoto(filled, backgroundUrl, brand)
    : injectBrandTokens(filled, brand);
  const html = injectRunningStrip(branded, slideIndex, slideCount);

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
