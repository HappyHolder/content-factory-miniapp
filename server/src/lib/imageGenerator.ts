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
 *
 * Key lessons from bad outputs:
 *  - Model was rendering HEX codes, token names, and font rules as visible text.
 *  - Model was producing infographic/spec-sheet layouts instead of clean covers.
 *  - "Brand color palette for this cover: Name: #HEX" read as content, not style.
 *  - "print-ready" wording encouraged white print margins / framed poster look.
 *  - Output sometimes had a white border/frame placing the image on a background.
 * These constraints lock the output to one clean full-bleed visual cover.
 */
const FINAL_OUTPUT_CONSTRAINTS =
  'CRITICAL OUTPUT RULES — read before generating anything. ' +

  // Single finished full-bleed cover
  'Generate exactly ONE finished full-bleed Telegram post cover image. ' +
  'The image must fill the entire square canvas edge-to-edge — full-bleed, no borders, no margins. ' +
  'Do NOT add a white border, outer frame, margin, padding, or any edge gap around the image. ' +
  'Do NOT place the cover on a white background, paper sheet, card, or any outer container. ' +
  'Do NOT create a poster-on-card, framed print, or image-inside-another-image layout. ' +
  'Do NOT produce a design board, mood board, concept sheet, grid of options, or annotated layout. ' +
  'Do NOT show multiple variants or versions side by side. ' +
  'Do NOT add UI chrome, mockup frames, device screens, or browser windows. ' +

  // No visible technical labels
  'Do NOT render any technical prompt instructions as visible text in the image. ' +
  'Do NOT write HEX color codes, color names, or color token names anywhere in the image. ' +
  'Do NOT write font names, typography rules, layout coordinates, or style guide annotations in the image. ' +
  'Do NOT write words like "Type", "Font", "HEX", "RGB", "Palette", "Color", "Style", "Position", ' +
    '"Montserrat", "gradient", "option", "concept", "mockup", "version", "draft", "#DALL-E", or any similar technical label. ' +
  'Do NOT create diagrams, UI specs, infographics, brand boards, or annotated mockups. ' +

  // Text policy
  'By default generate a TEXT-FREE visual cover — no words, no letters, no numbers on the image. ' +
  'Only add text to the image if the user prompt explicitly states an exact headline or caption to display. ' +
  'If text is requested, render only that exact phrase in large, clean, legible type. ' +
  'Do NOT invent, add, or interpret any other words. ' +

  // Other safeguards
  'Do NOT invent logos, watermarks, or brand marks unless explicitly described in the prompt. ' +
  'Do NOT create charts, graphs, roadmap diagrams, or maps unless the user prompt explicitly requests one. ' +

  // Priority
  'The user image prompt below is the single highest priority — follow its visual concept precisely.';

/**
 * Builds BrandKit style guidance to append after the user image prompt.
 *
 * WORDING RULES — prevents the model from rendering technical values as
 * visible text on the image:
 *  - Color tokens are described as invisible palette/atmosphere guidance.
 *    HEX values are included for color accuracy but the block explicitly
 *    forbids writing them in the image.
 *  - Font preset/rules are phrased as visual mood, not spec-sheet items.
 *    Font names are never mentioned — only mood descriptors are used.
 *
 * Note: logoUrl and references are stored in visualKit but are NOT passed
 * here because the current model accepts prompt-only input. Logo compositing
 * and reference image inputs are not yet implemented.
 *
 * Never throws — returns '' when there is nothing to add.
 */
export function buildVisualKitPromptHints(visualKit: unknown): string {
  if (!visualKit || typeof visualKit !== 'object') return '';
  const vk = visualKit as Record<string, unknown>;

  const parts: string[] = [];

  // ── Brand colors — invisible palette/atmosphere guidance ─────────────────
  // Only HEX values are passed (no token names) so the model gets accurate
  // color information without producing visible label text.
  const rawColors = vk['brandColors'];
  if (Array.isArray(rawColors) && rawColors.length > 0) {
    const hexes: string[] = [];
    for (const c of (rawColors as RawBrandColor[]).slice(0, 8)) {
      if (typeof c.hex !== 'string' || !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(c.hex)) continue;
      hexes.push(c.hex);
    }
    if (hexes.length > 0) {
      parts.push(
        'Invisible palette guidance — do NOT write these as text: ' +
        'use ' + hexes.join(', ') + ' as the dominant color atmosphere. ' +
        'Apply to background tones, lighting, glows, accents, and shapes only. ' +
        'Never render hex codes, color names, or color labels anywhere in the image.'
      );
    }
  }

  // ── Typography — visual mood only, no font names ─────────────────────────
  // Described as mood/atmosphere to avoid the model writing spec labels.
  const presetMoodMap: Record<string, string> = {
    serif:       'classic, editorial, print-inspired visual mood',
    sans:        'clean, modern, minimal visual mood',
    mono:        'technical, terminal, code-aesthetic visual mood',
    display:     'bold, high-impact, graphic visual mood',
    handwritten: 'organic, handcrafted, personal visual mood',
  };
  const preset = typeof vk['visualFontPreset'] === 'string' ? vk['visualFontPreset'] : 'default';
  if (preset !== 'default' && presetMoodMap[preset]) {
    parts.push(
      `Overall visual mood: ${presetMoodMap[preset]}. ` +
      'Do not write font names, type rules, or style annotations in the image.'
    );
  }
  const fontRules = typeof vk['visualFontRules'] === 'string' ? vk['visualFontRules'].trim() : '';
  if (fontRules) {
    parts.push(
      `Visual style note (invisible guidance — do not render as text): ${fontRules}`
    );
  }

  if (parts.length === 0) return '';
  return (
    '\n\nInvisible brand style guidance' +
    ' (influences color atmosphere and visual mood only —' +
    ' none of this should appear as visible text in the image):\n' +
    parts.join('\n')
  );
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
