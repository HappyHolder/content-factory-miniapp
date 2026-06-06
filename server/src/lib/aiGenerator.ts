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
  /**
   * Full Prisma BrandKit record — all 6 text-relevant columns:
   * channelAbout, voiceProfile, postRules, linkKit, signature.
   * Defensive access throughout; null = no style configured.
   */
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
 * Structured style context extracted from the BrandKit blob.
 * language, addressStyle, and signature are separated out for use directly
 * in the system prompt as hard constraints rather than advisory lines.
 */
interface StyleContext {
  /** Multi-line style body injected into the user prompt */
  context:        string;
  /** 'RU' | 'EN' | '' — from voiceProfile.language */
  language:       string;
  /** 'ты' | 'вы' | '' — from voiceProfile.addressStyle */
  addressStyle:   string;
  /** Formatted signature string, or null if absent or usage === 'never' */
  signatureBlock: string | null;
  /** 'always' | 'when_relevant' | 'never' | '' */
  signatureUsage: string;
  /** Free-text guidance the owner typed (voiceProfile + postRules customNote), or '' */
  customNote:     string;
}

/**
 * Extracts a structured style summary from the BrandKit JSON blob.
 *
 * Rules:
 * - All field reads are defensive (typeof check before use).
 * - Missing or wrong-typed values are silently skipped.
 * - language, addressStyle, and signature are returned separately so they
 *   can be injected into the system prompt as hard constraints.
 * - Never logs raw BrandKit data (may contain user-authored text).
 */
function buildStyleContext(brandKit: unknown): StyleContext {
  const empty: StyleContext = {
    context: '', language: '', addressStyle: '', signatureBlock: null, signatureUsage: '', customNote: '',
  };

  if (!brandKit || typeof brandKit !== 'object') return empty;

  const bk          = brandKit as Record<string, unknown>;
  const lines:       string[] = [];
  const customNotes: string[] = [];
  let language       = '';
  let addressStyle   = '';
  let signatureBlock: string | null = null;
  let signatureUsage = '';

  // ── channelAbout ──────────────────────────────────────────────────────────
  const channelAbout = bk['channelAbout'];
  if (channelAbout && typeof channelAbout === 'object') {
    const a = channelAbout as Record<string, unknown>;
    if (typeof a['topic'] === 'string'          && a['topic'])          lines.push(`Channel topic: ${a['topic']}`);
    if (typeof a['targetAudience'] === 'string' && a['targetAudience']) lines.push(`Target audience: ${a['targetAudience']}`);
    if (typeof a['contentGoal'] === 'string'    && a['contentGoal'])    lines.push(`Content goal: ${a['contentGoal']}`);
  }

  // ── voiceProfile ──────────────────────────────────────────────────────────
  // language and addressStyle are extracted for system-prompt injection,
  // not placed in the context body (they are hard rules, not soft guidance).
  const voiceProfile = bk['voiceProfile'];
  if (voiceProfile && typeof voiceProfile === 'object') {
    const vp = voiceProfile as Record<string, unknown>;

    if (typeof vp['language']     === 'string' && vp['language'])     language     = vp['language'];
    if (typeof vp['addressStyle'] === 'string' && vp['addressStyle']) addressStyle = vp['addressStyle'];

    // 'any' = owner picked "no preference" — skip so the model is left free.
    if (typeof vp['authorRole']   === 'string' && vp['authorRole'] && vp['authorRole'] !== 'any')   lines.push(`Author role: ${vp['authorRole']}`);
    if (typeof vp['tone']         === 'string' && vp['tone']       && vp['tone']       !== 'any')   lines.push(`Tone: ${vp['tone']}`);
    if (typeof vp['postLength']   === 'string' && vp['postLength'] && vp['postLength'] !== 'any')   lines.push(`Post length: ${vp['postLength']}`);

    if (typeof vp['customNote'] === 'string' && vp['customNote'].trim()) customNotes.push(vp['customNote'].trim());
    const favWords = vp['favoriteWords'];
    if (Array.isArray(favWords) && favWords.length > 0) {
      const words = favWords
        .filter((w): w is string => typeof w === 'string' && !!w)
        .join(', ');
      if (words) lines.push(`Prefer these words and phrases: ${words}`);
    }

    const forbWords = vp['forbiddenWords'];
    if (Array.isArray(forbWords) && forbWords.length > 0) {
      const words = forbWords
        .filter((w): w is string => typeof w === 'string' && !!w)
        .join(', ');
      if (words) lines.push(`NEVER use these words: ${words}`);
    }
  }

  // ── postRules ─────────────────────────────────────────────────────────────
  const postRules = bk['postRules'];
  if (postRules && typeof postRules === 'object') {
    const pr = postRules as Record<string, unknown>;

    if (typeof pr['defaultStructure'] === 'string' && pr['defaultStructure'])
      lines.push(`Post structure: ${pr['defaultStructure']}`);
    if (typeof pr['paragraphStyle'] === 'string' && pr['paragraphStyle'])
      lines.push(`Paragraph style: ${pr['paragraphStyle']}`);
    if (typeof pr['listUsage'] === 'string' && pr['listUsage'])
      lines.push(`Bullet list usage: ${pr['listUsage']}`);
    if (typeof pr['ctaUsage'] === 'string' && pr['ctaUsage'])
      lines.push(`CTA inclusion: ${pr['ctaUsage']}`);
    if (pr['neverCopySource'] === true)
      lines.push(`Never copy or paraphrase source wording — always create original text`);
    if (pr['avoidClickbait'] === true)
      lines.push(`Avoid clickbait headlines`);

    const thingsToAvoid = pr['thingsToAvoid'];
    if (Array.isArray(thingsToAvoid) && thingsToAvoid.length > 0) {
      const items = thingsToAvoid
        .filter((i): i is string => typeof i === 'string' && !!i)
        .join('; ');
      if (items) lines.push(`Avoid: ${items}`);
    }

    if (typeof pr['customNote'] === 'string' && pr['customNote'].trim()) customNotes.push(pr['customNote'].trim());
  }

  // ── linkKit (inline / when_relevant links only) ───────────────────────────
  const linkKit = bk['linkKit'];
  if (linkKit && typeof linkKit === 'object') {
    const lk    = linkKit as Record<string, unknown>;
    const links = lk['links'];
    if (Array.isArray(links) && links.length > 0) {
      const inlineLinks = links.filter(l => {
        if (!l || typeof l !== 'object') return false;
        const usage = (l as Record<string, unknown>)['usage'];
        return usage === 'inline' || usage === 'when_relevant';
      });
      if (inlineLinks.length > 0) {
        const formatted = inlineLinks
          .map(l => {
            const link       = l as Record<string, unknown>;
            const label      = typeof link['label']      === 'string' ? link['label']      : '';
            const url        = typeof link['url']        === 'string' ? link['url']        : '';
            const anchorText = typeof link['anchorText'] === 'string' ? link['anchorText'] : '';
            return `${label}: ${url}${anchorText ? ` (anchor text: "${anchorText}")` : ''}`;
          })
          .join('; ');
        if (formatted) lines.push(`Inline links to use when relevant: ${formatted}`);
      }
    }
  }

  // ── signature ─────────────────────────────────────────────────────────────
  // Extracted separately — injected into system prompt as a hard append rule.
  const signature = bk['signature'];
  if (signature && typeof signature === 'object') {
    const sig    = signature as Record<string, unknown>;
    const sigText = typeof sig['text']  === 'string' ? sig['text'].trim()  : '';
    const sigCta  = typeof sig['cta']   === 'string' ? sig['cta'].trim()   : '';
    const usage   = typeof sig['usage'] === 'string' ? sig['usage']        : '';

    signatureUsage = usage;

    if (sigText && usage !== 'never') {
      signatureBlock = sigText;
      if (sigCta) signatureBlock += '\n' + sigCta;
    }
  }

  return { context: lines.join('\n'), language, addressStyle, signatureBlock, signatureUsage, customNote: customNotes.join('\n') };
}

async function generateWithDeepSeek(params: GenerateParams): Promise<VariantDraft[]> {
  const { input, sourceType, channel, brandKit } = params;

  const { context, language, addressStyle, signatureBlock, signatureUsage, customNote } =
    buildStyleContext(brandKit);

  const channelLabel = channel.handle ? `@${channel.handle}` : channel.name;

  // ── System prompt: Channel Style as hard rules ────────────────────────────
  // Critical constraints (language, address style, signature) are placed in the
  // system prompt so the model treats them as hard rules, not advisory context.
  const systemParts: string[] = [];

  systemParts.push('You are a Telegram channel copywriter.');

  systemParts.push(
    'You MUST follow the Channel Style Profile below EXACTLY — do not produce generic AI content. ' +
    'Write in the authentic voice of this channel.'
  );

  systemParts.push('Do NOT invent facts beyond what is given in the source content.');

  // Language hard constraint
  if (language === 'RU') {
    systemParts.push(
      'Write ENTIRELY in Russian. Every single word must be in Russian — ' +
      'not a single word of English or any other language.'
    );
  } else if (language === 'EN') {
    systemParts.push('Write ENTIRELY in English.');
  }

  // Address style hard constraint (meaningful only for Russian)
  if (language === 'RU') {
    if (addressStyle === 'ты') {
      systemParts.push('Address readers using ты (informal "you"). Use informal verb forms throughout.');
    } else if (addressStyle === 'вы') {
      systemParts.push('Address readers using вы (formal "you"). Use formal verb forms throughout.');
    }
  }

  // Signature hard constraint
  if (signatureBlock) {
    if (signatureUsage === 'always') {
      systemParts.push(
        `Append this EXACT signature to EVERY variant on a new line after the post body:\n${signatureBlock}`
      );
    } else if (signatureUsage === 'when_relevant') {
      systemParts.push(
        `Include this signature at the end of the post when it fits naturally:\n${signatureBlock}`
      );
    }
  }

  // Owner's free-text guidance — highest-priority hard rule.
  if (customNote) {
    systemParts.push(
      `Additional hard style instructions from the channel owner — follow them EXACTLY:\n${customNote}`
    );
  }

  // Variant diversity contract
  systemParts.push(
    'Generate exactly 3 variants. Each variant MUST take a meaningfully different angle, format, or rhythm. ' +
    'For example: one concise and direct, one structured with a hook and numbered or bulleted points, ' +
    'one punchy and hook-first. Do NOT produce 3 nearly-identical versions.'
  );

  // JSON output format
  systemParts.push(
    'Return ONLY valid JSON: {"variants":[{"label":"Variant A","text":"..."},' +
    '{"label":"Variant B","text":"..."},{"label":"Variant C","text":"..."}]}' +
    '\nDo NOT include any explanation, markdown code fences, or keys besides "variants".'
  );

  const systemPrompt = systemParts.join('\n\n');

  // ── User prompt: style profile body + source content ─────────────────────
  const userParts: string[] = [
    `Channel: ${channelLabel}`,
    `Source type: ${sourceType}`,
  ];

  if (context) {
    userParts.push(`=== Channel Style Profile ===\n${context}`);
  }

  userParts.push(`=== Content to transform into 3 post variants ===\n${input}`);

  const userPrompt = userParts.join('\n\n');

  // ── DeepSeek API call ─────────────────────────────────────────────────────
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
    // AbortError = timeout; log message only, no key or token exposure
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

// ─── Image prompt generation ─────────────────────────────────────────────────

/**
 * Extracts a natural-language color description from visualKit brandColors.
 * Maps hex values to approximate human-readable color names so the image
 * model receives "electric blue, black, white" instead of "#0098EA #000000".
 */
function hexToColorName(hex: string): string {
  const h = hex.replace('#', '').toLowerCase();
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  if (brightness < 30)  return 'deep black';
  if (brightness > 240) return 'bright white';
  if (max - min < 20)   return brightness < 128 ? 'dark gray' : 'light gray';

  // dominant hue
  if (r > g && r > b) {
    if (g > b * 1.5) return 'golden orange';
    return r > 200 ? 'vivid red' : 'deep red';
  }
  if (g > r && g > b) return g > 200 ? 'bright green' : 'forest green';
  if (b > r && b > g) {
    if (r > 100) return 'purple';
    return b > 180 ? 'electric blue' : 'deep blue';
  }
  if (r > 180 && g > 100 && b < 80) return 'orange';
  return 'accent color';
}

function buildVisualStyleDescription(visualKit: unknown): string {
  if (!visualKit || typeof visualKit !== 'object') return '';
  const vk = visualKit as Record<string, unknown>;
  const parts: string[] = [];

  // visualCoverStyle — collapse newlines/bullets into a single clean line so
  // DeepSeek receives readable prose, not a bullet-pointed design spec.
  const coverStyleRaw = vk['visualCoverStyle'];
  if (typeof coverStyleRaw === 'string' && coverStyleRaw.trim()) {
    const cleaned = coverStyleRaw.trim().replace(/\s+/g, ' ').slice(0, 500);
    parts.push(`brand visual style guide: ${cleaned}`);
  }

  // Reference image descriptions — analysed by vision model on upload.
  const refs = vk['references'];
  if (Array.isArray(refs)) {
    const descs: string[] = [];
    for (const r of refs) {
      const desc = typeof r === 'string' ? null : (r as Record<string, unknown>)?.['description'];
      if (typeof desc === 'string' && desc.trim()) descs.push(desc.trim());
    }
    if (descs.length > 0) parts.push(`visual reference style: ${descs.join(' | ')}`);
  }

  // Brand colors — use "AI эпитеты" from usage field when present (these are
  // explicit image-generation keywords the user wrote for this purpose).
  // Fall back to brand color name, then generic hex→name conversion.
  const rawColors = vk['brandColors'];
  if (Array.isArray(rawColors) && rawColors.length > 0) {
    const colorDescs: string[] = [];
    for (const c of (rawColors as { hex?: unknown; name?: unknown; usage?: unknown }[]).slice(0, 4)) {
      if (typeof c.hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(c.hex)) continue;
      const usage = typeof c.usage === 'string' ? c.usage : '';
      // Extract AI epithets block: "AI эпитеты: foo, bar" or "AI adjectives: foo"
      const epithetsMatch = usage.match(/AI\s+(?:эпитеты|adjectives?)\s*[:：]\s*([^.;\n]+)/i);
      let label: string;
      if (epithetsMatch) {
        label = epithetsMatch[1].trim().slice(0, 80);
      } else if (typeof c.name === 'string' && c.name.trim()) {
        label = c.name.trim().slice(0, 40);
      } else {
        label = hexToColorName(c.hex);
      }
      colorDescs.push(`${c.hex} (${label})`);
    }
    if (colorDescs.length > 0) parts.push(`brand colors: ${colorDescs.join(', ')}`);
  }

  // Font preset as mood word
  const moodMap: Record<string, string> = {
    serif:       'editorial, print-inspired',
    sans:        'clean, modern, minimal',
    mono:        'tech, terminal, code-aesthetic',
    display:     'bold, graphic, high-impact',
    handwritten: 'organic, handcrafted',
  };
  const preset = typeof vk['visualFontPreset'] === 'string' ? vk['visualFontPreset'] : '';
  if (preset && moodMap[preset]) parts.push(`visual mood: ${moodMap[preset]}`);

  // avoidList
  const avoidList = vk['avoidList'];
  if (Array.isArray(avoidList) && avoidList.length > 0) {
    const items = avoidList.filter((i): i is string => typeof i === 'string').join(', ');
    if (items) parts.push(`avoid in visuals: ${items}`);
  }

  return parts.join('; ');
}

export interface GenerateImagePromptParams {
  title:     string;
  excerpt:   string;
  visualKit: unknown;
}

/**
 * Uses DeepSeek to auto-generate a clean English image prompt for Replicate.
 *
 * The AI translates post topic + BrandKit visual style into a natural visual
 * description — no hex codes, no design specs, just artistic language that
 * image generation models understand.
 *
 * Returns null on any failure so callers can skip image generation gracefully.
 */
export async function generateImagePromptWithAI(
  params: GenerateImagePromptParams,
): Promise<string | null> {
  if (env.AI_PROVIDER !== 'deepseek' || !env.DEEPSEEK_API_KEY) return null;

  const { title, excerpt, visualKit } = params;
  const styleDesc = buildVisualStyleDescription(visualKit);

  const systemPrompt =
    'You are a visual art director writing prompts for AI image generation models. ' +
    'Given a post topic and brand style, write a short visual description (40-70 words) ' +
    'for a square Telegram post cover image. ' +
    'Write ONLY what should be visually present in the image: scene, atmosphere, colors, lighting, mood. ' +
    'Do NOT include any instructions, rules, or "do not" phrases. ' +
    'Do NOT mention text, typography, labels, or design specs. ' +
    'Write in English. Output ONLY the visual description, nothing else.';

  const userPrompt =
    `Post topic: ${title}\n` +
    `Brief: ${excerpt.slice(0, 200)}\n` +
    (styleDesc ? `Brand style: ${styleDesc}\n` : '') +
    'Image prompt:';

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method:  'POST',
      signal:  controller.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model:       env.DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens:  150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      console.warn(`[aiGenerator] Image prompt generation failed: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const result = data.choices?.[0]?.message?.content?.trim() ?? '';
    return result || null;
  } catch (err) {
    console.warn('[aiGenerator] Image prompt generation error:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Returns 3 VariantDraft objects.
 *
 * - AI_PROVIDER=placeholder (default): returns deterministic templates, no network call.
 * - AI_PROVIDER=deepseek: calls DeepSeek API with full Channel Style context;
 *   falls back to placeholder on any error (non-200, timeout, bad JSON, wrong
 *   variant count, invalid shape).
 */
export async function generatePostVariants(params: GenerateParams): Promise<VariantDraft[]> {
  if (env.AI_PROVIDER === 'deepseek') {
    return generateWithDeepSeek(params);
  }
  return buildPlaceholderVariants(params.input);
}
