/**
 * Id_Set_Check (Requirement 20.4 to 20.7, 20.13): the ids the engine reads versus the ids of the
 * built parameter table.
 */
import { collectParameterSpecs, RULE_REGISTRY } from '../../../src/simulation/registry.ts';
import { DISTRICTS } from '../../lib/districts.ts';

/** Ids that the engine reads but no rule declares (the 41 `commute.jobShare.<code>` ids are added in `engineIdSet`). */
export const ENGINE_EXTRA_IDS: readonly string[] = [
  'limit.commuterPass.subsidy.lowerFactor',
  'limit.rentSubsidy.households.lowerFactor',
  'limit.rentSubsidy.households.upperFactor',
  'limit.rentSubsidy.amount.lowerFactor',
  'limit.rentSubsidy.amount.upperFactor',
];

/** The five fixed Omitted_Optional_Ids; every `budget.ceiling.` id is also omitted, by prefix. */
export const OMITTED_OPTIONAL_IDS: readonly string[] = [
  'limit.socialHousing.unitsStarted.upperMin',
  'limit.socialHousing.unitsStarted.min',
  'limit.socialHousing.unitsStarted.max',
  'commuterPass.costSchedule',
  'rentSubsidy.costSchedule',
];

const OMITTED_PREFIX = 'budget.ceiling.';
const PRICE_PREFIX = 'commuterPass.price.';

function isOmitted(id: string): boolean {
  return OMITTED_OPTIONAL_IDS.includes(id) || id.startsWith(OMITTED_PREFIX);
}

/** The Engine_Id_Set: rule-declared ids, minus price and omitted ids, plus the extra ids and 41 job shares. */
export function engineIdSet(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const spec of collectParameterSpecs(RULE_REGISTRY)) {
    if (spec.id.startsWith(PRICE_PREFIX) || isOmitted(spec.id)) continue;
    out.add(spec.id);
  }
  for (const id of ENGINE_EXTRA_IDS) out.add(id);
  for (const d of DISTRICTS) out.add(`commute.jobShare.${d.code}`);
  return out;
}

export interface IdSetDiff {
  readonly missing: readonly string[];
  readonly extra: readonly string[];
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ids of the engine absent from the built table (`missing`) and built ids outside the engine set (`extra`). */
export function idSetDiff(built: Iterable<string>, engine: ReadonlySet<string>): IdSetDiff {
  const have = new Set(built);
  const missing = [...engine].filter((id) => !have.has(id)).sort(byCodePoint);
  const extra = [...have].filter((id) => !engine.has(id)).sort(byCodePoint);
  return { missing, extra };
}
