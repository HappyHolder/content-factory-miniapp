/**
 * webSearch.ts
 *
 * Web search for the AI assistant. Prefers Serper (real Google results — best
 * for Russian-language and fresh events) when SERPER_API_KEY is set; otherwise
 * falls back to Tavily. Returns a compact, model-friendly text block (summary +
 * top results with title, URL, date, snippet), or null when nothing is found /
 * not configured, so callers degrade gracefully.
 */

import { env } from '../env';

const TIMEOUT_MS    = 15_000;
const MAX_RESULTS   = 8;
const MAX_OUT_CHARS = 4_500;
const FRESH_DAYS    = 14;   // recency window for the Tavily news pass

export interface WebSearchOptions { allowedDomains?: string[]; blockedDomains?: string[] }
const cleanDomains=(v:string[]|undefined)=>[...new Set((v??[]).map(x=>x.toLowerCase().replace(/^www\./,'')).filter(x=>/^[a-z0-9.-]+$/.test(x)&&x.includes('.')))];
const domainAllowed=(url:string,opts:WebSearchOptions)=>{try{const h=new URL(url).hostname.toLowerCase().replace(/^www\./,'');const allowed=cleanDomains(opts.allowedDomains),blocked=cleanDomains(opts.blockedDomains);if(blocked.some(d=>h===d||h.endsWith('.'+d)))return false;return allowed.length===0||allowed.some(d=>h===d||h.endsWith('.'+d))}catch{return false}};
const scopedQuery=(query:string,opts:WebSearchOptions)=>{const allowed=cleanDomains(opts.allowedDomains),blocked=cleanDomains(opts.blockedDomains);const scope=allowed.length?' ('+allowed.map(d=>'site:'+d).join(' OR ')+')':blocked.map(d=>' -site:'+d).join('');return(query.trim()+' '+scope).trim().slice(0,1200)};

// ─── Serper (Google) ────────────────────────────────────────────────────────────

const SERPER_URL = 'https://google.serper.dev/search';
const SERPER_KEY = process.env['SERPER_API_KEY'] || '';

interface SerperOrganic { title?: string; link?: string; snippet?: string; date?: string }
interface SerperNews    { title?: string; link?: string; snippet?: string; date?: string; source?: string }
interface SerperResponse {
  answerBox?:      { answer?: string; snippet?: string };
  knowledgeGraph?: { description?: string };
  organic?:        SerperOrganic[];
  topStories?:     SerperNews[];
  news?:           SerperNews[];
}

async function serperSearch(query: string, opts: WebSearchOptions): Promise<string | null> {
  if (!SERPER_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SERPER_URL, {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      // gl/hl=ru → Russian Google results (interfax/tass/dw etc.) for RU queries.
      body: JSON.stringify({ q: scopedQuery(query, opts), gl: 'ru', hl: 'ru', num: 10 }),
    });
    if (!res.ok) { console.warn(`[webSearch] Serper HTTP ${res.status}`); return null; }
    const data = (await res.json()) as SerperResponse;

    const lines: string[] = [];
    const summary = data.answerBox?.answer || data.answerBox?.snippet || data.knowledgeGraph?.description;
    if (summary && summary.trim() && !cleanDomains(opts.allowedDomains).length && !cleanDomains(opts.blockedDomains).length) lines.push(`Summary: ${summary.trim()}`);

    const news = [...(data.topStories ?? []), ...(data.news ?? [])].filter(n=>n.link&&domainAllowed(n.link,opts)).slice(0, 5);
    news.forEach((n, i) => {
      const t = (n.title ?? '').trim(), u = (n.link ?? '').trim();
      const meta = [n.source, n.date].filter(Boolean).join(', ');
      if (t || u) lines.push(`[news ${i + 1}] ${t}${meta ? ` (${meta})` : ''}\n${u}\n${(n.snippet ?? '').trim().slice(0, 280)}`);
    });

    (data.organic ?? []).filter(r=>r.link&&domainAllowed(r.link,opts)).slice(0, MAX_RESULTS).forEach((r, i) => {
      const t = (r.title ?? '').trim(), u = (r.link ?? '').trim();
      const snippet = (r.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (t || u) lines.push(`[${i + 1}] ${t}${r.date ? ` (${r.date})` : ''}\n${u}\n${snippet}`);
    });

    const out = lines.join('\n\n').slice(0, MAX_OUT_CHARS);
    return out.trim() || null;
  } catch (err) {
    console.warn('[webSearch] Serper failed:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Tavily (fallback) ────────────────────────────────────────────────────────────

const TAVILY_URL = 'https://api.tavily.com/search';

interface TavilyResult { title?: string; url?: string; content?: string; published_date?: string }
interface TavilyResponse { answer?: string; results?: TavilyResult[] }

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
    console.warn('[webSearch] Tavily failed:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const tavilyHasResults = (d: TavilyResponse | null): d is TavilyResponse =>
  !!d && Array.isArray(d.results) && d.results.length > 0;

async function tavilySearch(query: string, opts: WebSearchOptions): Promise<string | null> {
  if (!env.TAVILY_API_KEY) return null;
  // News-first for recency, then general. Apply provider-side filters and repeat
  // the check locally so a provider cannot leak an excluded result.
  const allowed=cleanDomains(opts.allowedDomains),blocked=cleanDomains(opts.blockedDomains),domainOpts=allowed.length?{include_domains:allowed}:blocked.length?{exclude_domains:blocked}:{};
  let data = await callTavily(query, { topic: 'news', days: FRESH_DAYS, search_depth: 'advanced', ...domainOpts });
  if (!tavilyHasResults(data)) data = await callTavily(query, { search_depth: 'advanced', ...domainOpts });
  if (!data) return null;

  const lines: string[] = [];
  if (data.answer && data.answer.trim() && !allowed.length && !blocked.length) lines.push(`Summary: ${data.answer.trim()}`);
  (data.results ?? []).filter(r=>r.url&&domainAllowed(r.url,opts)).slice(0, MAX_RESULTS).forEach((r, i) => {
    const t = (r.title ?? '').trim(), u = (r.url ?? '').trim();
    const date = (r.published_date ?? '').trim();
    const snippet = (r.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (t || u) lines.push(`[${i + 1}] ${t}${date ? ` (${date})` : ''}\n${u}\n${snippet}`);
  });
  const out = lines.join('\n\n').slice(0, MAX_OUT_CHARS);
  return out.trim() || null;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Searches the web (Serper/Google preferred, Tavily fallback). Returns null on no result. */
export async function webSearch(query: string, opts: WebSearchOptions = {}): Promise<string | null> {
  if (!query || !query.trim()) return null;
  if (SERPER_KEY) {
    const viaGoogle = await serperSearch(query, opts);
    if (viaGoogle) return viaGoogle;
  }
  return tavilySearch(query, opts);
}
