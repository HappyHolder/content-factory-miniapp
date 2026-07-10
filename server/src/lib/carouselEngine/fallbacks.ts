/**
 * carouselEngine/fallbacks.ts
 *
 * Every refusal path lands here. There is exactly one fallback and it is "no
 * carousel" — the post keeps its rubric cover and its text, byte for byte what
 * it would have been before this engine existed.
 *
 * No default slide design is drawn when a channel has no template. A cover has a
 * Satori fallback because a post MUST have an image; a carousel is optional, and
 * inventing slides would push a design the channel owner never chose into their
 * feed — the exact generic look the cover engines fight to avoid.
 */

import type { CarouselMode, CarouselResult, CarouselScenario } from './types';

export function noCarousel(params: {
  scenario:      CarouselScenario;
  reason:        string;
  requestedMode: CarouselMode;
  mode:          CarouselMode;
  debug?:        string[];
}): CarouselResult {
  const { scenario, reason, requestedMode, mode, debug = [] } = params;
  return {
    block: null,
    plan:  { scenario, requestedMode, mode, slideCount: 0, position: 'end', reason },
    debug: [...debug, `refused: ${scenario} — ${reason}`],
  };
}
