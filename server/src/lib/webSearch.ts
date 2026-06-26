/**
 * webSearch.ts
 *
 * Minimal web search for the AI assistant via the Tavily API (search built for
 * LLMs). Returns a compact, model-friendly text block (a short answer + the top
 * results with title, URL, snippet). Never throws — returns null when the key is
 * missing, the request fails, or there are no results, so callers degrade
 * gracefully (assistant just answers without fresh data).
 */

import { env } from '../env';

const TAVILY_URL    = 'https://api.tavily.com/search';
const TIMEOUT_MS    = 15_000;
const MAX_RESULTS   = 8;
const MAX_OUT_CHARS = 4_500;
const FRESH_DAYS    = 14;   // recency window for the news pass

interface TavilyResult { title?: string; url?: string; content?: string; published_date?: string; }
interface TavilyResponse { answer?: string; results?: TavilyResult[]; }

/** One Tavily call with the given extra params. Returns parsed data or null. */
async function callTavily(query: string, extra: Record<string, unknown>): Promise<TavilyResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TAVILY_URL, {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:        env.TAVILY_API_KEY,
        query:          query.trim().slice(0, 400),
        max_results:    MAX_RESULTS,
        include_answer: true,
        ...extra,
      }),
    });
    if (!res.ok) { console.warn(`[webSearch] Tavily HTTP ${res.status}`); return null; }
    return (await res.json()) as TavilyResponse;
  } catch (err) {
    console.warn('[webSearch] failed:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Searches the web and returns a formatted result block, or null.
 * Recency-first: a NEWS pass (last 14 days, advanced depth) catches fresh events
 * the old "basic" general search missed; falls back to a general advanced search
 * when the news pass is empty (non-news factual queries).
 */
export async function webSearch(query: string): Promise<string | null> {
  if (!env.TAVILY_API_KEY || !query || !query.trim()) return null;

  let data = await callTavily(query, { topic: 'news', days: FRESH_DAYS, search_depth: 'advanced' });
  if (!data || !(Array.isArray(data.results) && data.results.length > 0)) {
    data = await callTavily(query, { search_depth: 'advanced' });
  }
  if (!data) return null;

  const lines: string[] = [];
  if (data.answer && data.answer.trim()) lines.push(`Summary: ${data.answer.trim()}`);

  const results = Array.isArray(data.results) ? data.results.slice(0, MAX_RESULTS) : [];
  results.forEach((r, i) => {
    const title   = (r.title ?? '').trim();
    const url     = (r.url ?? '').trim();
    const date    = (r.published_date ?? '').trim();
    const snippet = (r.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (title || url) lines.push(`[${i + 1}] ${title}${date ? ` (${date})` : ''}\n${url}\n${snippet}`);
  });

  const out = lines.join('\n\n').slice(0, MAX_OUT_CHARS);
  return out.trim() || null;
}
