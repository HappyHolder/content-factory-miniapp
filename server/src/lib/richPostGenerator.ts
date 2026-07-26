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
import { parseInline, stripDisabledHighlightMarkers } from './richPost';
import { terraText } from './assistantModel';
import type { ListItem, PostBlock } from './richPost';

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

// Inline markers (**bold**, [text](url), …) are parsed by the
// shared parseInline() from ./richPost — one canonical vocabulary everywhere.

// ─── AI element schema (what the model returns) ─────────────────────────────────

interface AiElement {
  kind: 'paragraph' | 'quote' | 'list' | 'table' | 'image' | 'gallery' | 'divider' | 'linkbox';
  text?: string;                 // paragraph / quote / linkbox
  url?:  string;                 // linkbox
  expandable?: boolean;          // quote
  ordered?: boolean;             // list
  items?: (string | { text?: string; sub?: string[] })[];  // list (item may carry a nested sub-list)
  headers?: string[];            // table
  rows?: string[][];             // table
  index?: number;                // image → images[index]
  indices?: number[];            // gallery → images[indices]
  layout?: 'slideshow' | 'collage';
}

interface AiLayout {
  heading?:    string;
  headingUrl?: string;   // optional — makes the heading a link (only if the URL is in the source)
  elements?:   AiElement[];
}

// ─── Prompt ─────────────────────────────────────────────────────────────────────

function buildPrompt(input: RichGenInput): { system: string; user: string } {
  const imgCount = input.images.length;
  const ru = (input.lang ?? 'ru') === 'ru';

  const levelRule =
    input.level === 'minimal'
      ? 'LEVEL=minimal: keep it simple — a heading and 1-3 short paragraphs. Avoid tables/lists/quotes unless the content is literally a list or table.'
      : 'FORMAT RICHLY. The output must look polished and scannable, NOT a wall of plain paragraphs. Actively use structure: bold the key numbers/percentages/tickers/names, turn any comparative or multi-item numeric data into a TABLE, turn steps or rankings into a LIST, and put a key takeaway or "why" aside into an expandable quote. If a post is just prose with no real structure, at minimum bold its key figures and split it into clean short paragraphs.';

  const imageRule = imgCount === 0
    ? 'There are NO images available — do not emit image/gallery elements.'
    : imgCount === 1
      ? 'There is 1 image (index 0). Emit ONE {"kind":"image","index":0} element, usually near the top.'
      : `There are ${imgCount} images (indices 0..${imgCount - 1}). If they are a set worth browsing, emit ONE {"kind":"gallery","layout":"slideshow","indices":[0,...]}. If each illustrates a different point, place separate {"kind":"image","index":N} elements between paragraphs. Use every image once.`;

  const system =
    'You are a post layout engine. You turn a finished post into a beautifully FORMATTED Telegram post that has a real "wow" structure. ' +
    'Faithfulness: never invent figures or facts, never translate, never drop any language or any fact from the source. ' +
    'But you MAY restructure prose into headings, paragraphs, lists and tables, and lightly rephrase to fit table cells / list items, as long as every number and fact stays exactly faithful to the source. ' +
    'Extract figures buried in prose into tables/lists rather than leaving them in a wall of text. ' +
    'If the post is bilingual (two languages), KEEP BOTH versions and SEPARATE them with a {"kind":"divider"} (first language fully, then divider, then the second). ' +
    'Output STRICT JSON only, matching this shape: ' +
    '{"heading": string, "headingUrl"?: string, "elements": [ {"kind":"paragraph","text":"..."} | {"kind":"quote","text":"...","expandable":true} | {"kind":"list","ordered":true,"items":["..."]} | {"kind":"table","headers":["..."],"rows":[["..."]]} | {"kind":"image","index":0} | {"kind":"gallery","layout":"slideshow","indices":[0,1]} | {"kind":"linkbox","text":"...","url":"..."} | {"kind":"divider"} ] }. ' +
    'A "linkbox" is a framed CTA box with a centered link — use it AT MOST once, at the very end, and ONLY when the source has a real action URL (a product/site/handle). Never invent its URL. ' +
    'A list "items" entry is a string, OR an object {"text":"...","sub":["...","..."]} to nest a numbered sub-list under that item (use nesting when the source groups sub-points under a point). ' +
    '"headingUrl" is optional — set it ONLY if the source text contains a URL that the heading should link to. ' +
    'Inline emphasis via these markers inside text (never output HTML tags): **bold**, __italic__, ~~strike~~, `mono`, ||spoiler||, and links [text](url). ' +
    'TEMPORARY HARD RULE: highlighting is disabled. Never output ==highlight== or wrap any text in == markers; use **bold** for genuinely key terms instead. Bold the key numbers, percentages, tickers and names. Use `mono` for code, tickers, IDs or commands. ' +
    'Use links [text](url) ONLY when the source text actually contains that URL (for a source, product or handle) — never invent or guess a URL. Do not over-format: most text stays plain. ' +
    'Keep a table to 2-4 columns. Table cells (headers and rows) may use the same enabled inline markers — e.g. **bold** the key figure. Never use == markers in cells. Do not add a signature/handle line. ' +
    (ru ? 'Write any structural labels (table headers) in Russian.' : 'Write structural labels in English.');

  const user =
    `${levelRule}\n${imageRule}\n` +
    (input.rubric ? `Rubric: ${input.rubric}\n` : '') +
    `\nPOST TEXT:\n${input.postText}\n\nReturn the JSON layout now.`;

  return { system, user };
}

// ─── DeepSeek call ──────────────────────────────────────────────────────────────

/** Extracts the first {...} JSON object from a model reply (robust to fences/prose). */
function parseLayout(raw: string): AiLayout | null {
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(raw.slice(s, e + 1)) as AiLayout; }
  catch { return null; }
}

/** Uses the same primary text model as the rest of the product. Null on failure. */
async function callLayoutAI(system: string, user: string): Promise<AiLayout | null> {
  if (!env.OPENAI_API_KEY) return null;
  // 8000 tokens: a full post laid out as blocks is long, and the old Replicate
  // call left max_tokens unset to get the model's native capacity.
  const raw = await terraText({ system, prompt: user, maxTokens: 8000, timeoutMs: 60_000, effort: 'low' });
  return raw ? parseLayout(raw) : null;
}
// ─── Mapping AiLayout → PostBlock[] ─────────────────────────────────────────────

function isStr(x: unknown): x is string { return typeof x === 'string' && x.trim().length > 0; }

/** A list item may be a plain string or an object with an optional nested sub-list. */
function toListItem(x: string | { text?: string; sub?: string[] }): ListItem | null {
  if (isStr(x)) return { runs: parseInline(stripDisabledHighlightMarkers(x)) };
  if (x && typeof x === 'object' && isStr(x.text)) {
    const sub = Array.isArray(x.sub) ? x.sub.filter(isStr).map(v => parseInline(stripDisabledHighlightMarkers(v))) : [];
    const runs = parseInline(stripDisabledHighlightMarkers(x.text));
    return sub.length ? { runs, sub } : { runs };
  }
  return null;
}

function mapElement(el: AiElement, images: string[], usedImages: Set<number>): PostBlock | null {
  switch (el.kind) {
    case 'paragraph':
      return isStr(el.text) ? { type: 'paragraph', runs: parseInline(stripDisabledHighlightMarkers(el.text)) } : null;
    case 'quote':
      return isStr(el.text) ? { type: 'quote', runs: parseInline(stripDisabledHighlightMarkers(el.text)), expandable: el.expandable === true } : null;
    case 'list': {
      const items = Array.isArray(el.items)
        ? el.items.map(toListItem).filter((x): x is ListItem => x !== null)
        : [];
      return items.length ? { type: 'list', ordered: el.ordered === true, items } : null;
    }
    case 'table': {
      const headers = Array.isArray(el.headers) ? el.headers.filter(isStr).map(stripDisabledHighlightMarkers) : [];
      const rows = Array.isArray(el.rows)
        ? el.rows.filter(r => Array.isArray(r)).map(r => r.map(c => (isStr(c) ? stripDisabledHighlightMarkers(c) : '')))
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
    case 'linkbox':
      return isStr(el.text) && isStr(el.url) && /^https?:\/\/\S+$/i.test(el.url.trim())
        ? { type: 'linkbox', text: stripDisabledHighlightMarkers(el.text.trim()), url: el.url.trim() } : null;
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

/** Minimal deterministic fallback that preserves the source's paragraph structure. */
function fallbackBlocks(input: RichGenInput): PostBlock[] {
  const lines = input.postText.split('\n').map(l => l.trim()).filter(Boolean);
  const heading = lines[0] && lines[0].length <= 90 ? lines[0] : null;
  const bodyLines = heading ? lines.slice(1) : lines;
  const blocks: PostBlock[] = [];
  if (input.images[0]) blocks.push({ type: 'image', url: input.images[0] });
  // Same marker stripping as the AI-layout path above: a heading renders as plain
  // display-bold text, so leftover **bold** markers would show literally. This
  // path runs whenever the layout model fails (e.g. provider throttling), which
  // is exactly when a broken heading is most visible.
  if (heading) blocks.push({ type: 'heading', text: parseInline(stripDisabledHighlightMarkers(heading)).map(r => r.t).join('') });
  for (const paragraph of bodyLines) {
    blocks.push({ type: 'paragraph', runs: parseInline(paragraph) });
  }
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
  let layout: AiLayout | null = null;
  try {
    layout = await callLayoutAI(system, user);
  } catch (err) {
    console.warn('[richPostGenerator] Layout model failed; using deterministic rich fallback:', (err as Error).message);
  }

  let blocks: PostBlock[];
  if (!layout || !Array.isArray(layout.elements)) {
    blocks = fallbackBlocks(input);
  } else {
    blocks = [];
    if (isStr(layout.heading)) {
      const link = isStr(layout.headingUrl) && /^https?:\/\/\S+$/i.test(layout.headingUrl.trim())
        ? layout.headingUrl.trim() : undefined;
      // The heading is plain text (display-bold already) — strip any inline markers
      // the model left in (e.g. **bold**), so they don't render literally.
      const text = parseInline(stripDisabledHighlightMarkers(layout.heading)).map(r => r.t).join('');
      blocks.push({ type: 'heading', text, ...(link ? { link } : {}) });
    }
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
