import { env } from '../env';

export type CoverRenderMode = 'ai' | 'html' | 'ai_html';
export type BackgroundKind = 'photo' | 'abstract';
export type TextZone = 'top' | 'bottom' | 'left' | 'right' | 'center' | 'full';

export interface VisualBrief {
  coreEvent: string;
  mainActors: string[];
  conflict: string;
  consequence: string;
  visualMetaphor: string;
  avoid: string[];
  keywords: string[];
}

export interface RubricPolicy {
  name: string;
  intent: string;
  backgroundRole: string;
  metaphorBias: string;
  avoid: string[];
}

export interface TemplateContract {
  templateName?: string | null;
  backgroundKind: BackgroundKind;
  textZone: TextZone;
  focalZone: string;
  density: 'low' | 'medium' | 'high';
  backgroundRole: string;
  avoid: string[];
}

export interface PromptBuilderInput {
  title: string;
  excerpt: string;
  visualBrief?: VisualBrief | null;
  rubricPolicy?: RubricPolicy | null;
  templateContract?: TemplateContract | null;
  channelStyle?: string;
  artDirection?: string;
  hybridPrompt?: string;
  renderMode: CoverRenderMode;
  backgroundKind?: BackgroundKind;
  fullBleed?: boolean;
}

function cleanText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, 240) : fallback;
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim().replace(/\s+/g, ' ').slice(0, 80)).slice(0, 6)
    : [];
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

function fallbackVisualBrief(title: string, content: string): VisualBrief {
  const text = `${title}. ${content}`.replace(/\s+/g, ' ').trim();
  const firstSentence = text.split(/[.!?。！？]\s+/)[0]?.slice(0, 180) || title;
  const numberMatches = Array.from(text.matchAll(/(?:\d+[\d\s.,]*%?|\$\d+[\d\s.,]*[BMK]?|\d+[\d\s.,]*\+?)/gi)).map(m => m[0].trim()).slice(0, 4);
  const keywords = Array.from(new Set((text.match(/[A-Za-zА-Яа-яЁё]{4,}/g) ?? [])
    .map(w => w.toLowerCase())
    .filter(w => !/^(this|that|with|from|have|will|their|about|через|котор|должн|будет|были|было|если|после)$/i.test(w))))
    .slice(0, 8);

  return {
    coreEvent: firstSentence,
    mainActors: keywords.slice(0, 3),
    conflict: numberMatches.length ? `Key figures: ${numberMatches.join(', ')}` : 'The post contains a change, tension, or decision that should drive the visual.',
    consequence: text.slice(0, 220),
    visualMetaphor: 'A concrete scene that shows the central process, conflict, or consequence of the post, not a generic mood image.',
    avoid: ['generic cityscape', 'random skyscraper', 'empty room', 'vague technology background', 'decorative abstract mood shot'],
    keywords,
  };
}

export async function createVisualBrief(params: {
  title: string;
  content: string;
  rubricName?: string | null;
  coverLanguage?: 'ru' | 'en';
}): Promise<VisualBrief> {
  const title = params.title.trim() || 'Post';
  const content = params.content.trim();
  const fallback = fallbackVisualBrief(title, content);

  if (env.AI_PROVIDER !== 'deepseek' || !env.DEEPSEEK_API_KEY || !content) return fallback;

  const systemPrompt =
    'You are a visual editor. Analyze the full post and return ONLY valid JSON for an image-generation brief. ' +
    'Do not write an image prompt. Extract the story logic: event, actors, conflict, consequence, and one concrete visual metaphor. ' +
    'The metaphor must be specific to the post, not a generic city, office, server room, or abstract technology background. ' +
    'Never include instructions to render text, labels, numbers, signs, UI, letters, logos, or readable documents in the image.';

  const userPrompt =
    `Rubric: ${params.rubricName ?? 'none'}\n` +
    `Post title: ${title}\n` +
    `Full post:\n${content.slice(0, 2800)}\n\n` +
    'Return JSON exactly with keys: coreEvent string, mainActors string[], conflict string, consequence string, visualMetaphor string, avoid string[], keywords string[].';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens: 500,
        temperature: 0.2,
      }),
    });
    if (!response.ok) return fallback;
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
    const parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
    return {
      coreEvent: cleanText(parsed.coreEvent, fallback.coreEvent),
      mainActors: cleanList(parsed.mainActors).length ? cleanList(parsed.mainActors) : fallback.mainActors,
      conflict: cleanText(parsed.conflict, fallback.conflict),
      consequence: cleanText(parsed.consequence, fallback.consequence),
      visualMetaphor: cleanText(parsed.visualMetaphor, fallback.visualMetaphor),
      avoid: cleanList(parsed.avoid).length ? cleanList(parsed.avoid) : fallback.avoid,
      keywords: cleanList(parsed.keywords).length ? cleanList(parsed.keywords) : fallback.keywords,
    };
  } catch (err) {
    console.warn('[coverPromptBuilder] VisualBrief failed, using fallback:', (err as Error).message);
    return fallback;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function buildRubricPolicy(name?: string | null, description?: string | null): RubricPolicy | null {
  const raw = `${name ?? ''} ${description ?? ''}`.trim();
  if (!raw) return null;
  const text = raw.toLowerCase();
  const policy: RubricPolicy = {
    name: name?.trim() || 'Rubric',
    intent: 'Match the visual to the rubric intent and the actual post, with the post taking priority.',
    backgroundRole: 'support the post meaning without competing with the template text',
    metaphorBias: 'concrete visual metaphor for the central story',
    avoid: ['generic mood image', 'template-looking UI inside the background'],
  };

  if (/news|новост|событ|объявл|инфоповод/.test(text)) {
    policy.intent = 'news: show the event, decision, conflict, or consequence behind the post';
    policy.metaphorBias = 'event-driven editorial scene, not decorative atmosphere';
  } else if (/opinion|мнен|quote|insight|тезис/.test(text)) {
    policy.intent = 'opinion: support a point of view or quote with atmosphere, texture, or a restrained metaphor';
    policy.backgroundRole = 'stay calmer so the quote/card is the main focus';
    policy.metaphorBias = 'symbolic atmosphere or abstract premium texture';
  } else if (/guide|гайд|how|инструк|обуч/.test(text)) {
    policy.intent = 'guide: show process, steps, tools, or a clear learning path';
    policy.metaphorBias = 'ordered process or instructional scene';
  } else if (/top|топ|rating|list|рейтинг|спис/.test(text)) {
    policy.intent = 'top/list: show comparison, selection, ranking, or multiple items';
    policy.metaphorBias = 'curated set, ranking, dashboard-like scene without readable UI text';
  } else if (/recap|digest|дайджест|итог/.test(text)) {
    policy.intent = 'digest: show several events gathered into one overview';
    policy.metaphorBias = 'overview, constellation, board, or grouped signals without readable text';
  } else if (/signal|сигнал|trade|торг/.test(text)) {
    policy.intent = 'signal: show market tension, levels, risk, direction, or trading setup';
    policy.metaphorBias = 'financial/market visual metaphor without charts containing readable labels';
  }
  return policy;
}

export function buildTemplateContract(params: {
  templateName?: string | null;
  backgroundKind: BackgroundKind;
  textZone?: TextZone | null;
  referenceHtml?: string | null;
}): TemplateContract {
  const html = (params.referenceHtml ?? '').toLowerCase();
  const textZone = params.textZone ?? 'full';
  const dense = /card|cards|grid|list|row|recap|quote|author|stat/.test(html);
  const backgroundKind = params.backgroundKind;
  return {
    templateName: params.templateName,
    backgroundKind,
    textZone,
    focalZone: textZone === 'center'
      ? 'off-center or deep background, never directly behind the central headline'
      : textZone === 'top'
        ? 'middle or lower frame, away from the header/headline'
        : textZone === 'bottom'
          ? 'upper or middle frame, away from footer text'
          : textZone === 'full'
            ? 'distributed, no single dominant object behind text'
            : `away from the ${textZone} text zone`,
    density: dense || backgroundKind === 'abstract' ? 'low' : 'medium',
    backgroundRole: backgroundKind === 'abstract'
      ? 'premium texture/material behind the HTML template'
      : 'contextual scene behind the HTML template',
    avoid: [
      'readable text or signage inside the image',
      'main subject directly behind headline',
      'bright busy details under text',
      'large flat black overlay',
    ],
  };
}

function briefLine(brief?: VisualBrief | null): string {
  if (!brief) return '';
  return [
    `Core event: ${brief.coreEvent}`,
    brief.mainActors.length ? `Actors: ${brief.mainActors.join(', ')}` : '',
    brief.conflict ? `Conflict/process: ${brief.conflict}` : '',
    brief.consequence ? `Stakes/consequence: ${brief.consequence}` : '',
    brief.visualMetaphor ? `Preferred visual metaphor: ${brief.visualMetaphor}` : '',
    brief.avoid.length ? `Avoid: ${brief.avoid.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function rubricLine(policy?: RubricPolicy | null): string {
  if (!policy) return '';
  return [
    `Rubric policy (${policy.name}): ${policy.intent}`,
    `Background role: ${policy.backgroundRole}`,
    `Metaphor bias: ${policy.metaphorBias}`,
    policy.avoid.length ? `Rubric avoid: ${policy.avoid.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function contractLine(contract?: TemplateContract | null): string {
  if (!contract) return '';
  return [
    `Template contract${contract.templateName ? ` (${contract.templateName})` : ''}: ${contract.backgroundRole}`,
    `Background kind: ${contract.backgroundKind}`,
    `Text zone: ${contract.textZone}`,
    `Focal subject zone: ${contract.focalZone}`,
    `Density: ${contract.density}`,
    contract.avoid.length ? `Template avoid: ${contract.avoid.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

export function buildImagePromptMessages(input: PromptBuilderInput): { systemPrompt: string; userPrompt: string } {
  const backgroundKind = input.backgroundKind ?? input.templateContract?.backgroundKind ?? 'photo';
  const subjectRule = backgroundKind === 'abstract'
    ? 'Create an abstract, low-detail background texture or soft material surface. Use blurred shapes, atmospheric light, subtle noise, glass, fabric, metal, or gradient depth. Do NOT depict a literal room, person, object, device, chart, logo, screenshot, or recognizable scene. '
    : 'Create a real scene or a concrete visual metaphor based on the visual brief. ';

  const compositionRule = backgroundKind === 'abstract'
    ? 'COMPOSITION: the image is only a background material for an HTML template. Keep it calm, low-contrast, non-literal, text-free, and free of focal objects. '
    : input.fullBleed
      ? 'COMPOSITION: the image is a background layer for a template. Fill the square coherently, keep overlay zones readable, and do not place a dominant focal object under the template text. '
      : 'COMPOSITION: keep the lower third calmer and less busy so overlaid text stays readable. ';

  const systemPrompt =
    'You are a senior visual art director writing prompts for AI image generation models. ' +
    'Write one short English image prompt, 40-80 words, for a square Telegram cover background. ' +
    subjectRule +
    'The image must be specifically about the post: use the central event, actors, conflict/process, consequence, and visual metaphor from the visual brief. ' +
    'Never default to generic cityscapes, random skyscrapers, empty rooms, generic server rooms, vague technology backgrounds, galaxies, or decorative mood shots unless the brief explicitly requires them. ' +
    'NEVER depict readable text, numbers, letters, digits, UI copy, logos, watermarks, or signage inside the image. ' +
    compositionRule +
    'Use the channel style for mood, palette, lighting, and medium. ' +
    'Output ONLY the image description, no markdown, no explanations, no negative prompt list.';

  const userPrompt = [
    `Render mode: ${input.renderMode}`,
    `Post topic: ${input.title}`,
    `Post context: ${input.excerpt.slice(0, 700)}`,
    briefLine(input.visualBrief),
    rubricLine(input.rubricPolicy),
    contractLine(input.templateContract),
    input.channelStyle ? `Channel style: ${input.channelStyle}` : '',
    input.artDirection ? `User art direction: ${input.artDirection.slice(0, 500)}` : '',
    input.hybridPrompt ? `Hybrid/template guidance: ${input.hybridPrompt.slice(0, 500)}` : '',
    'Image prompt:',
  ].filter(Boolean).join('\n\n');

  return { systemPrompt, userPrompt };
}

export function buildCorrectiveImagePrompt(params: {
  prompt: string;
  visualBrief?: VisualBrief | null;
  templateContract?: TemplateContract | null;
  reason: string;
}): string {
  const avoid = params.visualBrief?.avoid?.join(', ') || 'generic background';
  const focal = params.templateContract?.focalZone || 'away from text zones';
  return `${params.prompt}. Correction: ${params.reason}. Make the scene more specifically about: ${params.visualBrief?.coreEvent ?? 'the post topic'}. Use this metaphor: ${params.visualBrief?.visualMetaphor ?? 'a concrete story-specific visual metaphor'}. Avoid ${avoid}. Keep the focal subject ${focal}. No readable text or signs.`;
}

export function assessPromptQuality(prompt: string, visualBrief?: VisualBrief | null): { ok: boolean; reason?: string } {
  const p = prompt.toLowerCase();
  const generic = /\b(cityscape|skyscraper|office tower|empty room|server room|technology background|abstract gradient|galaxy|nebula)\b/.test(p);
  const briefWords = [
    ...(visualBrief?.keywords ?? []),
    ...(visualBrief?.mainActors ?? []),
    visualBrief?.coreEvent ?? '',
    visualBrief?.conflict ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .match(/[a-zа-яё]{4,}/gi) ?? [];
  const unique = Array.from(new Set(briefWords)).slice(0, 12);
  const hits = unique.filter(w => p.includes(w)).length;
  if (generic && hits < 2) return { ok: false, reason: 'prompt is too generic for the visual brief' };
  if (visualBrief && hits === 0) return { ok: false, reason: 'prompt does not reflect the visual brief keywords' };
  return { ok: true };
}
export function assessGeneratedImageDescription(description: string | null, visualBrief?: VisualBrief | null): { ok: boolean; reason?: string } {
  if (!description || !visualBrief) return { ok: true };
  const d = description.toLowerCase();
  if (/readable text|visible text|sign says|logo|watermark|caption|lettering|words on/i.test(description)) {
    return { ok: false, reason: 'generated image appears to contain readable text or signage' };
  }
  const generic = /\b(city street|cityscape|skyscraper|office tower|server room|empty room|generic technology|abstract background|galaxy|nebula)\b/.test(d);
  const terms = Array.from(new Set([
    ...(visualBrief.keywords ?? []),
    ...(visualBrief.mainActors ?? []),
    visualBrief.coreEvent,
    visualBrief.conflict,
    visualBrief.consequence,
  ].join(' ').toLowerCase().match(/[a-zа-яё]{4,}/gi) ?? [])).slice(0, 16);
  const hits = terms.filter(t => d.includes(t)).length;
  if (generic && hits < 2) return { ok: false, reason: 'generated image looks generic instead of story-specific' };
  if (terms.length >= 3 && hits === 0) return { ok: false, reason: 'generated image description does not match the visual brief' };
  return { ok: true };
}