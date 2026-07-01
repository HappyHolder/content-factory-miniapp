import { env } from '../../env';
import type { CoverContextV2, VisualBriefV2 } from './types';

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

function cleanText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, 260) : fallback;
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim().replace(/\s+/g, ' ').slice(0, 90)).slice(0, 8)
    : [];
}

export function fallbackVisualBriefV2(ctx: CoverContextV2): VisualBriefV2 {
  const text = `${ctx.finalTitle || ctx.title}. ${ctx.postText || ctx.sourceSummary}`.replace(/\s+/g, ' ').trim();
  const firstSentence = text.split(/[.!?。！？]\s+/)[0]?.slice(0, 180) || ctx.finalTitle || ctx.title;
  const numbers = Array.from(text.matchAll(/(?:\d+[\d\s.,]*%?|\$\d+[\d\s.,]*[BMK]?|\d+[\d\s.,]*\+?)/gi)).map(m => m[0].trim()).slice(0, 4);
  const keywords = Array.from(new Set((text.match(/[A-Za-zА-Яа-яЁё]{4,}/g) ?? [])
    .map(w => w.toLowerCase())
    .filter(w => !/^(this|that|with|from|have|will|their|about|через|котор|должн|будет|были|было|если|после)$/i.test(w))))
    .slice(0, 10);
  return {
    coreEvent: firstSentence,
    actors: keywords.slice(0, 4),
    conflict: numbers.length ? `Key figures: ${numbers.join(', ')}` : 'A concrete event, decision, conflict, or change drives the visual.',
    consequence: text.slice(0, 240),
    visualMetaphor: 'A concrete editorial scene that shows the post meaning, not a generic decorative background.',
    avoid: ['generic cityscape', 'empty dark room', 'random skyscraper', 'abstract gradient', 'unrelated landscape'],
    keywords,
  };
}

export async function createVisualBriefV2(ctx: CoverContextV2, dryRun = false): Promise<VisualBriefV2> {
  const fallback = fallbackVisualBriefV2(ctx);
  if (dryRun || env.AI_PROVIDER !== 'deepseek' || !env.DEEPSEEK_API_KEY || !ctx.postText) return fallback;

  const systemPrompt =
    'You are a visual editor. Return ONLY valid JSON. Extract the post story as visual guidance: event, actors, conflict, consequence, and one concrete visual metaphor. Do not write an image prompt.';
  const userPrompt =
    `Post title: ${ctx.finalTitle || ctx.title}\n` +
    `Full post:\n${ctx.postText.slice(0, 2800)}\n\n` +
    'Return JSON exactly with keys: coreEvent string, actors string[], conflict string, consequence string, visualMetaphor string, avoid string[], keywords string[].';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens: 500,
        temperature: 0.2,
      }),
    });
    if (!response.ok) return fallback;
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(extractJsonObject(data.choices?.[0]?.message?.content?.trim() ?? '{}')) as Record<string, unknown>;
    return {
      coreEvent: cleanText(parsed.coreEvent, fallback.coreEvent),
      actors: cleanList(parsed.actors).length ? cleanList(parsed.actors) : fallback.actors,
      conflict: cleanText(parsed.conflict, fallback.conflict),
      consequence: cleanText(parsed.consequence, fallback.consequence),
      visualMetaphor: cleanText(parsed.visualMetaphor, fallback.visualMetaphor),
      avoid: cleanList(parsed.avoid).length ? cleanList(parsed.avoid) : fallback.avoid,
      keywords: cleanList(parsed.keywords).length ? cleanList(parsed.keywords) : fallback.keywords,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeoutId);
  }
}
