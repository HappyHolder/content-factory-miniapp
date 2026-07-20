import { env } from '../env';
import { replicateText, replicateTextStream } from './replicateText';

export type TerraEffort = 'low' | 'medium' | 'high';
export interface TerraTextParams {
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: TerraEffort;
  verbosity?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  /** Kept for call-site compatibility; the unified model has no fallback provider. */
  noFallback?: boolean;
}

export async function terraText(p: TerraTextParams): Promise<string | null> {
  if (!env.REPLICATE_API_TOKEN) return null;
  const maxTokens = p.maxTokens ?? 1024;
  const output = await replicateText({
    model: env.LAYOUT_MODEL,
    systemPrompt: p.system,
    prompt: p.prompt,
    maxTokens,
    timeoutMs: p.timeoutMs ?? 90_000,
    input: { max_completion_tokens: maxTokens, reasoning_effort: p.effort ?? 'low', verbosity: p.verbosity ?? 'medium' },
  });
  return output?.trim() || null;
}

export async function terraTextStream(p: TerraTextParams, onChunk: (delta: string) => void): Promise<string | null> {
  if (!env.REPLICATE_API_TOKEN) return null;
  const maxTokens = p.maxTokens ?? 1024;
  const streamed = await replicateTextStream({
    model: env.LAYOUT_MODEL,
    systemPrompt: p.system,
    prompt: p.prompt,
    maxTokens,
    timeoutMs: p.timeoutMs ?? 120_000,
    input: { max_completion_tokens: maxTokens, reasoning_effort: p.effort ?? 'low', verbosity: p.verbosity ?? 'medium' },
  }, onChunk);
  return streamed?.trim() || null;
}

export function extractJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    return start >= 0 && end > start ? JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown> : null;
  } catch { return null; }
}

export async function terraJson(p: Omit<TerraTextParams, 'verbosity'>): Promise<Record<string, unknown> | null> {
  const raw = await terraText({ ...p, verbosity: 'low' });
  return raw ? extractJsonObject(raw) : null;
}