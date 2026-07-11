/**
 * replicateText.ts
 *
 * Minimal helper to run a text/LLM model on Replicate's prediction API
 * (e.g. anthropic/claude-4.5-sonnet) as a single prompt → text completion.
 *
 * This is the HIGH-tier text transport. LOW tier keeps calling DeepSeek's
 * OpenAI-compatible endpoint directly. Replicate's predictions API has no
 * OpenAI-style tool-calling, so callers that need tools (chat web search)
 * orchestrate that themselves and pass a flattened prompt here.
 *
 * Never throws — returns the model's text output, or null on any failure so
 * callers can fall back gracefully.
 */

import { env } from '../env';

interface Prediction {
  id:     string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | string[] | null;
  error:  string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function joinOutput(output: string | string[] | null): string {
  if (!output) return '';
  return Array.isArray(output) ? output.join('') : output;
}

async function pollText(id: string, token: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3_000);
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) return null;
    const p = await res.json() as Prediction;
    if (p.status === 'succeeded') return joinOutput(p.output) || null;
    if (p.status === 'failed' || p.status === 'canceled') {
      console.warn(`[replicateText] Prediction ${p.status}: ${p.error ?? ''}`);
      return null;
    }
  }
  console.warn('[replicateText] Polling timed out');
  return null;
}

export interface ReplicateTextParams {
  model:        string;   // e.g. 'anthropic/claude-4.5-sonnet'
  prompt:       string;
  systemPrompt?: string;
  maxTokens?:   number;   // → input.max_tokens (omitted when undefined)
  temperature?: number;   // → input.temperature (omitted when undefined; some models reject it)
  timeoutMs?:   number;
  /** Extra model-specific input fields, merged last (e.g. GPT-5.6: max_completion_tokens, reasoning_effort). */
  input?:       Record<string, unknown>;
}

/**
 * Runs a single prompt through a Replicate text model and returns the raw text
 * output (markdown fences NOT stripped — caller decides), or null on failure.
 */
export async function replicateText(params: ReplicateTextParams): Promise<string | null> {
  if (!env.REPLICATE_API_TOKEN) {
    console.warn('[replicateText] REPLICATE_API_TOKEN not set');
    return null;
  }
  const { model, prompt, systemPrompt, maxTokens, temperature, timeoutMs = 90_000, input: extraInput } = params;

  try {
    const createRes = await fetch(
      `https://api.replicate.com/v1/models/${model}/predictions`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Token ${env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: {
            prompt,
            ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
            ...(maxTokens   != null ? { max_tokens: maxTokens } : {}),
            ...(temperature != null ? { temperature } : {}),
            ...(extraInput ?? {}),
          },
        }),
      },
    );

    if (!createRes.ok) {
      const body = await createRes.text().catch(() => '');
      console.warn(`[replicateText] Create failed: HTTP ${createRes.status} — ${body.slice(0, 200)}`);
      return null;
    }

    const prediction = await createRes.json() as Prediction;
    if (prediction.status === 'succeeded') return joinOutput(prediction.output) || null;
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      console.warn(`[replicateText] Failed immediately: ${prediction.status}`);
      return null;
    }
    if (!prediction.id) return null;
    return await pollText(prediction.id, env.REPLICATE_API_TOKEN, timeoutMs);
  } catch (err) {
    console.warn('[replicateText] Error:', (err as Error).message);
    return null;
  }
}
