/**
 * panoramaGenerator.ts
 *
 * Regular 2-3-part panoramas use direct OpenAI Images. This file is also the
 * only place nano-banana-2 (Google Gemini 3.1 Flash Image) and Replicate remain:
 * long 4-8-part panoramas plus the experimental 4x4 grid.
 *
 * Nano Banana stays because it renders ratios beyond OpenAI's verified 3:1
 * ceiling. Every regular provider still returns one complete source scene; the
 * server validates, normalizes and only then cuts it into square slides.
 *
 * Isolated from the cover engine, the carousel engine and the text model — none
 * of them touch this file.
 */

import sharp from 'sharp';
import { env } from '../env';
import { openAiImage } from './openaiImage';
import { openAiVision } from './openaiChat';

const NANO_MODEL = 'google/nano-banana-2';

interface Prediction {
  id?:     string;
  status:  string;
  output:  string | string[] | null;
  error:   string | null;
}

export type PanoramaOrientation = 'horizontal' | 'vertical' | 'grid4';
export type LinearPanoramaOrientation = Exclude<PanoramaOrientation, 'grid4'>;

export interface PanoramaGenerationPlan {
  count: number;
  orientation: LinearPanoramaOrientation;
  provider: 'openai' | 'replicate';
  aspectRatio: string;
  openAiSize: string | null;
  replicateAspectRatio: string | null;
  needsRatioGuide: boolean;
  targetWidth: number;
  targetHeight: number;
}

/** The selected part count is the source of truth for provider and canvas size. */
export function getPanoramaGenerationPlan(
  orientation: LinearPanoramaOrientation,
  requestedCount: number,
  tileSize = 1080,
): PanoramaGenerationPlan {
  const count = Math.min(Math.max(Math.round(requestedCount), 2), 8);
  const vertical = orientation === 'vertical';
  const aspectRatio = vertical ? `1:${count}` : `${count}:1`;
  const provider = count <= 3 ? 'openai' : 'replicate';
  const openAiSize = provider === 'openai'
    ? (vertical ? `1024x${1024 * count}` : `${1024 * count}x1024`)
    : null;
  const replicateAspectRatio = provider === 'replicate'
    ? (count === 4 || count === 8 ? aspectRatio : 'match_input_image')
    : null;

  return {
    count,
    orientation,
    provider,
    aspectRatio,
    openAiSize,
    replicateAspectRatio,
    needsRatioGuide: provider === 'replicate' && count !== 4 && count !== 8,
    targetWidth: vertical ? tileSize : tileSize * count,
    targetHeight: vertical ? tileSize * count : tileSize,
  };
}
const PANORAMA_STYLE_PHRASES: Record<string, string> = {
  hyperreal:  'hyperrealistic, ultra-detailed, lifelike photography',
  cinematic:  'cinematic film still, dramatic lighting, shallow depth of field, professionally color-graded',
  '3d':       'high-end 3D render, physically based materials, volumetric lighting',
  cartoon:    'flat 2D cartoon illustration, bold clean shapes',
  anime:      'anime illustration, expressive composition, cel shading',
  clay:       'handcrafted clay art, tactile miniature forms, soft studio lighting',
  pixel:      'pixel art, crisp deliberate pixels, limited cohesive palette',
  scifi:      'science-fiction concept art, advanced technology, cinematic scale',
  cyberpunk:  'cyberpunk atmosphere, neon light, dense futuristic urban detail',
  vaporwave:  'vaporwave aesthetic, retro-futuristic gradients, surreal nostalgic mood',
  isometric:  'clean isometric illustration, precise dimensional geometry',
  minimal:    'minimalist art direction, restrained forms, clean uncluttered composition',
  lowpoly:    'low-poly 3D art, faceted geometry, stylized lighting',
  glitch:     'controlled digital glitch aesthetic, chromatic distortion, layered signal artifacts',
  blueprint:  'technical blueprint aesthetic, precise linework, schematic visual language',
  watercolor: 'watercolor painting, organic pigment blooms, textured paper feel',
  oil:        'traditional oil painting, rich brushwork, layered pigments',
};

function compactText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

/**
 * Converts the channel VisualKit into explicit image-model instructions.
 * Reference images are represented by their saved vision descriptions because
 * the panorama model currently receives a text prompt, not raw image inputs.
 */
export function buildPanoramaBrandStyle(visualKit: unknown, safeOnly = false): string {
  if (!visualKit || typeof visualKit !== 'object' || Array.isArray(visualKit)) return '';
  const vk = visualKit as Record<string, unknown>;
  const parts: string[] = [];

  const bgStyle = compactText(vk['coverBgStyle'], 40).toLowerCase();
  if (bgStyle && bgStyle !== 'auto') {
    parts.push('rendering style: ' + (PANORAMA_STYLE_PHRASES[bgStyle] ?? bgStyle));
  }

  const detail = compactText(vk['coverBgDetail'], 20).toLowerCase();
  if (detail === 'minimal') parts.push('detail level: restrained and uncluttered');
  if (detail === 'balanced') parts.push('detail level: balanced, readable, and layered');
  if (detail === 'detailed') parts.push('detail level: richly detailed, intricate, and deep');

  // Free-form master style and reference descriptions can contain instructions
  // such as "write the headline on the image". A text-free panorama must never
  // forward those commands to the image model.
  const masterStyle = safeOnly ? '' : compactText(vk['visualCoverStyle'], 600);
  if (masterStyle) parts.push('master visual style: ' + masterStyle);

  const colors = Array.isArray(vk['brandColors'])
    ? (vk['brandColors'] as unknown[]).slice(0, 5).flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const color = item as Record<string, unknown>;
        const hex = compactText(color['hex'], 10);
        if (!/^#[0-9a-f]{6}$/i.test(hex)) return [];
        const name = safeOnly ? '' : compactText(color['name'], 50);
        const usage = safeOnly ? '' : compactText(color['usage'], 100);
        return [(name ? name + ' ' : '') + hex + (usage ? ' (' + usage + ')' : '')];
      })
    : [];
  if (colors.length) parts.push('brand palette: ' + colors.join(', '));

  const references = !safeOnly && Array.isArray(vk['references'])
    ? (vk['references'] as unknown[]).slice(0, 5).flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const description = compactText((item as Record<string, unknown>)['description'], 240);
        return description ? [description] : [];
      })
    : [];
  if (references.length) parts.push('reference art direction: ' + references.join(' | '));

  const avoid = !safeOnly && Array.isArray(vk['avoidList'])
    ? (vk['avoidList'] as unknown[]).flatMap(item => {
        const value = compactText(item, 100);
        return value ? [value] : [];
      }).slice(0, 12)
    : [];
  if (avoid.length) parts.push('avoid: ' + avoid.join(', '));

  const legacyBackground = compactText(vk['backgroundStyle'], 40);
  if (legacyBackground) parts.push('background treatment: ' + legacyBackground);

  return parts.join('\n');
}

/**
 * Turns a short user brief into a production prompt for an image that will be
 * sliced after generation. The orientation-specific rules are deliberately
 * deterministic: even a terse brief must produce one continuous composition,
 * not a collage of unrelated frames.
 */
export function buildPanoramaPrompt(
  brief: string,
  orientation: PanoramaOrientation,
  count: number,
  aspectRatio: string,
  visualKit?: unknown,
  textRetry = false,
): string {
  const brandStyle = buildPanoramaBrandStyle(visualKit, orientation !== 'grid4');

  if (orientation === 'grid4') {
    return [
      'Create ONE single square source image at 1:1 aspect ratio and true 4K resolution.',
      'USER SUBJECT:',
      brief.trim(),
      'FOUR SYNCHRONIZED VARIANTS IN ONE IMAGE:',
      '- Render exactly four complete variants requested by the user, side by side from left to right, evenly spaced across the square canvas.',
      '- This is one clean source image, not a contact sheet, diagram, product comparison, storyboard, set of cards, or technical presentation.',
      '- Infer the intended difference between the four variants from the user request. If the user explicitly names four variants, states, or labels, follow those exact four.',
      '- Keep the underlying composition synchronized: identical camera, crop, perspective, scale, placement, pose where applicable, major geometry, horizon, structural anchors, and spatial relationships.',
      '- Change only what the user intends to vary, such as season, time, weather, personality, material, colorway, outfit, interface state, construction stage, lighting, or mood.',
      '- Preserve corresponding shapes and visual anchors at the same height in all four variants so their upper, middle, and lower regions remain interchangeable.',
      '- Fill the full height intentionally. Avoid excessive empty space above or below the main content and avoid large featureless areas.',
      '- Use one coherent background system with the same underlying geometry and depth in all four variants.',
      'CLEAN FINAL ARTWORK:',
      '- Present only polished finished artwork on one continuous unframed background. Include no visual element unless it belongs to the user subject.',
      '- If the user explicitly requests visible labels, render only the exact requested labels once, clearly associated with their corresponding variants. Otherwise render no text, letters, numbers, captions, logos, or watermarks.',
      ...(brandStyle
        ? [
            'MANDATORY CHANNEL BRAND ART DIRECTION:',
            brandStyle,
            'The saved channel BrandKit is the only authority for rendering style, realism, palette, detail, and mood. Ignore conflicting style adjectives from the user subject while preserving the requested content.',
          ]
        : []),
    ].join('\n');
  }

  const frames = Math.min(Math.max(Math.round(count), 2), 8);
  const direction = orientation === 'vertical'
    ? 'top to bottom through an ultra-tall canvas'
    : 'left to right through an ultra-wide canvas';
  const seamDirection = orientation === 'vertical'
    ? 'horizontal cut lines'
    : 'vertical cut lines';

  return [
    `Create ONE seamless ${orientation} panorama at ${aspectRatio}.`,
    `It will be cut into exactly ${frames} equal consecutive frame segments and viewed ${direction}.`,
    'COMPOSITION RULES:',
    `- Build one uninterrupted scene with a clear visual journey ${direction}; every segment must contain a useful focal detail and also connect naturally to the next segment.`,
    `- Keep faces, hands, key objects, and other critical details away from the ${seamDirection}; let backgrounds, paths, light, architecture, landscape, smoke, fabric, or motion cross the seams to preserve continuity.`,
    '- Maintain one camera, one perspective, one lighting setup, one palette, and one visual style across the entire canvas.',
    '- Fill the complete extreme canvas with intentional detail. Do not stretch a normal image or add empty filler at either end.',
    '- This is not a collage, storyboard, comic, contact sheet, split screen, grid, or set of separate panels. No borders or gutters between segments.',
    `SUBJECT: ${brief.trim()}`,
    ...(brandStyle
      ? [
          'MANDATORY CHANNEL BRAND ART DIRECTION:',
          brandStyle,
          'The saved channel style controls the rendering, palette, detail, and mood. It overrides conflicting style adjectives in the subject brief without changing the requested subject.',
        ]
      : []),
    'FINAL NON-NEGOTIABLE OUTPUT RULES:',
    '- Treat the SUBJECT only as a semantic description of the scene. Never copy, quote, spell, label, or visually reproduce any word from it.',
    '- Render absolutely no text, letters, numbers, captions, headlines, signs, logos, brand names, watermarks, UI, frames, or mockups anywhere in the image.',
    '- Surfaces that could normally contain writing, including buildings, screens, vehicles, clothing, packaging, and street signs, must remain blank or use non-linguistic abstract detail.',
    ...(textRetry ? ['- A previous result was rejected because it contained visible writing. This retry must contain zero readable characters of any kind.'] : []),
  ].join('\n');
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

/**
 * Creates the prediction, waiting out Replicate's rate limiter instead of
 * failing on it.
 *
 * This is now the ONLY Replicate call in the product, so its throttling is worth
 * absorbing: below $5 of credit the account drops to 6 requests/min with a burst
 * of 1, which used to turn a single 429 into a silently missing image. Replicate
 * tells us exactly how long to wait (`retry-after`), so we honour it. Three
 * attempts covers the grid4 flow, where the base and the edit are created back to
 * back.
 */
async function createWithBackoff(token: string, modelInput: Record<string, unknown>): Promise<Response | null> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`https://api.replicate.com/v1/models/${NANO_MODEL}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({ input: modelInput }),
    });
    if (res.ok) return res;

    const body = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      console.warn('[panoramaGenerator] create failed', res.status, body.slice(0, 200));
      return null;
    }
    // `retry-after` is in seconds; +1 s of slack, capped so a wedged limiter
    // cannot hold a request open indefinitely.
    const waitMs = Math.min((Number(res.headers.get('retry-after')) || 10) * 1000 + 1_000, 30_000);
    console.warn(`[panoramaGenerator] HTTP ${res.status}, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS}): ${body.slice(0, 160)}`);
    await sleep(waitMs);
  }
  return null;
}

async function poll(id: string, token: string, timeoutMs = 90_000): Promise<Prediction | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2_500);
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: { Authorization: `Token ${token}` } });
    if (!res.ok) return null;
    const p = await res.json() as Prediction;
    if (p.status === 'succeeded') return p;
    if (p.status === 'failed' || p.status === 'canceled') { console.warn('[panoramaGenerator] prediction', p.status, p.error ?? ''); return null; }
  }
  return null;
}

async function runNanoImage(
  productionPrompt: string,
  aspectRatio: string,
  options?: { resolution?: '1K' | '2K' | '4K'; imageInput?: string[] },
): Promise<Buffer | null> {
  const token = env.REPLICATE_API_TOKEN;
  if (!token) { console.warn('[panoramaGenerator] REPLICATE_API_TOKEN not set'); return null; }

  try {
    const modelInput: Record<string, unknown> = {
      prompt: productionPrompt,
      aspect_ratio: aspectRatio,
      output_format: 'png',
    };
    if (options?.resolution) modelInput['resolution'] = options.resolution;
    if (options?.imageInput?.length) modelInput['image_input'] = options.imageInput;

    const res = await createWithBackoff(token, modelInput);
    if (!res) return null;

    let prediction = await res.json() as Prediction;
    if (prediction.status !== 'succeeded' && prediction.id) {
      const polled = await poll(prediction.id, token);
      if (polled) prediction = polled;
    }

    const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!url) return null;
    const image = await fetch(url);
    if (!image.ok) return null;
    return Buffer.from(await image.arrayBuffer());
  } catch (err) {
    console.warn('[panoramaGenerator] error:', (err as Error).message);
    return null;
  }
}

/** Generates one complete regular panorama through the provider for its length. */
export async function generatePanoramaImage(
  prompt: string,
  orientation: LinearPanoramaOrientation,
  count: number,
  visualKit?: unknown,
  options?: { ratioGuideUrl?: string; textRetry?: boolean },
): Promise<Buffer | null> {
  const plan = getPanoramaGenerationPlan(orientation, count);
  const productionPrompt = buildPanoramaPrompt(
    prompt,
    orientation,
    plan.count,
    plan.aspectRatio,
    visualKit,
    options?.textRetry ?? false,
  );

  if (plan.provider === 'openai') {
    return openAiImage({
      prompt: productionPrompt,
      size: plan.openAiSize!,
      quality: 'medium',
      model: env.OPENAI_IMAGE_MODEL,
    });
  }

  if (plan.needsRatioGuide && !options?.ratioGuideUrl) {
    console.warn(`[panoramaGenerator] ${plan.aspectRatio} requires a ratio guide`);
    return null;
  }

  return runNanoImage(productionPrompt, plan.replicateAspectRatio!, {
    resolution: '2K',
    imageInput: options?.ratioGuideUrl ? [options.ratioGuideUrl] : undefined,
  });
}

/** Transparent guide used only to make Replicate preserve 1:5 / 1:6 / 1:7. */
export async function buildPanoramaRatioGuide(
  orientation: LinearPanoramaOrientation,
  count: number,
  shortEdge = 512,
): Promise<Buffer> {
  const plan = getPanoramaGenerationPlan(orientation, count, shortEdge);
  return sharp({
    create: {
      width: plan.targetWidth,
      height: plan.targetHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  }).png().toBuffer();
}

/**
 * Produces the exact N-square source canvas. Generated images are strict: a
 * wrong model ratio is rejected instead of stretched. Uploaded images may be
 * centre-cropped to the requested N-square canvas.
 */
export async function normalizePanoramaSource(
  buffer: Buffer,
  orientation: LinearPanoramaOrientation,
  count: number,
  tileSize = 1080,
  strictRatio = true,
): Promise<Buffer> {
  const plan = getPanoramaGenerationPlan(orientation, count, tileSize);
  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 2 || height < 2) throw new Error('Panorama source has no usable dimensions');

  const actual = width / height;
  const expected = plan.targetWidth / plan.targetHeight;
  const relativeError = Math.abs(actual - expected) / expected;
  if (strictRatio && relativeError > 0.02) {
    throw new Error(
      `Panorama source ratio mismatch: got ${width}x${height}, expected ${plan.aspectRatio}`,
    );
  }

  return sharp(buffer)
    .resize({
      width: plan.targetWidth,
      height: plan.targetHeight,
      // Never stretch the scene. Strict mode only allows the tiny edge crop
      // caused by providers rounding their internal pixel dimensions.
      fit: 'cover',
      position: 'centre',
    })
    .png()
    .toBuffer();
}

export interface PanoramaTextScan {
  checked: boolean;
  hasText: boolean;
  detectedText: string;
}

export function parsePanoramaTextScan(response: string | null): PanoramaTextScan {
  if (!response) return { checked: false, hasText: false, detectedText: '' };
  try {
    const match = response.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] ?? response) as Record<string, unknown>;
    if (typeof parsed['has_text'] !== 'boolean') throw new Error('missing has_text');
    return {
      checked: true,
      hasText: parsed['has_text'],
      detectedText: typeof parsed['detected_text'] === 'string' ? parsed['detected_text'].slice(0, 300) : '',
    };
  } catch {
    console.warn('[panoramaGenerator] text QA returned invalid JSON:', response.slice(0, 160));
    return { checked: false, hasText: false, detectedText: '' };
  }
}

/** Uses the existing direct OpenAI vision path as a fail-closed text QA gate. */
export async function scanPanoramaForText(
  normalized: Buffer,
  orientation: LinearPanoramaOrientation,
  count: number,
): Promise<PanoramaTextScan> {
  const tiles = await sliceImage(normalized, orientation, count, 512);
  if (!tiles.length) return { checked: false, hasText: false, detectedText: '' };

  const columns = Math.min(3, tiles.length);
  const rows = Math.ceil(tiles.length / columns);
  const contactSheet = await sharp({
    create: {
      width: columns * 512,
      height: rows * 512,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  }).composite(tiles.map((input, index) => ({
    input,
    left: (index % columns) * 512,
    top: Math.floor(index / columns) * 512,
  }))).jpeg({ quality: 85 }).toBuffer();

  const response = await openAiVision({
    image: `data:image/jpeg;base64,${contactSheet.toString('base64')}`,
    prompt: [
      'Inspect every panel of this contact sheet for prohibited designed writing added by the image generator.',
      'Set has_text=true for prominent headlines, captions, slogans, labels, signs, storefront or building lettering, logos, brand names, watermarks, UI labels, or conspicuous words that describe the scene.',
      'Set has_text=false for tiny incidental markings naturally belonging to a depicted real-world object, such as currency denominations and banknote microprint, vehicle plates, clock faces, instrument scales, or distant unreadable environmental detail.',
      'The distinction is functional: reject typography used as a graphic/design element; allow small authentic object detail that is not acting as a headline, caption, sign, logo, or focal message.',
      'Return only compact JSON in this exact shape: {"has_text":boolean,"detected_text":string}.',
      'When has_text=false, detected_text must be an empty string.',
    ].join(' '),
    maxTokens: 120,
    timeoutMs: 45_000,
  });
  return parsePanoramaTextScan(response);
}

function buildGrid4BasePrompt(brief: string, visualKit?: unknown): string {
  const brandStyle = buildPanoramaBrandStyle(visualKit);
  return [
    'Create ONE complete canonical base composition as a tall 1:4 portrait image.',
    'ORIGINAL CREATIVE BRIEF:',
    brief.trim(),
    'BASE TEMPLATE RULES:',
    '- Extract the common subject and underlying composition from the brief and render exactly ONE neutral canonical version.',
    '- If the brief requests four variants, multiple states, personalities, seasons, styles, or labels, do not render those differences yet. Do not render any label or text.',
    '- Use a centered, stable composition with clear top, upper-middle, lower-middle, and bottom content.',
    '- Fill the full height intentionally with minimal empty space above and below.',
    '- Keep the camera, perspective, geometry, silhouette, horizon, and structural anchors clean and easy to preserve during a later visual edit.',
    '- Present only polished finished artwork on one continuous unframed background.',
    ...(brandStyle
      ? [
          'MANDATORY CHANNEL BRAND ART DIRECTION:',
          brandStyle,
        ]
      : []),
  ].join('\n');
}

/** Generates the single canonical 1:4 column used as the geometry template. */
export async function generateGrid4BaseImage(
  brief: string,
  visualKit?: unknown,
): Promise<Buffer | null> {
  return runNanoImage(buildGrid4BasePrompt(brief, visualKit), '1:4', { resolution: '4K' });
}

/**
 * Converts one canonical 1:4 composition into a deterministic square containing
 * four pixel-identical columns. The image model receives this as its edit input.
 */
export async function buildGrid4ReferenceImage(
  baseImage: Buffer,
  side = 4096,
): Promise<Buffer> {
  const columnWidth = Math.floor(side / 4);
  const column = await sharp(baseImage)
    .resize({ width: columnWidth, height: side, fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: columnWidth * 4,
      height: side,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(Array.from({ length: 4 }, (_, index) => ({
      input: column,
      left: index * columnWidth,
      top: 0,
    })))
    .png()
    .toBuffer();
}

/**
 * Edits one square reference image containing four identical columns. Nano
 * Banana changes only the requested state of each column while the supplied
 * geometry remains the common structural source.
 */
export async function generateGrid4FromReference(
  brief: string,
  referenceUrl: string,
  visualKit?: unknown,
): Promise<Buffer | null> {
  const productionPrompt = [
    'Edit the supplied square reference image; do not create a new composition.',
    'The reference contains four pixel-identical copies of one canonical composition.',
    'Preserve the exact camera, crop, placement, pose where applicable, perspective, scale, major geometry, horizon, visual anchors, and background structure of all four copies.',
    'Keep all corresponding features at the same pixel-space height and width.',
    'Apply the requested four variants only as controlled visual changes inside the existing structure.',
    buildPanoramaPrompt(brief, 'grid4', 4, '1:1', visualKit),
  ].join('\n');

  return runNanoImage(productionPrompt, 'match_input_image', {
    resolution: '4K',
    imageInput: [referenceUrl],
  });
}

/**
 * Center-crops an image to 1:1 and cuts it into a row-major 4x4 matrix.
 * Each returned row is ready to become one independent slideshow block.
 */
export async function sliceGrid4Image(
  buffer: Buffer,
  tileSize = 1024,
): Promise<Buffer[][]> {
  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 4 || height < 4) return [];

  const side = Math.min(width, height);
  const left = Math.floor((width - side) / 2);
  const top = Math.floor((height - side) / 2);
  const square = await sharp(buffer)
    .extract({ left, top, width: side, height: side })
    .png()
    .toBuffer();

  const cell = Math.floor(side / 4);
  const rows: Buffer[][] = [];
  for (let row = 0; row < 4; row++) {
    const outputRow: Buffer[] = [];
    for (let col = 0; col < 4; col++) {
      const region = {
        left: col * cell,
        top: row * cell,
        width: col === 3 ? side - col * cell : cell,
        height: row === 3 ? side - row * cell : cell,
      };
      outputRow.push(await sharp(square)
        .extract(region)
        .resize({ width: tileSize, height: tileSize, fit: 'fill' })
        .png()
        .toBuffer());
    }
    rows.push(outputRow);
  }
  return rows;
}

/** Cuts a one-dimensional panorama into equal carousel or stack pieces. */
export async function sliceImage(
  buffer: Buffer,
  orientation: LinearPanoramaOrientation,
  count: number,
  tileSize = 1080,
): Promise<Buffer[]> {
  const n = Math.min(Math.max(Math.round(count), 2), 8);
  const normalized = await normalizePanoramaSource(buffer, orientation, n, tileSize, false);
  const out: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const region = orientation === 'vertical'
      ? { left: 0, top: tileSize * i, width: tileSize, height: tileSize }
      : { left: tileSize * i, top: 0, width: tileSize, height: tileSize };
    out.push(await sharp(normalized).extract(region).png().toBuffer());
  }
  return out;
}
