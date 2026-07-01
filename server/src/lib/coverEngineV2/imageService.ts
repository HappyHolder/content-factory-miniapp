import { generateImageForPost } from '../imageGenerator';
import type { CoverContextV2, CoverPlanV2, PromptPlanV2, TemplateContractV2 } from './types';

export async function generateBackgroundV2(
  ctx: CoverContextV2,
  plan: CoverPlanV2,
  promptPlan: PromptPlanV2 | null,
  contract: TemplateContractV2 | null,
): Promise<string | null> {
  if (!promptPlan || !plan.needsBackground) return null;
  const backgroundOnly = plan.scenario === 'brand_ai_overlay' || plan.scenario === 'hybrid_template_background' || plan.scenario === 'rubric_template_pack';
  const image = await generateImageForPost({
    prompt: promptPlan.prompt,
    visualKit: ctx.visualKit,
    aspectRatio: ctx.aspectRatio,
    backgroundOnly,
    backgroundKind: contract?.backgroundKind ?? 'photo',
    calmZone: contract?.textZone,
    headline: backgroundOnly ? undefined : ctx.finalTitle,
    model: ctx.imageModel,
  });
  return image?.bannerUrl ?? null;
}
