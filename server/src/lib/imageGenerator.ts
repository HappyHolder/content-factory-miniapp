/**
 * imageGenerator.ts
 *
 * Generates a single image via the Replicate HTTP API.
 * Returns the image URL on success, or null if generation is skipped / fails.
 *
 * Supports both Replicate response shapes:
 *   - Synchronous: output URL is in the initial POST response.
 *   - Asynchronous: response contains a prediction id that must be polled.
 *
 * Polling strategy: up to IMAGE_GENERATION_POLL_TIMEOUT_MS total (default 120 s),
 * ~3 s between polls. Timeout is configurable via env without code changes.
 *
 * No external dependencies — uses Node's built-in fetch (Node 18+).
 */

import { env } from '../env';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReplicatePrediction {
  id:     string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | string[] | null;
  error:  string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extracts the first URL string from a Replicate output value.
 * output may be a direct string, an array of strings, or null.
 */
function extractUrl(output: string | string[] | null): string | null {
  if (!output) return null;
  if (typeof output === 'string') return output.trim() || null;
  if (Array.isArray(output)) {
    const first = output[0];
    return (typeof first === 'string' && first.trim()) ? first.trim() : null;
  }
  return null;
}

/**
 * Polls a prediction until succeeded/failed/canceled or until timeoutMs elapses.
 * Returns the output URL or null.
 */
async function pollPrediction(
  predictionId: string,
  token: string,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = 3_000;   // 3 s between polls

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const res = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      { headers: { Authorization: `Token ${token}` } },
    );

    if (!res.ok) {
      console.warn(`[imageGenerator] Poll failed: HTTP ${res.status}`);
      return null;
    }

    const prediction = await res.json() as ReplicatePrediction;

    if (prediction.status === 'succeeded') {
      return extractUrl(prediction.output);
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      console.warn(`[imageGenerator] Prediction ended with status: ${prediction.status}`);
      return null;
    }

    // status is 'starting' or 'processing' — keep polling
  }

  console.warn(`[imageGenerator] Polling timed out after ${timeoutMs / 1000} s — prediction ${predictionId} did not finish in time`);
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

interface RawBrandColor {
  name?:  unknown;
  hex?:   unknown;
  usage?: unknown;
}

/**
 * Hard output constraints prepended to every image prompt.
 * These ensure the model produces one finished Telegram post cover
 * rather than a design board, concept sheet, or UI mockup.
 */
const FINAL_OUTPUT_CONSTRAINTS =
  'OUTPUT RULES: Generate exactly ONE finished, print-ready Telegram post cover image. ' +
  'Do NOT produce a design board, mood board, concept sheet, or grid of options. ' +
  'Do NOT show multiple variants or versions side by side. ' +
  'Do NOT add UI chrome, mockup frames, device screens, or browser windows. ' +
  'Do NOT include labels such as "#DALL-E", "option", "concept", "mockup", "version", "draft", or any similar meta-text. ' +
  'Do NOT invent logos, watermarks, or brand marks unless explicitly described in the prompt. ' +
  'Do NOT fill space with tiny unreadable filler text or random characters. ' +
  'If the prompt requests text on the cover, use at most one short headline rendered in large, legible type. ' +
  'The user image prompt below is the highest priority — follow it precisely.';

/**
 * Builds BrandKit visual direction to append after the user image prompt.
 * Framed as final-cover direction, not loose inspiration.
 * Safely handles unknown/missing fields — never throws.
 * Returns an empty string when there is nothing to add.
 *
 * Note: logoUrl and references are stored in visualKit but are NOT passed here
 * because the current model accepts prompt-only input. Logo compositing and
 * reference image inputs are not yet implemented.
 */
export function buildVisualKitPromptHints(visualKit: unknown): string {
  if (!visualKit || typeof visualKit !== 'object') return '';
  const vk = visualKit as Record<string, unknown>;

  const lines: string[] = [];

  // ── Brand colors ────────────────────────────────────────────────────────────
  const rawColors = vk['brandColors'];
  if (Array.isArray(rawColors) && rawColors.length > 0) {
    const colorLines: string[] = [];
    for (const c of (rawColors as RawBrandColor[]).slice(0, 8)) {
      if (typeof c.hex !== 'string' || !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(c.hex)) continue;
      const name  = typeof c.name  === 'string' && c.name.trim()  ? c.name.trim()  : c.hex;
      const usage = typeof c.usage === 'string' && c.usage.trim() ? ` (${c.usage.trim()})` : '';
      colorLines.push(`${name}: ${c.hex}${usage}`);
    }
    if (colorLines.length > 0) {
      lines.push('Brand color palette for this cover: ' + colorLines.join(', ') + '.');
      lines.push('Apply these colors to backgrounds, typography, and graphic elements on the final cover.');
    }
  }

  // ── Typography ───────────────────────────────────────────────────────────────
  const presetMap: Record<string, string> = {
    serif:       'serif / newspaper-style',
    sans:        'clean sans-serif / modern',
    mono:        'monospace / terminal',
    display:     'bold display / headline',
    handwritten: 'handwritten / script',
  };
  const preset = typeof vk['visualFontPreset'] === 'string' ? vk['visualFontPreset'] : 'default';
  if (preset !== 'default' && presetMap[preset]) {
    lines.push(`Any text on the cover must use ${presetMap[preset]} typography.`);
  }
  const fontRules = typeof vk['visualFontRules'] === 'string' ? vk['visualFontRules'].trim() : '';
  if (fontRules) lines.push(`Additional typography direction: ${fontRules}`);

  if (lines.length === 0) return '';
  return '\n\nBrand direction for this cover:\n' + lines.join('\n');
}

export interface GenerateImageInput {
  prompt:     string;
  visualKit?: unknown;
}

/**
 * Generates an image via Replicate and returns the URL, or null if
 * generation is disabled, misconfigured, or encounters a non-fatal error.
 *
 * Never throws — callers (draftGenerator) can safely ignore a null result.
 */
export async function generateImageForPost(
  input: GenerateImageInput,
): Promise<string | null> {

  // ── Guard: only run when IMAGE_PROVIDER === 'replicate' ──────────────────
  if (env.IMAGE_PROVIDER !== 'replicate') return null;

  if (!env.REPLICATE_API_TOKEN) {
    console.warn('[imageGenerator] REPLICATE_API_TOKEN is not set — skipping image generation');
    return null;
  }

  const model = env.IMAGE_MODEL;  // e.g. 'google/imagen-4'

  // Prompt assembly order:
  //   1. Hard output constraints (always) — prevent design boards / mockups
  //   2. User image prompt (highest content priority)
  //   3. BrandKit color + typography direction (when BrandKit is ON)
  const userPrompt = input.prompt.trim();
  if (!userPrompt) return null;
  const brandHints = buildVisualKitPromptHints(input.visualKit);
  const prompt = `${FINAL_OUTPUT_CONSTRAINTS}\n\nUser prompt: ${userPrompt}${brandHints}`;

  console.log(`[imageGenerator] Requesting image from model ${model}`);

  try {
    // ── POST /v1/models/{model}/predictions ──────────────────────────────
    // Replicate model IDs use owner/name format; the predictions endpoint
    // under /v1/models/ is the standard path for versioned public models.
    const createRes = await fetch(
      `https://api.replicate.com/v1/models/${model}/predictions`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          input: {
            prompt,
            aspect_ratio: '1:1',
          },
        }),
      },
    );

    if (!createRes.ok) {
      console.warn(`[imageGenerator] Create prediction failed: HTTP ${createRes.status}`);
      return null;
    }

    const prediction = await createRes.json() as ReplicatePrediction;

    // ── Synchronous response: output already present ──────────────────────
    if (prediction.status === 'succeeded' && prediction.output) {
      return extractUrl(prediction.output);
    }

    // ── Failed immediately ────────────────────────────────────────────────
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      console.warn(`[imageGenerator] Prediction failed immediately: ${prediction.status}`);
      return null;
    }

    // ── Asynchronous: poll until done, up to IMAGE_GENERATION_POLL_TIMEOUT_MS ─
    if (!prediction.id) {
      console.warn('[imageGenerator] No prediction id in response — cannot poll');
      return null;
    }

    return await pollPrediction(prediction.id, env.REPLICATE_API_TOKEN, env.IMAGE_GENERATION_POLL_TIMEOUT_MS);

  } catch (err) {
    console.warn('[imageGenerator] Unexpected error:', (err as Error).message);
    return null;
  }
}
