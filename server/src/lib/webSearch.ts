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
const TIMEOUT_MS    = 12_000;
const MAX_RESULTS   = 5;
const MAX_OUT_CHARS = 4_000;

interface TavilyResult { title?: string; url?: string; content?: string; }
interface TavilyResponse { answer?: string; results?: TavilyResult[]; }

/** Searches the web and returns a formatted result block, or null on failure. */
export async function webSearch(query: string): Promise<string | null> {
  if (!env.TAVILY_API_KEY || !query || !query.trim()) return null;

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
        search_depth:   'basic',
        max_results:    MAX_RESULTS,
        include_answer: true,
      }),
    });

    if (!res.ok) {
      console.warn(`[webSearch] Tavily HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as TavilyResponse;
    const lines: string[] = [];

    if (data.answer && data.answer.trim()) {
      lines.push(`Summary: ${data.answer.trim()}`);
    }

    const results = Array.isArray(data.results) ? data.results.slice(0, MAX_RESULTS) : [];
    results.forEach((r, i) => {
      const title   = (r.title ?? '').trim();
      const url     = (r.url ?? '').trim();
      const snippet = (r.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (title || url) lines.push(`[${i + 1}] ${title}\n${url}\n${snippet}`);
    });

    const out = lines.join('\n\n').slice(0, MAX_OUT_CHARS);
    return out.trim() || null;
  } catch (err) {
    console.warn('[webSearch] failed:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
