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
   * channelAbout, voiceProfile, postRules, emojiPack, linkKit, signature.
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
    context: '', language: '', addressStyle: '', signatureBlock: null, signatureUsage: '',
  };

  if (!brandKit || typeof brandKit !== 'object') return empty;

  const bk          = brandKit as Record<string, unknown>;
  const lines:       string[] = [];
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

    if (typeof vp['authorRole']   === 'string' && vp['authorRole'])   lines.push(`Author role: ${vp['authorRole']}`);
    if (typeof vp['tone']         === 'string' && vp['tone'])         lines.push(`Tone: ${vp['tone']}`);
    if (typeof vp['postLength']   === 'string' && vp['postLength'])   lines.push(`Post length: ${vp['postLength']}`);
    if (typeof vp['emojiDensity'] === 'string' && vp['emojiDensity']) lines.push(`Emoji usage: ${vp['emojiDensity']}`);

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
  }

  // ── emojiPack ─────────────────────────────────────────────────────────────
  const emojiPack = bk['emojiPack'];
  if (emojiPack && typeof emojiPack === 'object') {
    const ep     = emojiPack as Record<string, unknown>;
    const allowed = ep['allowedEmojis'];
    if (Array.isArray(allowed) && allowed.length > 0) {
      const emojis = allowed
        .filter((e): e is string => typeof e === 'string' && !!e)
        .join(' ');
      if (emojis) {
        const strict = ep['strictMode'] === true;
        lines.push(
          strict
            ? `Only use these emoji (strict): ${emojis}`
            : `Prefer these emoji: ${emojis}`
        );
      }
    }
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

  return { context: lines.join('\n'), language, addressStyle, signatureBlock, signatureUsage };
}

async function generateWithDeepSeek(params: GenerateParams): Promise<VariantDraft[]> {
  const { input, sourceType, channel, brandKit } = params;

  const { context, language, addressStyle, signatureBlock, signatureUsage } =
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
