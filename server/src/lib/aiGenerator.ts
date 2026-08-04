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
import { primaryTextModel, terraText } from './assistantModel';
import { stripDisabledHighlightMarkers } from './richPost';
import { buildTemplateSlotFallback } from './templateSlotFallback';


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

  return [
    { label: 'Variant A', text: textA },
    { label: 'Variant B', text: textB },
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
  /** Real channel posts (few-shot voice examples), capped by exampleCount. */
  examplePosts:   string[];
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
    context: '', language: '', addressStyle: '', signatureBlock: null, signatureUsage: '', customNote: '', examplePosts: [],
  };

  if (!brandKit || typeof brandKit !== 'object') return empty;

  const bk          = brandKit as Record<string, unknown>;
  const lines:       string[] = [];
  const customNotes: string[] = [];
  let language       = '';
  let addressStyle   = '';
  let signatureBlock: string | null = null;
  let signatureUsage = '';
  let examplePosts:  string[] = [];

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

    // Few-shot voice examples — real channel posts uploaded by the owner.
    // exampleCount (5 or 10) caps how many are actually fed to the model.
    const rawExamples = vp['examplePosts'];
    if (Array.isArray(rawExamples) && rawExamples.length > 0) {
      const count = typeof vp['exampleCount'] === 'number' ? vp['exampleCount'] : 5;
      examplePosts = rawExamples
        .filter((p): p is string => typeof p === 'string' && !!p.trim())
        .slice(0, count)
        .map(p => p.trim().slice(0, 600));
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

  return { context: lines.join('\n'), language, addressStyle, signatureBlock, signatureUsage, customNote: customNotes.join('\n'), examplePosts };
}

/**
 * Pulls a JSON object out of a model response that may be wrapped in markdown
 * code fences or carry stray prose around it. Returns the outermost {…} slice.
 */
function extractJsonObject(raw: string): string {
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s;
}

type ProtectedToken = { value: string; index: number; end: number };

const LATIN_TOKEN = /@[A-Za-z][A-Za-z0-9_]{2,31}|\$[A-Z][A-Z0-9]{1,9}|\b[A-Za-z][A-Za-z0-9+#._-]*\b/g;

function looksLikeProtectedLatinToken(value: string): boolean {
  const bare = value.replace(/^[@$]/, '');
  return value.startsWith('@')
    || value.startsWith('$')
    || /\d/.test(bare)
    || /^[A-Z]{2,}[A-Za-z0-9+#._-]*$/.test(bare)
    || /^[A-Z][a-z]+$/.test(bare)
    || /^[A-Za-z]*[a-z][A-Z][A-Za-z0-9+#._-]*$/.test(bare);
}

/**
 * Finds exact Latin-script names in a mainly Russian source. These are not
 * translations: they are immutable source tokens such as OpenAI, ChatGPT, TON,
 * LayerZero, GPT-5, Telegram Mini Apps, @username and $TICKER.
 */
export function extractProtectedSourceTerms(input: string): string[] {
  const cyrillicCount = (input.match(/[А-Яа-яЁё]/g) ?? []).length;
  const latinCount = (input.match(/[A-Za-z]/g) ?? []).length;
  if (cyrillicCount < 20 || cyrillicCount < latinCount) return [];

  const searchable = input
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ');
  const tokens: ProtectedToken[] = [...searchable.matchAll(LATIN_TOKEN)]
    .flatMap(match => {
      const value = match[0];
      const index = match.index ?? -1;
      return index >= 0 && looksLikeProtectedLatinToken(value)
        ? [{ value, index, end: index + value.length }]
        : [];
    });

  const terms: string[] = [];
  let group: ProtectedToken[] = [];
  const flush = () => {
    if (!group.length) return;
    terms.push(group.map(token => token.value).join(' '));
    group = [];
  };
  for (const token of tokens) {
    const previous = group.at(-1);
    const separator = previous ? searchable.slice(previous.end, token.index) : '';
    if (previous && group.length < 4 && /^\s+$/.test(separator)) group.push(token);
    else {
      flush();
      group.push(token);
    }
  }
  flush();
  return [...new Set(terms)].filter(term => term.length <= 80).slice(0, 50);
}

function missingProtectedTerms(variants: VariantDraft[], protectedTerms: string[]): string[] {
  return protectedTerms.filter(term => variants.some(variant => !variant.text.includes(term)));
}

/** Builds the system + user prompts for variant generation (shared by all transports). */
export function buildVariantPrompts(params: GenerateParams): { systemPrompt: string; userPrompt: string; protectedTerms: string[] } {
  const { input, sourceType, channel, brandKit } = params;

  const { context, language, addressStyle, signatureBlock, signatureUsage, customNote, examplePosts } =
    buildStyleContext(brandKit);

  const channelLabel = channel.handle ? `@${channel.handle}` : channel.name;
  const protectedTerms = language === 'RU' || language === 'BI'
    ? extractProtectedSourceTerms(input)
    : [];

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

  systemParts.push('TEMPORARY FORMATTING RULE: highlighting is disabled. Never output ==highlight== or wrap any text in == markers. Use ordinary text or **bold** instead.');

  // Language hard constraint
  if (language === 'RU') {
    systemParts.push(
      'Write the prose in Russian, but preserve source-language proper nouns exactly as written. ' +
      'Never translate, transliterate, respell, or change the case of brand names, product names, company names, ' +
      'people names, technical terms, tickers, handles, model names, and other Latin-script identifiers from the source.'
    );
  } else if (language === 'EN') {
    systemParts.push('Write ENTIRELY in English.');
  } else if (language === 'BI') {
    // Bilingual: each variant carries the SAME post in both languages, stacked.
    systemParts.push(
      'Write each variant BILINGUALLY in one post: first the full post in Russian, then a separator line, then the SAME post in English. ' +
      'Both language versions must say the same thing and follow the channel style. ' +
      'Format the "text" field of every variant EXACTLY as:\n' +
      '<full Russian post>\n\n———\n\n<full English post>\n' +
      'Use exactly "———" as the separator between the two languages. Do NOT prefix the versions with language labels like "RU:"/"EN:".'
    );
  }

  if (protectedTerms.length > 0) {
    systemParts.push(
      'The following source terms are immutable. Include every one in EVERY variant exactly as written, ' +
      'with the same Latin spelling and letter case:\n' + protectedTerms.map(term => `- ${term}`).join('\n')
    );
  }

  // Address style hard constraint (the Russian voice — also the RU half of bilingual)
  if (language === 'RU' || language === 'BI') {
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

  // Few-shot: real posts from this channel as the authoritative voice reference.
  // The model must mimic their tone, rhythm, and formatting — not copy their text.
  if (examplePosts.length > 0) {
    const samples = examplePosts.map((p, i) => `Example ${i + 1}:\n${p}`).join('\n\n---\n\n');
    systemParts.push(
      `Below are REAL posts from this channel. They are the single best reference for the channel's authentic voice, tone, rhythm, sentence length, and formatting. ` +
      `Match this style closely in your output, but write about the new content — never copy or reuse phrases from these examples:\n\n${samples}`
    );
  }

  // Variant contract: 2 strong, publishable variants — NOT forced format gymnastics.
  // Forcing maximally-different formats made 1 variant fit and the rest off-style;
  // here both must be something the owner would actually post, with only light variation.
  systemParts.push(
    'Generate exactly 2 variants. Both must be strong, publishable, and fully in the channel style — ' +
    'each one something the channel owner would actually post. ' +
    'Vary them only lightly (a different opening hook, angle, or rhythm). ' +
    'Do NOT force an off-style format (e.g. bullet lists or a "hook" structure) if it does not suit this channel, ' +
    'and do NOT produce two near-identical versions.'
  );

  // JSON output format
  systemParts.push(
    'Return ONLY valid JSON: {"variants":[{"label":"Variant A","text":"..."},' +
    '{"label":"Variant B","text":"..."}]}' +
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

  if (protectedTerms.length > 0) {
    userParts.push(`=== Preserve exactly in both variants ===\n${protectedTerms.join('\n')}`);
  }
  userParts.push(`=== Content to transform into 2 post variants ===\n${input}`);

  const userPrompt = userParts.join('\n\n');

  return { systemPrompt, userPrompt, protectedTerms };
}

/**
 * Parses a model's JSON response into up to 2 VariantDrafts. Tolerant of markdown
 * fences / surrounding prose (extractJsonObject). Falls back to placeholder on any
 * malformed / empty / invalid-shape response.
 */
function parseVariantsJson(raw: string, input: string, finishReason: string): VariantDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    console.error(
      `[aiGenerator] Model response is not valid JSON — falling back to placeholder ` +
      `(finish_reason=${finishReason || 'n/a'}, len=${raw.length}, tail=${JSON.stringify(raw.slice(-160))})`
    );
    return buildPlaceholderVariants(input);
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as Record<string, unknown>)['variants'])
  ) {
    console.error('[aiGenerator] Model response missing "variants" array — falling back');
    return buildPlaceholderVariants(input);
  }

  const variants = (parsed as { variants: unknown[] })['variants'];

  if (variants.length === 0) {
    console.error('[aiGenerator] Model returned no variants — falling back');
    return buildPlaceholderVariants(input);
  }

  // Expect 2; take the first 2 valid ones (tolerate a model that returns more).
  const drafts: VariantDraft[] = [];
  for (const v of variants.slice(0, 2)) {
    if (
      !v ||
      typeof v !== 'object' ||
      typeof (v as Record<string, unknown>)['label'] !== 'string' ||
      typeof (v as Record<string, unknown>)['text']  !== 'string' ||
      !((v as Record<string, unknown>)['text'] as string).trim()
    ) {
      console.error('[aiGenerator] Model variant has invalid shape — falling back');
      return buildPlaceholderVariants(input);
    }
    drafts.push({
      label: (v as Record<string, unknown>)['label'] as string,
      text:  stripDisabledHighlightMarkers((v as Record<string, unknown>)['text'] as string),
    });
  }

  return drafts;
}

/** LOW tier: DeepSeek (OpenAI-compatible chat completions). */
async function generateWithDeepSeek(params: GenerateParams): Promise<VariantDraft[]> {
  const { systemPrompt, userPrompt } = buildVariantPrompts(params);

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 30_000);

  let raw = '';
  let finishReason = '';
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
        temperature: 0.7,
        top_p:       0.9,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[aiGenerator] DeepSeek returned ${response.status}: ${errText.slice(0, 200)}`);
      return buildPlaceholderVariants(params.input);
    }

    const data = await response.json() as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    raw = data.choices?.[0]?.message?.content ?? '';
    finishReason = data.choices?.[0]?.finish_reason ?? '';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[aiGenerator] DeepSeek fetch failed: ${msg}`);
    return buildPlaceholderVariants(params.input);
  } finally {
    clearTimeout(timeoutId);
  }

  return parseVariantsJson(raw, params.input, finishReason);
}

/**
 * Post text: one prompt → JSON with both variants.
 *
 * ⚠️ Model change: this used to run Claude 4.5 Sonnet through Replicate, which
 * made the product's core output — the post text itself — depend on the Replicate
 * balance. It now runs the primary text model (terraText → direct OpenAI). Same
 * prompts, so the structure is unchanged, but the writing voice comes from a
 * different model. To go back to Claude, the honest route is the Anthropic API
 * directly (ANTHROPIC_API_KEY) rather than renting it again.
 *
 * effort 'medium': writing two full post variants in the channel's voice is the
 * one place in the pipeline where reasoning is clearly worth its cost.
 */
async function generatePostText(params: GenerateParams): Promise<VariantDraft[]> {
  const { systemPrompt, userPrompt, protectedTerms } = buildVariantPrompts(params);

  const raw = await terraText({
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 8000,
    effort: 'medium',
    timeoutMs: 120_000,
  });

  if (!raw) {
    console.error('[aiGenerator] Primary text model returned nothing — falling back to placeholder');
    return buildPlaceholderVariants(params.input);
  }

  const variants = parseVariantsJson(raw, params.input, primaryTextModel());
  const missing = missingProtectedTerms(variants, protectedTerms);
  if (missing.length === 0) return variants;

  console.warn(`[aiGenerator] Retrying post text because ${missing.length} protected source term(s) changed or disappeared`);
  const repairedRaw = await terraText({
    system: systemPrompt + '\n\nCORRECTION PASS: preserve every immutable source term exactly in both variants.',
    prompt:
      userPrompt +
      '\n\n=== Previous invalid output ===\n' + JSON.stringify({ variants }) +
      '\n\nRewrite both variants. The previous output changed or omitted immutable source terms.',
    maxTokens: 8000,
    effort: 'medium',
    timeoutMs: 120_000,
  });
  if (!repairedRaw) return variants;
  const repaired = parseVariantsJson(repairedRaw, params.input, primaryTextModel());
  return missingProtectedTerms(repaired, protectedTerms).length === 0 ? repaired : variants;
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
  /**
   * Optional free-text art direction from the user's "image prompt" field.
   * Used only as a hint for subject/style/mood — never copied verbatim into the
   * output, so pasting the article text here still yields a clean, text-free
   * scene instead of a Flux image with burned-in gibberish.
   */
  artDirection?: string;
  /**
   * Full-bleed composition: fill the entire square edge-to-edge with no empty or
   * dark reserved zones. Used when the channel template (rendered over the photo)
   * owns the text layout, so the photo must NOT leave a calm bottom for a caption.
   * Default (false) keeps the lower third calmer for a bottom-stacked headline.
   */
  fullBleed?: boolean;
  backgroundKind?: 'photo' | 'abstract';
  hybridPrompt?: string;
  /**
   * Body illustration mode (gallery / in-post block image), NOT a cover. No
   * headline is overlaid, so the cover composition rules (reserve calm zones,
   * "must be about the post topic") don't apply. When artDirection is present it
   * becomes the PRIMARY subject; the post topic/style only fill gaps or set mood.
   */
  bodyImage?: boolean;
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
  if (!env.OPENAI_API_KEY) return null;

  const { title, excerpt, visualKit, artDirection, fullBleed, backgroundKind, hybridPrompt, bodyImage } = params;
  const styleDesc = buildVisualStyleDescription(visualKit);

  // ── Body illustration (gallery / in-post block) ──────────────────────────
  // No headline overlay → skip cover composition rules. A user art direction is
  // the PRIMARY subject; the post topic/style only fill gaps or set the mood.
  if (bodyImage) {
    const artPrimary = !!artDirection?.trim();
    const bodySystem =
      'You are a visual art director writing prompts for AI image generation models. ' +
      'Write a short visual description (40-70 words) for a standalone illustration shown inside a Telegram post body — no text is overlaid on it. ' +
      (artPrimary
        ? 'The user gave specific art direction: build the image PRIMARILY around exactly what they describe — their subject, objects, style and mood. Use the post topic and brand style ONLY to fill gaps or set a supporting mood when the direction is short; never let them replace the user\'s subject. '
        : 'Depict a concrete scene or visual metaphor that conveys the post topic (people, places, objects, devices, nature, technology); avoid generic decorative mood shots. ') +
      'Distil the art direction into a purely pictorial scene — never copy its sentences. ' +
      'NEVER render text, numbers, letters, or written words in the image. ' +
      'Fill the whole frame with a clear, appealing composition (no reserved empty zones). ' +
      'Do NOT include any instructions, rules, or "do not" phrases in the output. ' +
      'Write in English. Output ONLY the visual description, nothing else.';

    const bodyUser = artPrimary
      ? `PRIMARY subject — build the image around this: ${artDirection!.slice(0, 400)}\n` +
        `Supporting context (post topic, for mood/gaps only): ${title}\n` +
        (styleDesc ? `Brand style (mood only): ${styleDesc}\n` : '') +
        'Image prompt:'
      : `Post topic: ${title}\n` +
        `Brief: ${excerpt.slice(0, 200)}\n` +
        (styleDesc ? `Brand style: ${styleDesc}\n` : '') +
        'Image prompt:';

    return callImagePromptModel(bodySystem, bodyUser);
  }
  const subjectRule = backgroundKind === 'abstract'
    ? 'Create an abstract, low-detail background texture or soft material surface. Use blurred shapes, atmospheric light, subtle noise, glass, fabric, metal, or gradient depth. Do NOT depict a literal room, person, object, device, chart, logo, screenshot, or recognizable scene. '
    : 'Depict a real scene or visual metaphor that conveys the topic (people, places, objects, devices, nature, technology). ';

  const compositionRule = backgroundKind === 'abstract'
    ? 'CRITICAL COMPOSITION: the image is only a background material for an HTML template. Keep it calm, low-contrast, non-literal, text-free, and free of focal objects. Fill the whole frame with a premium abstract texture. '
    : fullBleed
    ? 'CRITICAL COMPOSITION: the image is a background layer for an HTML template. Fill the square edge to edge with a coherent scene, but keep the overlay zones readable: no text, no labels, no bright competing focal elements, no busy details directly behind the headline, tags, brand bar, or channel handle. Use light and contrast inside the scene, not a flat dark overlay. '
    : 'Keep the lower third of the image calmer and less busy so the overlaid headline stays readable. ';

  const systemPrompt =
    'You are a visual art director writing prompts for AI image generation models. ' +
    'Given a post topic and brand style, write a short visual description (40-70 words) ' +
    'for a square Telegram post cover image. ' +
    subjectRule +
    'NEVER depict text, numbers, letters, digits, UI copy, or written words — the image must be purely pictorial, ' +
    'because a headline is overlaid on top afterwards. ' +
    'The image must be specifically about the post: identify the central event, actor, conflict, consequence, or process and choose a concrete visual metaphor for THAT. Avoid generic cityscapes, random skyscrapers, empty rooms, vague technology backgrounds, or decorative mood shots unless they directly express the story. ' +
    'If the topic is a metric or abstract idea (user growth, a milestone, an announcement), express it through a metaphor ' +
    '(a crowd of people, a network of glowing nodes, a rising cityscape, a growing structure) rather than showing the number itself. ' +
    compositionRule +
    'Use an atmospheric, on-brand background (colors, lighting, mood); avoid empty abstract gradients, nebulae, or galaxies ' +
    'unless the brand style explicitly calls for them. ' +
    'Do NOT include any instructions, rules, or "do not" phrases in the output. ' +
    'If the user provides art direction, follow its subject, style and mood, but ' +
    'never copy its sentences and never render any text from it — distil it into a ' +
    'purely pictorial scene. ' +
    'Write in English. Output ONLY the visual description, nothing else.';

  const userPrompt =
    `Post topic: ${title}\n` +
    `Brief: ${excerpt.slice(0, 200)}\n` +
    (styleDesc ? `Brand style: ${styleDesc}\n` : '') +
    (artDirection ? `User art direction (a hint for subject/style/mood only): ${artDirection.slice(0, 400)}\n` : '') +
    (hybridPrompt ? `HTML template fit guidance (composition only, keep the image text-free): ${hybridPrompt.slice(0, 600)}\n` : '') +
    'Image prompt:';

  return callImagePromptModel(systemPrompt, userPrompt);
}

/** Runs image-prompt generation through the unified primary text model. */
async function callImagePromptModel(systemPrompt: string, userPrompt: string): Promise<string | null> {
  try {
    const result = await terraText({
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 150,
      timeoutMs: 20_000,
      effort: 'low',
    });
    return result?.trim() || null;
  } catch (err) {
    console.warn('[aiGenerator] Image prompt generation error:', (err as Error).message);
    return null;
  }
}
// ─── Template slot filling ────────────────────────────────────────────────────

/** Escapes HTML text-node special characters in a slot value. */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Extracts the <style> + <body> of a template so the AI can size each slot. */
function extractStyleAndBody(html: string): string {
  const style = html.match(/<style[^>]*>[\s\S]*?<\/style>/i)?.[0] ?? '';
  const body  = html.match(/<body[\s\S]*?<\/body>/i)?.[0] ?? '';
  return `${style}\n${body}`.slice(0, 5000);
}

/** Channel identity passed into slot filling so the cover reads as THIS channel. */
export interface SlotBrandContext {
  handle?: string | null;   // channel @handle → author/handle slots
  name?:   string | null;   // channel display name
  about?:  string;          // what the channel is about (short)
  voice?:  string;          // the channel's voice/style (short)
  rubricName?: string;      // selected rubric/template label for RUBRIC/SECTION slots
}

function rubricSlotLabel(name: string | undefined, lang?: 'ru' | 'en'): string | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  const key = n.toLowerCase();
  const en: Record<string, string> = {
    'новости': 'NEWS', 'новость': 'NEWS', 'news': 'NEWS',
    'сигнал': 'SIGNAL', 'signal': 'SIGNAL',
    'листинг': 'LISTING', 'listing': 'LISTING',
    'мнение': 'OPINION', 'opinion': 'OPINION',
    'аналитика': 'ANALYSIS', 'analysis': 'ANALYSIS',
    'дайджест': 'RECAP', 'recap': 'RECAP', 'digest': 'RECAP',
    'гайд': 'GUIDE', 'guide': 'GUIDE',
    'топ': 'TOP', 'top': 'TOP',
    'партнёрство': 'PARTNER', 'партнерство': 'PARTNER', 'partner': 'PARTNER', 'partnership': 'PARTNER',
  };
  const ru: Record<string, string> = {
    'новости': 'НОВОСТЬ', 'новость': 'НОВОСТЬ', 'news': 'НОВОСТЬ',
    'сигнал': 'СИГНАЛ', 'signal': 'СИГНАЛ',
    'листинг': 'ЛИСТИНГ', 'listing': 'ЛИСТИНГ',
    'мнение': 'МНЕНИЕ', 'opinion': 'МНЕНИЕ',
    'аналитика': 'АНАЛИТИКА', 'analysis': 'АНАЛИТИКА',
    'дайджест': 'ДАЙДЖЕСТ', 'recap': 'ДАЙДЖЕСТ', 'digest': 'ДАЙДЖЕСТ',
    'гайд': 'ГАЙД', 'guide': 'ГАЙД',
    'топ': 'ТОП', 'top': 'ТОП',
    'партнёрство': 'ПАРТНЕР', 'партнерство': 'ПАРТНЕР', 'partner': 'ПАРТНЕР', 'partnership': 'ПАРТНЕР',
  };
  return (lang === 'en' ? en[key] : ru[key]) ?? n.toUpperCase();
}

/**
 * Validates the section label the model derived from the post.
 *
 * The rubric decides which TEMPLATE a cover uses, but it must not dictate the
 * words printed on it: a channel owns four rubrics, so a round-up of tools gets
 * classified "Новости" and used to render "// НОВОСТЬ" over "Топ-5 плагинов".
 * The model reads the post and names the section; this only refuses answers that
 * would leak identity (the channel, the source outlet, a product) or blow up the
 * layout. A refusal falls back to the rubric's own label — the old behaviour.
 */
function sanitizeSectionLabel(value: unknown, brand?: SlotBrandContext): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().replace(/^[/#\s"'«»]+|["'«»\s]+$/g, '').replace(/\s+/g, ' ');
  if (!v) return null;
  // A section label is a couple of words; anything longer is a headline that
  // wandered into the wrong slot and will overflow a monospace pill.
  if (v.length > 24 || v.split(' ').length > 3) return null;
  // Identity leaks: an @handle, a URL, the channel's own name, or a bare number.
  if (/[@]|https?:/i.test(v) || /^\d+$/.test(v)) return null;
  const channel = (brand?.name ?? '').trim().toLowerCase();
  const handle  = (brand?.handle ?? '').trim().replace(/^@/, '').toLowerCase();
  const low = v.toLowerCase();
  if ((channel && low === channel) || (handle && low === handle)) return null;
  return v;
}
/** Slot-fill JSON completion via DeepSeek's OpenAI-compatible endpoint. */
async function fillSlotsViaDeepseek(systemPrompt: string, userPrompt: string): Promise<string | null> {
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
        model:           env.DEEPSEEK_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens:  800,
        temperature: 0.5,
      }),
    });
    if (!response.ok) {
      console.warn(`[aiGenerator] Slot fill failed: HTTP ${response.status}`);
      return null;
    }
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.warn('[aiGenerator] Slot fill (DeepSeek) error:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fills a slot-based cover template ({{SLOT}} placeholders) with content for the
 * post, WITHOUT touching its HTML/CSS — the design and colors stay 1:1.
 *
 * Slots are treated as two kinds so the cover keeps the CHANNEL's identity
 * instead of mirroring the source article:
 *   - IDENTITY slots (author/handle, rubric/section, the channel's own tags) are
 *     filled from the channel brand context — never invented from the post and
 *     never the source outlet's name.
 *   - CONTENT slots (title, description, metrics, badge) are rewritten FROM the
 *     post but IN THE CHANNEL'S VOICE and language.
 *
 * Provider-agnostic: uses DeepSeek when configured, otherwise Claude via
 * the primary text model. Returns the filled HTML, or null when there are
 * no slots / no provider available / the call fails.
 */
export async function fillTemplateSlots(
  templateHtml: string,
  post: { title: string; content: string; artDirection?: string; coverLanguage?: 'ru' | 'en' },
  brand?: SlotBrandContext,
): Promise<string | null> {
  const slots = Array.from(new Set(
    [...templateHtml.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]),
  ));
  if (slots.length === 0) return null;

  const fallbackValues = buildTemplateSlotFallback(slots, post, brand);
  const applyValues = (values: Record<string, unknown>): string => {
    const rubricFallback = rubricSlotLabel(brand?.rubricName, post.coverLanguage);
    let sectionSource = 'none';
    const filled = templateHtml.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (/^(RUBRIC|SECTION|CATEGORY)$/i.test(key)) {
        const derived = sanitizeSectionLabel(values[key], brand);
        const deterministic = fallbackValues[key];
        sectionSource = derived ? 'post' : rubricFallback || deterministic ? 'rubric' : 'none';
        return escapeHtmlText(derived ?? rubricFallback ?? deterministic ?? '');
      }
      const value = values[key];
      if (typeof value === 'string' && value.trim()) return escapeHtmlText(value);
      if (typeof value === 'number') return String(value);
      return escapeHtmlText(fallbackValues[key] ?? '');
    });
    console.log(`[aiGenerator] Filled ${slots.length} template slots (section from ${sectionSource})`);
    return filled;
  };

  const hasDeepseek  = env.AI_PROVIDER === 'deepseek' && !!env.DEEPSEEK_API_KEY;
  const hasPrimaryModel = !!env.OPENAI_API_KEY;
  if (!hasDeepseek && !hasPrimaryModel) {
    console.warn('[aiGenerator] Slot fill: no AI provider, using deterministic fallback');
    return applyValues({});
  }

  const langRule =
    post.coverLanguage === 'ru' ? 'Russian, translating from the post language when needed'
    : post.coverLanguage === 'en' ? 'English, translating from the post language when needed'
    : 'the SAME language as the post';

  // Generic + self-calibrating: the model is given the template's HTML+CSS and
  // sizes each slot by HOW it is styled, so ANY template works without per-client
  // prompt changes. The naming hints below are just common conventions.
  const systemPrompt =
    'You fill the {{SLOT}} placeholders of a social-media cover TEMPLATE with content for a post, ' +
    'and return ONLY a JSON object mapping each slot name to a short string value.\n\n' +
    'The cover belongs to a specific CHANNEL and must read as THAT channel\'s own post — ' +
    'never as the source article\'s publication. Treat slots as two kinds:\n' +
    '1. IDENTITY slots — author/byline/signature, the channel\'s own hashtags. ' +
    'Fill these from the CHANNEL IDENTITY block, NOT from the post, and NEVER with the source outlet\'s name. ' +
    'An author/byline/signature slot = the channel\'s PROJECT or BRAND NAME — derive it from the channel name or its ' +
    '"about" description; do NOT use the raw @handle (it is often arbitrary, like a username).\n' +
    '2. CONTENT slots — title/headline, description/subtitle, metrics, badge, rubric/section label. Rewrite these FROM the post, ' +
    'but in the CHANNEL\'S VOICE (first person when the channel is a personal blog) and language. ' +
    'Do NOT copy the source outlet\'s framing, byline, or branding.\n\n' +
    'Size EACH slot by how it is styled in the template HTML/CSS:\n' +
    '- A large/display/headline slot gets VERY few short words (1-3). Long words or sentences break such layouts — never put them there.\n' +
    '- A small/monospace/label/tag/category/badge slot gets a 1-3 word short label.\n' +
    '- A description/subtitle slot gets one short sentence.\n' +
    'Naming hints (common conventions, when present): *_VALUE = one metric/number/keyword, *_LABEL = its caption; ' +
    'TITLE/HEADLINE (or a TITLE split into _WHITE/_ACCENT parts) = the huge headline, keep it to 2-5 short words total. If a title is split into WHITE/ACCENT, the two values MUST read left-to-right as one grammatical headline in natural word order; ACCENT is only the final key word/phrase, never a rearranged fragment; ' +
    'QUOTE/QUOTE_WHITE/QUOTE_ACCENT = a real quote or quote-like thought from the post. Preserve the quote\'s meaning and as much exact wording as fits; do NOT compress it into a slogan. Split the quote so QUOTE_WHITE carries the main phrase and QUOTE_ACCENT carries only the final 2-5 key words. Target 55-120 characters total when the template has a large quote card. ' +
    'AUTHOR/HANDLE/SIGNATURE = the channel\'s project/brand name (from name/about), NOT the raw @handle; ' +
    'RUBRIC/SECTION/CATEGORY = a 1-2 word label naming WHAT KIND OF POST THIS IS, read from the post itself ' +
    '(новость, подборка, гайд, инструменты, разбор, анонс…), written in the channel\'s own voice. ' +
    'It is NOT the channel name, NOT the source publication, NOT a company or product name, and NOT a person. ' +
    'When the post genuinely is news, "новость" is the right answer — but a round-up of tools is "инструменты", not "новость"; ' +
    'TAGS = the channel\'s hashtags.\n\n' +
    'General rules:\n' +
    `- Write all values in ${langRule}. No markdown, no line breaks.\n` +
    '- Return PLAIN text only — NO decorative prefixes or symbols around values ' +
    '(no "//", no "#", no "///", no bullets, no quotes). The template draws its own ' +
    'punctuation/separators; e.g. a rubric value is just "новости" (the template adds "//"), ' +
    'a tag value is just "крипто" (the template adds the colored prefix).\n' +
    '- Keep each value short enough to fit its element without wrapping awkwardly.\n' +
    '- Use a number ONLY if that exact number appears in the post. ' +
    'NEVER invent facts, numbers, metrics, or statistics. ' +
    'If you cannot derive a value for a slot from the post, return an empty string for it rather than making something up.';

  const identityLines: string[] = [];
  if (brand?.name)   identityLines.push(`Channel name (a good source for the project/brand name): ${brand.name}`);
  if (brand?.about)  identityLines.push(`Channel is about (the project/brand name usually appears here — use it for author/byline slots): ${brand.about.slice(0, 400)}`);
  if (brand?.voice)  identityLines.push(`Channel voice/style: ${brand.voice.slice(0, 300)}`);
  if (brand?.handle) identityLines.push(`Channel @handle (LAST RESORT only — usually an arbitrary username, avoid as the author/byline): ${brand.handle.startsWith('@') ? brand.handle : '@' + brand.handle}`);
  const identityBlock = identityLines.length
    ? `CHANNEL IDENTITY (the cover must read as THIS channel — keep these stable):\n${identityLines.join('\n')}\n\n`
    : '';

  const artDirectionLine = post.artDirection
    ? `\nUser art direction (apply where it makes sense): ${post.artDirection.slice(0, 400)}\n`
    : '';

  const userPrompt =
    identityBlock +
    `TEMPLATE (HTML + CSS — use it to judge each slot's size and length):\n${extractStyleAndBody(templateHtml)}\n\n` +
    `Slots to fill: ${slots.join(', ')}\n\n` +
    `Post title: ${post.title}\n` +
    `Post body:\n${post.content.slice(0, 1500)}\n` +
    artDirectionLine +
    `\nReturn a JSON object with exactly these keys: ${slots.join(', ')}`;

  // Provider-agnostic JSON completion: DeepSeek when configured, else the
  // primary text model.
  const rawJson = hasDeepseek
    ? await fillSlotsViaDeepseek(systemPrompt, userPrompt)
    : await terraText({
        system: systemPrompt + '\n\nReturn ONLY the JSON object — no prose, no code fences.',
        prompt: userPrompt,
        maxTokens: 800,
        timeoutMs: 40_000,
        effort: 'low',
      });
  if (!rawJson) {
    console.warn('[aiGenerator] Slot fill: empty AI response, using deterministic fallback');
    return applyValues({});
  }

  let values: Record<string, unknown>;
  try {
    values = JSON.parse(extractJsonObject(rawJson)) as Record<string, unknown>;
  } catch (err) {
    console.warn('[aiGenerator] Slot fill: could not parse JSON:', (err as Error).message);
    return applyValues({});
  }

  console.log(`[aiGenerator] Slot values received via ${hasDeepseek ? 'DeepSeek' : 'Claude'}`);
  return applyValues(values);
}

// ─── Template classifier ─────────────────────────────────────────────────────

export interface StatCard {
  label: string;
  value: string;
  desc?: string;
}

export interface TemplateClassification {
  template:     'atmospheric' | 'milestone' | 'news';
  headline:     string;
  subheadline?: string;
  stat?:        string;       // big metric number, e.g. "1,500+"
  statCards?:   StatCard[];   // up to 4 cards for milestone stats grid
  category?:    string;       // short category label for news template, e.g. "UPDATE"
}

/**
 * Uses DeepSeek to classify the post into a cover template type and extract
 * key content (headline, stat number, subtitle, stat cards). Falls back to
 * heuristics when DeepSeek is unavailable.
 *
 * milestone   — post celebrates a metric/number/achievement
 * news        — breaking news, time-sensitive announcement, event report
 * atmospheric — everything else (opinion, story, long-form update)
 */
export async function classifyPostForTemplate(
  title:   string,
  excerpt: string,
  /** Pin the cover text language; undefined = follow the post language. */
  coverLanguage?: 'ru' | 'en',
): Promise<TemplateClassification> {
  const c = await classifyPostRaw(title, excerpt, coverLanguage);
  // Cover text always uses "-": models and source titles like to emit em/en
  // dashes. Normalized here once, so every cover engine (Sonnet overlay, HTML
  // templates, Satori, fallback overlay) gets clean text.
  const fix = <T extends string | undefined>(s: T): T =>
    (s === undefined ? s : s.replace(/[—–―]/g, '-')) as T;
  return {
    ...c,
    headline:    fix(c.headline),
    subheadline: fix(c.subheadline),
    stat:        fix(c.stat),
    category:    fix(c.category),
    statCards:   c.statCards?.map(card =>
      ({ ...card, label: fix(card.label), value: fix(card.value), desc: fix(card.desc) })),
  };
}

async function classifyPostRaw(
  title:   string,
  excerpt: string,
  coverLanguage?: 'ru' | 'en',
): Promise<TemplateClassification> {

  // Heuristic fallback (used when DeepSeek is unavailable or fails)
  function heuristic(): TemplateClassification {
    const text = `${title} ${excerpt}`;
    const numMatch = text.match(/[\d][,\d]*\+?/);
    const isMilestone = numMatch !== null &&
      /пользовател|юзер|user|подписчик|subscriber|клиент|client|рост|growth|достиг|milestone|crossed|viber/i.test(text);
    if (isMilestone && numMatch) {
      return {
        template:    'milestone',
        headline:    title.slice(0, 60),
        stat:        numMatch[0].includes('+') ? numMatch[0] : numMatch[0] + '+',
        subheadline: /user|юзер|пользовател|viber/i.test(text) ? 'users' : undefined,
      };
    }
    const isNews =
      /срочно|breaking|новость|новости|сообщает|announce|вышел|вышла|запущен|launch|update|обновление/i.test(text);
    if (isNews) {
      return { template: 'news', headline: title.slice(0, 60), category: 'NEWS' };
    }
    return { template: 'atmospheric', headline: title.slice(0, 60) };
  }

  if (env.AI_PROVIDER !== 'deepseek' || !env.DEEPSEEK_API_KEY) return heuristic();

  const systemPrompt =
    'You classify a Telegram post to choose a cover template and extract cover content. ' +
    'Respond with ONLY valid JSON, no markdown.\n\n' +
    'Templates:\n' +
    '  "milestone" — celebrates a metric/number/achievement (users, growth, revenue, records)\n' +
    '  "news"      — breaking news, launch announcement, time-sensitive event, product release\n' +
    '  "atmospheric" — opinion, story, analysis, general update (everything else)\n\n' +
    'Required JSON fields:\n' +
    '  template: "milestone" | "news" | "atmospheric"\n' +
    '  headline: punchy cover headline, max 8 words, same language as post\n\n' +
    'Optional by template:\n' +
    '  (milestone) stat: the SINGLE most impressive metric from the post, formatted as string e.g. "1,500+" or "10K"\n' +
    '  (milestone) subheadline: 1-3 words describing ONLY that metric, e.g. "Vibers" or "active users"\n' +
    '  (milestone) statCards: SECONDARY stats from the post body (NOT the same as stat above). ' +
    'Extract 2-4 DIFFERENT supporting numbers. Each: {label: short uppercase, value: number string, desc?: short context}. ' +
    'Example: if stat="1000+ Vibers", statCards should be things like miners count, posts count, tokens mined — NOT Vibers again.\n' +
    '  (news) category: very short uppercase label in the SAME LANGUAGE as the post — for a Russian post use e.g. "АНОНС", "НОВОСТЬ", "ОБНОВЛЕНИЕ" (never "UPDATE"), for an English post e.g. "BREAKING", "UPDATE", "LAUNCH"\n' +
    '  (news) subheadline: 1 sentence summary, max 15 words, same language as post\n' +
    '  (atmospheric) subheadline: optional 1-sentence teaser, same language as post' +
    (coverLanguage
      ? `\n\nLANGUAGE OVERRIDE: write ALL text fields (headline, subheadline, category, statCards labels and descs) in ${coverLanguage === 'ru' ? 'Russian' : 'English'}, translating from the post language when needed. This overrides the per-field language notes above.`
      : '');

  const userPrompt = `Post title: ${title}\nExcerpt: ${excerpt.slice(0, 400)}`;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model:       env.DEEPSEEK_MODEL,
        messages:    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens:  300,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) return heuristic();

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const raw  = data.choices?.[0]?.message?.content?.trim() ?? '';
    const parsed = JSON.parse(raw) as Partial<TemplateClassification> & { statCards?: unknown[] };

    // Validate and sanitize statCards
    let statCards: StatCard[] | undefined;
    if (Array.isArray(parsed.statCards) && parsed.statCards.length > 0) {
      statCards = (parsed.statCards as unknown[])
        .slice(0, 4)
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map(c => ({
          label: typeof c['label'] === 'string' ? c['label'] : '',
          value: typeof c['value'] === 'string' ? c['value'] : String(c['value'] ?? ''),
          desc:  typeof c['desc']  === 'string' ? c['desc']  : undefined,
        }))
        .filter(c => c.label && c.value);
    }

    const tmpl = parsed.template === 'milestone' ? 'milestone'
               : parsed.template === 'news'      ? 'news'
               : 'atmospheric';

    return {
      template:    tmpl,
      headline:    typeof parsed.headline    === 'string' ? parsed.headline    : title.slice(0, 60),
      subheadline: typeof parsed.subheadline === 'string' ? parsed.subheadline : undefined,
      stat:        typeof parsed.stat        === 'string' ? parsed.stat        : undefined,
      statCards:   statCards,
      category:    typeof parsed.category    === 'string' ? parsed.category    : undefined,
    };
  } catch {
    return heuristic();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── HTML template selector ──────────────────────────────────────────────────

export interface HtmlTemplateItem {
  name: string;
  url:  string;
}

/**
 * Given a list of named HTML templates and a post, asks DeepSeek which template
 * best matches. Falls back to the first template on any error.
 * Returns null if templates array is empty.
 */
export async function selectHtmlTemplate(
  templates: HtmlTemplateItem[],
  title:     string,
  excerpt:   string,
): Promise<HtmlTemplateItem | null> {
  if (!templates.length) return null;
  if (templates.length === 1) return templates[0]!;

  // Heuristic fallback: keyword match against template names
  function heuristic(): HtmlTemplateItem {
    const text = `${title} ${excerpt}`.toLowerCase();
    for (const tpl of templates) {
      const nameLower = tpl.name.toLowerCase();
      // Check if any word from the template name appears in the post text
      const words = nameLower.split(/\s+/);
      if (words.some(w => w.length > 3 && text.includes(w))) return tpl;
    }
    return templates[0]!;
  }

  if (env.AI_PROVIDER !== 'deepseek' || !env.DEEPSEEK_API_KEY) return heuristic();

  const names = templates.map((t, i) => `${i}: "${t.name}"`).join('\n');

  const systemPrompt =
    'You select the best cover template for a Telegram post. ' +
    'Respond with ONLY a JSON object: {"index": <number>}\n\n' +
    `Available templates:\n${names}`;

  const userPrompt =
    `Post title: ${title}\nExcerpt: ${excerpt.slice(0, 300)}`;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens: 20, temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) return heuristic();

    const data   = await response.json() as { choices?: { message?: { content?: string } }[] };
    const raw    = data.choices?.[0]?.message?.content?.trim() ?? '';
    const parsed = JSON.parse(raw) as { index?: unknown };
    const idx    = typeof parsed.index === 'number' ? Math.round(parsed.index) : -1;

    if (idx >= 0 && idx < templates.length) return templates[idx]!;
    return heuristic();
  } catch {
    return heuristic();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Rubric classifier ────────────────────────────────────────────────────────

export interface RubricItem {
  id:           string;
  name:         string;
  description?: string;
  mode:         'ai' | 'html' | 'ai_html';
  templateUrl?: string;
  hybridPrompt?: string;
}

/**
 * Classifies a post into the single best-fitting channel rubric. Returns null
 * when no rubric truly fits, so the caller can keep the channel's default cover
 * flow instead of forcing every post into a rubric.
 */
export async function classifyPostRubric(
  title:   string,
  excerpt: string,
  rubrics: RubricItem[],
): Promise<RubricItem | null> {
  if (rubrics.length === 0) return null;

  const miscRubric = (): RubricItem | null =>
    rubrics.find(r => /разное|прочее|misc|other|general/i.test(r.name)) ?? null;

  function heuristic(): RubricItem | null {
    const text = `${title} ${excerpt}`.toLowerCase();
    for (const r of rubrics) {
      const words = `${r.name} ${r.description ?? ''}`.toLowerCase().split(/\s+/);
      if (words.some(w => w.length > 3 && text.includes(w))) return r;
    }
    return miscRubric();
  }

  if (env.AI_PROVIDER !== 'deepseek' || !env.DEEPSEEK_API_KEY) return heuristic();

  const list = rubrics
    .map((r, i) => `${i}: "${r.name}"${r.description ? ` — ${r.description}` : ''}`)
    .join('\n');
  const systemPrompt =
    'You assign a Telegram post to the SINGLE best-fitting channel rubric, or to no rubric if none truly fits. ' +
    'Respond with ONLY a JSON object: {"index": <number|null>}. Use null when no rubric fits.\n\n' +
    `Rubrics:\n${list}`;
  const userPrompt = `Post title: ${title}\nExcerpt: ${excerpt.slice(0, 400)}`;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens: 20, temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) return heuristic();
    const data   = await response.json() as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content?.trim() ?? '{}') as { index?: unknown };
    if (parsed.index === null) return null;
    const idx    = typeof parsed.index === 'number' ? Math.round(parsed.index) : -1;
    return (idx >= 0 && idx < rubrics.length) ? rubrics[idx]! : heuristic();
  } catch {
    return heuristic();
  } finally {
    clearTimeout(timeoutId);
  }
}
// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Returns up to 2 VariantDraft objects.
 *
 * - AI_PROVIDER=placeholder (default): returns deterministic templates, no network call.
 * - AI_PROVIDER=deepseek: calls DeepSeek API with full Channel Style context;
 *   falls back to placeholder on any error (non-200, timeout, bad JSON,
 *   empty/invalid variants).
 */
export async function generatePostVariants(params: GenerateParams): Promise<VariantDraft[]> {
  if (!env.OPENAI_API_KEY) throw new Error('Primary text model is not configured');
  return generatePostText(params);
}
