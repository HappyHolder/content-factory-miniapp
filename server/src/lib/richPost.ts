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
  | { type: 'image';     url: string }
  | { type: 'video';     url: string; poster?: string }
  | { type: 'document';  url: string; name: string; mime?: string; size?: number }
  | { type: 'gallery';   layout: 'slideshow' | 'collage'; urls: string[] }
  | { type: 'divider' };

export interface RichPost {
  blocks: PostBlock[];
}

// ─── Escaping ───────────────────────────────────────────────────────────────────

/** Escapes text for use inside Telegram HTML (&, <, > only — per Bot API spec). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        ? `<tr>${b.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`
        : '';
      const body = b.rows.map(row =>
        `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
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
      const tag = b.layout === 'collage' ? 'tg-collage' : 'tg-slideshow';
      const imgs = b.urls.filter(isHttpUrl).map(renderImg).join('');
      if (!imgs) return '';
      return `<${tag}>${imgs}</${tag}>`;
    }
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
      case 'table':
        if (b.headers.length) parts.push(b.headers.join(' · '));
        parts.push(b.rows.map(r => r.join(' · ')).join('\n'));
        break;
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
