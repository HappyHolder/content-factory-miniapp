/**
 * researchEngine.ts
 *
 * Deep research for the AI content manager. Given a search query (one plan
 * item), gathers grounded material a writer can turn into a post.
 *
 * Pipeline (Replicate-only, per product decision — no Anthropic API):
 *   Serper/Tavily search → fetchArticle on the top links → GPT-5.6 Terra
 *   synthesis pass through the unified primary model.
 *
 * The legacy `backend` option is accepted for call-site compatibility but
 * ignored — there is one pipeline now. Never throws: individual tool failures
 * degrade to whatever material was gathered.
 */

import { webSearch } from './webSearch';
import { fetchArticle } from './urlContentExtractor';
import { terraText } from './assistantModel';

export type ResearchBackend = 'opus' | 'deepseek' | 'terra';

export interface ResearchSource {
  url: string;
  title?: string;
}

export interface ResearchResult {
  text: string;              // synthesised research brief (grounded material)
  sources: ResearchSource[]; // de-duplicated source URLs
  backend: ResearchBackend;  // which backend actually ran
}

export interface ResearchOptions {
  /** Legacy — ignored; kept so existing call sites keep compiling. */
  backend?: ResearchBackend;
  /** Extra grounding text (e.g. ProjectDoc excerpts) folded into the prompt. */
  extraContext?: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
  maxSearches?: number;
}

const MAX_EXTRA_CONTEXT_CHARS = 12_000;
const sourceAllowed = (url: string, opts: ResearchOptions) => {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const allowed = opts.allowedDomains ?? [], blocked = opts.blockedDomains ?? [];
    if (blocked.some(d => h === d || h.endsWith('.' + d))) return false;
    return !allowed.length || allowed.some(d => h === d || h.endsWith('.' + d));
  } catch { return false; }
};

/** De-duplicates sources by URL, preserving order and the first non-empty title. */
function dedupeSources(sources: ResearchSource[]): ResearchSource[] {
  const byUrl = new Map<string, ResearchSource>();
  for (const s of sources) {
    if (!s.url) continue;
    const existing = byUrl.get(s.url);
    if (!existing) byUrl.set(s.url, { url: s.url, title: s.title });
    else if (!existing.title && s.title) existing.title = s.title;
  }
  return [...byUrl.values()];
}

/** Real 'now' (Moscow) — anchors the model so it treats the present, not its
 *  training cutoff, as current. */
function todayContext(): { iso: string; year: string } {
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  return { iso, year: iso.slice(0, 4) };
}

function researchSystem(): string {
  const { iso, year } = todayContext();
  return (
    `Today's real date is ${iso} (current year ${year}) — do NOT rely on your training cutoff; treat ${year} as the present. ` +
    'You are a diligent research assistant preparing source material for a Telegram post. ' +
    'You are given raw gathered material (search results and article extracts). ' +
    'Distill it into a structured research brief (NOT a finished post): bullet the key points and facts — ' +
    'figures, dates, names, concrete examples or quotes — note anything time-sensitive, and keep every claim ' +
    `grounded in the material. Prioritize the most CURRENT information (${year}); do not present older facts as current unless clearly historical context. ` +
    'Write the brief in the same language as the topic.'
  );
}

/** Extracts up to `limit` unique http(s) URLs from a text block. */
function extractUrls(text: string, limit: number): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s)"'<>]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && urls.length < limit) {
    const url = m[0].replace(/[.,;]+$/, ''); // strip trailing punctuation
    if (!seen.has(url)) { seen.add(url); urls.push(url); }
  }
  return urls;
}

/**
 * Researches `query` and returns grounded material + sources: search → fetch
 * top articles → Terra synthesis. Falls back to raw material when synthesis
 * fails entirely.
 */
export async function research(query: string, opts: ResearchOptions = {}): Promise<ResearchResult> {
  const searchBlock = (await webSearch(query, { allowedDomains: opts.allowedDomains, blockedDomains: opts.blockedDomains })) ?? '';
  const urls = extractUrls(searchBlock, 4);

  const articles: { url: string; title: string; text: string }[] = [];
  for (const url of urls) {
    const a = await fetchArticle(url);
    if (a) articles.push({ url, title: a.title, text: a.text });
  }

  const materialParts: string[] = [];
  if (searchBlock) materialParts.push(`Search results:\n${searchBlock}`);
  for (const a of articles) materialParts.push(`## ${a.title}\n(${a.url})\n${a.text}`);
  const material = materialParts.join('\n\n');

  const userPrompt =
    (opts.extraContext ? `Project reference material:\n${opts.extraContext.slice(0, MAX_EXTRA_CONTEXT_CHARS)}\n\n` : '') +
    `Topic: ${query}\n\nGathered material:\n${material.slice(0, 24_000)}\n\n` +
    'Write the structured research brief now:';

  const synthesised = material
    ? await terraText({ system: researchSystem(), prompt: userPrompt, maxTokens: 2000, effort: 'medium', timeoutMs: 120_000 })
    : null;

  return {
    text: (synthesised ?? material).trim(),
    sources: dedupeSources(articles.map(a => ({ url: a.url, title: a.title }))).filter(x => sourceAllowed(x.url, opts)),
    backend: 'terra',
  };
}
