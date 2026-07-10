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
import { parseInline } from './richPost';
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

// Inline markers (**bold**, ==highlight==, [text](url), …) are parsed by the
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
    'Inline emphasis via these markers inside text (never output HTML tags): **bold**, __italic__, ~~strike~~, `mono`, ==highlight==, ||spoiler||, and links [text](url). ' +
    'Bold the key numbers, percentages, tickers and names. Highlight (==) one or two genuinely key terms per post — sparingly. Use `mono` for code, tickers, IDs or commands. ' +
    'Use links [text](url) ONLY when the source text actually contains that URL (for a source, product or handle) — never invent or guess a URL. Do not over-format: most text stays plain. ' +
    'Keep a table to 2-4 columns. Table cells (headers and rows) may use the same inline markers — e.g. **bold** the key figure or ==highlight== a verdict in a cell. Do not add a signature/handle line. ' +
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

/** A list item may be a plain string or an object with an optional nested sub-list. */
function toListItem(x: string | { text?: string; sub?: string[] }): ListItem | null {
  if (isStr(x)) return { runs: parseInline(x) };
  if (x && typeof x === 'object' && isStr(x.text)) {
    const sub = Array.isArray(x.sub) ? x.sub.filter(isStr).map(parseInline) : [];
    return sub.length ? { runs: parseInline(x.text), sub } : { runs: parseInline(x.text) };
  }
  return null;
}

function mapElement(el: AiElement, images: string[], usedImages: Set<number>): PostBlock | null {
  switch (el.kind) {
    case 'paragraph':
      return isStr(el.text) ? { type: 'paragraph', runs: parseInline(el.text) } : null;
    case 'quote':
      return isStr(el.text) ? { type: 'quote', runs: parseInline(el.text), expandable: el.expandable === true } : null;
    case 'list': {
      const items = Array.isArray(el.items)
        ? el.items.map(toListItem).filter((x): x is ListItem => x !== null)
        : [];
      return items.length ? { type: 'list', ordered: el.ordered === true, items } : null;
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
    case 'linkbox':
      return isStr(el.text) && isStr(el.url) && /^https?:\/\/\S+$/i.test(el.url.trim())
        ? { type: 'linkbox', text: el.text.trim(), url: el.url.trim() } : null;
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
    if (isStr(layout.heading)) {
      const link = isStr(layout.headingUrl) && /^https?:\/\/\S+$/i.test(layout.headingUrl.trim())
        ? layout.headingUrl.trim() : undefined;
      blocks.push({ type: 'heading', text: layout.heading, ...(link ? { link } : {}) });
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
