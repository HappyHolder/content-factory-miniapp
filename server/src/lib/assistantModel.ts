/**
 * assistantModel.ts
 *
 * Единая точка входа для текстовых вызовов ассистента и контент-менеджера:
 * GPT-5.6 Terra через Replicate (как модерация и обложки). DeepSeek остаётся
 * ТОЛЬКО аварийным фолбэком на случай недоступности Replicate — не вызывается,
 * пока Terra отвечает. Никогда не бросает исключений: null при полном отказе.
 */

import { env } from '../env';
import { replicateText, replicateTextStream } from './replicateText';

export type TerraEffort = 'low' | 'medium' | 'high';

export interface TerraTextParams {
  system:      string;
  prompt:      string;
  maxTokens?:  number;      // default 1024
  effort?:     TerraEffort; // default 'low'
  verbosity?:  'low' | 'medium' | 'high';
  timeoutMs?:  number;      // default 90s
  /** Skip the DeepSeek fallback (for cheap classifier calls where a miss is fine). */
  noFallback?: boolean;
}

/** Single DeepSeek chat completion — emergency fallback only. */
async function deepseekEmergency(p: TerraTextParams): Promise<string | null> {
  if (!env.DEEPSEEK_API_KEY) return null;
  try {
    const res = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        max_tokens: Math.min(p.maxTokens ?? 1024, 4000),
        temperature: 0.6,
        messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.prompt }],
      }),
    });
    if (!res.ok) { console.warn(`[assistantModel] DeepSeek fallback HTTP ${res.status}`); return null; }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text) console.warn('[assistantModel] served by DeepSeek fallback');
    return text || null;
  } catch (err) {
    console.warn('[assistantModel] DeepSeek fallback failed:', (err as Error).message);
    return null;
  }
}

/** Terra text completion with emergency DeepSeek fallback. Null on total failure. */
export async function terraText(p: TerraTextParams): Promise<string | null> {
  const maxTokens = p.maxTokens ?? 1024;
  if (env.REPLICATE_API_TOKEN) {
    const out = await replicateText({
      model: env.LAYOUT_MODEL,
      systemPrompt: p.system,
      prompt: p.prompt,
      maxTokens,
      timeoutMs: p.timeoutMs ?? 90_000,
      input: { max_completion_tokens: maxTokens, reasoning_effort: p.effort ?? 'low', verbosity: p.verbosity ?? 'medium' },
    });
    if (out?.trim()) return out.trim();
  }
  return p.noFallback ? null : deepseekEmergency(p);
}

/**
 * Streaming Terra call: `onChunk` fires per output delta. Resolves to the full
 * text. When streaming is unavailable, degrades to the non-streaming path
 * (including the DeepSeek fallback) and emits the whole reply as one chunk.
 */
export async function terraTextStream(p: TerraTextParams, onChunk: (delta: string) => void): Promise<string | null> {
  const maxTokens = p.maxTokens ?? 1024;
  if (env.REPLICATE_API_TOKEN) {
    const streamed = await replicateTextStream({
      model: env.LAYOUT_MODEL,
      systemPrompt: p.system,
      prompt: p.prompt,
      maxTokens,
      timeoutMs: p.timeoutMs ?? 120_000,
      input: { max_completion_tokens: maxTokens, reasoning_effort: p.effort ?? 'low', verbosity: p.verbosity ?? 'medium' },
    }, onChunk);
    if (streamed?.trim()) return streamed.trim();
  }
  const whole = await terraText(p);
  if (whole) onChunk(whole);
  return whole;
}

/** Pulls the first {...} JSON object out of a model reply (tolerates ``` fences). */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
    return a >= 0 && b > a ? JSON.parse(clean.slice(a, b + 1)) as Record<string, unknown> : null;
  } catch { return null; }
}

/** Terra JSON call: low verbosity, parsed envelope. Null when unparseable/failed. */
export async function terraJson(p: Omit<TerraTextParams, 'verbosity'>): Promise<Record<string, unknown> | null> {
  const raw = await terraText({ ...p, verbosity: 'low' });
  return raw ? extractJsonObject(raw) : null;
}
