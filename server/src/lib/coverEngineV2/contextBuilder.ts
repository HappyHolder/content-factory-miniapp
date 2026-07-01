import type { CoverContextV2, CoverEngineV2Input, HtmlTemplateRef, RubricRef } from './types';

export function parseHtmlTemplatesV2(vkObj: Record<string, unknown> | null): HtmlTemplateRef[] {
  const raw = vkObj?.['htmlTemplates'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is HtmlTemplateRef =>
    !!t && typeof t === 'object' &&
    typeof (t as Record<string, unknown>)['name'] === 'string' &&
    typeof (t as Record<string, unknown>)['url'] === 'string' &&
    !!(t as Record<string, unknown>)['url']);
}

export function parseRubricsV2(vkObj: Record<string, unknown> | null): RubricRef[] {
  const raw = vkObj?.['rubrics'];
  if (!Array.isArray(raw)) return [];
  const out: RubricRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
    if (!name) continue;
    const templateUrl = typeof r['templateUrl'] === 'string' && r['templateUrl'] ? r['templateUrl'] : undefined;
    const rawMode = r['mode'];
    const mode = rawMode === 'html' || rawMode === 'ai_html' ? rawMode : 'ai';
    out.push({
      id: typeof r['id'] === 'string' && r['id'] ? r['id'] : name,
      name,
      description: typeof r['description'] === 'string' ? r['description'] : undefined,
      mode,
      templateUrl,
      hybridPrompt: typeof r['hybridPrompt'] === 'string' && r['hybridPrompt'].trim() ? r['hybridPrompt'].trim() : undefined,
    });
  }
  return out;
}

export function buildCoverContextV2(input: CoverEngineV2Input): CoverContextV2 {
  const postText = (input.input || input.sourceSummary || input.finalTitle || input.title).trim();
  const htmlTemplates = input.useBrandKit ? parseHtmlTemplatesV2(input.vkObj) : [];
  const rubrics = input.useBrandKit ? parseRubricsV2(input.vkObj) : [];
  return {
    mode: input.coverMode,
    title: input.title,
    sourceSummary: input.sourceSummary,
    finalTitle: input.finalTitle,
    postText,
    imagePrompt: input.imagePrompt,
    visualKit: input.visualKit,
    vkObj: input.vkObj,
    aspectRatio: input.aspectRatio,
    imageModel: input.imageModel,
    coverLanguage: input.coverLanguage,
    slotBrandCtx: input.slotBrandCtx,
    htmlTemplates,
    rubrics,
    explicitTemplate: input.rubricTemplate ?? null,
    explicitHybridPrompt: input.rubricHybridPrompt,
    rubricSelected: input.rubricSelected === true,
  };
}


