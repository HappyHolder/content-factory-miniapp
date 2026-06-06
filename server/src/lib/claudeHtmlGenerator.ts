/**
 * claudeHtmlGenerator.ts
 *
 * Generates a new unique HTML cover for each post using the user's templates
 * as a design system reference via Claude Haiku on Replicate.
 *
 * Strategy: extract the CSS from the reference template (exact colors, effects,
 * component styles) → send to Haiku → ask it to write a NEW <body> using those
 * same CSS classes in a fresh composition for the specific post content.
 *
 * Result: different layout per post, identical visual language per channel.
 */

import { env } from '../env';

export interface HtmlCoverInput {
  referenceHtml:  string;
  headline:       string;
  subheadline?:   string;
  stat?:          string;
  category?:      string;
  logoUrl?:       string;
  primaryColor:   string;
  bgColor:        string;
  aspectRatio?:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dims(ratio?: string): { w: number; h: number } {
  switch (ratio) {
    case '16:9': return { w: 1080, h: 607  };
    case '4:5':  return { w: 1080, h: 1350 };
    case '9:16': return { w: 607,  h: 1080 };
    default:     return { w: 1080, h: 1080 };
  }
}

/** Extracts everything inside the first <style> block */
function extractCss(html: string): string {
  const m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  return m ? m[1].trim() : '';
}

/** Extracts the <body> content, strips canvas/script tags (keep static structure) */
function extractBodyStructure(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return '';
  return bodyMatch[1]
    .replace(/<canvas[^>]*>[\s\S]*?<\/canvas>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim();
}

// ─── Replicate polling ────────────────────────────────────────────────────────

interface Prediction {
  id:     string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | string[] | null;
  error:  string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function joinOutput(output: string | string[] | null): string {
  if (!output) return '';
  return Array.isArray(output) ? output.join('') : output;
}

async function pollText(id: string, token: string, timeoutMs = 90_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3_000);
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) return null;
    const p = await res.json() as Prediction;
    if (p.status === 'succeeded') return joinOutput(p.output) || null;
    if (p.status === 'failed' || p.status === 'canceled') {
      console.warn(`[htmlCoverGenerator] Prediction ${p.status}: ${p.error ?? ''}`);
      return null;
    }
  }
  console.warn('[htmlCoverGenerator] Polling timed out');
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateHtmlCover(input: HtmlCoverInput): Promise<string | null> {
  if (!env.REPLICATE_API_TOKEN) {
    console.warn('[htmlCoverGenerator] REPLICATE_API_TOKEN not set');
    return null;
  }

  const { w, h } = dims(input.aspectRatio);
  const css = extractCss(input.referenceHtml);
  if (!css) {
    console.warn('[htmlCoverGenerator] No <style> block found in reference HTML');
    return null;
  }
  const bodyStructure = extractBodyStructure(input.referenceHtml);

  const contentLines = [`Headline: "${input.headline}"`];
  if (input.subheadline) contentLines.push(`Subheadline: "${input.subheadline}"`);
  if (input.stat)        contentLines.push(`Key metric: "${input.stat}"`);
  if (input.category)    contentLines.push(`Category: "${input.category}"`);

  const systemPrompt = `You are an expert HTML/CSS web designer specializing in social media cover images. You write clean, valid HTML that renders pixel-perfectly in a headless browser. Return ONLY raw HTML — no markdown, no explanation, no code fences.`;

  const userPrompt = `You are editing an HTML cover image. Your ONLY job is to update text content for a new post. Keep everything else exactly as-is.

ORIGINAL HTML (complete file to edit):
<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><style>
${css}
</style></head><body>
${bodyStructure}
</body></html>

NEW POST CONTENT:
${contentLines.join('\n')}
${input.logoUrl ? `Logo URL: ${input.logoUrl}` : ''}

INSTRUCTIONS — follow these EXACTLY:
1. Keep ALL HTML tags, attributes, CSS classes, and structure identical to the original
2. Keep ALL SVG icons exactly as they are — do not modify any <svg> elements
3. Keep ALL CSS class names — do not add or remove any classes
4. ONLY change visible text content inside elements to reflect the new post
5. Update: headlines, taglines, stat numbers, labels, descriptions, badge text, bottom text
6. Remove <canvas> elements and <script> tags if present
7. body must be ${w}px × ${h}px, overflow:hidden (already set in CSS — do not change)
8. Return the complete modified HTML file starting with <!DOCTYPE html>
9. NO markdown fences, NO explanation — raw HTML only`;

  try {
    const createRes = await fetch(
      `https://api.replicate.com/v1/models/${env.COVER_HTML_MODEL}/predictions`,
      {
        method:  'POST',
        headers: {
          Authorization: `Token ${env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: {
            prompt:        userPrompt,
            system_prompt: systemPrompt,
            max_tokens:    4096,
          },
        }),
      },
    );

    if (!createRes.ok) {
      const body = await createRes.text();
      console.warn(`[htmlCoverGenerator] Create failed: HTTP ${createRes.status} — ${body.slice(0, 200)}`);
      return null;
    }

    const prediction = await createRes.json() as Prediction;

    let raw: string | null = null;
    if (prediction.status === 'succeeded') {
      raw = joinOutput(prediction.output) || null;
    } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
      console.warn(`[htmlCoverGenerator] Failed immediately: ${prediction.status}`);
      return null;
    } else if (prediction.id) {
      raw = await pollText(prediction.id, env.REPLICATE_API_TOKEN);
    }

    if (!raw) return null;

    // Strip markdown fences if model added them
    const html = raw
      .replace(/^```html?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    if (!html.includes('<body') && !html.startsWith('<!')) {
      console.warn('[htmlCoverGenerator] Response does not look like HTML');
      return null;
    }

    console.log(`[htmlCoverGenerator] Generated ${html.length}-char cover (${w}×${h}) via ${env.COVER_HTML_MODEL}`);
    return html;

  } catch (err) {
    console.warn('[htmlCoverGenerator] Error:', (err as Error).message);
    return null;
  }
}
