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
 * Returns the first usable reference image URL from visualKit.
 * Priority: references[] first, then logoUrl.
 * Used as image input for models that support it (e.g. gpt-image-2).
 */
function extractReferenceImage(visualKit: unknown): string | null {
  if (!visualKit || typeof visualKit !== 'object') return null;
  const vk = visualKit as Record<string, unknown>;

  const refs = vk['references'];
  if (Array.isArray(refs)) {
    for (const r of refs) {
      if (typeof r === 'string' && r.startsWith('http')) return r;
    }
  }

  const logo = vk['logoUrl'];
  if (typeof logo === 'string' && logo.startsWith('http')) return logo;

  return null;
}

/**
 * Appends a minimal BrandKit mood suffix to the image prompt.
 *
 * When the AI (generateImagePromptWithAI) is available it already describes
 * colors and style in natural language — no hex tokens needed here.
 * This function adds only a short mood adjective from the font preset as
 * extra style reinforcement. Colors are intentionally NOT added here to
 * prevent hex codes from appearing in the final prompt.
 *
 * Never throws. Returns '' when nothing to add.
 */
export function buildVisualKitPromptHints(visualKit: unknown): string {
  if (!visualKit || typeof visualKit !== 'object') return '';
  const vk = visualKit as Record<string, unknown>;

  const tokens: string[] = [];

  // Font preset → short mood adjective only (no color tokens, no hex)
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

  const model = env.IMAGE_MODEL;  // e.g. 'openai/gpt-image-2'

  // Prompt assembly: [user visual concept] + [brand mood token] + [negative suffix]
  const userPrompt = input.prompt.trim();
  if (!userPrompt) return null;
  const brandTokens = buildVisualKitPromptHints(input.visualKit);
  const prompt = userPrompt + brandTokens + NEGATIVE_SUFFIX;

  // Extract first reference image from BrandKit for style guidance (gpt-image-2 supports image input)
  const referenceImageUrl = extractReferenceImage(input.visualKit);

  console.log(`[imageGenerator] Requesting image from model ${model}`);

  // ── Build model input — gpt-image-2 uses size/quality, Imagen uses aspect_ratio ──
  const isGptImage = model.includes('gpt-image');
  const modelInput: Record<string, unknown> = isGptImage
    ? {
        prompt,
        size:    '1024x1024',
        quality: 'high',
        ...(referenceImageUrl ? { image: referenceImageUrl } : {}),
      }
    : {
        prompt,
        aspect_ratio: '1:1',
      };

  try {
    const createRes = await fetch(
      `https://api.replicate.com/v1/models/${model}/predictions`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ input: modelInput }),
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
