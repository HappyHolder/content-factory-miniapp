/**
 * imagePlanner.ts
 *
 * Decides, per post, HOW MANY images to make and the ROLE + ENGINE of each — the
 * "per-image engine" idea: an illustration is raw AI generation, a pull-quote is
 * an HTML template card, etc. The executor (draftGenerator) then renders each
 * spec with the right engine and feeds the URLs into the layout.
 *
 * Pure + safe: one unified primary-model call, strict JSON, capped to maxImages, and a
 * sensible 1-image fallback. Never throws.
 */

import { env } from '../env';
import { terraText } from './assistantModel';

export type ImageEngine = 'ai' | 'template';
export type ImageRole = 'cover' | 'illustration' | 'quote_card';

export interface ImageSpec {
  role:    ImageRole;
  engine:  ImageEngine;   // 'ai' = Flux/GPT illustration; 'template' = HTML card
  /** Art-direction prompt for AI illustrations (English, scene only — no text). */
  prompt?: string;
  /** The quotation text for a quote_card (verbatim from the post). */
  quote?:  string;
  /** Optional attribution for a quote_card (author/handle). */
  author?: string;
}

interface AiPlan { images?: ImageSpec[] }

function buildPrompt(postText: string, maxImages: number, rubric: string | null): { system: string; user: string } {
  const system =
    'You plan the images for a Telegram post. Decide how many images genuinely help (1 to ' + maxImages + ') and the role + engine of each. ' +
    'Engines: "ai" = a generated illustration (give a short ENGLISH art-direction "prompt" describing the SCENE only, no text/letters in the image); ' +
    '"template" = a styled HTML card — use ONLY for a strong pull-quote, with the verbatim "quote" (and "author" if present in the post). ' +
    'Rules: the FIRST image is the cover (role "cover"). Prefer fewer images; add an illustration only when the post is long/visual, and a quote_card only when there is a genuinely quotable line. Never invent quotes or facts. ' +
    'Output STRICT JSON: {"images":[{"role":"cover|illustration|quote_card","engine":"ai|template","prompt":"...","quote":"...","author":"..."}]}. ' +
    'Max ' + maxImages + ' images.';
  const user = (rubric ? `Rubric: ${rubric}\n` : '') + `POST TEXT:\n${postText}\n\nReturn the image plan JSON.`;
  return { system, user };
}

function sanitize(plan: AiPlan, maxImages: number): ImageSpec[] {
  const raw = Array.isArray(plan.images) ? plan.images : [];
  const out: ImageSpec[] = [];
  for (const s of raw.slice(0, Math.max(1, maxImages))) {
    if (!s || typeof s !== 'object') continue;
    const engine: ImageEngine = s.engine === 'template' ? 'template' : 'ai';
    const role: ImageRole = s.role === 'quote_card' ? 'quote_card' : s.role === 'illustration' ? 'illustration' : 'cover';
    if (engine === 'template') {
      const quote = typeof s.quote === 'string' ? s.quote.trim() : '';
      if (!quote) continue; // a template card without a quote is useless
      out.push({ role: 'quote_card', engine: 'template', quote, author: typeof s.author === 'string' ? s.author : undefined });
    } else {
      out.push({ role, engine: 'ai', prompt: typeof s.prompt === 'string' ? s.prompt : undefined });
    }
  }
  // Always at least one cover image.
  if (out.length === 0) out.push({ role: 'cover', engine: 'ai' });
  return out;
}

/**
 * Returns the image plan for a post. `maxImages` is the per-tier cap; the engine
 * may choose fewer. Falls back to a single AI cover if the AI is unavailable.
 */
export async function planPostImages(input: {
  postText: string; rubric?: string | null; maxImages: number;
}): Promise<ImageSpec[]> {
  const cap = Math.max(1, Math.min(input.maxImages, 6));
  if (!env.OPENAI_API_KEY) return [{ role: 'cover', engine: 'ai' }];

  const { system, user } = buildPrompt(input.postText, cap, input.rubric ?? null);
  try {
    const raw = await terraText({
      system,
      prompt: user,
      maxTokens: 800,
      timeoutMs: 25_000,
      effort: 'low',
    });
    return sanitize(JSON.parse(raw ?? '{}') as AiPlan, cap);
  } catch (err) {
    console.error('[imagePlanner] failed:', (err as Error).message);
    return [{ role: 'cover', engine: 'ai' }];
  }
}
