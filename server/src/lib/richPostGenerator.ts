/**
 * richPostGenerator.ts
 *
 * The "formatting pass": takes an already-generated post text + the available
 * images + a formatting level, and asks the AI to lay it out as a STRUCTURE
 * (heading, paragraphs, optional table/list/quote, image placements). We then
 * map that structure to PostBlock[] (see richPost.ts) which renders to Telegram
 * Rich Message HTML.
 *
 * Safety model:
 *  - The AI returns ONLY text values + a constrained element vocabulary as JSON.
 *  - It references images by INDEX into the images[] we pass — never raw URLs.
 *  - Inline emphasis is expressed with simple markers (**bold**, ||spoiler||)
 *    which we parse into Run[]; the AI never emits HTML tags.
 *  - Any parse/validation failure falls back to a minimal heading+paragraph+image.
 */

import { env } from '../env';
import type { PostBlock, Run } from './richPost';

export type FormatLevel = 'auto' | 'minimal' | 'article';

export interface RichGenInput {
  /** The post body text (already generated in the channel's voice). */
  postText: string;
  /** Optional rubric hint (e.g. "Сигнал", "Топ", "Новости"). */
  rubric?: string | null;
  /** How rich the layout may be. */
  level: FormatLevel;
  /** Image URLs available to place (generated covers / uploads). */
  images: string[];
  /** Channel @handle for the footer line, or null. */
  handle?: string | null;
  /** Cover-text language hint: 'ru' | 'en'. Defaults to ru. */
  lang?: 'ru' | 'en';
}

// ─── Inline marker parsing ──────────────────────────────────────────────────────
// Converts a plain string with **bold** and ||spoiler|| markers into Run[].

export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  // Split on **bold** and ||spoiler|| while keeping delimiters.
  const re = /(\*\*[^*]+\*\*|\|\|[^|]+\|\|)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ t: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('**')) runs.push({ t: tok.slice(2, -2), b: true });
    else                      runs.push({ t: tok.slice(2, -2), spoiler: true });
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push({ t: text.slice(last) });
  return runs.length ? runs : [{ t: text }];
}

// ─── AI element schema (what the model returns) ─────────────────────────────────

interface AiElement {
  kind: 'paragraph' | 'quote' | 'list' | 'table' | 'image' | 'gallery' | 'divider';
  text?: string;                 // paragraph / quote
  expandable?: boolean;          // quote
  ordered?: boolean;             // list
  items?: string[];              // list
  headers?: string[];            // table
  rows?: string[][];             // table
  index?: number;                // image → images[index]
  indices?: number[];            // gallery → images[indices]
  layout?: 'slideshow' | 'collage';
}

interface AiLayout {
  heading?: string;
  elements?: AiElement[];
}

// ─── Prompt ─────────────────────────────────────────────────────────────────────

function buildPrompt(input: RichGenInput): { system: string; user: string } {
  const imgCount = input.images.length;
  const ru = (input.lang ?? 'ru') === 'ru';

  const levelRule =
    input.level === 'minimal'
      ? 'LEVEL=minimal: keep it simple — a heading and 1-3 short paragraphs. Avoid tables/lists/quotes unless the content is literally a list or table.'
      : input.level === 'article'
        ? 'LEVEL=article: use the full toolkit where it genuinely helps — heading, paragraphs, a table for numeric data, an ordered/unordered list for steps/rankings, an expandable quote for extra detail.'
        : 'LEVEL=auto: pick the lightest structure that fits the content. Use a table only for numeric/comparative data, a list only for steps or rankings, a quote only for a real quotation or a key takeaway.';

  const imageRule = imgCount === 0
    ? 'There are NO images available — do not emit image/gallery elements.'
    : imgCount === 1
      ? 'There is 1 image (index 0). Emit ONE {"kind":"image","index":0} element, usually near the top.'
      : `There are ${imgCount} images (indices 0..${imgCount - 1}). If they are a set worth browsing, emit ONE {"kind":"gallery","layout":"slideshow","indices":[0,...]}. If each illustrates a different point, place separate {"kind":"image","index":N} elements between paragraphs. Use every image once.`;

  const system =
    'You are a post layout engine. You receive a finished post text and must lay it out as STRUCTURE — you do NOT rewrite, translate, shorten, or invent content. ' +
    'Reuse the exact wording from the post (you may split it across a heading, paragraphs, list items or table cells). ' +
    'Preserve EVERY part of the post verbatim, including ALL languages present — never omit, summarize, or translate anything. ' +
    'If the post is bilingual (contains two languages), KEEP BOTH language versions, and SEPARATE them with a {"kind":"divider"} element: lay out the first language fully, then a divider, then the second language version. ' +
    'Output STRICT JSON only, matching this shape: ' +
    '{"heading": string, "elements": [ {"kind":"paragraph","text":"..."} | {"kind":"quote","text":"...","expandable":true} | {"kind":"list","ordered":true,"items":["..."]} | {"kind":"table","headers":["..."],"rows":[["..."]]} | {"kind":"image","index":0} | {"kind":"gallery","layout":"slideshow","indices":[0,1]} | {"kind":"divider"} ] }. ' +
    'Inline emphasis ONLY via markers inside text: **bold** and ||spoiler||. Never output HTML tags. ' +
    'Keep a table to 2-4 columns. Do not add a signature/handle line — it is added separately. ' +
    (ru ? 'Write any structural labels (table headers) in Russian.' : 'Write structural labels in English.');

  const user =
    `${levelRule}\n${imageRule}\n` +
    (input.rubric ? `Rubric: ${input.rubric}\n` : '') +
    `\nPOST TEXT:\n${input.postText}\n\nReturn the JSON layout now.`;

  return { system, user };
}

// ─── DeepSeek call ──────────────────────────────────────────────────────────────

async function callLayoutAI(system: string, user: string): Promise<AiLayout | null> {
  if (!env.DEEPSEEK_API_KEY) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: 4096,
        temperature: 0.3,
      }),
    });
    if (!res.ok) { console.error('[richPostGenerator] DeepSeek', res.status); return null; }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '';
    return JSON.parse(raw) as AiLayout;
  } catch (err) {
    console.error('[richPostGenerator] layout AI failed:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Mapping AiLayout → PostBlock[] ─────────────────────────────────────────────

function isStr(x: unknown): x is string { return typeof x === 'string' && x.trim().length > 0; }

function mapElement(el: AiElement, images: string[], usedImages: Set<number>): PostBlock | null {
  switch (el.kind) {
    case 'paragraph':
      return isStr(el.text) ? { type: 'paragraph', runs: parseInline(el.text) } : null;
    case 'quote':
      return isStr(el.text) ? { type: 'quote', runs: parseInline(el.text), expandable: el.expandable === true } : null;
    case 'list': {
      const items = Array.isArray(el.items) ? el.items.filter(isStr) : [];
      return items.length ? { type: 'list', ordered: el.ordered === true, items: items.map(parseInline) } : null;
    }
    case 'table': {
      const headers = Array.isArray(el.headers) ? el.headers.filter(isStr) : [];
      const rows = Array.isArray(el.rows)
        ? el.rows.filter(r => Array.isArray(r)).map(r => r.map(c => (isStr(c) ? c : '')))
        : [];
      return rows.length ? { type: 'table', headers, rows } : null;
    }
    case 'image': {
      const i = el.index ?? 0;
      if (i >= 0 && i < images.length) { usedImages.add(i); return { type: 'image', url: images[i]! }; }
      return null;
    }
    case 'divider':
      return { type: 'divider' };
    case 'gallery': {
      const idxs = (Array.isArray(el.indices) ? el.indices : [])
        .filter(i => typeof i === 'number' && i >= 0 && i < images.length);
      idxs.forEach(i => usedImages.add(i));
      const urls = idxs.map(i => images[i]!);
      return urls.length >= 2 ? { type: 'gallery', layout: el.layout === 'collage' ? 'collage' : 'slideshow', urls }
        : urls.length === 1 ? { type: 'image', url: urls[0]! } : null;
    }
    default:
      return null;
  }
}

/** Minimal deterministic fallback: heading (first line) + paragraph + first image. */
function fallbackBlocks(input: RichGenInput): PostBlock[] {
  const lines = input.postText.split('\n').map(l => l.trim()).filter(Boolean);
  const heading = lines[0] && lines[0].length <= 90 ? lines[0] : null;
  const body = heading ? lines.slice(1).join('\n\n') : input.postText;
  const blocks: PostBlock[] = [];
  if (input.images[0]) blocks.push({ type: 'image', url: input.images[0] });
  if (heading) blocks.push({ type: 'heading', text: heading });
  if (body.trim()) blocks.push({ type: 'paragraph', runs: parseInline(body.trim()) });
  return blocks;
}

/** Appends a leftover-images gallery (so we never silently drop generated images). */
function appendUnusedImages(blocks: PostBlock[], images: string[], used: Set<number>): void {
  const leftover = images.filter((_, i) => !used.has(i));
  if (leftover.length >= 2) blocks.push({ type: 'gallery', layout: 'slideshow', urls: leftover });
  else if (leftover.length === 1) blocks.push({ type: 'image', url: leftover[0]! });
}

/**
 * Generates the structured blocks for a post. Never throws — returns a sensible
 * fallback layout if the AI is unavailable or returns something unusable.
 */
export async function generateRichBlocks(input: RichGenInput): Promise<PostBlock[]> {
  const { system, user } = buildPrompt(input);
  const layout = await callLayoutAI(system, user);

  let blocks: PostBlock[];
  if (!layout || !Array.isArray(layout.elements)) {
    blocks = fallbackBlocks(input);
  } else {
    blocks = [];
    if (isStr(layout.heading)) blocks.push({ type: 'heading', text: layout.heading });
    const used = new Set<number>();
    for (const el of layout.elements) {
      const b = el && typeof el === 'object' ? mapElement(el, input.images, used) : null;
      if (b) blocks.push(b);
    }
    // Guard: if the model produced no real content, fall back.
    if (!blocks.some(b => b.type === 'paragraph' || b.type === 'list' || b.type === 'table' || b.type === 'quote')) {
      blocks = fallbackBlocks(input);
      used.clear();
      appendUnusedImages(blocks, input.images, used);
    } else {
      appendUnusedImages(blocks, input.images, used);
    }
  }

  return blocks;
}
