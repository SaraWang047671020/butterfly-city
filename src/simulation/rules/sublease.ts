// Sublease and rental management tool rule (housing-tools Requirement 4). City level, stock effect.
// Field: `unitsMatched` (integer, homes newly matched per city and quarter).
//
// A matched home houses one renter household at `sublease.rentShare` of market rent, so the household's rent falls
// by `(1 - rentShare) x rent_d x dwellingSize`. The extra homes stay in the programme for the rest of the game
// (contracts of 3 years, renewable twice, so at least 9 years, longer than the 2017-2025 span of the programme in
// the game): the effect is a stock. The programme sets the rent, so nothing passes into market rents.
// Differences in, deltas out: nothing here reads the player's absolute value except to build a difference.

import type { CityName, DistrictCode, QuarterKey } from '../../types/data-files.ts';
import type {
  AreaKey,
  CauseLinks,
  EngineError,
  GhostGroupContribution,
  ParameterSpec,
  RuleContext,
  ToolEffects,
  ToolField,
  ToolRule,
  ToolSetting,
} from '../../types/simulation.ts';
import { CITY_ORDER, MAX_LAG } from '../constants.ts';
import { districtFacts, type DistrictFacts } from '../derived.ts';
import { derivedInputInvalid, policyValueInvalid, trackMissing } from '../errors.ts';
import { roundHalfUp } from '../numeric.ts';
import { expandId, scalar } from '../params.ts';

const TOOL_ID = 'sublease';
const FIELD = 'unitsMatched';
export const SUBLEASE_LAG_ID = 'sublease.lag';
export const SUBLEASE_UNIT_COST_ID = 'sublease.unitCost';
export const SUBLEASE_RENT_SHARE_ID = 'sublease.rentShare';
export const SUBLEASE_SCHEDULE_ID = 'sublease.costSchedule';

const FIELDS: readonly ToolField[] = [{ id: FIELD, area: 'city', integer: true, limitScope: 'quarter' }];

/** Replaces `-0` with `0` so a zero delta reads as exactly 0. */
function plain(x: number): number {
  return x === 0 ? 0 : x;
}

function units(setting: ToolSetting, city: CityName): number {
  const v = setting[FIELD]?.[city];
  return typeof v === 'number' ? v : Number.NaN;
}

function quarterIdx(ctx: RuleContext, quarter: QuarterKey): number {
  return ctx.baseline.quarters.indexOf(quarter);
}

function cityFacts(
  ctx: RuleContext,
  city: CityName,
  idx: number,
  quarter: QuarterKey,
): { readonly facts: readonly DistrictFacts[] } | { readonly error: EngineError } {
  if (idx < 0) {
    const first = ctx.baseline.districts.find((d) => d.city === city)?.code ?? city;
    return { error: derivedInputInvalid('quarter', first, quarter) };
  }
  const facts: DistrictFacts[] = [];
  for (const d of ctx.baseline.districts) {
    if (d.city !== city) continue;
    const f = districtFacts(ctx.baseline, ctx.params, d.code, idx);
    if (!f.ok) return { error: f.error };
    facts.push(f.value);
  }
  return { facts };
}

/** Market rent of the district in TWD per m2 per month (Baseline `rent`). */
function marketRent(ctx: RuleContext, code: DistrictCode, idx: number): number {
  const v = ctx.baseline.indicators['rent']?.[code]?.[idx];
  return typeof v === 'number' ? v : Number.NaN;
}

function burdenLinks(ctx: RuleContext): CauseLinks {
  const ids = new Set<string>([SUBLEASE_LAG_ID, SUBLEASE_RENT_SHARE_ID, 'housing.dwellingSize']);
  for (const city of CITY_ORDER) {
    ids.add(expandId('housing.householdSize.<city>', { city }));
    ids.add(expandId('housing.renterRate.<city>', { city }));
  }
  const sources = new Set<string>(ctx.baseline.indicatorSources['householdIncome'] ?? []);
  for (const s of ctx.baseline.indicatorSources['rent'] ?? []) sources.add(s);
  return { parameterIds: [...ids].sort(), sourceIds: [...sources].sort() };
}

function specs(): readonly ParameterSpec[] {
  const list: ParameterSpec[] = [
    { id: SUBLEASE_LAG_ID, role: 'lag', check: { kind: 'integer', min: 0, max: MAX_LAG } },
    { id: SUBLEASE_UNIT_COST_ID, role: 'cost', check: { kind: 'positive' } },
    { id: SUBLEASE_RENT_SHARE_ID, role: 'effect', check: { kind: 'share' } },
    { id: SUBLEASE_SCHEDULE_ID, role: 'schedule', check: { kind: 'schedule' } },
    { id: 'housing.dwellingSize', role: 'derivation', check: { kind: 'positive' } },
  ];
  for (const city of CITY_ORDER) {
    list.push({ id: expandId('housing.householdSize.<city>', { city }), role: 'derivation', check: { kind: 'positive' } });
    list.push({ id: expandId('housing.renterRate.<city>', { city }), role: 'derivation', check: { kind: 'share' } });
  }
  return list;
}

function checkSetting(player: ToolSetting, real: ToolSetting, quarter: QuarterKey, ctx: RuleContext): EngineError | null {
  for (const city of CITY_ORDER) {
    const u = player[FIELD]?.[city];
    if (typeof u !== 'number') return trackMissing('player timeline', `${TOOL_ID}.${FIELD}.${city}`, quarter);
    if (!Number.isInteger(u) || u < 0) {
      return policyValueInvalid(TOOL_ID, FIELD, city, quarter, u, 'expected an integer of at least 0');
    }
    if (u === units(real, city)) continue;
    // A non-zero difference is placed in districts by renter households: the city needs renters and incomes.
    const found = cityFacts(ctx, city, quarterIdx(ctx, quarter), quarter);
    if ('error' in found) return found.error;
    let renters = 0;
    for (const f of found.facts) {
      if (!(f.monthlyIncome > 0)) return derivedInputInvalid('monthlyIncome', f.code, quarter);
      renters += f.renterHouseholds;
    }
    if (!(renters > 0)) return derivedInputInvalid('renterHouseholds', found.facts[0]?.code ?? city, quarter);
  }
  return null;
}

function difference(player: ToolSetting, real: ToolSetting): Readonly<Record<AreaKey, number>> {
  const out: Record<AreaKey, number> = {};
  for (const city of CITY_ORDER) out[city] = plain(units(player, city) - units(real, city));
  return out;
}

function charge(player: ToolSetting, real: ToolSetting, ctx: RuleContext): { readonly real: number; readonly difference: number } {
  const unitCost = scalar(ctx.params, SUBLEASE_UNIT_COST_ID);
  let realSum = 0;
  let diffSum = 0;
  for (const city of CITY_ORDER) {
    realSum += units(real, city) * unitCost;
    diffSum += (units(player, city) - units(real, city)) * unitCost;
  }
  return { real: roundHalfUp(realSum), difference: roundHalfUp(diffSum) };
}

/** Rent saved per matched home per month in a district, TWD. */
export function savingPerHome(ctx: RuleContext, code: DistrictCode, idx: number): number {
  const share = scalar(ctx.params, SUBLEASE_RENT_SHARE_ID);
  return (1 - share) * marketRent(ctx, code, idx) * scalar(ctx.params, 'housing.dwellingSize');
}

/**
 * The average rent saved per matched home and month in a city, weighted by renter households, at the rent share
 * `share` (for the Policy_Dialog: the low end of `sublease.rentShare` gives the largest saving). NaN without data.
 */
export function citySaving(ctx: RuleContext, city: CityName, quarter: QuarterKey, share: number): number {
  const idx = quarterIdx(ctx, quarter);
  const found = cityFacts(ctx, city, idx, quarter);
  if ('error' in found) return Number.NaN;
  const dwelling = scalar(ctx.params, 'housing.dwellingSize');
  let renters = 0;
  let sum = 0;
  for (const f of found.facts) {
    renters += f.renterHouseholds;
    sum += f.renterHouseholds * (1 - share) * marketRent(ctx, f.code, idx) * dwelling;
  }
  return renters > 0 ? sum / renters : Number.NaN;
}

function effects(active: Readonly<Record<AreaKey, number>>, t: QuarterKey, ctx: RuleContext): ToolEffects {
  const burden: Record<DistrictCode, number> = {};
  const groups: Record<DistrictCode, readonly GhostGroupContribution[]> = {};
  const idx = quarterIdx(ctx, t);
  const links = burdenLinks(ctx);

  for (const city of CITY_ORDER) {
    const extra = active[city] ?? 0;
    const found = cityFacts(ctx, city, idx, t);
    if ('error' in found) {
      // No error channel here: NaN is reported by the stage-9 finite check.
      for (const d of ctx.baseline.districts) if (d.city === city) burden[d.code] = extra === 0 ? 0 : Number.NaN;
      continue;
    }
    let totalRenters = 0;
    for (const f of found.facts) totalRenters += f.renterHouseholds;

    for (const f of found.facts) {
      if (extra === 0 || !(f.renterHouseholds > 0)) {
        burden[f.code] = extra !== 0 && !(totalRenters > 0) ? Number.NaN : 0;
        groups[f.code] = [{ source: 'sublease', persons: 0, burdenChangePp: 0, personPp: 0, links }];
        continue;
      }
      const homes = (extra * f.renterHouseholds) / totalRenters;
      const saved = homes * savingPerHome(ctx, f.code, idx); // TWD per month in the district
      burden[f.code] = plain((-saved / (f.renterHouseholds * f.monthlyIncome)) * 100);

      // The households in the extra homes carry the whole change; fewer homes (a negative difference) give the
      // households that would have been housed a higher burden.
      const persons = Math.abs(homes) * f.householdSize;
      const personPp = plain(((-saved / f.monthlyIncome) * 100) * f.householdSize);
      groups[f.code] = [
        { source: 'sublease', persons, burdenChangePp: persons > 0 ? plain(personPp / persons) : 0, personPp, links },
      ];
    }
  }

  return { deltas: { rentBurden: burden }, links: { rentBurden: links }, ghostGroups: groups };
}

export const subleaseRule: ToolRule = {
  id: TOOL_ID,
  level: 'city',
  effect: 'stock',
  fields: FIELDS,
  trackOnlyFields: [],
  lagParameterId: SUBLEASE_LAG_ID,
  modifiable: ['rentBurden'],
  parameters: specs,
  checkSetting,
  difference: (player, real) => difference(player, real),
  charge: (player, real, _quarter, ctx) => charge(player, real, ctx),
  effects,
};
