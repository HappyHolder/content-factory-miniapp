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
5. Do NOT add emoji or Unicode pictographs that are not already in the template — the render server has no emoji font and they come out as empty boxes. Prefer the template's own icons/SVG.
6. Remove <canvas> and <script> tags
7. <body> must be ${w}px × ${h}px, overflow:hidden
8. Return complete HTML starting with <!DOCTYPE html>
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
  /**
   * The channel's HTML cover template. The overlay reuses its design system
   * (fonts, colors, badges, chips, cards) so the hybrid cover looks like THIS
   * channel's covers — without it Sonnet converges on the same generic
   * scrim+accent-bar look as the sharp overlay in pure AI mode.
   */
  referenceHtml?: string;
  headline:     string;
  subheadline?: string;
  /** Short category label from classification, e.g. "ОБНОВЛЕНИЕ". */
  category?:    string;
  postContent?: string;
  /** Free-text composition wishes from the user (image prompt). */
  artDirection?: string;
  logoUrl?:     string;
  primaryColor: string;
  aspectRatio?: string;
}

/**
 * Deterministic minimal overlay — no AI involved. Used when the Flux background
 * succeeded but Sonnet overlay generation/render failed: keeps the photo and
 * crisp HTML text instead of degrading to a no-photo Satori card.
 */
export function buildFallbackOverlayHtml(input: HtmlOverlayInput): string {
  const { w, h } = dims(input.aspectRatio);
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sub = input.subheadline
    ? `<p class="sub">${esc(input.subheadline)}</p>` : '';
  const logo = input.logoUrl
    ? `<img class="logo" src="${input.logoUrl}" alt="">` : '';
  const tag = input.category
    ? `<span class="tag">${esc(input.category)}</span>` : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:${w}px; height:${h}px; position:relative; overflow:hidden;
    background:#0b0b0f url('${input.bgImageUrl}') center/cover no-repeat;
    font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
  }
  .scrim {
    position:absolute; inset:0;
    background:linear-gradient(to top, rgba(5,8,14,.92) 0%, rgba(5,8,14,.55) 30%, rgba(5,8,14,0) 62%);
  }
  .content {
    position:absolute; left:${Math.round(w * 0.065)}px; right:${Math.round(w * 0.065)}px;
    bottom:${Math.round(h * 0.07)}px; color:#fff;
  }
  .tag {
    display:inline-block; padding:${Math.round(h * 0.011)}px ${Math.round(w * 0.022)}px;
    border:2px solid ${input.primaryColor}; border-radius:999px;
    color:${input.primaryColor}; font-size:${Math.round(h * 0.024)}px;
    font-weight:700; letter-spacing:.08em; text-transform:uppercase;
    margin-bottom:${Math.round(h * 0.028)}px;
  }
  h1 { font-size:${Math.round(h * 0.078)}px; line-height:1.08; font-weight:800; letter-spacing:-.01em; }
  .sub { margin-top:${Math.round(h * 0.022)}px; font-size:${Math.round(h * 0.034)}px; line-height:1.35; color:rgba(255,255,255,.82); }
  .logo {
    position:absolute; top:${Math.round(h * 0.05)}px; right:${Math.round(w * 0.065)}px;
    width:${Math.round(h * 0.085)}px; height:${Math.round(h * 0.085)}px;
    border-radius:50%; object-fit:cover;
  }
</style></head>
<body>
  <div class="scrim"></div>
  ${logo}
  <div class="content">
    ${tag}
    <h1>${esc(input.headline)}</h1>
    ${sub}
  </div>
</body></html>`;
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
  if (input.category)    contentLines.push(`Category label: "${input.category}"`);
  const postBodyBlock = input.postContent ? `\nFULL POST TEXT:\n${input.postContent.slice(0, 1500)}` : '';
  const artBlock = input.artDirection ? `\nUSER ART DIRECTION (top priority for composition): ${input.artDirection.slice(0, 400)}` : '';

  // The channel's template design system. Without it the model has nothing to
  // anchor on and produces the same generic scrim+bar+headline composition the
  // sharp overlay already draws in AI mode — the whole hybrid becomes pointless.
  const refCss  = input.referenceHtml ? extractCss(input.referenceHtml) : '';
  const refBody = input.referenceHtml ? extractBodyStructure(input.referenceHtml) : '';
  const designBlock = refCss
    ? `
━━━ CHANNEL DESIGN SYSTEM (CSS from the channel's cover template — its fonts, colors, effects) ━━━
${refCss}

━━━ CHANNEL TEMPLATE MARKUP (the components this channel uses: badges, chips, cards, footer) ━━━
${refBody}`
    : '';

  const styleRule = refCss
    ? `5. The cover MUST be recognizable as THIS channel's design: reuse the template's fonts, type scale, badge/chip/card components and footer from the design system above — restyled to sit on a photo. Make panels and cards SEMI-TRANSPARENT (rgba backgrounds, backdrop-filter: blur) so the photo shows through them. Pick only the components that fit this post — do not cram in everything.
6. FORBIDDEN: the generic "small accent bar + plain white headline" photo-caption look. That is what the cheap mode produces; you are here to lay the channel's design language over the photo.`
    : `5. Compose a clean, branded layout in the channel's primary color: a strong punchy headline, optional one-line subheadline, a small tag/badge, and the channel logo. Give it structure (badge, headline block, footer) — not just a bare caption on a photo.
6. Use the brand primary color for accents (a tag, a highlighted word, borders) so the cover reads as branded, not as a stock photo with text.`;

  const systemPrompt = `You are an expert HTML/CSS designer. You build the channel's branded cover layer ON TOP of a full-bleed background photo, following the channel's own template design system when given. You return ONLY raw HTML with no markdown, no explanation, no code fences.`;

  const userPrompt = `Build the overlay for a social-media cover. There is a full-bleed BACKGROUND PHOTO behind it (URL below) — your job is the readable branded layer on top.

BACKGROUND IMAGE URL: ${input.bgImageUrl}
BRAND PRIMARY COLOR: ${input.primaryColor}
${input.logoUrl ? `LOGO URL: ${input.logoUrl}` : ''}
${designBlock}

━━━ THIS POST ━━━
${contentLines.join('\n')}${postBodyBlock}${artBlock}

━━━ BRIEF ━━━
1. <body> is ${w}px × ${h}px, position:relative, overflow:hidden, margin:0.
2. Set the body background to the photo, covering the whole canvas:
   background: #0b0b0f url('${input.bgImageUrl}') center/cover no-repeat;
3. ZONING: the photo is composed with its focal subject in the UPPER part of the frame. Keep roughly the upper 40% of the canvas free of text — no headline, no badges over the photo's subject (only a small logo in a corner is allowed there). ALL text (badge, headline, subheadline, cards, footer) stacks in the LOWER part of the canvas.
4. Lay a continuous dark gradient scrim UNDER the whole text zone (e.g. linear-gradient(to top, rgba(0,0,0,.9) 0%, rgba(0,0,0,.6) 40%, rgba(0,0,0,0) 72%)) so EVERY word is fully readable. Large headline text must NEVER sit on a bright, unscrimmed area of the photo. Readability is the #1 rule.
${styleRule}
7. Let the photo breathe — its upper half must stay clearly visible; never cover the whole canvas with an opaque panel.
8. ALL text must come from the post. No invented numbers or metrics. Keep the headline short (a few words). Use "-" for dashes, never "—" or "–".
9. NEVER use emoji or Unicode pictographs (📷 🚀 ✨ etc.) anywhere in the markup — the render server has no emoji font and they come out as empty boxes. For chips, tags and list markers use plain text, CSS shapes, or small inline SVG icons.
10. Embed all CSS in <style>. No <script>, no <canvas>.
11. Return complete HTML starting with <!DOCTYPE html>. NO markdown fences, raw HTML only.`;

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
