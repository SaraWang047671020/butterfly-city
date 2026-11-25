// Builder for a QuarterWork value used by the indicator rule example tests. All in memory.

import type { DistrictCode } from '../../../src/types/data-files.ts';
import type {
  Contribution,
  EngineBaseline,
  ParameterTable,
  QuarterWork,
  ToolEffects,
} from '../../../src/types/simulation.ts';
import { quarterAt } from '../../../src/simulation/quarter.ts';
import { buildBaseline, buildCommuteMatrix, buildRealTrack } from './baseline.ts';
import { buildParams } from './params.ts';

export const NO_LINKS = { parameterIds: [], sourceIds: [] } as const;

export interface WorkOptions {
  readonly params?: ParameterTable;
  readonly baseline?: EngineBaseline;
  readonly quarterIndex?: number;
  readonly effects?: Readonly<Record<string, ToolEffects>>;
  readonly eventContributions?: QuarterWork['eventContributions'];
  readonly values?: QuarterWork['values'];
  readonly migration?: QuarterWork['migration'];
}

/** Tool effects with one indicator delta for one district. */
export function effectOf(
  indicator: string,
  district: DistrictCode,
  delta: number,
  links = NO_LINKS,
): ToolEffects {
  return { deltas: { [indicator]: { [district]: delta } }, links: { [indicator]: links } };
}

export const EMPTY_EFFECTS: ToolEffects = { deltas: {}, links: {} };

/** Registry-ordered effects: socialHousing, commuterPass, rentSubsidy, sublease, holdingTax, with overrides. */
export function toolEffects(
  overrides: Readonly<Record<string, ToolEffects>> = {},
): Readonly<Record<string, ToolEffects>> {
  return {
    socialHousing: overrides['socialHousing'] ?? EMPTY_EFFECTS,
    commuterPass: overrides['commuterPass'] ?? EMPTY_EFFECTS,
    rentSubsidy: overrides['rentSubsidy'] ?? EMPTY_EFFECTS,
    sublease: overrides['sublease'] ?? EMPTY_EFFECTS,
    holdingTax: overrides['holdingTax'] ?? EMPTY_EFFECTS,
  };
}

export function eventCause(eventId: string, value: number): Contribution & { readonly eventId: string } {
  return { eventId, value, links: NO_LINKS };
}

export function buildWork(options: WorkOptions = {}): QuarterWork {
  const quarterIndex = options.quarterIndex ?? 0;
  return {
    quarter: quarterAt(quarterIndex),
    quarterIndex,
    ctx: {
      params: options.params ?? buildParams(),
      baseline: options.baseline ?? buildBaseline(),
      realTrack: buildRealTrack(),
      commute: buildCommuteMatrix(),
    },
    effects: options.effects ?? toolEffects(),
    eventContributions: options.eventContributions ?? {},
    values: options.values ?? {},
    migration: options.migration ?? null,
    carry: {},
  };
}
