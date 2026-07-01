import { classifyPostForTemplate } from '../aiGenerator';
import { generateImageForPost } from '../imageGenerator';
import { buildCoverContextV2 } from './contextBuilder';
import { satoriFallbackPlanV2 } from './fallbacks';
import { generateBackgroundV2 } from './imageService';
import { renderCoverOverlayV2 } from './overlayService';
import { buildTemplateContractV2, resolveImagePromptV2 } from './promptBuilder';
import { assessPromptQualityV2 } from './quality';
import { resolveRubricV2 } from './rubricResolver';
import { fetchTemplateHtmlV2, inferBackgroundKindV2, resolveTemplateV2 } from './templateResolver';
import { createVisualBriefV2 } from './visualBrief';
import type { CoverEngineV2Input, CoverEngineV2Result, CoverPlanV2, TemplateContractV2, VisualBriefV2 } from './types';

function planCoverV2(params: {
  ctxMode: CoverEngineV2Input['coverMode'];
  rubric: Awaited<ReturnType<typeof resolveRubricV2>>;
  template: Awaited<ReturnType<typeof resolveTemplateV2>>;
  backgroundKind: 'photo' | 'abstract';
}): CoverPlanV2 {
  const { ctxMode, rubric, template, backgroundKind } = params;
  if (rubric && template) {
    return {
      scenario: 'rubric_template_pack',
      mode: rubric.mode,
      rubric,
      template,
      backgroundKind,
      needsBackground: rubric.mode === 'ai_html',
      needsHtmlOverlay: true,
      usesSharpOverlay: false,
      reason: 'rubric selected a template pack recipe',
    };
  }
  if (ctxMode === 'html' && template) {
    return {
      scenario: 'html_template',
      mode: 'html',
      rubric,
      template,
      backgroundKind,
      needsBackground: false,
      needsHtmlOverlay: true,
      usesSharpOverlay: false,
      reason: 'HTML template mode with a concrete template',
    };
  }
  if (ctxMode === 'ai_html' && template) {
    return {
      scenario: 'hybrid_template_background',
      mode: 'ai_html',
      rubric,
      template,
      backgroundKind,
      needsBackground: true,
      needsHtmlOverlay: true,
      usesSharpOverlay: false,
      reason: 'AI background must satisfy a real HTML template contract',
    };
  }
  if (ctxMode === 'ai_html') {
    return {
      scenario: 'brand_ai_overlay',
      mode: 'ai_html',
      rubric,
      template: null,
      backgroundKind: 'photo',
      needsBackground: true,
      needsHtmlOverlay: true,
      usesSharpOverlay: false,
      reason: 'channel branded overlay without a market/template contract',
    };
  }
  if (ctxMode === 'html') {
    return satoriFallbackPlanV2('HTML mode selected without an uploaded HTML template');
  }
  return {
    scenario: 'ai_sharp_overlay',
    mode: 'ai',
    rubric,
    template: null,
    backgroundKind: 'photo',
    needsBackground: true,
    needsHtmlOverlay: false,
    usesSharpOverlay: true,
    reason: 'pure AI cover with sharp text/logo overlay',
  };
}

export async function buildCoverV2(input: CoverEngineV2Input): Promise<CoverEngineV2Result> {
  const debug: string[] = [];
  const dryRun = input.dryRun === true;
  const ctx = buildCoverContextV2(input);
  debug.push(`context mode=${ctx.mode} templates=${ctx.htmlTemplates.length} rubrics=${ctx.rubrics.length}`);

  const rubric = await resolveRubricV2(ctx, dryRun);
  const template = await resolveTemplateV2(ctx, rubric, dryRun);
  const referenceHtml = dryRun ? null : await fetchTemplateHtmlV2(template);
  const backgroundKind = inferBackgroundKindV2(referenceHtml, template?.name);
  const plan = planCoverV2({ ctxMode: ctx.mode, rubric, template, backgroundKind });
  debug.push(`plan scenario=${plan.scenario} reason=${plan.reason}`);

  const classification = dryRun
    ? null
    : await classifyPostForTemplate(ctx.title, ctx.sourceSummary, ctx.coverLanguage);

  let brief: VisualBriefV2 | null = null;
  let contract: TemplateContractV2 | null = null;
  if (plan.scenario === 'hybrid_template_background' || plan.scenario === 'rubric_template_pack') {
    brief = await createVisualBriefV2(ctx, dryRun);
    contract = buildTemplateContractV2(plan.backgroundKind, 'full', template?.name, rubric?.hybridPrompt ?? ctx.explicitHybridPrompt);
    debug.push(`template contract kind=${contract.backgroundKind} zone=${contract.textZone}`);
  }

  const promptPlan = await resolveImagePromptV2(ctx, plan, brief, contract, dryRun);
  const quality = assessPromptQualityV2(promptPlan, brief);
  if (!quality.ok) debug.push(`quality warning=${quality.reason}`);

  if (dryRun) {
    return { cover: null, plan, promptPlan, classification, debug };
  }

  if (plan.scenario === 'ai_sharp_overlay' && promptPlan) {
    const cover = await generateImageForPost({
      prompt: promptPlan.prompt,
      visualKit: ctx.visualKit,
      aspectRatio: ctx.aspectRatio,
      headline: ctx.finalTitle,
      model: ctx.imageModel,
    });
    return { cover, plan, promptPlan, classification, debug };
  }

  const backgroundUrl = await generateBackgroundV2(ctx, plan, promptPlan, contract);
  const rendered = classification
    ? await renderCoverOverlayV2({ ctx, plan, template, referenceHtml, backgroundUrl, classification, contract })
    : null;
  if (rendered) return { cover: rendered, plan, promptPlan, classification, debug };

  const fallbackPlan = satoriFallbackPlanV2('V2 renderer did not produce a cover');
  const fallback = classification
    ? await renderCoverOverlayV2({ ctx, plan: fallbackPlan, template: null, referenceHtml: null, backgroundUrl: null, classification, contract: null })
    : null;
  return { cover: fallback, plan: fallbackPlan, promptPlan, classification, debug };
}


