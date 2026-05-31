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
 * Short negative suffix appended to every image prompt.
 *
 * Image generation models render everything as visual content — long
 * instruction blocks get drawn on the image. Only minimal, well-known
 * negative tokens are safe to append.
 */
const NEGATIVE_SUFFIX = ', no text, no typography, no letters, no words, no watermark, no border, no frame, no margin, full-bleed';

/**
 * Builds BrandKit style tokens to embed naturally in the image prompt.
 *
 * Image generation models are visual — they respond to descriptive adjectives
 * and color values, not instruction blocks. Everything here is phrased as
 * natural visual description that gets woven into the prompt string.
 *
 * - Colors: passed as hex values described as "color palette: ..." so the
 *   model uses them for lighting/atmosphere. Token names are dropped to avoid
 *   any chance of rendering them as labels.
 * - Font preset: mapped to short mood adjectives (e.g. "editorial aesthetic",
 *   "tech minimal aesthetic"). No font names — model can't render what it
 *   doesn't know.
 * - fontRules: stripped of any technical jargon and appended as visual mood.
 *
 * logoUrl and references are stored but NOT used — current model is
 * prompt-only. Logo compositing and reference image inputs not yet implemented.
 *
 * Never throws. Returns '' when nothing to add.
 */
export function buildVisualKitPromptHints(visualKit: unknown): string {
  if (!visualKit || typeof visualKit !== 'object') return '';
  const vk = visualKit as Record<string, unknown>;

  const tokens: string[] = [];

  // ── Brand colors → color palette descriptor ──────────────────────────────
  const rawColors = vk['brandColors'];
  if (Array.isArray(rawColors) && rawColors.length > 0) {
    const hexes: string[] = [];
    for (const c of (rawColors as RawBrandColor[]).slice(0, 5)) {
      if (typeof c.hex !== 'string' || !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(c.hex)) continue;
      hexes.push(c.hex);
    }
    if (hexes.length > 0) {
      tokens.push(`color palette ${hexes.join(' ')}`);
    }
  }

  // ── Font preset → mood adjectives ────────────────────────────────────────
  const presetMoodMap: Record<string, string> = {
    serif:       'editorial aesthetic',
    sans:        'clean modern aesthetic',
    mono:        'tech minimal aesthetic',
    display:     'bold graphic aesthetic',
    handwritten: 'organic handcrafted aesthetic',
  };
  const preset = typeof vk['visualFontPreset'] === 'string' ? vk['visualFontPreset'] : 'default';
  if (preset !== 'default' && presetMoodMap[preset]) {
    tokens.push(presetMoodMap[preset]);
  }

  // ── fontRules → short visual style note (stripped of tech jargon) ─────────
  const fontRules = typeof vk['visualFontRules'] === 'string' ? vk['visualFontRules'].trim() : '';
  if (fontRules) {
    tokens.push(fontRules);
  }

  return tokens.length > 0 ? ', ' + tokens.join(', ') : '';
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

  // Prompt assembly: [user visual concept] + [brand style tokens] + [negative suffix]
  // Image models render everything as visual content — no instruction blocks,
  // just natural visual descriptors followed by minimal negative tokens.
  const userPrompt = input.prompt.trim();
  if (!userPrompt) return null;
  const brandTokens = buildVisualKitPromptHints(input.visualKit);
  const prompt = userPrompt + brandTokens + NEGATIVE_SUFFIX;

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
