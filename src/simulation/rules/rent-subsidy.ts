// Rent subsidy tool rule (Requirement 6). City level, flow effect.
// Fields: `households` (integer) and `amount` (TWD per household per month).
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
import {
  derivedInputInvalid,
  householdsExceedRenters,
  policyValueInvalid,
  trackMissing,
} from '../errors.ts';
import { roundHalfUp } from '../numeric.ts';
import { expandId, optionalScalar, scalar } from '../params.ts';

const TOOL_ID = 'rentSubsidy';
const LAG_ID = 'rentSubsidy.lag';
const UNIT_COST_ID = 'rentSubsidy.unitCost';
const PASS_THROUGH_ID = 'rentSubsidy.passThrough';
const SCHEDULE_ID = 'rentSubsidy.costSchedule';

const FIELDS: readonly ToolField[] = [
  { id: 'households', area: 'city', integer: true, limitScope: 'quarter' },
  { id: 'amount', area: 'city', limitScope: 'quarter' },
];

/** Replaces `-0` with `0` so a zero delta reads as exactly 0. */
function plain(x: number): number {
  return x === 0 ? 0 : x;
}

function value(setting: ToolSetting, field: string, city: CityName): number {
  const v = setting[field]?.[city];
  return typeof v === 'number' ? v : Number.NaN;
}

function totalOf(setting: ToolSetting, city: CityName): number {
  return value(setting, 'households', city) * value(setting, 'amount', city);
}

function realSetting(ctx: RuleContext, quarter: QuarterKey): ToolSetting | undefined {
  return ctx.realTrack.find((s) => s.quarter === quarter)?.tools[TOOL_ID];
}

function quarterIdx(ctx: RuleContext, quarter: QuarterKey): number {
  return ctx.baseline.quarters.indexOf(quarter);
}

/** Facts of every district of one city, or the first derived error. */
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

function linksFor(ctx: RuleContext, indicator: 'rent' | 'rentBurden'): CauseLinks {
  const ids = new Set<string>([LAG_ID, 'housing.dwellingSize']);
  if (optionalScalar(ctx.params, PASS_THROUGH_ID) !== undefined) ids.add(PASS_THROUGH_ID);
  for (const city of CITY_ORDER) {
    ids.add(expandId('housing.householdSize.<city>', { city }));
    ids.add(expandId('housing.renterRate.<city>', { city }));
  }
  const sources = new Set<string>(ctx.baseline.indicatorSources['householdIncome'] ?? []);
  if (indicator === 'rent') {
    for (const s of ctx.baseline.indicatorSources['rent'] ?? []) sources.add(s);
  }
  return { parameterIds: [...ids].sort(), sourceIds: [...sources].sort() };
}

function specs(): readonly ParameterSpec[] {
  const list: ParameterSpec[] = [
    { id: LAG_ID, role: 'lag', check: { kind: 'integer', min: 0, max: MAX_LAG } },
    { id: UNIT_COST_ID, role: 'cost', check: { kind: 'positive' } },
    { id: PASS_THROUGH_ID, role: 'effect', check: { kind: 'share' }, optional: true },
    { id: SCHEDULE_ID, role: 'schedule', check: { kind: 'schedule' }, optional: true },
    { id: 'rentSubsidy.nationalBudget', role: 'reference', check: { kind: 'non-negative' }, optional: true },
    { id: 'rentSubsidy.nationalHouseholds', role: 'reference', check: { kind: 'non-negative' }, optional: true },
    { id: 'housing.dwellingSize', role: 'derivation', check: { kind: 'positive' } },
  ];
  for (const city of CITY_ORDER) {
    list.push({
      id: expandId('housing.householdSize.<city>', { city }),
      role: 'derivation',
      check: { kind: 'positive' },
    });
    list.push({
      id: expandId('housing.renterRate.<city>', { city }),
      role: 'derivation',
      check: { kind: 'share' },
    });
  }
  return list;
}

function checkSetting(
  player: ToolSetting,
  real: ToolSetting,
  quarter: QuarterKey,
  ctx: RuleContext,
): EngineError | null {
  for (const city of CITY_ORDER) {
    const h = player['households']?.[city];
    if (typeof h !== 'number') return trackMissing('player timeline', `${TOOL_ID}.households.${city}`, quarter);
    const a = player['amount']?.[city];
    if (typeof a !== 'number') return trackMissing('player timeline', `${TOOL_ID}.amount.${city}`, quarter);
    if (!Number.isInteger(h) || h < 0) {
      return policyValueInvalid(TOOL_ID, 'households', city, quarter, h, 'expected an integer of at least 0');
    }
    if (!Number.isFinite(a) || a < 0) {
      return policyValueInvalid(TOOL_ID, 'amount', city, quarter, a, 'expected a finite number of at least 0');
    }

    const found = cityFacts(ctx, city, quarterIdx(ctx, quarter), quarter);
    if ('error' in found) return found.error;
    let renters = 0;
    for (const f of found.facts) {
      if (!(f.monthlyIncome > 0)) return derivedInputInvalid('monthlyIncome', f.code, quarter);
      renters += f.renterHouseholds;
    }
    // Requirement 6.11: a non-zero city difference needs at least one district with renters.
    const diff = totalOf(player, city) - totalOf(real, city);
    if (diff !== 0 && !(renters > 0)) {
      const first = found.facts[0]?.code ?? city;
      return derivedInputInvalid('renterHouseholds', first, quarter);
    }
    if (h > renters) return householdsExceedRenters({ where: 'rent-subsidy', city }, quarter, h, renters);
  }
  return null;
}

function difference(
  player: ToolSetting,
  real: ToolSetting,
): Readonly<Record<AreaKey, number>> {
  const out: Record<AreaKey, number> = {};
  for (const city of CITY_ORDER) out[city] = plain(totalOf(player, city) - totalOf(real, city));
  return out;
}

function charge(
  player: ToolSetting,
  real: ToolSetting,
  ctx: RuleContext,
): { readonly real: number; readonly difference: number } {
  const unitCost = scalar(ctx.params, UNIT_COST_ID);
  let realSum = 0;
  let diffSum = 0;
  for (const city of CITY_ORDER) {
    const r = totalOf(real, city);
    realSum += r * 3 * unitCost;
    diffSum += (totalOf(player, city) - totalOf(real, city)) * 3 * unitCost;
  }
  return { real: roundHalfUp(realSum), difference: roundHalfUp(diffSum) };
}

function effects(
  active: Readonly<Record<AreaKey, number>>,
  t: QuarterKey,
  ctx: RuleContext,
): ToolEffects {
  const rent: Record<DistrictCode, number> = {};
  const burden: Record<DistrictCode, number> = {};
  const groups: Record<DistrictCode, readonly GhostGroupContribution[]> = {};
  const passThrough = optionalScalar(ctx.params, PASS_THROUGH_ID) ?? 0;
  const dwelling = scalar(ctx.params, 'housing.dwellingSize');
  const idx = quarterIdx(ctx, t);
  const real = realSetting(ctx, t);
  const burdenLinks = linksFor(ctx, 'rentBurden');

  for (const city of CITY_ORDER) {
    const delta = active[city] ?? 0;
    const found = cityFacts(ctx, city, idx, t);
    if ('error' in found) {
      // No error channel here: NaN is reported by the stage-9 finite check.
      for (const d of ctx.baseline.districts) {
        if (d.city !== city) continue;
        rent[d.code] = Number.NaN;
        burden[d.code] = Number.NaN;
      }
      continue;
    }
    let totalRenters = 0;
    for (const f of found.facts) totalRenters += f.renterHouseholds;
    const households = real === undefined ? 0 : value(real, 'households', city);

    for (const f of found.facts) {
      if (!(f.renterHouseholds > 0)) {
        // Zero-renter district: no allocation, zero deltas (Requirement 6.11). If the whole city has no
        // renters and the difference is non-zero, checkSetting has already reported the error; NaN is
        // only a guard for the stage-9 finite check.
        const bad = delta !== 0 && !(totalRenters > 0);
        rent[f.code] = bad ? Number.NaN : 0;
        burden[f.code] = bad ? Number.NaN : 0;
        groups[f.code] = [
          { source: 'subsidy', persons: 0, burdenChangePp: 0, personPp: 0, links: burdenLinks },
        ];
        continue;
      }
      const share = f.renterHouseholds / totalRenters;
      const a = delta * share;
      const direct = (-a / (f.renterHouseholds * f.monthlyIncome)) * 100;
      const rentDelta = (passThrough * a) / (f.renterHouseholds * dwelling);
      const followOn = ((passThrough * a) / (f.renterHouseholds * f.monthlyIncome)) * 100;
      rent[f.code] = plain(rentDelta);
      burden[f.code] = plain(direct + followOn);

      const personPp = plain(((-(1 - passThrough) * a) / f.monthlyIncome) * 100 * f.householdSize);
      const persons = Number.isFinite(households) ? f.householdSize * share * households : 0;
      groups[f.code] = [
        {
          source: 'subsidy',
          persons,
          burdenChangePp: persons > 0 ? plain(personPp / persons) : 0,
          personPp,
          links: burdenLinks,
        },
      ];
    }
  }

  return {
    deltas: { rent, rentBurden: burden },
    links: { rent: linksFor(ctx, 'rent'), rentBurden: burdenLinks },
    ghostGroups: groups,
  };
}

export const rentSubsidyRule: ToolRule = {
  id: TOOL_ID,
  level: 'city',
  effect: 'flow',
  fields: FIELDS,
  trackOnlyFields: [],
  lagParameterId: LAG_ID,
  modifiable: ['rent', 'rentBurden'],
  parameters: specs,
  checkSetting,
  difference: (player, real) => difference(player, real),
  charge: (player, real, _quarter, ctx) => charge(player, real, ctx),
  effects,
};
