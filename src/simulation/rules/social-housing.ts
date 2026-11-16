// Social housing construction tool (Requirement 4).
// District level, stock effect. The player edits `unitsStarted` per district and quarter.
// The matured stock difference X_d houses X_d renter households, who pay `ratio x market rent`.
// Pure: no I/O, no DOM. Parameter values are read only through params.ts.

import type { DistrictCode, QuarterKey } from '../../types/data-files.ts';
import type {
  AreaKey,
  CauseLinks,
  EngineError,
  GhostGroupContribution,
  IndicatorId,
  ParameterSpec,
  RuleContext,
  ToolEffects,
  ToolField,
  ToolRule,
  ToolSetting,
} from '../../types/simulation.ts';
import { MAX_LAG } from '../constants.ts';
import { districtFacts } from '../derived.ts';
import { householdsExceedRenters, policyValueInvalid } from '../errors.ts';
import { roundHalfUp } from '../numeric.ts';
import { scalar } from '../params.ts';
import { quarterIndex } from '../quarter.ts';

const TOOL_ID = 'socialHousing';
const FIELD = 'unitsStarted';

const LAG = 'socialHousing.lag';
const UNIT_COST = 'socialHousing.unitCost';
const COST_SCHEDULE = 'socialHousing.costSchedule';
const RENT_PER_UNIT = 'socialHousing.rentPerUnit';
const RENT_RATIO = 'socialHousing.rentRatio';
const DWELLING_SIZE = 'housing.dwellingSize';
const LIMIT_PREFIX = `limit.${TOOL_ID}.${FIELD}`;

const FIELDS: readonly ToolField[] = [
  { id: FIELD, area: 'district', integer: true, limitScope: 'city-year' },
];

const SPECS: readonly ParameterSpec[] = [
  { id: LAG, role: 'lag', check: { kind: 'integer', min: 0, max: MAX_LAG } },
  { id: UNIT_COST, role: 'cost', check: { kind: 'positive' } },
  { id: COST_SCHEDULE, role: 'schedule', check: { kind: 'schedule' } },
  { id: RENT_PER_UNIT, role: 'effect', check: { kind: 'finite' } },
  { id: RENT_RATIO, role: 'effect', check: { kind: 'unit-share' } },
  { id: `${LIMIT_PREFIX}.lowerFactor`, role: 'limit', check: { kind: 'share' } },
  { id: `${LIMIT_PREFIX}.upperFactor`, role: 'limit', check: { kind: 'finite' } },
  { id: `${LIMIT_PREFIX}.upperMin`, role: 'limit', check: { kind: 'non-negative' }, optional: true },
  { id: `${LIMIT_PREFIX}.min`, role: 'limit', check: { kind: 'non-negative' }, optional: true },
  { id: `${LIMIT_PREFIX}.max`, role: 'limit', check: { kind: 'non-negative' }, optional: true },
];

/** Turns -0 into 0 so zero differences give exactly 0. */
function zero(x: number): number {
  return x === 0 ? 0 : x;
}

function fieldMap(setting: ToolSetting): Readonly<Record<AreaKey, number>> {
  return Object.hasOwn(setting, FIELD) ? (setting[FIELD] ?? {}) : {};
}

function valueAt(map: Readonly<Record<AreaKey, number>>, area: string): number | undefined {
  return Object.hasOwn(map, area) ? map[area as AreaKey] : undefined;
}

/** Areas of both settings in a stable order. */
function areasOf(
  a: Readonly<Record<AreaKey, number>>,
  b: Readonly<Record<AreaKey, number>>,
): readonly string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
}

/** Player value of an area; an area the player does not mention keeps the real value. */
function playerValue(
  player: Readonly<Record<AreaKey, number>>,
  real: Readonly<Record<AreaKey, number>>,
  area: string,
): number {
  return valueAt(player, area) ?? valueAt(real, area) ?? 0;
}

function baselineAt(
  ctx: RuleContext,
  indicator: string,
  code: DistrictCode,
  idx: number,
): number {
  const series = ctx.baseline.indicators[indicator];
  if (series === undefined || !Object.hasOwn(series, code)) return Number.NaN;
  const v = series[code]?.[idx];
  return typeof v === 'number' ? v : Number.NaN;
}

function sources(ctx: RuleContext, indicator: string): readonly string[] {
  const s = ctx.baseline.indicatorSources;
  return Object.hasOwn(s, indicator) ? [...(s[indicator] ?? [])].sort() : [];
}

function links(parameterIds: readonly string[], sourceIds: readonly string[]): CauseLinks {
  return { parameterIds: [...parameterIds].sort(), sourceIds: [...sourceIds] };
}

function checkSetting(
  player: ToolSetting,
  _real: ToolSetting,
  quarter: QuarterKey,
  ctx: RuleContext,
): EngineError | null {
  const known = new Set<string>(ctx.baseline.districts.map((d) => d.code));
  const map = fieldMap(player);
  for (const area of Object.keys(map).sort()) {
    const value = valueAt(map, area);
    if (!known.has(area)) {
      return policyValueInvalid(TOOL_ID, FIELD, area, quarter, value ?? null, 'unknown District_Code');
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      const reason = 'units started must be a non-negative integer';
      return policyValueInvalid(
        TOOL_ID,
        FIELD,
        area,
        quarter,
        typeof value === 'number' && Number.isFinite(value) ? value : null,
        reason,
      );
    }
  }
  return null;
}

function difference(
  player: ToolSetting,
  real: ToolSetting,
  _quarter: QuarterKey,
  ctx: RuleContext,
): Readonly<Record<AreaKey, number>> {
  const p = fieldMap(player);
  const r = fieldMap(real);
  const out: Record<string, number> = {};
  for (const d of ctx.baseline.districts) {
    const realUnits = valueAt(r, d.code) ?? 0;
    out[d.code] = zero(playerValue(p, r, d.code) - realUnits);
  }
  return out;
}

function charge(
  player: ToolSetting,
  real: ToolSetting,
  _quarter: QuarterKey,
  ctx: RuleContext,
): { readonly real: number; readonly difference: number } {
  const p = fieldMap(player);
  const r = fieldMap(real);
  const unitCost = scalar(ctx.params, UNIT_COST);
  let realUnits = 0;
  let diffUnits = 0;
  for (const area of areasOf(p, r)) {
    const realValue = valueAt(r, area) ?? 0;
    realUnits += realValue;
    diffUnits += playerValue(p, r, area) - realValue;
  }
  return {
    real: roundHalfUp(realUnits * unitCost),
    difference: roundHalfUp(zero(diffUnits) * unitCost),
  };
}

/**
 * Requirement 4.17: a positive stock difference above the renter households of the district is an error.
 * Called by the engine for the matured stock difference of each quarter (`effects` has no error channel).
 */
export function checkRenterCapacity(
  active: Readonly<Record<AreaKey, number>>,
  t: QuarterKey,
  ctx: RuleContext,
): EngineError | null {
  const idx = quarterIndex(t);
  for (const d of ctx.baseline.districts) {
    const x = valueAt(active, d.code) ?? 0;
    if (!(x > 0)) continue;
    const facts = districtFacts(ctx.baseline, ctx.params, d.code, idx);
    if (!facts.ok) return facts.error;
    if (x > facts.value.renterHouseholds) {
      return householdsExceedRenters(
        { where: 'social-housing', district: d.code },
        t,
        x,
        facts.value.renterHouseholds,
      );
    }
  }
  return null;
}

function effects(
  active: Readonly<Record<AreaKey, number>>,
  t: QuarterKey,
  ctx: RuleContext,
): ToolEffects {
  const idx = quarterIndex(t);
  const rentPerUnit = scalar(ctx.params, RENT_PER_UNIT);
  const ratio = scalar(ctx.params, RENT_RATIO);

  const stock: Record<DistrictCode, number> = {};
  const rent: Record<DistrictCode, number> = {};
  const burden: Record<DistrictCode, number> = {};
  const groups: Record<DistrictCode, readonly GhostGroupContribution[]> = {};

  const ghostLinks = (income: readonly string[], rentSources: readonly string[]): CauseLinks =>
    links([RENT_RATIO, RENT_PER_UNIT, LAG, DWELLING_SIZE], [...income, ...rentSources]);
  const incomeSources = sources(ctx, 'householdIncome');
  const rentSources = sources(ctx, 'rent');

  for (const d of ctx.baseline.districts) {
    const x = valueAt(active, d.code) ?? 0;
    stock[d.code] = zero(x);

    if (x === 0) {
      rent[d.code] = 0;
      burden[d.code] = 0;
      groups[d.code] = [
        { source: 'housed', persons: 0, burdenChangePp: 0, personPp: 0, links: ghostLinks(incomeSources, rentSources) },
        { source: 'spillover', persons: 0, burdenChangePp: 0, personPp: 0, links: ghostLinks(incomeSources, rentSources) },
      ];
      continue;
    }

    const facts = districtFacts(ctx.baseline, ctx.params, d.code, idx);
    const baseRent = baselineAt(ctx, 'rent', d.code, idx);
    if (!facts.ok || !Number.isFinite(baseRent)) {
      // No error channel here: NaN is reported by the engine's finite check (Requirement 15.3).
      stock[d.code] = x;
      rent[d.code] = Number.NaN;
      burden[d.code] = Number.NaN;
      groups[d.code] = [];
      continue;
    }
    const f = facts.value;
    const spill = zero(rentPerUnit * x);
    const market = baseRent + spill;
    const perHouseholdPp = (ratio * market - baseRent) * f.k;
    const direct = (x * (ratio * market - baseRent) * f.k) / f.renterHouseholds;
    const spillBurden = spill * f.k;

    rent[d.code] = spill;
    burden[d.code] = zero(direct + spillBurden);

    const housedPersons = x * f.householdSize;
    const spillPp = zero(spill * f.k);
    groups[d.code] = [
      {
        source: 'housed',
        persons: housedPersons,
        burdenChangePp: perHouseholdPp,
        personPp: zero(housedPersons * perHouseholdPp),
        links: ghostLinks(incomeSources, rentSources),
      },
      {
        source: 'spillover',
        persons: f.renterPersons,
        burdenChangePp: spillPp,
        personPp: zero(f.renterPersons * spillPp),
        links: ghostLinks(incomeSources, rentSources),
      },
    ];
  }

  const linkMap: Record<IndicatorId, CauseLinks> = {
    socialHousingStock: links([LAG, UNIT_COST], sources(ctx, 'socialHousingStock')),
    rent: links([RENT_PER_UNIT, LAG, UNIT_COST], rentSources),
    rentBurden: links(
      [RENT_RATIO, RENT_PER_UNIT, LAG, DWELLING_SIZE, UNIT_COST],
      [...incomeSources, ...rentSources],
    ),
  };

  return {
    deltas: { socialHousingStock: stock, rent, rentBurden: burden },
    links: linkMap,
    ghostGroups: groups,
  };
}

export const socialHousingRule: ToolRule = {
  id: TOOL_ID,
  level: 'district',
  effect: 'stock',
  fields: FIELDS,
  trackOnlyFields: [],
  lagParameterId: LAG,
  modifiable: ['rent', 'rentBurden'],
  parameters: () => SPECS,
  checkSetting,
  difference,
  charge,
  effects,
};
