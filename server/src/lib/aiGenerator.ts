/**
 * aiGenerator.ts
 *
 * Generates post variant drafts — either via the DeepSeek API (when
 * AI_PROVIDER=deepseek) or via a deterministic placeholder (default).
 *
 * The placeholder is intentionally kept here so that the generate route
 * has a single import point and the fallback is always available.
 */

import { env } from '../env';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface VariantDraft {
  label: string;
  text:  string;
}

export interface GenerateParams {
  input:      string;
  sourceType: string;
  channel: {
    handle: string | null;
    name:   string;
  };
  /** Prisma Json BrandKit sections — defensive access, may be null */
  brandKit: unknown | null;
}

// ─── Placeholder (deterministic) ─────────────────────────────────────────────

function buildTitle(input: string): string {
  const firstLine = input.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return 'Generated post';
  return firstLine.length <= 60 ? firstLine : firstLine.slice(0, 57) + '…';
}

function buildPlaceholderVariants(input: string): VariantDraft[] {
  const title   = buildTitle(input);
  const preview = input.length > 200 ? input.slice(0, 200) + '…' : input;
  const short   = input.length > 80  ? input.slice(0, 80)  + '…' : input;

  const textA =
    `${title}\n\n` +
    `${preview}\n\n` +
    `Worth paying close attention to.`;

  const textB =
    `${title}\n\n` +
    `Here's what matters:\n\n` +
    `→ ${short}\n` +
    `→ The context shapes everything here\n` +
    `→ The details will determine the outcome\n\n` +
    `More signal, less noise.`;

  const textC =
    `${short}\n\n` +
    `Here's the real point: this changes the picture.\n\n` +
    `Not hype. Signal worth tracking.`;

  return [
    { label: 'Variant A', text: textA },
    { label: 'Variant B', text: textB },
    { label: 'Variant C', text: textC },
  ];
}

// ─── DeepSeek generation ──────────────────────────────────────────────────────

/**
 * Extracts a plain-text summary of relevant BrandKit fields to pass as
 * context to the AI. Keeps it short to avoid burning tokens on raw JSON.
 */
function buildStyleContext(brandKit: unknown): string {
  if (!brandKit || typeof brandKit !== 'object') return '';

  const bk = brandKit as Record<string, unknown>;

  const lines: string[] = [];

  // channelAbout: { topic, targetAudience, contentGoal }
  const channelAbout = bk['channelAbout'];
  if (channelAbout && typeof channelAbout === 'object') {
    const a = channelAbout as Record<string, unknown>;
    if (a['topic'])          lines.push(`Topic: ${a['topic']}`);
    if (a['targetAudience']) lines.push(`Audience: ${a['targetAudience']}`);
    if (a['contentGoal'])    lines.push(`Content goal: ${a['contentGoal']}`);
  }

  // voiceProfile: { tone, postLength, emojiDensity, authorRole, ... }
  const voiceProfile = bk['voiceProfile'];
  if (voiceProfile && typeof voiceProfile === 'object') {
    const tv = voiceProfile as Record<string, unknown>;
    if (tv['tone'])         lines.push(`Tone: ${tv['tone']}`);
    if (tv['postLength'])   lines.push(`Post length: ${tv['postLength']}`);
    if (tv['emojiDensity']) lines.push(`Emoji density: ${tv['emojiDensity']}`);
    if (tv['authorRole'])   lines.push(`Author role: ${tv['authorRole']}`);
  }

  // postRules: { defaultStructure, ... }
  const postRules = bk['postRules'];
  if (postRules && typeof postRules === 'object') {
    const pf = postRules as Record<string, unknown>;
    if (pf['defaultStructure']) lines.push(`Post structure: ${pf['defaultStructure']}`);
  }

  return lines.join('\n');
}

async function generateWithDeepSeek(params: GenerateParams): Promise<VariantDraft[]> {
  const { input, sourceType, channel, brandKit } = params;

  const styleContext = buildStyleContext(brandKit);
  const channelLabel = channel.handle ? `@${channel.handle}` : channel.name;

  const systemPrompt =
    `You are a Telegram content writer. Generate exactly 3 post variants for a Telegram channel.` +
    `\nReturn ONLY valid JSON matching: {"variants":[{"label":"Variant A","text":"..."},{"label":"Variant B","text":"..."},{"label":"Variant C","text":"..."}]}` +
    `\nEach text must be a complete, standalone Telegram post ready to publish.` +
    `\nDo NOT include any explanation, markdown, or keys besides "variants".`;

  const userPrompt =
    `Channel: ${channelLabel}\n` +
    `Source type: ${sourceType}\n` +
    (styleContext ? `Channel style:\n${styleContext}\n` : '') +
    `\nContent to turn into 3 post variants:\n${input}`;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 30_000);

  let raw: string;
  try {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method:  'POST',
      signal:  controller.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model:           env.DEEPSEEK_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens:  2048,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[aiGenerator] DeepSeek returned ${response.status}: ${errText.slice(0, 200)}`);
      return buildPlaceholderVariants(input);
    }

    const data = await response.json() as {
      choices?: { message?: { content?: string } }[];
    };
    raw = data.choices?.[0]?.message?.content ?? '';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // AbortError = timeout; log without leaking token
    console.error(`[aiGenerator] DeepSeek fetch failed: ${msg}`);
    return buildPlaceholderVariants(input);
  } finally {
    clearTimeout(timeoutId);
  }

  // ── Parse and validate the JSON response ──────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[aiGenerator] DeepSeek response is not valid JSON — falling back to placeholder');
    return buildPlaceholderVariants(input);
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as Record<string, unknown>)['variants'])
  ) {
    console.error('[aiGenerator] DeepSeek response missing "variants" array — falling back');
    return buildPlaceholderVariants(input);
  }

  const variants = (parsed as { variants: unknown[] })['variants'];

  if (variants.length !== 3) {
    console.error(`[aiGenerator] DeepSeek returned ${variants.length} variants (expected 3) — falling back`);
    return buildPlaceholderVariants(input);
  }

  const drafts: VariantDraft[] = [];
  for (const v of variants) {
    if (
      !v ||
      typeof v !== 'object' ||
      typeof (v as Record<string, unknown>)['label'] !== 'string' ||
      typeof (v as Record<string, unknown>)['text']  !== 'string' ||
      !((v as Record<string, unknown>)['text'] as string).trim()
    ) {
      console.error('[aiGenerator] DeepSeek variant has invalid shape — falling back');
      return buildPlaceholderVariants(input);
    }
    drafts.push({
      label: (v as Record<string, unknown>)['label'] as string,
      text:  (v as Record<string, unknown>)['text']  as string,
    });
  }

  return drafts;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Returns 3 VariantDraft objects.
 *
 * - AI_PROVIDER=placeholder (default): returns deterministic templates, no network call.
 * - AI_PROVIDER=deepseek: calls DeepSeek API; falls back to placeholder on any error.
 */
export async function generatePostVariants(params: GenerateParams): Promise<VariantDraft[]> {
  if (env.AI_PROVIDER === 'deepseek') {
    return generateWithDeepSeek(params);
  }
  return buildPlaceholderVariants(params.input);
}
