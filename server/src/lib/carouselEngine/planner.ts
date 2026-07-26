/**
 * carouselEngine/planner.ts
 *
 * The only AI call the carousel engine makes: does this post contain 3-7 truly
 * PARALLEL points (steps, a top-N, theses, tools) that a swipeable carousel
 * would present better than a paragraph? If not, we say so and no carousel is
 * built — that is the normal case, not a failure.
 *
 * Nothing is invented: the model extracts what the post already says. It never
 * writes the slide markup — slots are filled deterministically downstream.
 */

import { env } from '../../env';
import { MAX_ITEMS, MIN_ITEMS, type CarouselContent, type CarouselContext, type CarouselItem, type CarouselPosition } from './types';
import { terraText } from '../assistantModel';

interface AiPlan {
  carousel?:   unknown;
  rubric?:     unknown;
  title?:      unknown;
  subtitle?:   unknown;
  outroTitle?: unknown;
  cta?:        unknown;
  topTag?:     unknown;
  tags?:       unknown;
  items?:      unknown;
  position?:   unknown;
}

function buildPrompt(ctx: CarouselContext): { system: string; user: string } {
  const lang = ctx.lang === 'en' ? 'English' : 'Russian';
  const system =
    'You decide whether a Telegram post should carry a swipeable CAROUSEL of slides, and if so you extract its content.\n\n' +
    `A carousel fits ONLY when the post already contains ${MIN_ITEMS}-${MAX_ITEMS} genuinely PARALLEL points of the same kind — ` +
    'numbered steps, a top-N list, a set of tools, a set of theses. Points must be siblings, not a narrative. ' +
    'Prose, a single announcement, one opinion, or a news report has NO carousel. When in doubt, answer no.\n\n' +
    'Never invent points, facts, numbers, or names. Extract only what the post states. ' +
    'If the post has fewer than ' + MIN_ITEMS + ' parallel points, return {"carousel": false} and nothing else.\n\n' +
    'When a carousel fits, return STRICT JSON:\n' +
    '{"carousel":true,' +
    '"rubric":"1-2 word section label for THIS carousel, read from the post itself (e.g. \\"инструменты\\", \\"гайд\\", \\"подборка\\") — not the channel rubric you were given",' +
    '"title":"2-5 word headline for the intro slide",' +
    '"subtitle":"one short sentence under the headline",' +
    '"outroTitle":"2-3 word headline for the CLOSING slide — an imperative like \\"Save this list\\", never the intro headline repeated",' +
    '"cta":"one short call to action under it",' +
    '"topTag":"1-2 word label describing the format or topic; it sits next to the rubric, so it must NOT repeat it",' +
    '"tags":["up to 4 single short words"],' +
    `"items":[{"title":"1-4 words","desc":"one short sentence"}],` +
    '"position":"top|middle|end"}\n\n' +
    '"position" says where the carousel belongs in the post: "top" when the points ARE the post, ' +
    '"middle" when prose introduces them and prose follows, "end" when they summarize it.\n' +
    `Write every value in ${lang}. Plain text only — no markdown, no emoji, no leading "#", "//" or bullets ` +
    '(the slide template draws its own punctuation). Keep titles brutally short: they land in huge display type and long words break the layout.';

  const user =
    // The channel rubric is context, never the answer: it was picked from the few
    // rubric templates the channel owns, so a tools round-up can arrive as "Новости".
    (ctx.rubricName ? `Channel rubric (background only — do NOT reuse it as "rubric"): ${ctx.rubricName}\n` : '') +
    `POST TEXT:\n${ctx.postText.slice(0, 3000)}\n\n` +
    'Return the JSON now.';

  return { system, user };
}

// ─── Sanitizing ───────────────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function sanitizeItems(raw: unknown): CarouselItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CarouselItem[] = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const title = str(o['title'], 40);
    const desc  = str(o['desc'], 140);
    // A point with no title has no slide to draw — drop it rather than render
    // an empty display slot.
    if (!title) continue;
    out.push({ title, desc });
  }
  return out;
}

function sanitizePosition(v: unknown): CarouselPosition {
  return v === 'top' || v === 'middle' ? v : 'end';
}

function sanitize(plan: AiPlan): CarouselContent | null {
  if (plan.carousel !== true) return null;
  const items = sanitizeItems(plan.items);
  if (items.length < MIN_ITEMS) return null;

  const tags = Array.isArray(plan.tags)
    ? plan.tags.map(t => str(t, 20).replace(/^#/, '')).filter(Boolean).slice(0, 4)
    : [];

  const title = str(plan.title, 40);
  // A model that echoes the intro headline back gives us a closing slide that
  // says nothing. Reject the echo; outroSlots then falls back deliberately.
  const outroTitle = str(plan.outroTitle, 40);

  const rubric = str(plan.rubric, 20);
  // The rubric sits top-left and the topTag top-right on the same slide. Printing
  // one word twice reads as a rendering bug, so drop the duplicate.
  const topTag = str(plan.topTag, 20);

  return {
    rubric,
    title,
    subtitle:   str(plan.subtitle, 90),
    outroTitle: outroTitle.toLowerCase() === title.toLowerCase() ? '' : outroTitle,
    cta:        str(plan.cta, 90),
    topTag:     topTag.toLowerCase() === rubric.toLowerCase() ? '' : topTag,
    tags,
    items,
    position:   sanitizePosition(plan.position),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the carousel content, or null when the post does not warrant one.
 * Never throws: without an AI provider (or on any failure) there is no carousel,
 * which degrades the post to exactly what it would have been before this engine
 * existed.
 */
export async function planCarousel(ctx: CarouselContext): Promise<CarouselContent | null> {
  if (!env.OPENAI_API_KEY || ctx.postText.length < 200) return null;
  const { system, user } = buildPrompt(ctx);
  try {
    const raw = await terraText({
      system,
      prompt: user,
      maxTokens: 1200,
      timeoutMs: 25_000,
      effort: 'low',
    });
    return sanitize(JSON.parse(raw ?? '{}') as AiPlan);
  } catch (err) {
    console.warn('[carouselEngine] planner failed:', (err as Error).message);
    return null;
  }
}
