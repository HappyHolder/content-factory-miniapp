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
━━━ TEMPLATE LAYOUT TO FOLLOW (this is the channel's chosen design — keep its structure) ━━━
${bodyStructure}`;

  const contentLines = [`Headline: "${input.headline}"`];
  if (input.subheadline) contentLines.push(`Subheadline: "${input.subheadline}"`);
  if (input.stat)        contentLines.push(`Key metric: "${input.stat}"`);
  if (input.category)    contentLines.push(`Category: "${input.category}"`);
  const postBodyBlock = input.postContent
    ? `\nFULL POST TEXT:\n${input.postContent.slice(0, 2000)}`
    : '';
  const hasArt = !!input.artDirection;
  const artDirectionBlock = hasArt
    ? `\n━━━ USER ART DIRECTION — TOP PRIORITY, OVERRIDES THE TEMPLATE LAYOUT ━━━\n${input.artDirection!.slice(0, 600)}`
    : '';

  const systemPrompt = `You are an expert HTML/CSS designer producing a social-media cover for a post, using the channel's TEMPLATE for visual style. When the user gives explicit art direction, it dictates the composition; otherwise you faithfully follow the template's layout. You return ONLY raw HTML with no markdown, no explanation, no code fences.`;

  // Layout rule flips based on whether the user gave explicit art direction.
  const layoutRule = hasArt
    ? `2. The USER ART DIRECTION above is the TOP priority and OVERRIDES the template's layout. Build exactly the composition the user describes (what goes in the center, what at the bottom, how many elements, minimalism, etc.). Use the template ONLY for visual style — its colors, fonts, effects, and icon look — NOT its structure. Drop any template blocks the user did not ask for.`
    : `2. FOLLOW the template layout above: keep its structure, section order, blocks (header, cards, stat, footer, etc.) and overall composition. This is the channel's chosen design — do NOT redesign it. Adapt only the COUNT of repeating elements to the content.`;

  const userPrompt = `Design the cover below using the channel's TEMPLATE for visual style.

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

━━━ YOUR BRIEF ━━━
1. Use the CSS design system above — same colors, fonts, visual effects, icons (embed the CSS in <style>)
${layoutRule}
3. ALL text must come from the post — no placeholder phrases, no invented content/numbers, and no leftover sample text from the template.
4. Keep the template's icon/SVG style; reuse icons only where they fit the chosen composition.
5. Remove <canvas> and <script> tags
6. <body> must be ${w}px × ${h}px, overflow:hidden
7. Return complete HTML starting with <!DOCTYPE html>
8. NO markdown fences, NO explanation — raw HTML only`;

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
            // Low temperature: the model must follow the channel's template
            // faithfully, not improvise a new layout. Variety comes from having
            // multiple rubric templates, not from sampling randomness.
            temperature:   0.4,
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

// ─── AI+HTML hybrid: Sonnet overlay on top of a Flux background ────────────────

export interface HtmlOverlayInput {
  /** Public URL of the clean, text-free Flux background image. */
  bgImageUrl:   string;
  headline:     string;
  subheadline?: string;
  postContent?: string;
  /** Free-text composition wishes from the user (image prompt). */
  artDirection?: string;
  logoUrl?:     string;
  primaryColor: string;
  aspectRatio?: string;
}

/**
 * Generates a transparent HTML/CSS overlay that sits on top of a full-bleed
 * background photo (the Flux image). Sonnet composes a clean, readable, branded
 * layer — dark scrims for legibility, brand accent color, minimal structure.
 * Returns raw HTML, or null on failure.
 */
export async function generateHtmlOverlay(input: HtmlOverlayInput): Promise<string | null> {
  if (!env.REPLICATE_API_TOKEN) {
    console.warn('[htmlOverlay] REPLICATE_API_TOKEN not set');
    return null;
  }

  const { w, h } = dims(input.aspectRatio);

  const contentLines = [`Headline: "${input.headline}"`];
  if (input.subheadline) contentLines.push(`Subheadline: "${input.subheadline}"`);
  const postBodyBlock = input.postContent ? `\nFULL POST TEXT:\n${input.postContent.slice(0, 1500)}` : '';
  const artBlock = input.artDirection ? `\nUSER ART DIRECTION (top priority for composition): ${input.artDirection.slice(0, 400)}` : '';

  const systemPrompt = `You are an expert HTML/CSS designer. You build a clean, readable text-and-graphic overlay that sits ON TOP of a full-bleed background photo. You return ONLY raw HTML with no markdown, no explanation, no code fences.`;

  const userPrompt = `Build the overlay for a social-media cover. There is a full-bleed BACKGROUND PHOTO behind it (URL below) — your job is the readable branded layer on top.

BACKGROUND IMAGE URL: ${input.bgImageUrl}
BRAND PRIMARY COLOR: ${input.primaryColor}
${input.logoUrl ? `LOGO URL: ${input.logoUrl}` : ''}

━━━ THIS POST ━━━
${contentLines.join('\n')}${postBodyBlock}${artBlock}

━━━ BRIEF ━━━
1. <body> is ${w}px × ${h}px, position:relative, overflow:hidden, margin:0.
2. Set the body background to the photo, covering the whole canvas:
   background: #0b0b0f url('${input.bgImageUrl}') center/cover no-repeat;
3. Add dark gradient SCRIMS (e.g. linear-gradient(to top, rgba(0,0,0,.85), rgba(0,0,0,.15))) UNDER the text so EVERY word is fully readable on any photo. Readability is the #1 rule.
4. Compose a clean, minimal, branded layout: a strong punchy headline, optional one-line subheadline, and the channel handle/logo. Use the brand primary color only for small accents (a bar, a word, a tag).
5. Let the photo breathe — keep large areas of it visible; do NOT cover the whole image with panels.
6. ALL text must come from the post. No invented numbers or metrics. Keep the headline short (a few words).
7. Embed all CSS in <style>. No <script>, no <canvas>.
8. Return complete HTML starting with <!DOCTYPE html>. NO markdown fences, raw HTML only.`;

  try {
    const createRes = await fetch(
      `https://api.replicate.com/v1/models/${env.COVER_HTML_MODEL}/predictions`,
      {
        method:  'POST',
        headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { prompt: userPrompt, system_prompt: systemPrompt, max_tokens: 4096, temperature: 0.6 } }),
      },
    );
    if (!createRes.ok) {
      console.warn(`[htmlOverlay] Create failed: HTTP ${createRes.status}`);
      return null;
    }

    const prediction = await createRes.json() as Prediction;
    let raw: string | null = null;
    if (prediction.status === 'succeeded') raw = joinOutput(prediction.output) || null;
    else if (prediction.status === 'failed' || prediction.status === 'canceled') return null;
    else if (prediction.id) raw = await pollText(prediction.id, env.REPLICATE_API_TOKEN);
    if (!raw) return null;

    const html = raw.replace(/^```html?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!html.includes('<body') && !html.startsWith('<!')) return null;

    console.log(`[htmlOverlay] Generated ${html.length}-char overlay (${w}×${h}) over Flux bg`);
    return html;
  } catch (err) {
    console.warn('[htmlOverlay] Error:', (err as Error).message);
    return null;
  }
}
