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
  referenceHtml: string;
  headline:      string;
  subheadline?:   string;
  stat?:          string;
  category?:      string;
  /** Full post body text — lets the model extract real facts for feature cards */
  postContent?:   string;
  /** Optional user art direction — free-text layout/composition wishes */
  artDirection?:  string;
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

/** Extracts the <body> content, strips canvas/script tags */
function extractBodyStructure(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return '';
  return bodyMatch[1]
    .replace(/<canvas[^>]*>[\s\S]*?<\/canvas>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim();
}

/** Extracts unique CSS class names used in an HTML body */
function extractClassPalette(html: string): string {
  const classes = new Set<string>();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
  }
  return Array.from(classes).join(' ');
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
  const bodyStructure    = extractBodyStructure(input.referenceHtml);
  const classPalette     = extractClassPalette(bodyStructure);
  const referenceBodyBlock = `
━━━ REFERENCE LAYOUT (component structure — for creative inspiration only, do NOT copy) ━━━
${bodyStructure}`;

  const contentLines = [`Headline: "${input.headline}"`];
  if (input.subheadline) contentLines.push(`Subheadline: "${input.subheadline}"`);
  if (input.stat)        contentLines.push(`Key metric: "${input.stat}"`);
  if (input.category)    contentLines.push(`Category: "${input.category}"`);
  const postBodyBlock = input.postContent
    ? `\nFULL POST TEXT:\n${input.postContent.slice(0, 2000)}`
    : '';
  const artDirectionBlock = input.artDirection
    ? `\n━━━ ART DIRECTION FROM THE USER (follow these layout/composition wishes) ━━━\n${input.artDirection.slice(0, 600)}`
    : '';

  const systemPrompt = `You are a creative art director and HTML/CSS designer. You create unique, original social media cover images. Each cover you design is a fresh composition tailored to the specific post — never a copy of a template. You return ONLY raw HTML with no markdown, no explanation, no code fences.`;

  const userPrompt = `Design an original social media cover image for the post below.

━━━ DESIGN SYSTEM (CSS — colors, fonts, visual effects — use these exactly) ━━━
${css}

━━━ AVAILABLE CSS CLASSES ━━━
${classPalette}
${referenceBodyBlock}

━━━ THIS POST ━━━
${contentLines.join('\n')}
${input.logoUrl ? `Logo URL: ${input.logoUrl}` : ''}
${postBodyBlock}
${artDirectionBlock}

━━━ YOUR CREATIVE BRIEF ━━━
Create a COMPLETELY ORIGINAL cover for this specific post:
1. Use the CSS design system above — same colors, fonts, visual effects, icons (embed the CSS in <style>)
2. The reference layout is ONLY a style sample. Do NOT reuse its structure, element order, or section arrangement. Invent a genuinely different composition for THIS post.
3. Pick a layout archetype that fits the content, and vary it:
   • big number / metric → hero layout with the number dominating
   • list of ideas / features → card grid or numbered stack
   • announcement / quote → bold oversized typography, lots of negative space
   • story / analysis → asymmetric editorial layout
4. Vary the focal point, alignment (left / center / asymmetric), and visual hierarchy between covers — never default to the same arrangement twice.
5. ALL text must come from the post — no placeholder phrases, no invented content
6. If the post has specific numbers or facts, make them visually prominent
7. Reuse the icon/SVG components from the design system where they reinforce the message
8. Remove <canvas> and <script> tags
9. <body> must be ${w}px × ${h}px, overflow:hidden
10. Return complete HTML starting with <!DOCTYPE html>
11. NO markdown fences, NO explanation — raw HTML only`;

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
            // High temperature so two similar posts don't collapse to the same
            // layout — pushes the model to vary the composition each time.
            temperature:   1,
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
