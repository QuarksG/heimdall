import { TrOfaRemittanceProcessor } from './implementations/tr/TrOfaRemittanceProcessor';
import type { BaseRemittanceProcessor } from './base/BaseRemittanceProcessor';

/**
 * REGION DISPATCH — the single place a region code becomes a processor.
 *
 * Replaces the old broken `config/regions/index.ts` RegionRegistry (which
 * had unresolvable imports and zero callers) and makes the hook's
 * `regionCode` parameter real: an unsupported region now fails loudly
 * instead of silently running the TR processor (BC-06).
 *
 * Adding a region: implement its processor and add ONE entry here.
 */
const PROCESSOR_FACTORIES: Record<string, () => BaseRemittanceProcessor> = {
  TR: () => new TrOfaRemittanceProcessor(),
};

export function createRemittanceProcessor(regionCode: string): BaseRemittanceProcessor {
  const factory = PROCESSOR_FACTORIES[regionCode.toUpperCase()];
  if (!factory) {
    const supported = Object.keys(PROCESSOR_FACTORIES).join(', ');
    throw new Error(
      `Unsupported region "${regionCode}". Supported regions: ${supported}.`,
    );
  }
  return factory();
}
