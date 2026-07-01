import { buildCoverV2 } from './coverEngine';
import type { CoverEngineV2Input, CoverEngineV2Result } from './types';

export type CoverEngineV2DryRunInput = Omit<CoverEngineV2Input, 'dryRun'>;

export async function dryRunCoverV2(input: CoverEngineV2DryRunInput): Promise<CoverEngineV2Result> {
  return buildCoverV2({ ...input, dryRun: true });
}
