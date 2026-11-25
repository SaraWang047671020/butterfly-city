// Holding tax tool rule (housing-tools Requirement 5): the house tax rates for homes not lived in by the owner, per
// city. City level, flow effect: the rates of a quarter act after `holdingTax.lag` quarters while they are kept.
// Fields: `lowestRate` and `highestRate`, percent of assessed house value.
//
// The change of the effective rate is Δr = w × Δlowest + (1 − w) × Δhighest (percentage points), w = the share of
// those homes taxed at the lowest tier (`holdingTax.lowTierShare`). Three effects follow:
// - Vacancy: the low-use homes of the city change by `vacancyEffect × shock` of their level (Segú 2020: −13 % for
//   the French vacancy tax), where shock = (Δr / 100 × assessed value per home) ÷ (annual market rent of a home ×
//   `frenchTaxShareOfRent`), i.e. the Taiwanese tax change as a fraction of the French tax, both measured against
//   the rent of a home. Released homes join the rental stock (allocated to districts by renter households) and lower
//   the rent by `rentFlexibility × released ÷ renter households` of its level.
// - Pass-through: landlords pass `passThrough` of the tax change of a rented home on to its rent.
// - Revenue: N × assessed value × Δr per year, as a negative charge moved to the next year by the cost schedule
//   (the revenue above real history is added to the next year's Annual_Budget; a lower rate lowers it).
// Differences in, deltas out: every term is exactly 0 when the rates equal the real track.

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
import { CITY_ORDER, FIRST_QUARTER, LAST_QUARTER, MAX_LAG } from '../constants.ts';
import { districtFacts, type DistrictFacts } from '../derived.ts';
import { derivedInputInvalid, policyValueInvalid, trackMissing } from '../errors.ts';
import { roundHalfUp } from '../numeric.ts';
import { expandId, optionalScalar, scalar } from '../params.ts';

const TOOL_ID = 'holdingTax';
const LOWEST = 'lowestRate';
const HIGHEST = 'highestRate';
export const HT_LAG_ID = 'holdingTax.lag';
export const HT_SCHEDULE_ID = 'holdingTax.costSchedule';
export const HT_LOW_TIER_SHARE_ID = 'holdingTax.lowTierShare';
export const HT_VACANCY_EFFECT_ID = 'holdingTax.vacancyEffect';
export const HT_FRENCH_SHARE_ID = 'holdingTax.frenchTaxShareOfRent';
export const HT_RENT_FLEX_ID = 'holdingTax.rentFlexibility';
export const HT_PASS_THROUGH_ID = 'holdingTax.passThrough';
export const htHomesId = (city: CityName): string => `holdingTax.homes.${city}`;
export const htValueId = (city: CityName): string => `holdingTax.assessedValue.${city}`;
export const htLowUseId = (city: CityName, year: number): string => `holdingTax.lowUseHomes.${city}.${year}`;

const FIRST_YEAR = Number(FIRST_QUARTER.slice(0, 4));
const LAST_YEAR = Number(LAST_QUARTER.slice(0, 4));

const FIELDS: readonly ToolField[] = [
  { id: LOWEST, area: 'city', limitScope: 'quarter' },
  { id: HIGHEST, area: 'city', limitScope: 'quarter' },
];

function plain(x: number): number {
  return x === 0 ? 0 : x;
}

function rate(setting: ToolSetting, field: string, city: CityName): number {
  const v = setting[field]?.[city];
  return typeof v === 'number' ? v : Number.NaN;
}

/** Change of the effective rate of a city in percentage points; exactly 0 when the rates equal the real ones. */
function effectiveChange(player: ToolSetting, real: ToolSetting, city: CityName, w: number): number {
  const dLow = rate(player, LOWEST, city) - rate(real, LOWEST, city);
  const dHigh = rate(player, HIGHEST, city) - rate(real, HIGHEST, city);
  if (dLow === 0 && dHigh === 0) return 0;
  return plain(w * dLow + (1 - w) * dHigh);
}

function quarterIdx(ctx: RuleContext, quarter: QuarterKey): number {
  return ctx.baseline.quarters.indexOf(quarter);
}

function cityFacts(ctx: RuleContext, city: CityName, idx: number, quarter: QuarterKey): { readonly facts: readonly DistrictFacts[] } | { readonly error: EngineError } {
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

function marketRent(ctx: RuleContext, code: DistrictCode, idx: number): number {
  const v = ctx.baseline.indicators['rent']?.[code]?.[idx];
  return typeof v === 'number' ? v : Number.NaN;
}

function lowUseHomes(ctx: RuleContext, city: CityName, quarter: QuarterKey): number {
  const year = Math.min(LAST_YEAR, Math.max(FIRST_YEAR, Number(quarter.slice(0, 4))));
  return scalar(ctx.params, htLowUseId(city, year));
}

/**
 * The change of the low-use homes of a city for an effective rate change `dr` (percentage points) in `quarter`,
 * at the French tax share `frenchShare` (the Scenario value unless given). Negative WHEN vacancy falls; never below
 * minus the low-use homes. NaN without data.
 */
export function vacancyChange(ctx: RuleContext, city: CityName, quarter: QuarterKey, dr: number, frenchShare?: number): number {
  if (dr === 0) return 0;
  const idx = quarterIdx(ctx, quarter);
  const found = cityFacts(ctx, city, idx, quarter);
  if ('error' in found) return Number.NaN;
  const dwelling = scalar(ctx.params, 'housing.dwellingSize');
  let renters = 0;
  let rentSum = 0;
  for (const f of found.facts) {
    renters += f.renterHouseholds;
    rentSum += f.renterHouseholds * marketRent(ctx, f.code, idx) * dwelling * 12;
  }
  if (!(renters > 0)) return Number.NaN;
  const annualRent = rentSum / renters;
  const share = frenchShare ?? scalar(ctx.params, HT_FRENCH_SHARE_ID);
  const shock = ((dr / 100) * scalar(ctx.params, htValueId(city))) / (annualRent * share);
  const relative = Math.max(-1, scalar(ctx.params, HT_VACANCY_EFFECT_ID) * shock);
  return plain(lowUseHomes(ctx, city, quarter) * relative);
}

/** Revenue change of a city in TWD per year for an effective rate change `dr` (percentage points). */
export function revenueChange(ctx: RuleContext, city: CityName, dr: number): number {
  if (dr === 0) return 0;
  return plain(scalar(ctx.params, htHomesId(city)) * scalar(ctx.params, htValueId(city)) * (dr / 100));
}

function links(ctx: RuleContext, indicator: 'rent' | 'rentBurden'): CauseLinks {
  const ids = new Set<string>([HT_LAG_ID, HT_LOW_TIER_SHARE_ID, HT_VACANCY_EFFECT_ID, HT_FRENCH_SHARE_ID, HT_RENT_FLEX_ID, HT_PASS_THROUGH_ID, 'housing.dwellingSize']);
  for (const city of CITY_ORDER) {
    ids.add(htValueId(city));
    ids.add(expandId('housing.renterRate.<city>', { city }));
    ids.add(expandId('housing.householdSize.<city>', { city }));
  }
  const sources = new Set<string>(ctx.baseline.indicatorSources['rent'] ?? []);
  if (indicator === 'rentBurden') for (const s of ctx.baseline.indicatorSources['householdIncome'] ?? []) sources.add(s);
  return { parameterIds: [...ids].sort(), sourceIds: [...sources].sort() };
}

function specs(): readonly ParameterSpec[] {
  const list: ParameterSpec[] = [
    { id: HT_LAG_ID, role: 'lag', check: { kind: 'integer', min: 0, max: MAX_LAG } },
    { id: HT_SCHEDULE_ID, role: 'schedule', check: { kind: 'schedule' } },
    { id: HT_LOW_TIER_SHARE_ID, role: 'derivation', check: { kind: 'share' } },
    { id: HT_VACANCY_EFFECT_ID, role: 'effect', check: { kind: 'finite' } },
    { id: HT_FRENCH_SHARE_ID, role: 'effect', check: { kind: 'unit-share' } },
    { id: HT_RENT_FLEX_ID, role: 'effect', check: { kind: 'non-negative' } },
    { id: HT_PASS_THROUGH_ID, role: 'effect', check: { kind: 'share' } },
    { id: 'housing.dwellingSize', role: 'derivation', check: { kind: 'positive' } },
  ];
  for (const city of CITY_ORDER) {
    list.push({ id: htHomesId(city), role: 'derivation', check: { kind: 'positive' } });
    list.push({ id: htValueId(city), role: 'derivation', check: { kind: 'positive' } });
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y += 1) list.push({ id: htLowUseId(city, y), role: 'derivation', check: { kind: 'non-negative' } });
    list.push({ id: expandId('housing.householdSize.<city>', { city }), role: 'derivation', check: { kind: 'positive' } });
    list.push({ id: expandId('housing.renterRate.<city>', { city }), role: 'derivation', check: { kind: 'share' } });
  }
  return list;
}

function checkSetting(player: ToolSetting, _real: ToolSetting, quarter: QuarterKey): EngineError | null {
  for (const city of CITY_ORDER) {
    for (const field of [LOWEST, HIGHEST]) {
      const v = player[field]?.[city];
      if (typeof v !== 'number') return trackMissing('player timeline', `${TOOL_ID}.${field}.${city}`, quarter);
      if (!Number.isFinite(v) || v < 0) return policyValueInvalid(TOOL_ID, field, city, quarter, v, 'expected a finite rate of at least 0');
    }
    const low = rate(player, LOWEST, city);
    const high = rate(player, HIGHEST, city);
    if (low > high) return policyValueInvalid(TOOL_ID, LOWEST, city, quarter, low, `expected at most the highest tier rate ${high}`);
  }
  return null;
}

function difference(player: ToolSetting, real: ToolSetting, ctx: RuleContext): Readonly<Record<AreaKey, number>> {
  const w = scalar(ctx.params, HT_LOW_TIER_SHARE_ID);
  const out: Record<AreaKey, number> = {};
  for (const city of CITY_ORDER) out[city] = effectiveChange(player, real, city, w);
  return out;
}

/** No spending of its own: the revenue change of the quarter is a negative charge, moved to the next year. */
function charge(player: ToolSetting, real: ToolSetting, ctx: RuleContext): { readonly real: number; readonly difference: number } {
  const w = scalar(ctx.params, HT_LOW_TIER_SHARE_ID);
  let diff = 0;
  for (const city of CITY_ORDER) diff -= revenueChange(ctx, city, effectiveChange(player, real, city, w)) / 4;
  return { real: 0, difference: plain(roundHalfUp(diff)) };
}

function effects(active: Readonly<Record<AreaKey, number>>, t: QuarterKey, ctx: RuleContext): ToolEffects {
  const rent: Record<DistrictCode, number> = {};
  const burden: Record<DistrictCode, number> = {};
  const groups: Record<DistrictCode, readonly GhostGroupContribution[]> = {};
  const idx = quarterIdx(ctx, t);
  const burdenLinks = links(ctx, 'rentBurden');
  const flex = scalar(ctx.params, HT_RENT_FLEX_ID);
  const pass = optionalScalar(ctx.params, HT_PASS_THROUGH_ID) ?? 0;
  const dwelling = scalar(ctx.params, 'housing.dwellingSize');

  for (const city of CITY_ORDER) {
    const dr = active[city] ?? 0;
    const found = cityFacts(ctx, city, idx, t);
    if ('error' in found) {
      for (const d of ctx.baseline.districts) {
        if (d.city !== city) continue;
        rent[d.code] = dr === 0 ? 0 : Number.NaN;
        burden[d.code] = dr === 0 ? 0 : Number.NaN;
      }
      continue;
    }
    let renters = 0;
    for (const f of found.facts) renters += f.renterHouseholds;
    const released = dr === 0 ? 0 : -vacancyChange(ctx, city, t, dr);
    // TWD per m² per month added to the rent of a rented home by the tax passed on.
    const passed = dr === 0 ? 0 : (pass * scalar(ctx.params, htValueId(city)) * (dr / 100)) / 12 / dwelling;
    for (const f of found.facts) {
      if (dr === 0 || !(f.renterHouseholds > 0) || !(renters > 0)) {
        rent[f.code] = dr !== 0 && !(renters > 0) ? Number.NaN : 0;
        burden[f.code] = rent[f.code]!;
        groups[f.code] = [{ source: 'spillover', persons: 0, burdenChangePp: 0, personPp: 0, links: burdenLinks }];
        continue;
      }
      const releasedHere = (released * f.renterHouseholds) / renters;
      const dRent = plain(-flex * (releasedHere / f.renterHouseholds) * marketRent(ctx, f.code, idx) + passed);
      rent[f.code] = dRent;
      const dBurden = plain(f.k * dRent);
      burden[f.code] = dBurden;
      groups[f.code] = [
        { source: 'spillover', persons: f.renterPersons, burdenChangePp: dBurden, personPp: plain(dBurden * f.renterPersons), links: burdenLinks },
      ];
    }
  }
  return {
    deltas: { rent, rentBurden: burden },
    links: { rent: links(ctx, 'rent'), rentBurden: burdenLinks },
    ghostGroups: groups,
  };
}

export const holdingTaxRule: ToolRule = {
  id: TOOL_ID,
  level: 'city',
  effect: 'flow',
  fields: FIELDS,
  trackOnlyFields: [],
  lagParameterId: HT_LAG_ID,
  modifiable: ['rent', 'rentBurden'],
  parameters: specs,
  checkSetting: (player, real, quarter) => checkSetting(player, real, quarter),
  difference: (player, real, _quarter, ctx) => difference(player, real, ctx),
  charge: (player, real, _quarter, ctx) => charge(player, real, ctx),
  effects,
};
