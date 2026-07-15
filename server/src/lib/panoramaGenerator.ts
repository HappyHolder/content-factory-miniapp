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

export type PanoramaOrientation = 'horizontal' | 'vertical';
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
  const frames = Math.min(Math.max(Math.round(count), 2), 8);
  const direction = orientation === 'vertical'
    ? 'top to bottom through an ultra-tall canvas'
    : 'left to right through an ultra-wide canvas';
  const seamDirection = orientation === 'vertical'
    ? 'horizontal cut lines'
    : 'vertical cut lines';
  const brandStyle = buildPanoramaBrandStyle(visualKit);

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
    const res = await fetch(`https://api.replicate.com/v1/models/${NANO_MODEL}/predictions`, {
      method:  'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body:    JSON.stringify({ input: { prompt: productionPrompt, aspect_ratio: aspectRatio } }),
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
 * Cuts one image into `count` equal pieces (2–8): 'vertical' → horizontal strips
 * (stacked), 'horizontal' → vertical strips (carousel). Each slice is upscaled so
 * its width reaches `upscaleTo` (crisp on Telegram). The last slice absorbs the
 * rounding remainder so nothing is cropped.
 */
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
