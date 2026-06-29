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

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { putObject } from './storage';
import { env } from '../env';

// Bundled Cyrillic-capable font for the headline overlay. Resolved across the
// possible runtime cwds (dist/lib in prod, src/lib under tsx). Passing an explicit
// fontfile to sharp's text renderer removes any dependency on system fonts being
// installed on the host (Render). Null → fall back to the default sans font.
function resolveFontFile(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../assets/DejaVuSans-Bold.ttf'),
    path.resolve(process.cwd(), 'assets/DejaVuSans-Bold.ttf'),
    path.resolve(process.cwd(), 'server/assets/DejaVuSans-Bold.ttf'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  console.warn('[imageGenerator] Headline font not found — falling back to system sans');
  return null;
}
const FONT_FILE = resolveFontFile();

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
      const url = typeof r === 'string' ? r : (r as Record<string, unknown>)?.['url'];
      if (typeof url === 'string' && url.startsWith('http')) return url;
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
  aspectRatio?: '1:1' | '16:9' | '4:5' | '9:16';
  /**
   * Short headline (usually the post title) to overlay on the cover as real,
   * crisp text via sharp — only applied when visualKit.textOnCover !== false.
   * The model itself still renders a clean, text-free background (flux-schnell
   * draws garbled letters), and we composite legible typography on top.
   */
  headline?:  string;
  /**
   * When true, produce a clean text-free image with NO headline/logo overlay —
   * used as the background layer for the AI+HTML hybrid cover.
   */
  backgroundOnly?: boolean;
  backgroundKind?: 'photo' | 'abstract';
  /**
   * Where the template's text sits, so the photo keeps THAT zone a touch calmer
   * for legibility while the rest of the frame stays full of detail. Set only on
   * the template-over-photo path (measured from the actual template). 'full' = no
   * calm zone (fill edge to edge). When omitted on a backgroundOnly image, the
   * old behaviour applies (reserve a dark, empty lower half for an AI overlay).
   */
  calmZone?: 'top' | 'bottom' | 'left' | 'right' | 'center' | 'full';
  /**
   * Replicate model override (e.g. 'openai/gpt-image-1' for HIGH tier). When
   * absent, falls back to env.IMAGE_MODEL (Flux — the LOW default).
   */
  model?: string;
}

/** Result of cover generation: the final (text-baked) cover + the clean base. */
export interface GeneratedCover {
  /** Composited cover (background + headline + logo) to show and publish. */
  bannerUrl:    string;
  /** Clean, text-free background re-hosted to Blob — lets the headline be
   *  re-rendered later without regenerating the picture. Null if not re-hosted. */
  coverBaseUrl: string | null;
}

/**
 * Generates an image via Replicate and returns the composited cover + clean
 * base, or null if generation is disabled, misconfigured, or encounters a
 * non-fatal error.
 *
 * Never throws — callers (draftGenerator) can safely ignore a null result.
 */
export async function generateImageForPost(
  input: GenerateImageInput,
): Promise<GeneratedCover | null> {

  // ── Guard: only run when IMAGE_PROVIDER === 'replicate' ──────────────────
  if (env.IMAGE_PROVIDER !== 'replicate') return null;

  if (!env.REPLICATE_API_TOKEN) {
    console.warn('[imageGenerator] REPLICATE_API_TOKEN is not set — skipping image generation');
    return null;
  }

  const model = input.model ?? env.IMAGE_MODEL;  // HIGH passes 'openai/gpt-image-1'; LOW uses Flux

  const userPrompt = input.prompt.trim();
  if (!userPrompt) return null;

  // ── Prompt assembly ───────────────────────────────────────────────────────
  // visualCoverStyle is intentionally NOT prepended raw here — it is passed
  // as context to DeepSeek (generateImagePromptWithAI → buildVisualStyleDescription)
  // which distils it into a clean English image description. Prepending a raw
  // style spec (possibly in Russian, multi-line, bullet-pointed) confuses the
  // image model and degrades output quality.
  const vkObj = (input.visualKit && typeof input.visualKit === 'object')
    ? input.visualKit as Record<string, unknown>
    : null;
  const rawAspectRatio = input.aspectRatio ?? vkObj?.['aspectRatio'];
  const aspectRatio: '1:1' | '16:9' | '4:5' | '9:16' =
    rawAspectRatio === '16:9' || rawAspectRatio === '4:5' || rawAspectRatio === '9:16'
      ? rawAspectRatio
      : '1:1';
  const brandTokens = buildVisualKitPromptHints(input.visualKit);
  // Respect the channel's logo usage: 'never' = no logo on the cover (e.g. a
  // writer who wants a clean illustration). 'always'/'when_relevant' keep it.
  const logoUsage = typeof vkObj?.['logoUsage'] === 'string' ? vkObj['logoUsage'] as string : undefined;
  const logoUrl = !input.backgroundOnly
    && logoUsage !== 'never'
    && typeof vkObj?.['logoUrl'] === 'string' && (vkObj['logoUrl'] as string).startsWith('http')
    ? vkObj['logoUrl'] as string
    : null;

  // Text-on-cover overlay: honour the visualKit.textOnCover toggle (default on,
  // matching the UI default). The model keeps producing a clean background; the
  // headline is drawn on top by sharp so it is always crisp and on-brand.
  // backgroundOnly (AI+HTML hybrid) → never overlay headline or logo: the HTML
  // layer draws all text/branding on top of this clean image.
  const textOnCover = !input.backgroundOnly && vkObj?.['textOnCover'] !== false;
  const headline = textOnCover && typeof input.headline === 'string' && input.headline.trim()
    ? input.headline.trim()
    : null;
  const brandColor = pickBrandColor(vkObj);

  // Background detail + visual style — channel settings (Cover settings, AI mode;
  // the hybrid reuses the same generated background, so it inherits these too).
  const bgDetailPhrase: Record<string, string> = {
    minimal:  'minimalist composition, lots of negative space, a single simple subject, clean and uncluttered',
    detailed: 'richly detailed, intricate, layered scene with depth',
  };
  const bgStylePhrase: Record<string, string> = {
    hyperreal: 'hyperrealistic, ultra-detailed, lifelike photography',
    cinematic: 'cinematic film still, dramatic lighting, shallow depth of field, color-graded',
    '3d':      '3D render, octane render, volumetric lighting, CGI',
    cartoon:   'flat 2D cartoon illustration, bold clean shapes, vector style',
    anime:     'anime style illustration, cel shading',
    clay:      'claymation, plasticine clay model, stop-motion look, soft studio light',
  };
  const detailKey = typeof vkObj?.['coverBgDetail'] === 'string' ? vkObj['coverBgDetail'] as string : 'balanced';
  const styleKey  = typeof vkObj?.['coverBgStyle']  === 'string' ? vkObj['coverBgStyle']  as string : 'auto';
  const styleHint = [bgStylePhrase[styleKey], bgDetailPhrase[detailKey]]
    .filter(Boolean).join(', ');
  const styleSuffix = styleHint ? `. Style: ${styleHint}` : '';

  // Hybrid background composition. The "fill" wording is DETAIL-AWARE so it never
  // fights the detail setting — minimal must not be told to "fill with rich
  // detail" (that's why minimal looked busy before).
  const detailFill =
    detailKey === 'minimal'
      ? 'keep it minimal and clean — a single simple subject with generous negative space, uncluttered and calm, but the whole square still filled with a soft clean atmosphere (NO black bars, NO empty dead zones)'
      : detailKey === 'detailed'
        ? 'fill the whole frame with rich, layered detail, edge to edge'
        : 'a clear subject with the whole frame filled edge to edge';
  const calmZonePhrase: Record<string, string> = {
    top: 'the top area', bottom: 'the lower area', left: 'the left side',
    right: 'the right side', center: 'the central area',
  };
  const zoneClause = (input.calmZone && input.calmZone !== 'full' && calmZonePhrase[input.calmZone])
    ? `; keep ${calmZonePhrase[input.calmZone]} a touch calmer and lower-contrast (NOT empty, NOT black) so overlaid text stays legible`
    : '';
  const compositionHint = input.backgroundOnly
    ? (input.backgroundKind === 'abstract'
        ? '. Composition: abstract low-detail background texture only, soft atmospheric material, blurred shapes, subtle noise, premium lighting, no literal room, no person, no object, no device, no focal subject; fill the whole frame calmly edge to edge'
        : input.calmZone
          ? `. Composition: ${detailFill}${zoneClause}`
          : '. Composition: main subject in the upper third of the frame, slightly above center; the lower half is dark, calm, uncluttered negative space (subtle gradient or atmosphere only) reserved for a text overlay')
    : '';

  // Logo is composited via sharp AFTER generation — never passed to the model
  const prompt = `${userPrompt}${brandTokens}${styleSuffix}${compositionHint}${NEGATIVE_SUFFIX}`;

  // Reference image: first uploaded reference from visualKit (or logo as fallback).
  // Passed as img2img input so the model inherits the brand's color palette and
  // visual atmosphere. prompt_strength 0.35 — low enough to keep creative freedom,
  // high enough to pull in dark/neon/color mood from the reference.
  const refImageUrl = extractReferenceImage(input.visualKit);

  // ── Build model input ─────────────────────────────────────────────────────
  // flux-2-max uses `input_images: string[]` for img2img (file[] API).
  // flux-schnell / flux-dev use `image: string` + `prompt_strength`.
  // gpt-image uses `image: string`.
  const isGptImage  = model.includes('gpt-image');
  const isFlux2Max  = model.includes('flux-2-max');
  // gpt-image-2 aspect_ratio enum has 1:1 / 16:9 / 9:16 but no 4:5 — map to nearest portrait.
  const gptAspect = aspectRatio === '4:5' ? '2:3' : aspectRatio;
  const modelInput: Record<string, unknown> = isGptImage
    ? {
        prompt,
        aspect_ratio: gptAspect,
        // medium is the cost/quality sweet spot for covers (see docs/low-high-plan.md).
        quality: 'medium',
        // img2img reference uses input_images[] (NOT `image`); openai_api_key is
        // optional on gpt-image-2 (billed via Replicate) — don't send it.
        ...(refImageUrl ? { input_images: [refImageUrl] } : {}),
      }
    : isFlux2Max
    ? {
        prompt,
        aspect_ratio: aspectRatio,
        resolution:   '1 MP',
        ...(refImageUrl ? { input_images: [refImageUrl] } : {}),
      }
    : {
        prompt,
        aspect_ratio: aspectRatio,
        ...(refImageUrl ? { image: refImageUrl, prompt_strength: 0.35 } : {}),
      };

  console.log(`[imageGenerator] model=${model} logo=${logoUrl ? 'yes' : 'no'} ref=${refImageUrl ? 'yes' : 'no'} detail=${detailKey} style=${styleKey} promptLen=${prompt.length}`);

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
      const url = extractUrl(prediction.output);
      return url ? composeCover(url, { logoUrl, headline, brandColor }) : null;
    }

    // ── Failed immediately ────────────────────────────────────────────────
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      console.warn(`[imageGenerator] Prediction failed immediately: ${prediction.status}`);
      return null;
    }

    // ── Asynchronous: poll until done ─────────────────────────────────────
    if (!prediction.id) {
      console.warn('[imageGenerator] No prediction id in response — cannot poll');
      return null;
    }

    const polledUrl = await pollPrediction(prediction.id, env.REPLICATE_API_TOKEN, env.IMAGE_GENERATION_POLL_TIMEOUT_MS);
    return polledUrl ? composeCover(polledUrl, { logoUrl, headline, brandColor }) : null;

  } catch (err) {
    console.warn('[imageGenerator] Unexpected error:', (err as Error).message);
    return null;
  }
}

// ─── Sharp cover compositing (headline text + logo) ───────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Picks the first valid brand hex color from visualKit (brandColors → primaryColor). */
function pickBrandColor(vk: Record<string, unknown> | null): string | null {
  if (!vk) return null;
  const colors = vk['brandColors'];
  if (Array.isArray(colors)) {
    for (const c of colors) {
      const hex = (c as { hex?: unknown })?.hex;
      if (typeof hex === 'string' && HEX_RE.test(hex)) return hex;
    }
  }
  const primary = vk['primaryColor'];
  if (typeof primary === 'string' && HEX_RE.test(primary)) return primary;
  return null;
}

/** Escapes the Pango markup special characters in user text. */
function escapePango(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Collapses whitespace and truncates an over-long headline to ~maxChars (+ ellipsis). */
function clampHeadline(text: string, maxChars: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1).replace(/[\s.,;:!?]*$/, '') + '…';
}

/**
 * Renders the headline to a transparent PNG via sharp's native (Pango) text
 * engine, using the bundled fontfile so it never depends on host fonts. Wraps to
 * `wrapWidth` and is clamped to roughly three lines. Returns the buffer + height.
 */
async function renderHeadline(
  text: string,
  W: number,
  H: number,
  padX: number,
): Promise<{ buf: Buffer; h: number; fontSize: number } | null> {
  const fontSize  = Math.max(28, Math.round(H * 0.072));
  const wrapWidth = W - padX * 2;
  // Cap to ~2 lines so the overlaid headline sits at the bottom and never climbs
  // up into the picture/subject. Over-long titles are truncated with an ellipsis.
  const maxChars  = Math.floor((wrapWidth / (fontSize * 0.52)) * 2);
  const safe      = escapePango(clampHeadline(text, maxChars));
  if (!safe) return null;

  const textInput: sharp.CreateText = {
    text:  `<span foreground="#FFFFFF">${safe}</span>`,
    font:  `${FONT_FILE ? 'DejaVu Sans' : 'sans-serif'} Bold ${fontSize}`,
    rgba:  true,
    width: wrapWidth,
    align: 'left',
  };
  if (FONT_FILE) textInput.fontfile = FONT_FILE;

  const buf  = await sharp({ text: textInput }).png().toBuffer();
  const meta = await sharp(buf).metadata();
  return { buf, h: meta.height ?? fontSize, fontSize };
}

/** Fetches an image URL into a Buffer. Throws on failure (callers handle it). */
async function downloadImage(url: string): Promise<Buffer> {
  return fetch(url).then(r => r.arrayBuffer()).then(b => Buffer.from(b));
}

/** Uploads a composited cover JPEG to Blob and returns its public URL. */
async function uploadCover(buf: Buffer, kind: 'cover' | 'base'): Promise<string> {
  const obj = await putObject(`covers/${kind}-${Date.now()}.jpg`, buf, {
    contentType: 'image/jpeg',
  });
  return obj.url;
}

/**
 * Builds the sharp overlay layers (bottom scrim + brand accent bar + headline
 * text image, then the top-right logo) for a cover of size W×H. Returns [] when
 * there's nothing to overlay. Shared by generation and headline re-rendering.
 */
async function buildOverlayLayers(
  W: number,
  H: number,
  opts: { headline: string | null; brandColor: string | null; logoUrl: string | null },
): Promise<sharp.OverlayOptions[]> {
  const { headline, brandColor, logoUrl } = opts;
  const layers: sharp.OverlayOptions[] = [];

  // Headline: scrim + brand accent bar (SVG shapes, no fonts) + text image.
  if (headline) {
    const padX      = Math.round(W * 0.06);
    const padBottom = Math.round(H * 0.07);
    const rendered  = await renderHeadline(headline, W, H, padX);
    if (rendered) {
      const { buf: textBuf, h: th, fontSize } = rendered;
      const textTop  = Math.max(0, H - padBottom - th);
      const barH     = Math.max(4, Math.round(fontSize * 0.22));
      const barW     = Math.round(W * 0.11);
      const barGap   = Math.round(fontSize * 0.5);
      const barY     = Math.max(0, textTop - barGap - barH);
      const scrimTop = Math.max(0, barY - Math.round(H * 0.05));
      const accent   = brandColor && HEX_RE.test(brandColor) ? brandColor : '#FF6A00';

      const scrimBar = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
    <stop offset="${(scrimTop / H).toFixed(3)}" stop-color="#000000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000000" stop-opacity="0.82"/>
  </linearGradient></defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#scrim)"/>
  <rect x="${padX}" y="${barY}" width="${barW}" height="${barH}" rx="${Math.round(barH / 2)}" fill="${accent}"/>
</svg>`;

      layers.push({ input: Buffer.from(scrimBar), top: 0, left: 0 });
      layers.push({ input: textBuf, top: textTop, left: padX });
    }
  }

  // Brand logo, top-right (non-fatal — skip if it can't be fetched).
  if (logoUrl) {
    try {
      const logoBuf  = await downloadImage(logoUrl);
      const logoSize = Math.round(W * 0.18);
      const logoPng  = await sharp(logoBuf)
        .resize(logoSize, logoSize, { fit: 'inside', withoutEnlargement: false })
        .png()
        .toBuffer();
      const logoMeta = await sharp(logoPng).metadata();
      const logoW = logoMeta.width ?? logoSize;
      const margin = Math.round(W * 0.04);
      layers.push({ input: logoPng, top: margin, left: W - logoW - margin, blend: 'over' });
    } catch (err) {
      console.warn('[imageGenerator] Logo fetch/resize failed (skipping logo):', (err as Error).message);
    }
  }

  return layers;
}

/**
 * Downloads the model's (text-free) output, re-hosts it as the clean base, then
 * composites the headline + logo and uploads the final cover. Returns both URLs.
 * Falls back to the original URL on any error (or when no blob token) so
 * generation always returns something.
 */
async function composeCover(
  coverUrl: string,
  opts: { logoUrl: string | null; headline: string | null; brandColor: string | null },
): Promise<GeneratedCover> {
  try {
    const coverBuf = await downloadImage(coverUrl);

    // Re-host the clean (text-free) background so the headline can be re-rendered
    // later without regenerating the picture.
    let coverBaseUrl: string | null = null;
    try {
      coverBaseUrl = await uploadCover(await sharp(coverBuf).jpeg({ quality: 90 }).toBuffer(), 'base');
    } catch (err) {
      console.warn('[imageGenerator] Clean base re-host failed:', (err as Error).message);
    }

    const meta = await sharp(coverBuf).metadata();
    const W = meta.width  ?? 1024;
    const H = meta.height ?? 1024;

    const layers = await buildOverlayLayers(W, H, opts);
    if (layers.length === 0) {
      // No overlay → the banner is just the clean base (or the original URL).
      return { bannerUrl: coverBaseUrl ?? coverUrl, coverBaseUrl };
    }

    const bannerUrl = await uploadCover(
      await sharp(coverBuf).composite(layers).jpeg({ quality: 90 }).toBuffer(),
      'cover',
    );
    console.log(`[imageGenerator] Cover composed (text=${!!opts.headline} logo=${!!opts.logoUrl}) → ${bannerUrl}`);
    return { bannerUrl, coverBaseUrl };

  } catch (err) {
    console.warn('[imageGenerator] Cover compose failed (returning original):', (err as Error).message);
    return { bannerUrl: coverUrl, coverBaseUrl: null };
  }
}

/**
 * Re-renders the headline (and logo) over an existing clean base cover and
 * uploads the result. Used by "edit cover text" — the picture stays identical,
 * only the overlaid text changes. `headline` empty/null = remove text. Returns
 * the new banner URL, or null on failure / when no blob token.
 */
export async function renderCoverFromBase(
  baseUrl: string,
  headline: string | null,
  visualKit: unknown,
): Promise<string | null> {
  const vkObj = (visualKit && typeof visualKit === 'object')
    ? visualKit as Record<string, unknown>
    : null;
  const brandColor = pickBrandColor(vkObj);
  const logoUrl = typeof vkObj?.['logoUrl'] === 'string' && (vkObj['logoUrl'] as string).startsWith('http')
    ? vkObj['logoUrl'] as string
    : null;
  const cleanHeadline = headline && headline.trim() ? headline.trim() : null;

  try {
    const baseBuf = await downloadImage(baseUrl);
    const meta = await sharp(baseBuf).metadata();
    const W = meta.width  ?? 1024;
    const H = meta.height ?? 1024;

    const layers = await buildOverlayLayers(W, H, { headline: cleanHeadline, brandColor, logoUrl });
    const out = layers.length === 0
      ? await sharp(baseBuf).jpeg({ quality: 90 }).toBuffer()
      : await sharp(baseBuf).composite(layers).jpeg({ quality: 90 }).toBuffer();

    return await uploadCover(out, 'cover');
  } catch (err) {
    console.warn('[imageGenerator] renderCoverFromBase failed:', (err as Error).message);
    return null;
  }
}
