import { env } from '../env';
import { replicateTextStream } from './replicateText';
import { openAiText } from './openaiChat';

export type TerraEffort = 'low' | 'medium' | 'high';
export interface TerraTextParams {
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: TerraEffort;
  verbosity?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
}

/** The model actually answering — for journal rows and admin surfaces. */
export const primaryTextModel = (): string => env.OPENAI_CHAT_MODEL;

/** True when the primary text model can be reached at all. */
export const primaryTextModelConfigured = (): boolean => Boolean(env.OPENAI_API_KEY);

/**
 * Primary text completion for every backend AI path (moderation, Community
 * Manager, Community Core, research, planning). Direct OpenAI, nothing else.
 *
 * Replicate used to sit behind this as a fallback. It was removed: the model we
 * run (gpt-5.6-terra) IS OpenAI's — Replicate only resold it, and throttles to
 * ~6 requests/min once the account balance drops below $5, which took down
 * moderation, CM replies, activities and digests at the same time. A fallback
 * onto the exact thing that fails first is not a safety net, so the transport is
 * now single-provider with a retry (see openAiText) instead.
 */
export async function terraText(p: TerraTextParams): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;
  const direct = await openAiText({
    system: p.system,
    prompt: p.prompt,
    effort: p.effort ?? 'low',
    verbosity: p.verbosity ?? 'medium',
    maxTokens: p.maxTokens ?? 1024,
    timeoutMs: p.timeoutMs ?? 90_000,
  });
  return direct?.trim() || null;
}

/**
 * Streaming variant — still Replicate, and the last Replicate text path left.
 * Used only by the assistant chat when it streams; every other caller goes
 * through terraText above. Migrating this one needs the streaming Responses
 * bridge (runOpenAiChat), which is a separate change.
 */
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