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
export async function generatePanoramaImage(prompt: string, aspectRatio: string): Promise<Buffer | null> {
  const token = env.REPLICATE_API_TOKEN;
  if (!token) { console.warn('[panoramaGenerator] REPLICATE_API_TOKEN not set'); return null; }
  try {
    const res = await fetch(`https://api.replicate.com/v1/models/${NANO_MODEL}/predictions`, {
      method:  'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body:    JSON.stringify({ input: { prompt, aspect_ratio: aspectRatio } }),
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
