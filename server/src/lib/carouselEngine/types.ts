/**
 * carouselEngine/types.ts
 *
 * The carousel engine turns a post's parallel points (steps / top-N / theses)
 * into a SET of rendered slide PNGs and hands them back as one `gallery` block.
 *
 * It is a peer of the cover engines, not a layer on top of them:
 *   - cover engine  → GeneratedCover (exactly ONE image, always present)
 *   - carousel engine → PostBlock | null  (N images, optional by design)
 *
 * Neither calls the other. draftGenerator composes both into one post.
 */

import type { PostBlock } from '../richPost';
import type { TemplateBrand } from '../templateRenderer';

/**
 * Slides are rendered from flat HTML today. `ai_html` (slides laid over a
 * generated background) is declared so the contract is stable, but the resolver
 * refuses it — see CarouselScenario.ai_html_not_implemented. Slicing one wide
 * AI image into tiles that read as a mosaic does not survive Telegram's
 * one-slide-at-a-time slideshow, so the background strategy is still open.
 */
export type CarouselMode = 'html' | 'ai_html';

/** Why the engine produced (or refused to produce) a carousel. */
export type CarouselScenario =
  | 'pack_slides'               // ✓ slides rendered from the channel's template set
  | 'no_template'               // channel has no carousel template (or no `item` slide)
  | 'template_invalid'          // template fetched but carries no {{SLOT}} placeholders
  | 'template_fetch_failed'     // stored URL is dead
  | 'no_items'                  // the post has no parallel points worth a carousel
  | 'render_failed';            // too few slides survived rendering

/**
 * A carousel is a SET of slide templates, stored on the channel's VisualKit
 * (copied there from a style pack). Only `item` is mandatory — it is the slide
 * repeated per point. Missing cover/outro simply produce a shorter carousel.
 */
export interface CarouselTemplateSet {
  cover?: string;
  item?:  string;
  outro?: string;
}

/** The same set, with each template's HTML already fetched. */
export interface ResolvedTemplates {
  cover: string | null;
  item:  string;      // never null — the resolver refuses the carousel without it
  outro: string | null;
}

/** One extracted point of the post. Rendered into one `item` slide. */
export interface CarouselItem {
  title: string;   // 1-4 words — lands in a display slot
  desc:  string;   // one short sentence
}

/** What the planner reads out of the post text. */
export interface CarouselContent {
  title:      string;      // carousel headline, 2-5 words
  subtitle:   string;
  /** The closing slide's OWN headline ("Сохрани подборку") — not the intro's repeated. */
  outroTitle: string;
  cta:        string;      // outro call to action
  topTag:     string;      // small pill label, 1-2 words
  tags:       string[];    // up to 4 short hashtag-ish words
  items:      CarouselItem[];
  position:   CarouselPosition;
}

/** Where the gallery block lands among the post's blocks. */
export type CarouselPosition = 'top' | 'middle' | 'end';

export interface CarouselContext {
  mode:       CarouselMode;
  templates:  CarouselTemplateSet;
  postText:   string;
  /** The post's rubric label, used for the RUBRIC slot. */
  rubricName: string | null;
  brand:      TemplateBrand;
  /** Channel identity for the AUTHOR slot — project name preferred over @handle. */
  authorName: string | null;
  handle:     string | null;
  lang:       'ru' | 'en';
}

export interface CarouselPlan {
  scenario:   CarouselScenario;
  /** What the channel asked for. */
  requestedMode: CarouselMode;
  /** What actually ran. `ai_html` is always downgraded to `html` today. */
  mode:       CarouselMode;
  slideCount: number;
  position:   CarouselPosition;
  reason:     string;
}

export interface CarouselResult {
  /** The gallery block to splice into the post, or null when there is no carousel. */
  block: Extract<PostBlock, { type: 'gallery' }> | null;
  plan:  CarouselPlan;
  debug: string[];
}

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Below this the "carousel" is just two loose pictures — not worth it. */
export const MIN_ITEMS = 3;
/** Above this the reader stops swiping; also keeps us under Telegram's 10. */
export const MAX_ITEMS = 7;
/** Telegram caps a slideshow at 10 images (cover + 7 items + outro = 9). */
export const MAX_SLIDES = 10;
/** Slide templates are authored at 1080×1080 — never inherit the channel ratio. */
export const SLIDE_ASPECT_RATIO = '1:1' as const;
