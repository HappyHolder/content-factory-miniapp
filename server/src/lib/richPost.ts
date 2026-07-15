/**
 * richPost.ts
 *
 * The structured-post model and its renderer. A post is a list of BLOCKS (heading,
 * paragraph, list, table, quote, image, gallery…). We render those blocks into the
 * Telegram "Rich Message" HTML accepted by sendRichMessage ({ rich_message: { html } }).
 *
 * Why a block model and not free HTML from the AI: the AI only supplies TEXT and
 * says "image goes here" — the tags/layout are produced HERE, deterministically.
 * All text is HTML-escaped, so the AI can never inject markup ("каша"-proof).
 *
 * Verified tag set (see memory telegram-rich-messages): <h3> <p> <ul>/<ol>/<li>
 * <table><tr><th><td> <blockquote [expandable]> <hr> inline <b><i><u><s>
 * <tg-spoiler><code><a> <img>, and <tg-slideshow>/<tg-collage> wrapping <img> for
 * a swipeable carousel / grid.
 */

// ─── Inline runs ────────────────────────────────────────────────────────────────
// A paragraph/quote/list-item is an array of styled text runs. The AI fills `t`
// (plain text) + flags; we emit the tags.

export interface Run {
  t:        string;    // plain text (will be escaped)
  b?:       boolean;   // bold
  i?:       boolean;   // italic
  u?:       boolean;   // underline
  s?:       boolean;   // strikethrough
  code?:    boolean;   // inline monospace
  spoiler?: boolean;   // hidden until tapped
  mark?:    boolean;   // highlighted (Telegram <mark> "marked" style)
  link?:    string;    // wrap in <a href>
}

// ─── Blocks ─────────────────────────────────────────────────────────────────────

// A list item is a line of runs plus an optional nested numbered sub-list
// (Telegram renders <ul><li>…<ol>…</ol></li></ul> natively — verified live).
export interface ListItem { runs: Run[]; sub?: Run[][] }

export type PostBlock =
  | { type: 'heading';   text: string; link?: string }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list';      ordered?: boolean; items: ListItem[] }
  | { type: 'quote';     runs: Run[]; expandable?: boolean }
  | { type: 'table';     headers: string[]; rows: string[][] }
  | { type: 'image';     url: string; prompt?: string }
  | { type: 'video';     url: string; poster?: string }
  | { type: 'document';  url: string; name: string; mime?: string; size?: number }
  | { type: 'gallery';   layout: 'slideshow' | 'collage' | 'stack'; urls: string[]; matrix4?: string[][] }
  // A framed, filled CTA box with a centered link inside — a single bordered
  // header-cell table (Telegram: border="1" → is_bordered, <th> → fill).
  | { type: 'linkbox';   text: string; url: string }
  // Checklist — a <ul> whose items carry checkboxes (Telegram: has_checkbox / is_checked).
  | { type: 'checklist'; items: { text: string; checked: boolean }[] }
  // Collapsible section with a visible header (Telegram <details><summary>).
  | { type: 'details';   summary: string; body: string }
  // Preformatted code block with an optional language label + copy button (<pre><code>).
  | { type: 'code';      text: string; language?: string }
  | { type: 'divider' };

export interface RichPost {
  blocks: PostBlock[];
}

// ─── Runtime normalization ────────────────────────────────────────────────────
// PostBlock is stored as JSON, so TypeScript cannot protect rows written by an
// older application version. In particular, list items used to be stored as
// Run[][] and now use { runs: Run[]; sub?: Run[][] }[]. Normalize at every I/O
// boundary so legacy content remains editable and publishable.

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeRun(value: unknown): Run | null {
  const run = objectValue(value);
  if (!run || typeof run['t'] !== 'string') return null;
  return {
    t: run['t'],
    ...(run['b'] === true ? { b: true } : {}),
    ...(run['i'] === true ? { i: true } : {}),
    ...(run['u'] === true ? { u: true } : {}),
    ...(run['s'] === true ? { s: true } : {}),
    ...(run['code'] === true ? { code: true } : {}),
    ...(run['spoiler'] === true ? { spoiler: true } : {}),
    ...(run['mark'] === true ? { mark: true } : {}),
    ...(typeof run['link'] === 'string' ? { link: run['link'] } : {}),
  };
}

function normalizeRuns(value: unknown): Run[] {
  return Array.isArray(value)
    ? value.map(normalizeRun).filter((run): run is Run => run !== null)
    : [];
}

function normalizeListItem(value: unknown): ListItem | null {
  if (Array.isArray(value)) {
    const runs = normalizeRuns(value);
    return runs.length ? { runs } : null;
  }
  if (typeof value === 'string') return { runs: [{ t: value }] };
  const item = objectValue(value);
  if (!item) return null;
  const runs = normalizeRuns(item['runs']);
  if (!runs.length && typeof item['text'] === 'string') runs.push({ t: item['text'] });
  if (!runs.length) return null;
  const sub = Array.isArray(item['sub'])
    ? item['sub'].map(normalizeRuns).filter(runs => runs.length > 0)
    : [];
  return sub.length ? { runs, sub } : { runs };
}

function normalizeMatrix4(value: unknown): string[][] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const rows = value.map(row => Array.isArray(row) ? row.filter((v): v is string => typeof v === 'string') : []);
  return rows.every(row => row.length === 4) ? rows : undefined;
}
function normalizeBlock(value: unknown): PostBlock | null {
  const block = objectValue(value);
  if (!block || typeof block['type'] !== 'string') return null;
  switch (block['type']) {
    case 'heading':
      return typeof block['text'] === 'string'
        ? { type: 'heading', text: block['text'], ...(typeof block['link'] === 'string' ? { link: block['link'] } : {}) }
        : null;
    case 'paragraph': return { type: 'paragraph', runs: normalizeRuns(block['runs']) };
    case 'list': {
      const items = Array.isArray(block['items'])
        ? block['items'].map(normalizeListItem).filter((item): item is ListItem => item !== null)
        : [];
      return { type: 'list', ordered: block['ordered'] === true, items };
    }
    case 'quote': return { type: 'quote', runs: normalizeRuns(block['runs']), expandable: block['expandable'] === true };
    case 'table': {
      const headers = Array.isArray(block['headers']) ? block['headers'].map(v => typeof v === 'string' ? v : '') : [];
      const rows = Array.isArray(block['rows'])
        ? block['rows'].filter(Array.isArray).map(row => row.map(v => typeof v === 'string' ? v : ''))
        : [];
      return { type: 'table', headers, rows };
    }
    case 'image': return typeof block['url'] === 'string' ? { type: 'image', url: block['url'], ...(typeof block['prompt'] === 'string' ? { prompt: block['prompt'] } : {}) } : null;
    case 'video': return typeof block['url'] === 'string' ? { type: 'video', url: block['url'], ...(typeof block['poster'] === 'string' ? { poster: block['poster'] } : {}) } : null;
    case 'document': return typeof block['url'] === 'string' && typeof block['name'] === 'string' ? { type: 'document', url: block['url'], name: block['name'], ...(typeof block['mime'] === 'string' ? { mime: block['mime'] } : {}), ...(typeof block['size'] === 'number' ? { size: block['size'] } : {}) } : null;
    case 'gallery': {
      const matrix4 = normalizeMatrix4(block['matrix4']);
      const urls = matrix4?.flat() ?? (Array.isArray(block['urls']) ? block['urls'].filter((v): v is string => typeof v === 'string') : []);
      const layout = block['layout'] === 'collage' || block['layout'] === 'stack' ? block['layout'] : 'slideshow';
      return { type: 'gallery', layout, urls, ...(matrix4 ? { matrix4 } : {}) };
    }
    case 'linkbox': return typeof block['text'] === 'string' && typeof block['url'] === 'string' ? { type: 'linkbox', text: block['text'], url: block['url'] } : null;
    case 'checklist': {
      const items = Array.isArray(block['items']) ? block['items'].flatMap(value => {
        const item = objectValue(value);
        return item && typeof item['text'] === 'string' ? [{ text: item['text'], checked: item['checked'] === true }] : [];
      }) : [];
      return { type: 'checklist', items };
    }
    case 'details': return typeof block['summary'] === 'string' && typeof block['body'] === 'string' ? { type: 'details', summary: block['summary'], body: block['body'] } : null;
    case 'code': return typeof block['text'] === 'string' ? { type: 'code', text: block['text'], ...(typeof block['language'] === 'string' ? { language: block['language'] } : {}) } : null;
    case 'divider': return { type: 'divider' };
    default: return null;
  }
}

/** Converts persisted/remote JSON into the current safe PostBlock shape. */
function collapseLegacyMatrix4(blocks: PostBlock[]): PostBlock[] {
  const output: PostBlock[] = [];
  for (let i = 0; i < blocks.length;) {
    const candidate = blocks.slice(i, i + 4);
    const galleries = candidate.filter((item): item is Extract<PostBlock, { type: 'gallery' }> => item.type === 'gallery');
    let prefix: string | null = null;
    const isLegacyMatrix = candidate.length === 4 && galleries.length === 4 && galleries.every((gallery, row) =>
      !gallery.matrix4 && gallery.layout === 'slideshow' && gallery.urls.length === 4 && gallery.urls.every((url, column) => {
        const match = url.match(/^(.*)-r([0-3])-c([0-3])\.png(?:\?.*)?$/);
        if (!match || Number(match[2]) !== row || Number(match[3]) !== column) return false;
        if (prefix === null) prefix = match[1] ?? null;
        return prefix !== null && match[1] === prefix;
      }),
    );
    if (isLegacyMatrix) {
      const rows = galleries.map(gallery => gallery.urls);
      output.push({ type: 'gallery', layout: 'slideshow', urls: rows.flat(), matrix4: rows });
      i += 4;
    } else {
      output.push(blocks[i]!);
      i += 1;
    }
  }
  return output;
}

export function normalizePostBlocks(value: unknown): PostBlock[] | null {
  if (!Array.isArray(value)) return null;
  return collapseLegacyMatrix4(value.map(normalizeBlock).filter((block): block is PostBlock => block !== null));
}
// ─── Escaping ───────────────────────────────────────────────────────────────────

/** Escapes text for use inside Telegram HTML (&, <, > only — per Bot API spec). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Removes the temporarily disabled ==highlight== syntax from AI-generated text. */
export function stripDisabledHighlightMarkers(s: string): string {
  return s.replace(/==([\s\S]*?)==/g, '$1');
}

/** Escapes a value for use inside a double-quoted HTML attribute. */
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/** Returns true for a syntactically plausible http(s) URL (defensive). */
function isHttpUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

// ─── Inline rendering ───────────────────────────────────────────────────────────

function renderRun(r: Run): string {
  let html = escapeHtml(r.t);
  if (r.code)    html = `<code>${html}</code>`;
  if (r.b)       html = `<b>${html}</b>`;
  if (r.i)       html = `<i>${html}</i>`;
  if (r.u)       html = `<u>${html}</u>`;
  if (r.s)       html = `<s>${html}</s>`;
  if (r.mark)    html = `<mark>${html}</mark>`;
  if (r.spoiler) html = `<tg-spoiler>${html}</tg-spoiler>`;
  if (r.link && isHttpUrl(r.link)) html = `<a href="${escapeAttr(r.link)}">${html}</a>`;
  return html;
}

function renderRuns(runs: Run[]): string {
  return runs.map(renderRun).join('');
}

// Inline marker parser — the ONE canonical vocabulary shared by the generator,
// the block editor (RichPostPreview.textToRuns) and table cells:
//   [text](url) · **bold** · __italic__ · ~~strike~~ · `mono` · ==highlight== · ||spoiler||
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const re = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|==[^=]+==|\|\|[^|]+\|\|)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ t: text.slice(last, m.index) });
    const tok = m[0];
    if (tok[0] === '[') {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (lm) runs.push({ t: lm[1]!, link: lm[2]! });
      else runs.push({ t: tok });
    }
    else if (tok.startsWith('**')) runs.push({ t: tok.slice(2, -2), b: true });
    else if (tok.startsWith('__')) runs.push({ t: tok.slice(2, -2), i: true });
    else if (tok.startsWith('~~')) runs.push({ t: tok.slice(2, -2), s: true });
    else if (tok.startsWith('==')) runs.push({ t: tok.slice(2, -2), mark: true });
    else if (tok.startsWith('||')) runs.push({ t: tok.slice(2, -2), spoiler: true });
    else if (tok.startsWith('`'))  runs.push({ t: tok.slice(1, -1), code: true });
    else runs.push({ t: tok });
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push({ t: text.slice(last) });
  return runs.length ? runs : [{ t: text }];
}

/** Renders a table cell string that may carry inline markers (bold/highlight/link…). */
function renderCell(s: string): string {
  return renderRuns(parseInline(s));
}

// ─── Block rendering ────────────────────────────────────────────────────────────

function renderImg(url: string): string {
  return isHttpUrl(url) ? `<img src="${escapeAttr(url)}">` : '';
}

function renderBlock(b: PostBlock): string {
  switch (b.type) {
    case 'heading':
      return b.link && isHttpUrl(b.link)
        ? `<h3><a href="${escapeAttr(b.link)}">${escapeHtml(b.text)}</a></h3>`
        : `<h3>${escapeHtml(b.text)}</h3>`;
    case 'paragraph':
      return `<p>${renderRuns(b.runs)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map(it => {
        let inner = renderRuns(it.runs);
        if (it.sub && it.sub.length) inner += `<ol>${it.sub.map(s => `<li>${renderRuns(s)}</li>`).join('')}</ol>`;
        return `<li>${inner}</li>`;
      }).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'quote':
      return `<blockquote${b.expandable ? ' expandable' : ''}>${renderRuns(b.runs)}</blockquote>`;
    case 'table': {
      const head = b.headers.length
        ? `<tr>${b.headers.map(h => `<th>${renderCell(h)}</th>`).join('')}</tr>`
        : '';
      const body = b.rows.map(row =>
        `<tr>${row.map(c => `<td>${renderCell(c)}</td>`).join('')}</tr>`).join('');
      return `<table>${head}${body}</table>`;
    }
    case 'image':
      return renderImg(b.url);
    case 'video':
      return isHttpUrl(b.url)
        ? `<video src="${escapeAttr(b.url)}"${b.poster && isHttpUrl(b.poster) ? ` poster="${escapeAttr(b.poster)}"` : ''}></video>`
        : '';
    case 'document':
      return '';
    case 'gallery': {
      if (b.matrix4) {
        return b.matrix4.map(row => {
          const rowImages = row.filter(isHttpUrl).map(renderImg).join('');
          return rowImages ? `<tg-slideshow>${rowImages}</tg-slideshow>` : '';
        }).join('');
      }
      const imgs = b.urls.filter(isHttpUrl).map(renderImg).join('');
      if (!imgs) return '';
      // 'stack' = bare consecutive <img> → Telegram renders separate stacked
      // photos (top-to-bottom), which is how a sliced vertical panorama reads.
      if (b.layout === 'stack') return imgs;
      const tag = b.layout === 'collage' ? 'tg-collage' : 'tg-slideshow';
      return `<${tag}>${imgs}</${tag}>`;
    }
    case 'linkbox': {
      if (!b.text.trim()) return '';
      const inner = isHttpUrl(b.url)
        ? `<a href="${escapeAttr(b.url)}">${escapeHtml(b.text)}</a>`
        : escapeHtml(b.text);
      // border="1" draws the frame; <th align="center"> gives the fill + centering.
      return `<table border="1"><tr><th align="center">${inner}</th></tr></table>`;
    }
    case 'checklist': {
      const items = b.items
        .filter(it => it.text.trim())
        .map(it => `<li><input type="checkbox"${it.checked ? ' checked' : ''}>${renderCell(it.text)}</li>`)
        .join('');
      return items ? `<ul>${items}</ul>` : '';
    }
    case 'details': {
      if (!b.summary.trim() && !b.body.trim()) return '';
      const body = b.body.trim() ? `<p>${renderRuns(parseInline(b.body))}</p>` : '';
      return `<details><summary>${escapeHtml(b.summary)}</summary>${body}</details>`;
    }
    case 'code':
      return b.text.trim()
        ? `<pre><code${b.language ? ` class="language-${escapeAttr(b.language)}"` : ''}>${escapeHtml(b.text)}</code></pre>`
        : '';
    case 'divider':
      return '<hr>';
    default:
      return '';
  }
}

/** Renders a structured post into Telegram Rich Message HTML. */
export function blocksToRichHtml(blocks: PostBlock[]): string {
  return blocks.map(renderBlock).filter(Boolean).join('\n');
}

// ─── Plain-text fallback ────────────────────────────────────────────────────────
// If sendRichMessage ever fails, we publish the post the old way. This flattens
// the blocks to readable plain text (no markup), and finds a cover image.

function runsToText(runs: Run[]): string {
  return runs.map(r => r.t).join('');
}

/** Flattens blocks to plain text for the legacy publish fallback. */
export function blocksToPlainText(blocks: PostBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':   parts.push(b.text); break;
      case 'paragraph': parts.push(runsToText(b.runs)); break;
      case 'quote':     parts.push(runsToText(b.runs)); break;
      case 'list':
        parts.push(b.items.map((it, i) => {
          const head = `${b.ordered ? `${i + 1}.` : '•'} ${runsToText(it.runs)}`;
          const subs = it.sub?.length
            ? '\n' + it.sub.map((s, j) => `   ${j + 1}. ${runsToText(s)}`).join('\n')
            : '';
          return head + subs;
        }).join('\n'));
        break;
      case 'table': {
        const plain = (c: string) => runsToText(parseInline(c));
        if (b.headers.length) parts.push(b.headers.map(plain).join(' · '));
        parts.push(b.rows.map(r => r.map(plain).join(' · ')).join('\n'));
        break;
      }
      case 'linkbox': parts.push(b.url ? `${b.text} (${b.url})` : b.text); break;
      case 'checklist':
        parts.push(b.items.filter(it => it.text.trim())
          .map(it => `${it.checked ? '☑' : '☐'} ${runsToText(parseInline(it.text))}`).join('\n'));
        break;
      case 'details':
        parts.push(b.summary + (b.body.trim() ? `\n${runsToText(parseInline(b.body))}` : ''));
        break;
      case 'code': parts.push(b.text); break;
      // image / video / document / gallery / divider produce no text
    }
  }
  return parts.filter(s => s.trim()).join('\n\n');
}

/** Returns the first usable cover image from the blocks, or null. */
export function firstImage(blocks: PostBlock[]): string | null {
  for (const b of blocks) {
    if (b.type === 'image' && isHttpUrl(b.url)) return b.url;
    if (b.type === 'gallery') {
      const first = b.urls.find(isHttpUrl);
      if (first) return first;
    }
  }
  return null;
}

/** Returns document attachments that should be sent after the main post. */
export function documentBlocks(blocks: PostBlock[]): { url: string; name: string }[] {
  return blocks
    .filter((b): b is Extract<PostBlock, { type: 'document' }> => b.type === 'document' && isHttpUrl(b.url) && !!b.name?.trim())
    .map(b => ({ url: b.url, name: b.name.trim() }));
}
