/**
 * researchEngine.ts
 *
 * Deep research for the AI content manager. Given a search query (one plan
 * item), gathers grounded material a writer can turn into a post.
 *
 * Two backends:
 *  - 'opus'    — Anthropic SDK (Opus 4.8) with native web_search/web_fetch server
 *                tools. The model searches, reads, and synthesises itself, with
 *                citations. Needs ANTHROPIC_API_KEY.
 *  - 'deepseek'— existing Serper/Tavily search + fetchArticle on the top links,
 *                then a DeepSeek synthesis pass. The fallback when no key is set.
 *
 * Never throws for a missing backend: an 'opus' request without ANTHROPIC_API_KEY
 * transparently falls back to 'deepseek'. See docs/content-manager-plan.md.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import { webSearch } from './webSearch';
import { fetchArticle } from './urlContentExtractor';

export type ResearchBackend = 'opus' | 'deepseek';

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
  backend?: ResearchBackend;
  /** Extra grounding text (e.g. ProjectDoc excerpts) folded into the prompt. */
  extraContext?: string;
}

const MAX_EXTRA_CONTEXT_CHARS = 12_000;

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

// ─── Opus backend (Anthropic SDK + server-side web tools) ────────────────────

/** Real 'now' (Moscow) — anchors the model so it treats the present, not its
 *  training cutoff (2024/2025), as current. */
function todayContext(): { iso: string; year: string } {
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  return { iso, year: iso.slice(0, 4) };
}

function researchSystem(): string {
  const { iso, year } = todayContext();
  return (
    `Today's real date is ${iso} (current year ${year}) — do NOT rely on your training cutoff; treat ${year} as the present. ` +
    'You are a diligent research assistant preparing source material for a Telegram post. ' +
    'Research the given topic thoroughly using web search and web fetch: find recent, factual, ' +
    'specific information — key facts, figures, dates, names, and a few concrete examples or quotes. ' +
    `Prioritize the most CURRENT information (${year}); do not present older (2024/2025) facts as current unless clearly historical context. ` +
    'Then write a structured research brief (NOT a finished post): bullet the key points and facts, ' +
    'note anything time-sensitive, and keep every claim grounded in the sources you read. ' +
    'Write the brief in the same language as the topic.'
  );
}

/** Pulls text + source URLs out of one Anthropic message's content blocks. */
function collectFromContent(
  content: unknown[],
  outText: string[],
  outSources: ResearchSource[],
): void {
  for (const raw of content) {
    const block = raw as { type?: string; text?: string; content?: unknown };
    if (block.type === 'text' && typeof block.text === 'string') {
      outText.push(block.text);
    } else if (block.type === 'web_search_tool_result') {
      // content is a list of web_search_result { url, title, ... } (or an error object)
      const items = block.content;
      if (Array.isArray(items)) {
        for (const r of items as { url?: string; title?: string }[]) {
          if (r?.url) outSources.push({ url: r.url, title: r.title });
        }
      }
    } else if (block.type === 'web_fetch_tool_result') {
      // content is a web_fetch_result carrying the fetched url
      const c = block.content as { url?: string; content?: { url?: string } } | undefined;
      const url = c?.url ?? c?.content?.url;
      if (url) outSources.push({ url });
    }
  }
}

async function researchViaOpus(query: string, extraContext?: string): Promise<ResearchResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const userPrompt =
    (extraContext
      ? `Project reference material (use where relevant):\n${extraContext.slice(0, MAX_EXTRA_CONTEXT_CHARS)}\n\n`
      : '') +
    `Research this topic and produce the brief:\n${query}`;

  // Server tools run a bounded loop; on the iteration cap the API returns
  // stop_reason 'pause_turn' — re-send to resume. Guard against runaway loops.
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];
  const textParts: string[] = [];
  const sources: ResearchSource[] = [];

  for (let turn = 0; turn < 8; turn++) {
    const msg = await client.messages.create({
      model: env.CONTENT_RESEARCH_MODEL,
      max_tokens: 16_000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: researchSystem(),
      tools: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: 'web_search_20260209', name: 'web_search', max_uses: 8 } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 } as any,
      ],
      messages,
    });

    collectFromContent(msg.content, textParts, sources);

    if (msg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: msg.content });
      continue;
    }
    break;
  }

  return {
    text: textParts.join('\n').trim(),
    sources: dedupeSources(sources),
    backend: 'opus',
  };
}

// ─── DeepSeek backend (Serper/Tavily search + fetchArticle + synthesis) ──────

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

/** Synthesises gathered material into a research brief via DeepSeek. Null on failure. */
async function deepseekSynthesize(
  query: string,
  material: string,
  extraContext?: string,
): Promise<string | null> {
  if (!env.DEEPSEEK_API_KEY) return null;
  const userPrompt =
    (extraContext ? `Project reference material:\n${extraContext.slice(0, MAX_EXTRA_CONTEXT_CHARS)}\n\n` : '') +
    `Topic: ${query}\n\nGathered material:\n${material.slice(0, 24_000)}\n\n` +
    'Write the structured research brief now:';
  try {
    const res = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: researchSystem() },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 2000,
        temperature: 0.4,
      }),
    });
    if (!res.ok) { console.warn(`[researchEngine] DeepSeek HTTP ${res.status}`); return null; }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.warn('[researchEngine] DeepSeek synthesis failed:', (err as Error).message);
    return null;
  }
}

async function researchViaDeepseek(query: string, extraContext?: string): Promise<ResearchResult> {
  const searchBlock = (await webSearch(query)) ?? '';
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

  const synthesised = await deepseekSynthesize(query, material, extraContext);

  return {
    text: (synthesised ?? material).trim(),
    sources: dedupeSources(articles.map(a => ({ url: a.url, title: a.title }))),
    backend: 'deepseek',
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Researches `query` and returns grounded material + sources. Falls back from
 * 'opus' to 'deepseek' when ANTHROPIC_API_KEY is absent. Never throws for a
 * missing backend (individual tool failures inside a backend degrade gracefully).
 */
export async function research(query: string, opts: ResearchOptions = {}): Promise<ResearchResult> {
  let backend: ResearchBackend = opts.backend ?? env.CONTENT_RESEARCH_BACKEND;
  if (backend === 'opus' && !env.ANTHROPIC_API_KEY) {
    console.warn('[researchEngine] ANTHROPIC_API_KEY not set — falling back to DeepSeek research.');
    backend = 'deepseek';
  }

  if (backend === 'opus') {
    try {
      return await researchViaOpus(query, opts.extraContext);
    } catch (err) {
      // A hard Opus failure (rate limit, refusal, network) shouldn't sink the
      // whole plan item — degrade to the DeepSeek pipeline.
      console.warn('[researchEngine] Opus research failed, falling back to DeepSeek:', (err as Error).message);
      return researchViaDeepseek(query, opts.extraContext);
    }
  }
  return researchViaDeepseek(query, opts.extraContext);
}
