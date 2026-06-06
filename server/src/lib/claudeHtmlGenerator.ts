/**
 * claudeHtmlGenerator.ts
 *
 * Uses Claude Haiku to generate a unique HTML cover image for each post,
 * using the user's uploaded HTML/CSS template as a STYLE REFERENCE — not a
 * template to fill in, but a brand guide to generate something new from.
 *
 * Each post gets a visually distinct cover that matches the channel's visual
 * identity (colors, fonts, aesthetic) but has its own composition.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';

export interface HtmlCoverInput {
  referenceHtml:  string;    // uploaded HTML — style reference, not a template
  headline:       string;
  subheadline?:   string;
  stat?:          string;
  category?:      string;
  logoUrl?:       string;
  primaryColor:   string;
  bgColor:        string;
  aspectRatio?:   string;
}

function dims(ratio?: string): { w: number; h: number } {
  switch (ratio) {
    case '16:9': return { w: 1080, h: 607  };
    case '4:5':  return { w: 1080, h: 1350 };
    case '9:16': return { w: 607,  h: 1080 };
    default:     return { w: 1080, h: 1080 };
  }
}

export async function generateHtmlCover(input: HtmlCoverInput): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) {
    console.warn('[claudeHtmlGenerator] ANTHROPIC_API_KEY not set — skipping');
    return null;
  }

  const { w, h } = dims(input.aspectRatio);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const contentLines: string[] = [`Headline: "${input.headline}"`];
  if (input.subheadline) contentLines.push(`Subheadline: "${input.subheadline}"`);
  if (input.stat)        contentLines.push(`Key metric: "${input.stat}"`);
  if (input.category)    contentLines.push(`Category tag: "${input.category}"`);
  if (input.logoUrl)     contentLines.push(`Logo URL: ${input.logoUrl}`);

  // Give Claude the exact brand colors so it doesn't have to extract them
  const brandHint = [
    `Exact brand colors to use: primary/accent = ${input.primaryColor}, background = ${input.bgColor}`,
  ].join('\n');

  const prompt = `You are an expert web designer creating a ${w}×${h}px social media cover image.

REFERENCE DESIGN — study this to understand the channel's visual identity (colors, fonts, design language, aesthetic mood). Do NOT copy its layout; use it as a brand guide:
<reference>
${input.referenceHtml.slice(0, 8000)}
</reference>

${brandHint}

POST CONTENT:
${contentLines.join('\n')}

Design requirements:
1. Use the EXACT same color palette and fonts from the reference
2. Headline is the dominant element — large, bold, well-placed
3. Create a UNIQUE composition — different layout and structure than the reference
4. Fully self-contained: inline all CSS; Google Fonts @import is allowed; no other external resources
5. body must be exactly ${w}px wide × ${h}px tall, margin: 0, overflow: hidden
6. NO JavaScript, NO CSS animations or transitions — pure static design (screenshot = frame 0)
7. If a logo URL is provided, display it as <img> (don't use it as background-image)
8. Fill the entire canvas — no white margins or empty space

Return ONLY the raw HTML starting with <!DOCTYPE html>. No markdown code fences, no explanation.`;

  try {
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
    if (!text) return null;

    // Strip markdown fences if model wrapped anyway
    const html = text
      .replace(/^```html?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    if (!html.startsWith('<!') && !html.startsWith('<html')) {
      console.warn('[claudeHtmlGenerator] Response does not look like HTML, ignoring');
      return null;
    }

    console.log(`[claudeHtmlGenerator] Generated ${html.length}-char HTML cover (${w}×${h})`);
    return html;
  } catch (err) {
    console.warn('[claudeHtmlGenerator] API call failed:', (err as Error).message);
    return null;
  }
}
