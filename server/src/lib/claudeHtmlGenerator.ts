/**
 * claudeHtmlGenerator.ts
 *
 * Uses a Replicate text/code model (Llama 3.1 70B by default) to generate a
 * unique HTML cover image for each post, using the user's uploaded HTML/CSS
 * as a STYLE REFERENCE — not a template to fill, but a brand guide.
 *
 * Each post gets a visually distinct cover that matches the channel's visual
 * identity (colors, fonts, aesthetic) but with its own composition.
 *
 * Uses the same REPLICATE_API_TOKEN as image generation — no extra keys needed.
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

// ─── Dimensions ───────────────────────────────────────────────────────────────

function dims(ratio?: string): { w: number; h: number } {
  switch (ratio) {
    case '16:9': return { w: 1080, h: 607  };
    case '4:5':  return { w: 1080, h: 1350 };
    case '9:16': return { w: 607,  h: 1080 };
    default:     return { w: 1080, h: 1080 };
  }
}

// ─── Replicate polling ────────────────────────────────────────────────────────

interface ReplicatePrediction {
  id:     string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | string[] | null;
  error:  string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function extractText(output: string | string[] | null): string | null {
  if (!output) return null;
  if (Array.isArray(output)) return output.join('').trim() || null;
  if (typeof output === 'string') return output.trim() || null;
  return null;
}

async function pollForText(
  predictionId: string,
  token: string,
  timeoutMs = 60_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3_000);
    const res = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      { headers: { Authorization: `Token ${token}` } },
    );
    if (!res.ok) { console.warn(`[htmlCoverGenerator] Poll HTTP ${res.status}`); return null; }
    const p = await res.json() as ReplicatePrediction;
    if (p.status === 'succeeded') return extractText(p.output);
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
    console.warn('[htmlCoverGenerator] REPLICATE_API_TOKEN not set — skipping');
    return null;
  }

  const { w, h } = dims(input.aspectRatio);
  const model     = env.COVER_HTML_MODEL;

  const contentLines = [`Headline: "${input.headline}"`];
  if (input.subheadline) contentLines.push(`Subheadline: "${input.subheadline}"`);
  if (input.stat)        contentLines.push(`Key metric: "${input.stat}"`);
  if (input.category)    contentLines.push(`Category tag: "${input.category}"`);
  if (input.logoUrl)     contentLines.push(`Logo URL: ${input.logoUrl}`);

  const systemPrompt = `You are an expert web designer. You generate complete, self-contained HTML cover images. Return ONLY raw HTML — no markdown, no explanation.`;

  const userPrompt = `Create a ${w}×${h}px social media cover image.

REFERENCE DESIGN (brand style guide — study colors, fonts, aesthetic; do NOT copy the layout):
${input.referenceHtml.slice(0, 6000)}

EXACT BRAND COLORS: primary/accent = ${input.primaryColor}, background = ${input.bgColor}

POST CONTENT:
${contentLines.join('\n')}

Requirements:
- Use the EXACT same color palette and fonts from the reference
- Headline is the dominant element — large, bold, prominent
- Create a UNIQUE composition — different layout than the reference
- Fully self-contained: inline all CSS; Google Fonts @import OK; no other external files
- body: width ${w}px, height ${h}px, margin: 0, overflow: hidden
- NO JavaScript, NO CSS animations — static only (screenshot = frame 0)
- Fill the entire canvas — no white margins
${input.logoUrl ? `- Show logo as <img src="${input.logoUrl}" />` : ''}

Return ONLY the raw HTML starting with <!DOCTYPE html>.`;

  try {
    const createRes = await fetch(
      `https://api.replicate.com/v1/models/${model}/predictions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          input: {
            prompt:         userPrompt,
            system_prompt:  systemPrompt,
            max_new_tokens: 4096,
            temperature:    0.5,
          },
        }),
      },
    );

    if (!createRes.ok) {
      console.warn(`[htmlCoverGenerator] Create prediction failed: HTTP ${createRes.status}`);
      return null;
    }

    const prediction = await createRes.json() as ReplicatePrediction;

    let text: string | null = null;

    if (prediction.status === 'succeeded') {
      text = extractText(prediction.output);
    } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
      console.warn(`[htmlCoverGenerator] Prediction failed: ${prediction.status}`);
      return null;
    } else if (prediction.id) {
      text = await pollForText(prediction.id, env.REPLICATE_API_TOKEN);
    }

    if (!text) return null;

    // Strip markdown fences if model added them
    const html = text
      .replace(/^```html?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    if (!html.startsWith('<!') && !html.startsWith('<html')) {
      console.warn('[htmlCoverGenerator] Response does not look like HTML');
      return null;
    }

    console.log(`[htmlCoverGenerator] Generated ${html.length}-char HTML cover (${w}×${h}) via ${model}`);
    return html;
  } catch (err) {
    console.warn('[htmlCoverGenerator] Failed:', (err as Error).message);
    return null;
  }
}
