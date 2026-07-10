/**
 * carouselEngine/carouselEngine.ts
 *
 * The orchestrator. Mirrors buildCoverV2's shape — context → plan → render →
 * fallback — but owns a different contract: it returns a PostBlock (or null),
 * never an image, and it is allowed to produce nothing at all.
 *
 * Order matters. Templates are resolved BEFORE the planner runs, so a channel
 * without carousel templates never pays for the planner's AI call.
 *
 * Rendering is strictly sequential: Playwright's Chromium is a module-level
 * singleton shared with the cover engines, and contentWorker runs plans one item
 * at a time precisely so the prod box never drives two browsers at once.
 */

import type { PostBlock } from '../richPost';
import { buildCarouselContext, type BuildCarouselContextInput } from './contextBuilder';
import { noCarousel } from './fallbacks';
import { planCarousel } from './planner';
import { discardSlides, renderSlide } from './slideRenderer';
import { coverSlots, itemSlots, outroSlots } from './slots';
import { resolveTemplates } from './templateResolver';
import {
  MAX_SLIDES, MIN_ITEMS,
  type CarouselContent, type CarouselContext, type CarouselPosition, type CarouselResult,
} from './types';

export type BuildCarouselInput = BuildCarouselContextInput;

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Renders cover → items → outro, in order, into stored PNGs.
 *
 * A failed cover or outro is dropped (the carousel is still coherent without an
 * intro or an ending). A failed item slide is skipped; the caller checks whether
 * enough of them survived.
 */
async function renderSlides(
  ctx:       CarouselContext,
  content:   CarouselContent,
  templates: { cover: string | null; item: string; outro: string | null },
): Promise<{ urls: string[]; itemsRendered: number }> {
  const urls: string[] = [];
  let itemsRendered = 0;

  if (templates.cover) {
    const url = await renderSlide({ templateHtml: templates.cover, slots: coverSlots(ctx, content), brand: ctx.brand });
    if (url) urls.push(url);
    else console.warn('[carouselEngine] cover slide failed — continuing without it');
  }

  for (const [i, item] of content.items.entries()) {
    if (urls.length >= MAX_SLIDES) break;
    const url = await renderSlide({
      templateHtml: templates.item,
      slots:        itemSlots(ctx, content, item, i),
      brand:        ctx.brand,
    });
    if (url) { urls.push(url); itemsRendered++; }
    else console.warn(`[carouselEngine] item slide ${i + 1} failed — skipping`);
  }

  if (templates.outro && urls.length < MAX_SLIDES) {
    const url = await renderSlide({ templateHtml: templates.outro, slots: outroSlots(ctx, content), brand: ctx.brand });
    if (url) urls.push(url);
    else console.warn('[carouselEngine] outro slide failed — continuing without it');
  }

  return { urls, itemsRendered };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds a carousel for a post, or explains why it did not. Never throws:
 * `block: null` degrades the post to a plain rubric-cover post.
 */
export async function buildCarousel(input: BuildCarouselInput): Promise<CarouselResult> {
  const debug: string[] = [];
  const ctx = buildCarouselContext(input);
  const requestedMode = ctx.mode;

  // `ai_html` slides (a generated background under the template) are declared in
  // the contract but not built: slicing one image across slides does not survive
  // Telegram's one-at-a-time slideshow, so the background strategy is still open.
  // Downgrade rather than refuse — the channel still gets its carousel.
  if (requestedMode === 'ai_html') {
    ctx.mode = 'html';
    debug.push('ai_html requested → downgraded to html (background strategy undecided)');
  }
  const mode = ctx.mode;
  const refuse = (scenario: Parameters<typeof noCarousel>[0]['scenario'], reason: string) =>
    noCarousel({ scenario, reason, requestedMode, mode, debug });

  // 1. Templates first — a channel without them must not pay for the planner.
  const resolved = await resolveTemplates(ctx);
  if (!resolved.ok) return refuse(resolved.scenario, resolved.reason);
  debug.push(`templates cover=${!!resolved.templates.cover} item=yes outro=${!!resolved.templates.outro}`);

  // 2. Does the post actually hold parallel points? Usually not — that is fine.
  const content = await planCarousel(ctx);
  if (!content) return refuse('no_items', 'post has no parallel points worth a carousel');
  debug.push(`planner: ${content.items.length} item(s), position=${content.position}`);

  // 3. Render, sequentially.
  const { urls, itemsRendered } = await renderSlides(ctx, content, resolved.templates);

  // 4. A carousel that lost its points is not a carousel. Abandon it — and delete
  //    the PNGs we already stored, or they outlive the post that never used them.
  if (itemsRendered < MIN_ITEMS) {
    await discardSlides(urls);
    return refuse('render_failed', `only ${itemsRendered}/${content.items.length} item slides rendered`);
  }

  const block: Extract<PostBlock, { type: 'gallery' }> = { type: 'gallery', layout: 'slideshow', urls };
  debug.push(`rendered ${urls.length} slide(s)`);

  return {
    block,
    plan: {
      scenario:   'pack_slides',
      requestedMode,
      mode,
      slideCount: urls.length,
      position:   content.position,
      reason:     'channel pack supplied slide templates and the post has parallel points',
    },
    debug,
  };
}

// ─── Placement ────────────────────────────────────────────────────────────────

/** Index of the block after which the carousel should sit, for a given position. */
function insertionIndex(blocks: PostBlock[], position: CarouselPosition): number {
  if (position === 'end') return blocks.length;

  const paragraphs = blocks
    .map((b, i) => (b.type === 'paragraph' ? i : -1))
    .filter(i => i >= 0);

  // No prose to sit under (e.g. a pure list post) — the carousel leads the post.
  if (paragraphs.length === 0) {
    const heading = blocks.findIndex(b => b.type === 'heading');
    return heading >= 0 ? heading + 1 : 0;
  }

  // 'top' → straight after the opening paragraph, so the points ARE the post.
  // 'middle' → after the paragraph nearest the middle, so prose frames them.
  const target = position === 'top' ? paragraphs[0]! : paragraphs[Math.floor((paragraphs.length - 1) / 2)]!;
  return target + 1;
}

/**
 * Splices the carousel into a post's blocks. Returns a new array; the caller
 * persists it. The user can move or delete the block afterwards in the editor.
 */
export function insertCarouselBlock(
  blocks:   PostBlock[],
  block:    Extract<PostBlock, { type: 'gallery' }>,
  position: CarouselPosition,
): PostBlock[] {
  const at = insertionIndex(blocks, position);
  return [...blocks.slice(0, at), block, ...blocks.slice(at)];
}
