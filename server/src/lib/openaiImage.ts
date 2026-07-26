/**
 * openaiImage.ts
 *
 * Direct OpenAI Images API for cover generation — replaces renting the same
 * gpt-image model through Replicate. Two endpoints:
 *   /v1/images/generations — text → image
 *   /v1/images/edits       — text + reference image (our img2img brand path)
 *
 * gpt-image models answer with base64, not a URL, so this returns a Buffer and
 * the caller composites straight from bytes. Never throws; returns null so cover
 * generation stays non-fatal.
 *
 * Size, not aspect_ratio: the direct API takes explicit `WxH`. Both edges must be
 * multiples of 16 and the ratio must stay inside 3:1 — which is why panoramas
 * (1:4 / 4:1 / 1:8 / 8:1) cannot use this and stay on nano-banana.
 */

import { env } from '../env';

const GENERATIONS_URL = 'https://api.openai.com/v1/images/generations';
const EDITS_URL = 'https://api.openai.com/v1/images/edits';

/** Cover aspect ratios → pixel sizes. Every edge is a multiple of 16. */
const SIZE_BY_RATIO: Record<string, string> = {
  '1:1':  '1024x1024',
  '16:9': '1536x864',
  '4:5':  '1024x1280',
  '9:16': '864x1536',
};

export type CoverAspectRatio = '1:1' | '16:9' | '4:5' | '9:16';

export const sizeForAspectRatio = (ratio: string): string => SIZE_BY_RATIO[ratio] ?? SIZE_BY_RATIO['1:1']!;

export interface OpenAiImageParams {
  prompt: string;
  aspectRatio: CoverAspectRatio;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  /** Brand reference image (public URL). Switches the call to /images/edits. */
  referenceImageUrl?: string | null;
  model?: string;
  timeoutMs?: number;
}

interface ImagesResponse { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } }

/** Pulls the bytes out of an Images API response (base64 first, URL as a fallback). */
async function bytesOf(data: ImagesResponse): Promise<Buffer | null> {
  const first = data.data?.[0];
  if (!first) return null;
  if (typeof first.b64_json === 'string' && first.b64_json) return Buffer.from(first.b64_json, 'base64');
  if (typeof first.url === 'string' && first.url) {
    const res = await fetch(first.url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  return null;
}

/** Downloads a reference image so it can be uploaded as multipart. */
async function referenceBytes(url: string): Promise<{ buf: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) { console.warn(`[openAiImage] reference fetch HTTP ${res.status}`); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.toLowerCase() ?? '';
    const mime = ['image/png', 'image/jpeg', 'image/webp'].includes(contentType) ? contentType : 'image/png';
    return buf.length ? { buf, mime } : null;
  } catch (err) {
    console.warn('[openAiImage] reference fetch failed:', (err as Error).message);
    return null;
  }
}

const extensionOf = (mime: string) => (mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png');

/**
 * Generates one cover image. With `referenceImageUrl` the brand reference is
 * uploaded to /images/edits so the palette and mood carry over; without it this
 * is a plain text→image generation.
 */
export async function openAiImage(p: OpenAiImageParams): Promise<Buffer | null> {
  if (!env.OPENAI_API_KEY) return null;
  const model = p.model ?? env.OPENAI_IMAGE_MODEL;
  const size = sizeForAspectRatio(p.aspectRatio);
  const quality = p.quality ?? 'medium';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), p.timeoutMs ?? env.IMAGE_GENERATION_POLL_TIMEOUT_MS);
  try {
    const reference = p.referenceImageUrl ? await referenceBytes(p.referenceImageUrl) : null;
    let res: Response;

    if (reference) {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', p.prompt);
      form.append('size', size);
      form.append('quality', quality);
      form.append('image', new Blob([new Uint8Array(reference.buf)], { type: reference.mime }), `reference.${extensionOf(reference.mime)}`);
      res = await fetch(EDITS_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
      });
    } else {
      res = await fetch(GENERATIONS_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: p.prompt, size, quality, n: 1 }),
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[openAiImage] HTTP ${res.status} (${reference ? 'edits' : 'generations'}, size=${size}): ${body.slice(0, 300)}`);
      return null;
    }
    const buf = await bytesOf(await res.json() as ImagesResponse);
    if (!buf) { console.warn('[openAiImage] response carried no image'); return null; }
    return buf;
  } catch (err) {
    console.warn('[openAiImage] failed:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
