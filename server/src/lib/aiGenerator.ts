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
import { replicateText } from './replicateText';

type ModelTier = 'LOW' | 'HIGH';

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

/** Builds the system + user prompts for variant generation (shared by all transports). */
function buildVariantPrompts(params: GenerateParams): { systemPrompt: string; userPrompt: string } {
  const { input, sourceType, channel, brandKit } = params;

  const { context, language, addressStyle, signatureBlock, signatureUsage, customNote, examplePosts } =
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

  userParts.push(`=== Content to transform into 2 post variants ===\n${input}`);

  const userPrompt = userParts.join('\n\n');

  return { systemPrompt, userPrompt };
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
      text:  (v as Record<string, unknown>)['text']  as string,
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
        // 4096 (not 2048): bilingual variants carry the post in BOTH languages.
        max_tokens:  4096,
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

/** HIGH tier: Claude on Replicate (single prompt → JSON text). */
async function generateWithClaude(params: GenerateParams): Promise<VariantDraft[]> {
  const { systemPrompt, userPrompt } = buildVariantPrompts(params);

  const raw = await replicateText({
    model:        env.HIGH_TEXT_MODEL,
    systemPrompt,
    prompt:       userPrompt,
    maxTokens:    4096,
    temperature:  0.7,
    timeoutMs:    120_000,
  });

  if (!raw) {
    console.error('[aiGenerator] Claude (Replicate) returned nothing — falling back to placeholder');
    return buildPlaceholderVariants(params.input);
  }

  return parseVariantsJson(raw, params.input, 'replicate');
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

  const { title, excerpt, visualKit, artDirection, fullBleed, backgroundKind, hybridPrompt } = params;
  const styleDesc = buildVisualStyleDescription(visualKit);

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
 * Replicate (HIGH_TEXT_MODEL). Returns the filled HTML, or null when there are
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

  const hasDeepseek  = env.AI_PROVIDER === 'deepseek' && !!env.DEEPSEEK_API_KEY;
  const hasReplicate = !!env.REPLICATE_API_TOKEN;
  if (!hasDeepseek && !hasReplicate) return null;

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
    '1. IDENTITY slots — author/byline/signature, rubric/section name, the channel\'s own hashtags. ' +
    'Fill these from the CHANNEL IDENTITY block, NOT from the post, and NEVER with the source outlet\'s name. ' +
    'An author/byline/signature slot = the channel\'s PROJECT or BRAND NAME — derive it from the channel name or its ' +
    '"about" description; do NOT use the raw @handle (it is often arbitrary, like a username). ' +
    'A rubric/section slot = a short label in the channel\'s own style.\n' +
    '2. CONTENT slots — title/headline, description/subtitle, metrics, badge. Rewrite these FROM the post, ' +
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
    'RUBRIC/SECTION/CATEGORY = the channel\'s section label; TAGS = the channel\'s hashtags.\n\n' +
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

  // Provider-agnostic JSON completion: DeepSeek when configured, else Claude.
  const rawJson = hasDeepseek
    ? await fillSlotsViaDeepseek(systemPrompt, userPrompt)
    : await replicateText({
        model:        env.HIGH_TEXT_MODEL,
        systemPrompt: systemPrompt + '\n\nReturn ONLY the JSON object — no prose, no code fences.',
        prompt:       userPrompt,
        maxTokens:    800,
        temperature:  0.5,
        timeoutMs:    40_000,
      });
  if (!rawJson) return null;

  let values: Record<string, unknown>;
  try {
    values = JSON.parse(extractJsonObject(rawJson)) as Record<string, unknown>;
  } catch (err) {
    console.warn('[aiGenerator] Slot fill: could not parse JSON:', (err as Error).message);
    return null;
  }

  const fixedRubricLabel = rubricSlotLabel(brand?.rubricName, post.coverLanguage);
  const filled = templateHtml.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (fixedRubricLabel && /^(RUBRIC|SECTION|CATEGORY)$/i.test(key)) return escapeHtmlText(fixedRubricLabel);
    const v = values[key];
    return typeof v === 'string' ? escapeHtmlText(v)
         : typeof v === 'number' ? String(v)
         : '';
  });
  console.log(`[aiGenerator] Filled ${slots.length} template slots via ${hasDeepseek ? 'DeepSeek' : 'Claude'}`);
  return filled;
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
export async function generatePostVariants(
  params: GenerateParams,
  modelTier: ModelTier = 'LOW',
): Promise<VariantDraft[]> {
  // HIGH: premium text model (Claude) on Replicate. Falls back to DeepSeek/
  // placeholder inside generateWithClaude on any failure.
  if (modelTier === 'HIGH' && env.REPLICATE_API_TOKEN) {
    return generateWithClaude(params);
  }
  if (env.AI_PROVIDER === 'deepseek') {
    return generateWithDeepSeek(params);
  }
  return buildPlaceholderVariants(params.input);
}
