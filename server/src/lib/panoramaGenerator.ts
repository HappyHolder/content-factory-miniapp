/**
 * panoramaGenerator.ts
 *
 * The ONLY place nano-banana-2 (Google Gemini 3.1 Flash Image) is used. It is the
 * one Replicate image model that generates true extreme ratios (1:4 / 4:1 / 1:8 /
 * 8:1) in a single pass — used for post PANORAMAS, sliced into stacked/carousel
 * slides. Isolated from the cover engine (Flux + HTML), the carousel engine and
 * the layout model (Terra) — none of them touch this file.
 */

import sharp from 'sharp';
import { env } from '../env';

const NANO_MODEL = 'google/nano-banana-2';

interface Prediction {
  id?:     string;
  status:  string;
  output:  string | string[] | null;
  error:   string | null;
}

export type PanoramaOrientation = 'horizontal' | 'vertical' | 'grid4';
export interface Grid4Brief {
  cleanBrief: string;
  labels: string[];
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

export function parseGrid4Brief(brief: string): Grid4Brief {
  const patterns = [
    /(?:labels?|captions?)\s+(?:above\s+(?:them|their\s+heads?)|at\s+the\s+top)\s*:\s*([^\n.]+)/i,
    /(?:подписи?|названия?)\s+(?:над\s+(?:ними|головами)|сверху)\s*:\s*([^\n.]+)/i,
  ];
  for (const pattern of patterns) {
    const match = brief.match(pattern);
    if (!match?.[1]) continue;
    const labels = match[1].split(/[,;|]/).map(value => value.trim()).filter(Boolean);
    if (labels.length !== 4 || labels.some(label => label.length > 40)) continue;
    const cleanBrief = brief.replace(match[0], '').replace(/\s{2,}/g, ' ').replace(/([.!?])\s*[.!?]+/g, '$1').trim();
    return { cleanBrief, labels };
  }
  return { cleanBrief: brief.trim(), labels: [] };
}

/**
 * Converts the channel VisualKit into explicit image-model instructions.
 * Reference images are represented by their saved vision descriptions because
 * the panorama model currently receives a text prompt, not raw image inputs.
 */
export function buildPanoramaBrandStyle(visualKit: unknown): string {
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

  const masterStyle = compactText(vk['visualCoverStyle'], 600);
  if (masterStyle) parts.push('master visual style: ' + masterStyle);

  const colors = Array.isArray(vk['brandColors'])
    ? (vk['brandColors'] as unknown[]).slice(0, 5).flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const color = item as Record<string, unknown>;
        const hex = compactText(color['hex'], 10);
        if (!/^#[0-9a-f]{6}$/i.test(hex)) return [];
        const name = compactText(color['name'], 50);
        const usage = compactText(color['usage'], 100);
        return [(name ? name + ' ' : '') + hex + (usage ? ' (' + usage + ')' : '')];
      })
    : [];
  if (colors.length) parts.push('brand palette: ' + colors.join(', '));

  const references = Array.isArray(vk['references'])
    ? (vk['references'] as unknown[]).slice(0, 5).flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const description = compactText((item as Record<string, unknown>)['description'], 240);
        return description ? [description] : [];
      })
    : [];
  if (references.length) parts.push('reference art direction: ' + references.join(' | '));

  const avoid = Array.isArray(vk['avoidList'])
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
): string {
  const brandStyle = buildPanoramaBrandStyle(visualKit);

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
    '- No text, letters, numbers, captions, logos, watermarks, UI, frames, or mockups.',
    `SUBJECT: ${brief.trim()}`,
    ...(brandStyle
      ? [
          'MANDATORY CHANNEL BRAND ART DIRECTION:',
          brandStyle,
          'The saved channel style controls the rendering, palette, detail, and mood. It overrides conflicting style adjectives in the subject brief without changing the requested subject.',
        ]
      : []),
  ].join('\n');
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

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

    const res = await fetch(`https://api.replicate.com/v1/models/${NANO_MODEL}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({ input: modelInput }),
    });
    if (!res.ok) {
      console.warn('[panoramaGenerator] create failed', res.status, (await res.text()).slice(0, 200));
      return null;
    }

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

/**
 * Generates a regular one-dimensional panorama. Grid4 uses the separate
 * reference-template pipeline below.
 */
export async function generatePanoramaImage(
  prompt: string,
  aspectRatio: string,
  orientation: PanoramaOrientation,
  count: number,
  visualKit?: unknown,
): Promise<Buffer | null> {
  const productionPrompt = buildPanoramaPrompt(prompt, orientation, count, aspectRatio, visualKit);
  return runNanoImage(productionPrompt, aspectRatio, {
    resolution: orientation === 'grid4' ? '4K' : undefined,
  });
}

function buildGrid4BasePrompt(brief: string, visualKit?: unknown): string {
  const brandStyle = buildPanoramaBrandStyle(visualKit);
  const { cleanBrief } = parseGrid4Brief(brief);
  return [
    'Create ONE complete canonical base composition as a tall 1:4 portrait image.',
    'ORIGINAL CREATIVE BRIEF:',
    cleanBrief,
    'BASE TEMPLATE RULES:',
    '- Extract the common subject and underlying composition from the brief and render exactly ONE neutral canonical version.',
    '- Do not render multiple variants, comparison views, close-ups, inset images, labels, captions, or any text.',
    '- Use one centered, stable composition that fills the full height with minimal empty space.',
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

/** Generates a low-cost canonical 1:4 geometry template. */
export async function generateGrid4BaseImage(
  brief: string,
  visualKit?: unknown,
): Promise<Buffer | null> {
  return runNanoImage(buildGrid4BasePrompt(brief, visualKit), '1:4', { resolution: '1K' });
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
 * Performs an edit-only pass over the four existing copies. Labels are excluded
 * from the model prompt and rendered deterministically by the server afterwards.
 */
export async function generateGrid4FromReference(
  brief: string,
  referenceUrl: string,
  visualKit?: unknown,
): Promise<Buffer | null> {
  const { cleanBrief, labels } = parseGrid4Brief(brief);
  const brandStyle = buildPanoramaBrandStyle(visualKit);
  const variantDirection = labels.length === 4
    ? 'Apply these four visual traits from left to right, but never render the words themselves: ' + labels.join(' | ')
    : 'Infer exactly four requested visual states and apply one state to each existing copy from left to right.';

  const productionPrompt = [
    'STRICT IMAGE EDIT. Modify the supplied image in place. Do not redesign or recompose it.',
    'The input already contains four full-height, pixel-identical copies of one composition.',
    'Keep exactly those four existing copies in exactly their current positions.',
    'Do not add, remove, duplicate, crop, resize, or move any subject or object.',
    'Do not create a second row, close-up, portrait, thumbnail, inset, comparison sheet, card, diagram, poster, or character sheet.',
    'Preserve the exact camera, crop, pose, perspective, scale, silhouette, horizon, background geometry, and vertical anchors.',
    'Every corresponding feature must remain at the same height in all four copies.',
    variantDirection,
    'Change only surface appearance and the explicitly requested state: color, material, clothing, lighting, weather, mood, or other requested visual attributes.',
    'Render no text, labels, letters, numbers, captions, logos, badges, guides, borders, separators, or watermarks.',
    'CREATIVE BRIEF WITHOUT LABEL INSTRUCTIONS:',
    cleanBrief,
    ...(brandStyle
      ? [
          'MANDATORY CHANNEL BRAND ART DIRECTION:',
          brandStyle,
        ]
      : []),
  ].join('\n');

  return runNanoImage(productionPrompt, 'match_input_image', {
    resolution: '4K',
    imageInput: [referenceUrl],
  });
}

// ─── Per-column grid4 pipeline ───────────────────────────────────────────────
// Four cheap 1K calls: one base column (= variant #1) plus three single-figure
// edits. The server assembles the square, so the model never has to respect an
// invisible 4-column layout — the failure mode of the sheet-based approaches.

const GRID4_ORDINALS = ['first', 'second', 'third', 'fourth'];

export function buildGrid4ColumnBasePrompt(brief: string, visualKit?: unknown): string {
  const { cleanBrief, labels } = parseGrid4Brief(brief);
  const brandStyle = buildPanoramaBrandStyle(visualKit);
  const target = labels.length === 4
    ? 'Render specifically this variant: ' + labels[0] + '.'
    : 'Render the FIRST of the four distinct variants implied by the brief.';
  return [
    'Create ONE tall 1:4 portrait image containing exactly ONE complete subject.',
    'CREATIVE BRIEF (four variants will be produced as separate images):',
    cleanBrief,
    target,
    'COMPOSITION RULES:',
    '- Exactly one full subject filling the full height: its top near the top edge, its base near the bottom edge, centered horizontally.',
    '- No duplicates, close-ups, insets, alternate views, panels, grids, or comparison layouts.',
    '- One continuous, softly detailed background that stays consistent from top to bottom.',
    '- The image will be cut into four equal horizontal segments at 25%, 50% and 75% height: keep eyes, hands, joints and other critical details away from those heights.',
    '- Polished finished artwork. No text, letters, numbers, captions, logos, or watermarks.',
    ...(brandStyle ? ['MANDATORY CHANNEL BRAND ART DIRECTION:', brandStyle] : []),
  ].join('\n');
}

/** Generates the 1:4 base column at 1K — it doubles as variant #1. */
export async function generateGrid4ColumnBase(brief: string, visualKit?: unknown): Promise<Buffer | null> {
  return runNanoImage(buildGrid4ColumnBasePrompt(brief, visualKit), '1:4', { resolution: '1K' });
}

export function buildGrid4ColumnVariantPrompt(brief: string, variantIndex: number, visualKit?: unknown): string {
  const { cleanBrief, labels } = parseGrid4Brief(brief);
  const brandStyle = buildPanoramaBrandStyle(visualKit);
  const target = labels.length === 4
    ? 'Transform it into this variant: ' + labels[variantIndex] + '.'
    : 'Transform it into the ' + GRID4_ORDINALS[variantIndex] + ' of the four distinct variants implied by the brief.';
  return [
    'STRICT IMAGE EDIT of the supplied tall portrait. It contains exactly one subject.',
    target,
    'CREATIVE BRIEF:',
    cleanBrief,
    'EDIT RULES:',
    '- Keep the exact camera, crop, scale, position, pose, and overall silhouette of the subject.',
    '- Every major part of the subject must stay at the same height as in the input image.',
    '- Keep the same background structure and lighting direction; restyle surfaces, materials, colors, mood, and details that express the requested variant.',
    '- Exactly one subject. Do not add duplicates, close-ups, insets, panels, borders, or any layout elements.',
    '- No text, letters, numbers, captions, logos, or watermarks.',
    ...(brandStyle ? ['MANDATORY CHANNEL BRAND ART DIRECTION:', brandStyle] : []),
  ].join('\n');
}

/** Edits the base column into variant #variantIndex (1..3) at 1K. */
export async function generateGrid4ColumnVariant(
  brief: string,
  variantIndex: number,
  baseColumnUrl: string,
  visualKit?: unknown,
): Promise<Buffer | null> {
  return runNanoImage(buildGrid4ColumnVariantPrompt(brief, variantIndex, visualKit), 'match_input_image', {
    resolution: '1K',
    imageInput: [baseColumnUrl],
  });
}

/** Places the four columns side by side into one deterministic square. */
export async function assembleGrid4Columns(
  columns: Buffer[],
  columnWidth = 512,
  height = 2048,
): Promise<Buffer> {
  const resized = await Promise.all(columns.map(column =>
    sharp(column).resize({ width: columnWidth, height, fit: 'cover', position: 'centre' }).png().toBuffer()));
  return sharp({
    create: { width: columnWidth * columns.length, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite(resized.map((input, index) => ({ input, left: index * columnWidth, top: 0 })))
    .png()
    .toBuffer();
}

function fullWidthVerticalProfile(data: Buffer, width: number, height: number): number[] {
  const profile: number[] = [];
  for (let y = 1; y < height; y++) {
    let total = 0;
    for (let x = 0; x < width; x++) total += Math.abs(data[y * width + x] - data[(y - 1) * width + x]);
    profile.push(total / width);
  }
  return profile;
}

function horizontalEdgeProfile(data: Buffer, width: number, rowStart: number, rowEnd: number): number[] {
  const profile: number[] = [];
  for (let x = 1; x < width; x++) {
    let total = 0;
    for (let y = rowStart; y < rowEnd; y++) total += Math.abs(data[y * width + x] - data[y * width + x - 1]);
    profile.push(total / Math.max(1, rowEnd - rowStart));
  }
  return profile;
}

/**
 * Verifies an edited column against the base column: overall vertical geometry
 * plus edge alignment inside a thin strip around each 25/50/75% cut line, so a
 * head from one column keeps docking onto a torso from another. Gradient-based
 * profiles are invariant to the restyle itself (color/material changes pass;
 * pose, scale, or position drift fails). Deterministic — no model calls.
 */
export async function validateGrid4Column(
  base: Buffer,
  candidate: Buffer,
): Promise<{ ok: boolean; reason?: string }> {
  const width = 96;
  const height = 384;
  const [a, b] = await Promise.all([base, candidate].map(buffer =>
    sharp(buffer).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer()));

  const overall = profileCorrelation(fullWidthVerticalProfile(a, width, height), fullWidthVerticalProfile(b, width, height));
  if (overall < 0.25) {
    return { ok: false, reason: 'variant lost the base column geometry (profile correlation ' + overall.toFixed(2) + ')' };
  }

  for (const line of [1, 2, 3]) {
    const y = Math.round(height * line / 4);
    const strip = 8;
    const corr = profileCorrelation(
      horizontalEdgeProfile(a, width, y - strip, y + strip),
      horizontalEdgeProfile(b, width, y - strip, y + strip));
    if (corr < 0.2) {
      return { ok: false, reason: 'silhouette mismatch at the ' + (line * 25) + '% cut line (correlation ' + corr.toFixed(2) + ')' };
    }
  }

  return { ok: true };
}

function profileCorrelation(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let numerator = 0;
  let denominatorA = 0;
  let denominatorB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denominatorA += da * da;
    denominatorB += db * db;
  }
  const denominator = Math.sqrt(denominatorA * denominatorB);
  return denominator > 0 ? numerator / denominator : 0;
}

function verticalStructureProfile(data: Buffer, width: number, height: number, column: number): number[] {
  const left = Math.floor(width * column / 4);
  const right = Math.floor(width * (column + 1) / 4);
  const profile: number[] = [];
  for (let y = 1; y < height; y++) {
    let total = 0;
    for (let x = left; x < right; x++) {
      total += Math.abs(data[y * width + x] - data[(y - 1) * width + x]);
    }
    profile.push(total / Math.max(1, right - left));
  }
  return profile;
}

/**
 * Rejects obvious presentation/contact-sheet layouts before any slicing.
 * It never retries automatically, so a failed quality gate cannot create another
 * paid prediction behind the user's back.
 */
export async function validateGrid4Structure(
  reference: Buffer,
  candidate: Buffer,
): Promise<{ ok: boolean; reason?: string }> {
  const size = 128;
  const [referenceRaw, candidateRaw] = await Promise.all([
    sharp(reference).resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer(),
    sharp(candidate).resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer(),
  ]);

  // A contact sheet normally introduces a near-full-width hard row boundary.
  for (let y = 8; y < size - 8; y++) {
    let changed = 0;
    let totalDelta = 0;
    for (let x = 0; x < size; x++) {
      const delta = Math.abs(candidateRaw[y * size + x] - candidateRaw[(y - 1) * size + x]);
      totalDelta += delta;
      if (delta >= 28) changed++;
    }
    if (changed / size >= 0.72 && totalDelta / size >= 32) {
      return { ok: false, reason: 'detected an extra horizontal presentation row' };
    }
  }

  const referenceProfile = verticalStructureProfile(referenceRaw, size, size, 0);
  const correlations = [0, 1, 2, 3].map(column =>
    profileCorrelation(referenceProfile, verticalStructureProfile(candidateRaw, size, size, column)));
  const averageCorrelation = correlations.reduce((sum, value) => sum + value, 0) / correlations.length;
  if (averageCorrelation < 0.12 || correlations.some(value => value < -0.1)) {
    return { ok: false, reason: 'the edited columns no longer match the reference geometry' };
  }

  return { ok: true };
}

function escapeSvgText(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[char] ?? char));
}

/** Draws exact requested labels after generation so text cannot alter composition. */
export async function overlayGrid4Labels(image: Buffer, labels: string[]): Promise<Buffer> {
  if (labels.length !== 4) return image;
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 4 || height < 4) return image;

  const side = Math.min(width, height);
  const left = Math.floor((width - side) / 2);
  const top = Math.floor((height - side) / 2);
  const columnWidth = side / 4;
  const fontSize = Math.max(24, Math.round(side * 0.034));
  const boxHeight = Math.round(fontSize * 1.55);
  const boxY = Math.round(side * 0.025);
  const boxInset = Math.round(columnWidth * 0.08);
  const labelSvg = labels.map((label, index) => {
    const x = Math.round(index * columnWidth + boxInset);
    const center = Math.round((index + 0.5) * columnWidth);
    const boxWidth = Math.round(columnWidth - boxInset * 2);
    return '<rect x="' + x + '" y="' + boxY + '" width="' + boxWidth + '" height="' + boxHeight +
      '" rx="' + Math.round(boxHeight / 4) + '" fill="rgba(12,12,16,0.78)" stroke="rgba(255,255,255,0.28)" stroke-width="' +
      Math.max(2, Math.round(side / 1500)) + '"/><text x="' + center + '" y="' + Math.round(boxY + boxHeight * 0.69) +
      '" text-anchor="middle" font-family="Arial,DejaVu Sans,sans-serif" font-size="' + fontSize +
      '" font-weight="700" fill="#ffffff">' + escapeSvgText(label) + '</text>';
  }).join('');

  const overlay = Buffer.from(
    '<svg width="' + side + '" height="' + side + '" xmlns="http://www.w3.org/2000/svg">' + labelSvg + '</svg>');
  return sharp(image)
    .extract({ left, top, width: side, height: side })
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
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
  orientation: 'horizontal' | 'vertical',
  count: number,
  upscaleTo = 1080,
): Promise<Buffer[]> {
  const meta = await sharp(buffer).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  if (W < 2 || H < 2) return [];
  const n = Math.min(Math.max(count, 2), 8);
  const sw = Math.floor(W / n), sh = Math.floor(H / n);
  const out: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const region = orientation === 'vertical'
      ? { left: 0,      top: sh * i, width: W, height: i === n - 1 ? H - sh * i : sh }
      : { left: sw * i, top: 0,      width: i === n - 1 ? W - sw * i : sw, height: H };
    let pipe = sharp(buffer).extract(region);
    if (region.width < upscaleTo) pipe = pipe.resize({ width: upscaleTo });
    out.push(await pipe.png().toBuffer());
  }
  return out;
}
