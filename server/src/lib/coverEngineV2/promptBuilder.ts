import { generateImagePromptWithAI } from '../aiGenerator';
import type { CoverContextV2, CoverPlanV2, PromptPlanV2, TemplateContractV2, VisualBriefV2 } from './types';

function compact(value: string | undefined, max: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildTemplateContractV2(
  backgroundKind: 'photo' | 'abstract',
  textZone: TemplateContractV2['textZone'],
  templateName?: string | null,
  hybridPrompt?: string,
): TemplateContractV2 {
  return {
    templateName,
    backgroundKind,
    textZone,
    focalRule: textZone === 'center'
      ? 'keep the main subject off-center or in the deep background'
      : textZone === 'bottom'
        ? 'keep the main subject in the upper or middle frame'
        : textZone === 'top'
          ? 'keep the main subject in the middle or lower frame'
          : textZone === 'full'
            ? 'avoid one dominant focal object behind text'
            : `keep the main subject away from the ${textZone} text area`,
    density: backgroundKind === 'abstract' ? 'low' : 'medium',
    backgroundRole: backgroundKind === 'abstract'
      ? 'premium non-literal texture behind an HTML template'
      : 'concrete editorial scene behind an HTML template',
    hybridPrompt,
  };
}

export function buildLegacyBrandScenePromptV2(ctx: CoverContextV2): PromptPlanV2 {
  const systemPrompt =
    'You are a visual art director writing prompts for AI image generation models. ' +
    'Given a post topic and brand style, write a short visual description for a square Telegram post cover image. ' +
    'Depict a real scene or visual metaphor that conveys the topic. ' +
    'Never depict text, numbers, letters, UI copy, logos, watermarks, or written words. ' +
    'Keep the lower third calmer and less busy so a branded news overlay can sit there. ' +
    'Use the channel style for mood, palette and lighting. Output only the visual description.';
  const userPrompt = [
    `Post topic: ${ctx.title}`,
    `Brief: ${compact(ctx.sourceSummary, 220)}`,
    ctx.imagePrompt ? `User art direction: ${compact(ctx.imagePrompt, 400)}` : '',
  ].filter(Boolean).join('\n');
  return {
    builder: 'legacy_brand_scene',
    systemPrompt,
    userPrompt,
    prompt: `${compact(ctx.title, 120)}. ${compact(ctx.sourceSummary, 260)}${ctx.imagePrompt ? `. ${compact(ctx.imagePrompt, 300)}` : ''}`,
  };
}

export function buildTemplateHybridPromptV2(
  ctx: CoverContextV2,
  plan: CoverPlanV2,
  brief: VisualBriefV2,
  contract: TemplateContractV2,
): PromptPlanV2 {
  const subjectRule = contract.backgroundKind === 'abstract'
    ? 'Create an abstract, low-detail premium background texture. Do not depict literal rooms, people, devices, charts, UI, logos, or objects.'
    : 'Create a concrete editorial scene or visual metaphor based on the post.';
  const compositionRule = contract.backgroundKind === 'abstract'
    ? 'Keep it calm, atmospheric, text-free, and free of focal objects.'
    : `The image is a background for an HTML template: fill the frame, keep overlay zones readable, and ${contract.focalRule}.`;
  const systemPrompt =
    'You are a senior visual art director writing prompts for AI image generation models. ' +
    'Write one short English image prompt, 40-80 words. ' +
    `${subjectRule} The image must reflect the event, actors, conflict, consequence, and visual metaphor. ` +
    'Never draw readable text, numbers, signs, UI, logos, watermarks, or labels. ' +
    `${compositionRule} Output only the image description.`;
  const userPrompt = [
    `Scenario: ${plan.scenario}`,
    `Post topic: ${ctx.finalTitle || ctx.title}`,
    `Post context: ${compact(ctx.postText || ctx.sourceSummary, 700)}`,
    `Core event: ${brief.coreEvent}`,
    brief.actors.length ? `Actors: ${brief.actors.join(', ')}` : '',
    `Conflict/process: ${brief.conflict}`,
    `Consequence: ${brief.consequence}`,
    `Visual metaphor: ${brief.visualMetaphor}`,
    `Template: ${contract.templateName ?? 'none'}`,
    `Background kind: ${contract.backgroundKind}`,
    `Text zone: ${contract.textZone}`,
    contract.hybridPrompt ? `Pack guidance: ${compact(contract.hybridPrompt, 500)}` : '',
    ctx.imagePrompt ? `User art direction: ${compact(ctx.imagePrompt, 400)}` : '',
  ].filter(Boolean).join('\n');
  return {
    builder: 'template_hybrid_scene',
    systemPrompt,
    userPrompt,
    prompt: `${brief.visualMetaphor}. ${brief.coreEvent}. ${contract.hybridPrompt ?? ''}`.trim(),
  };
}

export async function resolveImagePromptV2(
  ctx: CoverContextV2,
  plan: CoverPlanV2,
  brief: VisualBriefV2 | null,
  contract: TemplateContractV2 | null,
  dryRun = false,
): Promise<PromptPlanV2 | null> {
  if (!plan.needsBackground) return null;

  if (plan.scenario === 'brand_ai_overlay' || plan.scenario === 'ai_sharp_overlay') {
    const legacy = buildLegacyBrandScenePromptV2(ctx);
    if (dryRun) return legacy;
    const aiPrompt = await generateImagePromptWithAI({
      title: ctx.title,
      excerpt: ctx.sourceSummary,
      visualKit: ctx.visualKit,
      artDirection: ctx.imagePrompt?.trim() || undefined,
    }).catch(() => null);
    return { ...legacy, prompt: aiPrompt || legacy.prompt };
  }

  if (!brief || !contract) return null;
  const hybrid = buildTemplateHybridPromptV2(ctx, plan, brief, contract);
  if (dryRun) return hybrid;
  const aiPrompt = await generateImagePromptWithAI({
    title: ctx.title,
    excerpt: ctx.postText || ctx.sourceSummary,
    visualKit: ctx.visualKit,
    artDirection: ctx.imagePrompt?.trim() || undefined,
    fullBleed: true,
    backgroundKind: contract.backgroundKind,
    hybridPrompt: contract.hybridPrompt,
  }).catch(() => null);
  return { ...hybrid, prompt: aiPrompt || hybrid.prompt };
}
