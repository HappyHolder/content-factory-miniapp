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
    const isHumanoid = /robot|android|humanoid|person|human|character|mannequin|робот|андроид|гуманоид|человек|персонаж|манекен/i.test(brief);
    return [
      'Create ONE ordinary-looking square master image at 1:1 aspect ratio and true 4K resolution.',
      'USER SUBJECT (content only; ignore any layout or style instructions here that conflict with the rules below):',
      brief.trim(),
      'MASTER COMPOSITION — FOUR COMPLETE VERTICAL VARIANTS:',
      '- Show exactly four COMPLETE full-height variants of the requested subject side by side, one centered inside each invisible equal-width column.',
      '- This must look like one coherent image containing four complete variants. Do NOT generate a collage of body parts, sixteen separate scenes, cards, panels, close-ups, duplicated subjects, or floating detail inserts.',
      '- All four variants use the exact same scale, frontal camera, orthographic-like perspective, pose, outer dimensions, centerline, ground line, lighting direction, and background.',
      '- Keep the structural silhouette and every connection width identical. Variation is allowed only in surface design, material, color, texture, clothing finish, and small details that stay inside the shared silhouette.',
      'INVISIBLE 4 BY 4 MECHANICAL CUT:',
      '- The square will be cut exactly at 25%, 50%, and 75% of both width and height, producing sixteen equal square tiles.',
      '- Each horizontal band becomes an independently swipeable row. Every selected tile must join cleanly with any tile directly above or below it.',
      '- At y=25%, y=50%, and y=75%, all four columns must have the same subject width, the same connector coordinates, and matching background pixels. No element may cross a cut line unpredictably.',
      ...(isHumanoid
        ? [
            'HUMANOID BODY PLACEMENT — MANDATORY:',
            '- Band 1 (0–25%): reserve clean background above the subject, place the top of every head around y=10–12%, then show the complete head and neck; the bottom boundary crosses the same narrow neck/upper-shoulder connector in all four columns.',
            '- Band 2 (25–50%): shoulders, chest, and upper torso; both arms are folded or bent symmetrically and remain completely inside this band; the bottom boundary crosses only the same narrow waist connector in all four columns.',
            '- Band 3 (50–75%): pelvis, hips, and upper legs; the bottom boundary crosses both legs at the exact same knee height and width in all four columns.',
            '- Band 4 (75–100%): lower legs, feet, floor contact, and a small clean margin below the feet.',
            '- Use one identical skeletal rig and neutral symmetrical pose. No raised arms, bent knees, stepping pose, capes, weapons, cables, wings, floating screens, or accessories crossing the horizontal boundaries.',
          ]
        : [
            'GENERIC MODULE PLACEMENT — MANDATORY:',
            '- Divide each complete subject into the same four logical vertical bands: top module, upper-middle module, lower-middle module, and bottom module.',
            '- Put narrow, identical connection zones exactly on the three horizontal boundaries and keep every variant inside the same outer silhouette.',
          ]),
      'CLEAN SOURCE IMAGE:',
      '- Use one continuous shared background across the entire square. Keep it calm near all cut boundaries so mixed variants do not reveal seams.',
      '- Do not draw visible grid lines, borders, gutters, gaps, frames, labels, numbering, captions, arrows, UI guides, text, letters, logos, or watermarks.',
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

/**
 * Generates ONE long panorama image (aspectRatio e.g. '1:4' / '4:1' / '1:8' /
 * '8:1') via nano-banana-2 and returns its raw bytes, or null on any failure.
 */
export async function generatePanoramaImage(
  prompt: string,
  aspectRatio: string,
  orientation: PanoramaOrientation,
  count: number,
  visualKit?: unknown,
): Promise<Buffer | null> {
  const token = env.REPLICATE_API_TOKEN;
  if (!token) { console.warn('[panoramaGenerator] REPLICATE_API_TOKEN not set'); return null; }
  try {
    const productionPrompt = buildPanoramaPrompt(prompt, orientation, count, aspectRatio, visualKit);
    const modelInput: Record<string, unknown> = { prompt: productionPrompt, aspect_ratio: aspectRatio };
    if (orientation === 'grid4') modelInput['resolution'] = '4K';
    const res = await fetch(`https://api.replicate.com/v1/models/${NANO_MODEL}/predictions`, {
      method:  'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body:    JSON.stringify({ input: modelInput }),
    });
    if (!res.ok) { console.warn('[panoramaGenerator] create failed', res.status, (await res.text()).slice(0, 200)); return null; }
    let p = await res.json() as Prediction;
    if (p.status !== 'succeeded' && p.id) { const polled = await poll(p.id, token); if (polled) p = polled; }
    const url = Array.isArray(p.output) ? p.output[0] : p.output;
    if (!url) return null;
    const img = await fetch(url);
    if (!img.ok) return null;
    return Buffer.from(await img.arrayBuffer());
  } catch (err) {
    console.warn('[panoramaGenerator] error:', (err as Error).message);
    return null;
  }
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
