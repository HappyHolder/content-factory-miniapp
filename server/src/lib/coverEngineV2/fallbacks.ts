import type { CoverPlanV2 } from './types';

export function satoriFallbackPlanV2(reason: string): CoverPlanV2 {
  return {
    scenario: 'satori_fallback',
    mode: 'html',
    rubric: null,
    template: null,
    backgroundKind: 'abstract',
    needsBackground: false,
    needsHtmlOverlay: true,
    usesSharpOverlay: false,
    reason,
  };
}
