import { buildCover as buildLegacyCover, parseHtmlTemplates, type BuildCoverInput } from './coverBuilder';
import { buildCoverV2 } from './coverEngineV2';
import type { GeneratedCover } from './imageGenerator';

function hasHtmlTemplateForCurrentPath(input: BuildCoverInput): boolean {
  if (input.rubricTemplate?.url) return true;
  if (input.rubricSelected) return false;
  return !!(input.useBrandKit && input.vkObj && parseHtmlTemplates(input.vkObj).length > 0);
}

function shouldUseLegacyCover(input: BuildCoverInput): boolean {
  return input.coverMode === 'ai_html' && !hasHtmlTemplateForCurrentPath(input);
}

export async function buildCoverRouted(input: BuildCoverInput): Promise<GeneratedCover | null> {
  if (shouldUseLegacyCover(input)) {
    console.log('[coverEngineRouter] legacy coverBuilder: ai_html without uploaded HTML template');
    return buildLegacyCover(input);
  }

  const result = await buildCoverV2(input);
  console.log(`[coverEngineRouter] v2: ${result.plan.scenario}; ${result.debug.join(' | ')}`);
  return result.cover;
}

