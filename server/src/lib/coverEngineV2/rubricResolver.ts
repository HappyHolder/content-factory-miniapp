import { classifyPostRubric } from '../aiGenerator';
import type { CoverContextV2, RubricRef } from './types';

function heuristicRubric(ctx: CoverContextV2): RubricRef | null {
  if (ctx.rubrics.length === 0) return null;
  const text = `${ctx.title} ${ctx.sourceSummary} ${ctx.postText}`.toLowerCase();
  for (const rubric of ctx.rubrics) {
    const words = `${rubric.name} ${rubric.description ?? ''}`.toLowerCase().split(/\s+/);
    if (words.some(w => w.length > 3 && text.includes(w))) return rubric;
  }
  return ctx.rubrics.find(r => /разное|прочее|misc|other|general/i.test(r.name)) ?? null;
}

export async function resolveRubricV2(ctx: CoverContextV2, dryRun = false): Promise<RubricRef | null> {
  if (ctx.rubrics.length === 0) return null;
  if (dryRun) return heuristicRubric(ctx);
  return classifyPostRubric(ctx.title, ctx.sourceSummary, ctx.rubrics);
}
