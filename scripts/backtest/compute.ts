/**
 * Computes one Backtest_Case (Requirements 20.2, 20.3, 20.4, 20.10; design conflict C1).
 *
 * 1. The observed effect is computed from the monthly Taipei Metro station entries (mrt-monthly.ts), summed
 *    over the districts with a Taipei Metro station, before
 *    the engine is called. Nothing is entered by hand, and the secondaryContext news figures are never read.
 * 2. A counterfactual Real_Policy_Track holds the changed field at its value before the change. It is passed
 *    as the real track; the actual real track, with the price difference as a subsidy, is passed as the
 *    Player_Policy_Timeline.
 * 3. runRange runs with options.budgetMode = 'record' and an empty event list. The simulated effect is the sum
 *    of the tool Cause contributions of the compared indicator over the compared districts and quarters.
 */
import { runRange } from '../../src/simulation/engine.ts';
import type { DistrictCode, QuarterKey } from '../../src/types/data-files.ts';
import type {
  AreaKey,
  EngineBaseline,
  EngineError,
  ParameterTable,
  PolicySetting,
  PolicyTimeline,
  ResultRange,
  ScenarioName,
  SimState,
  ToolSetting,
} from '../../src/types/simulation.ts';
import { withPassPrice, type BacktestInputs } from './adapt.ts';
import type { BacktestCase } from './cases.ts';
import { DataError } from '../pipeline/errors.ts';
import { quarterlyByDistrict, type MonthlyEntries, type QuarterlyResult } from './mrt-monthly.ts';

export interface PeriodSums {
  readonly postChangeYear: number;
  readonly postComparisonYear: number;
  readonly preChangeYear: number;
  readonly preComparisonYear: number;
  /** (postChangeYear - postComparisonYear) - (preChangeYear - preComparisonYear). */
  readonly effect: number;
}

export interface ObservedEffect extends PeriodSums {
  /** Number of districts with a Taipei Metro station (the district scope of the observed and simulated sums). */
  readonly districtCount: number;
  /** Codes of those districts, sorted. */
  readonly districtCodes: readonly string[];
  /** Same sums over the same districts, with every station of the monthly files (reference). */
  readonly allStations: PeriodSums;
  /** Stations of the main result: entries greater than 0 in all 24 months. */
  readonly includedStationCount: number;
  /** Stations left out of the main result. */
  readonly excludedStations: readonly string[];
  /** Entries of the excluded stations divided by all entries over the 2023 months; null when undefined. */
  readonly excludedShare2023: number | null;
}

/** The monthly Taipei Metro station entries and the station-to-district map (Requirements 27.19, 27.21). */
export interface MrtObservedInput {
  readonly monthly: readonly MonthlyEntries[];
  /** Station name of the station table -> district code (Requirement 11.1). */
  readonly stationDistrict: ReadonlyMap<string, string>;
}

/** The same input read from the committed derived file instead of the monthly files (Requirement 27.25). */
export interface MrtDerivedInput {
  readonly quarterly: QuarterlyResult;
  /** Codes of the districts that have a Taipei Metro station. */
  readonly stationDistrictCodes: readonly string[];
}

function resolveInput(mrt: MrtObservedInput | MrtDerivedInput): {
  readonly stationDistrict: ReadonlyMap<string, string>;
  readonly q: QuarterlyResult;
} {
  if ('quarterly' in mrt) return { stationDistrict: new Map(mrt.stationDistrictCodes.map((c) => [c, c])), q: mrt.quarterly };
  return { stationDistrict: mrt.stationDistrict, q: quarterlyByDistrict(mrt.monthly, mrt.stationDistrict) };
}

export interface BacktestChecks {
  /** Central simulated effect has the same sign as the observed effect. */
  readonly direction: boolean;
  /** simulated central / observed; null when the observed effect is 0. */
  readonly ratio: number | null;
  readonly ratioWithinTolerance: boolean;
  /** The observed effect lies between the simulated minimum and maximum. */
  readonly range: boolean;
}

export interface ComputedCase {
  readonly status: 'computed';
  readonly case: BacktestCase;
  readonly observed: ObservedEffect;
  readonly simulated: ResultRange;
  /** Reference: the same simulated sum over all 41 districts of the case areas. */
  readonly simulatedAllDistricts: ResultRange;
  /** simulated central minus observed. */
  readonly absoluteError: number;
  /** absoluteError divided by the absolute observed effect; null when the observed effect is 0. */
  readonly relativeError: number | null;
  readonly checks: BacktestChecks;
}

export interface NotComputedCase {
  readonly status: 'not-computed';
  readonly id: string;
  readonly reason: string;
}

export type CaseResult = ComputedCase | NotComputedCase;

const SUPPORTED_TOOL = 'commuterPass';
const SUBSIDY_FIELD = 'subsidy';

function notComputed(id: string, reason: string): NotComputedCase {
  return { status: 'not-computed', id, reason };
}

function describeError(error: EngineError, scenario: ScenarioName, quarter: QuarterKey | null): string {
  const where = quarter === null ? 'before the first quarter' : `at ${quarter}`;
  return `engine error ${error.code} in scenario ${scenario} ${where}: ${error.message}`;
}

function districtsOf(baseline: EngineBaseline, cities: readonly string[]): readonly DistrictCode[] {
  return baseline.districts.filter((d) => cities.includes(d.city)).map((d) => d.code);
}

type Sum = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: string };
type QuarterSums = ReadonlyMap<string, ReadonlyMap<string, number>>;

function sumQuarters(
  quarterly: QuarterSums,
  knownQuarters: ReadonlySet<string>,
  codes: readonly DistrictCode[],
  year: number,
  parts: readonly string[],
): Sum {
  let total = 0;
  for (const part of parts) {
    const quarter = `${year}${part}`;
    if (!knownQuarters.has(quarter)) return { ok: false, reason: `observed value missing: no monthly station data for ${quarter}` };
    // A district whose stations all have no entries in the quarter sums to 0.
    for (const code of codes) total += quarterly.get(code)?.get(quarter) ?? 0;
  }
  return { ok: true, value: total };
}

function periodSums(
  quarterly: QuarterSums,
  known: ReadonlySet<string>,
  codes: readonly DistrictCode[],
  o: BacktestCase['observed'],
): { readonly ok: true; readonly value: PeriodSums } | { readonly ok: false; readonly reason: string } {
  const sums: Sum[] = [
    sumQuarters(quarterly, known, codes, o.changeYear, o.postQuarters),
    sumQuarters(quarterly, known, codes, o.comparisonYear, o.postQuarters),
    sumQuarters(quarterly, known, codes, o.changeYear, o.preQuarters),
    sumQuarters(quarterly, known, codes, o.comparisonYear, o.preQuarters),
  ];
  for (const s of sums) if (!s.ok) return s;
  const [a, b, d, e] = sums.map((s) => (s.ok ? s.value : 0)) as [number, number, number, number];
  return {
    ok: true,
    value: { postChangeYear: a, postComparisonYear: b, preChangeYear: d, preComparisonYear: e, effect: a - b - (d - e) },
  };
}

/**
 * The districts with a Taipei Metro station: the districts of the station-to-district map that belong to the
 * given cities and to the baseline. Sorted (Requirement 27.19).
 */
export function stationDistrictCodes(
  baseline: EngineBaseline,
  cities: readonly string[],
  stationDistrict: ReadonlyMap<string, string>,
): readonly DistrictCode[] {
  const wanted = new Set(districtsOf(baseline, cities));
  return [...new Set(stationDistrict.values())].filter((code) => wanted.has(code)).sort();
}

/**
 * The observed effect of a case from the monthly Taipei Metro station entries (Requirements 20.2, 27.19, 27.21,
 * 27.23). Main result: stations with entries in all months. Reference: all stations. A station key without an
 * alias entry throws a DataError naming the station and the month; `computeCase` turns it into "not computed".
 */
export function computeObserved(
  c: BacktestCase,
  baseline: EngineBaseline,
  mrt: MrtObservedInput | MrtDerivedInput,
): { readonly ok: true; readonly value: ObservedEffect } | { readonly ok: false; readonly reason: string } {
  const o = c.observed;
  const { stationDistrict, q } = resolveInput(mrt);
  const codes = stationDistrictCodes(baseline, o.cities, stationDistrict);
  if (codes.length === 0) return { ok: false, reason: `no districts with a Taipei Metro station found for ${o.cities.join(', ')}` };
  const known = new Set<string>();
  for (const byQ of q.all.values()) for (const quarter of byQ.keys()) known.add(quarter);
  const main = periodSums(q.main, known, codes, o);
  if (!main.ok) return main;
  const all = periodSums(q.all, known, codes, o);
  if (!all.ok) return all;
  return {
    ok: true,
    value: {
      ...main.value,
      districtCount: codes.length,
      districtCodes: codes,
      allStations: all.value,
      includedStationCount: q.filter.included.length,
      excludedStations: q.filter.excluded,
      excludedShare2023: q.filter.excludedShare2023,
    },
  };
}

function toolSettingOf(setting: PolicySetting, tool: string): ToolSetting {
  return Object.hasOwn(setting.tools, tool) ? (setting.tools[tool] ?? {}) : {};
}

/**
 * The counterfactual real track and the player timeline of a commuter pass price change.
 * Counterfactual: from the first quarter of the change, the subsidy stays at its last value before the
 * change (the price is held at `before` through the parameters). Player: the actual track with the subsidy
 * raised by the price difference `before - after`.
 */
export function buildTracks(
  c: BacktestCase,
  actual: PolicyTimeline,
): { readonly ok: true; readonly counterfactual: PolicyTimeline; readonly player: PolicyTimeline } | { readonly ok: false; readonly reason: string } {
  const first = c.change.firstQuarter;
  const sorted = [...actual].sort((x, y) => (x.quarter < y.quarter ? -1 : x.quarter > y.quarter ? 1 : 0));
  const lastBefore = [...sorted].reverse().find((s) => s.quarter < first);
  if (lastBefore === undefined) return { ok: false, reason: `real track has no quarter before ${first}` };
  const heldBefore = toolSettingOf(lastBefore, c.tool)[SUBSIDY_FIELD] ?? {};
  const difference = c.change.before - c.change.after;

  const counterfactual: PolicySetting[] = [];
  const player: PolicySetting[] = [];
  for (const setting of actual) {
    if (setting.quarter < first) {
      counterfactual.push(setting);
      player.push(setting);
      continue;
    }
    const tool = toolSettingOf(setting, c.tool);
    const subsidy = Object.hasOwn(tool, SUBSIDY_FIELD) ? (tool[SUBSIDY_FIELD] ?? {}) : {};
    const cfSubsidy: Record<AreaKey, number> = { ...subsidy };
    const playerSubsidy: Record<AreaKey, number> = { ...subsidy };
    for (const city of c.change.cities) {
      const held = heldBefore[city];
      if (held === undefined) return { ok: false, reason: `real track has no ${SUBSIDY_FIELD} for ${city} before ${first}` };
      cfSubsidy[city] = held;
      playerSubsidy[city] = held + difference;
    }
    counterfactual.push({ quarter: setting.quarter, tools: { ...setting.tools, [c.tool]: { ...tool, [SUBSIDY_FIELD]: cfSubsidy } } });
    player.push({ quarter: setting.quarter, tools: { ...setting.tools, [c.tool]: { ...tool, [SUBSIDY_FIELD]: playerSubsidy } } });
  }
  return { ok: true, counterfactual, player };
}

function toolContribution(state: SimState, c: BacktestCase, codes: readonly DistrictCode[]): number {
  const byDistrict = Object.hasOwn(state.causes, c.indicator) ? state.causes[c.indicator] : undefined;
  let total = 0;
  for (const code of codes) {
    const breakdown = byDistrict?.[code];
    if (breakdown === undefined) continue;
    for (const cause of breakdown.causes) {
      if (cause.kind === 'tool' && cause.id === c.tool) total += cause.contribution;
    }
  }
  return total;
}

function simulatedSum(states: readonly SimState[], c: BacktestCase, codes: readonly DistrictCode[]): number {
  let total = 0;
  for (const state of states) {
    if (c.evaluationQuarters.includes(state.quarter)) total += toolContribution(state, c, codes);
  }
  return total;
}

/** Computes one case. Never throws for a well-typed input; failures become "not computed". */
export function computeCase(c: BacktestCase, inputs: BacktestInputs, mrt?: MrtObservedInput | MrtDerivedInput): CaseResult {
  if (c.tool !== SUPPORTED_TOOL || c.change.field !== 'commuterPassPrice') {
    return notComputed(c.id, `unsupported change: tool ${c.tool}, field ${c.change.field}`);
  }
  if (mrt === undefined) return notComputed(c.id, 'missing input: monthly Taipei Metro station files');
  const { baseline } = inputs;

  // The observed effect is fixed before the engine runs (Requirement 20.2).
  let observed: ReturnType<typeof computeObserved>;
  try {
    observed = computeObserved(c, baseline, mrt);
  } catch (e) {
    if (e instanceof DataError) return notComputed(c.id, `${e.message}${e.details.length > 0 ? ` (${e.details.join('; ')})` : ''}`);
    throw e;
  }
  if (!observed.ok) return notComputed(c.id, observed.reason);

  const tracks = buildTracks(c, inputs.track);
  if (!tracks.ok) return notComputed(c.id, tracks.reason);

  const lastQuarter = [...c.evaluationQuarters].sort().at(-1) as QuarterKey;
  if (!baseline.quarters.includes(lastQuarter)) {
    return notComputed(c.id, `evaluation quarter ${lastQuarter} is not in the baseline`);
  }

  const counterfactualPrices = withPassPrice(
    inputs.passPrices,
    c.change.cities,
    c.change.firstQuarter as QuarterKey,
    baseline.quarters,
    c.change.before,
  );
  const params: ParameterTable = { ...inputs.params, ...counterfactualPrices };

  const result = runRange(
    tracks.player,
    [],
    params,
    baseline,
    tracks.counterfactual,
    inputs.commute,
    lastQuarter,
    { budgetMode: 'record' },
  );
  if (!result.ok) return notComputed(c.id, describeError(result.error, result.scenario, result.quarter));

  const codes = observed.value.districtCodes;
  const allCodes = districtsOf(baseline, c.areas);
  const rangeOf = (list: readonly DistrictCode[]): ResultRange => {
    const lo = simulatedSum(result.low, c, list);
    const ce = simulatedSum(result.central, c, list);
    const hi = simulatedSum(result.high, c, list);
    return { min: Math.min(lo, ce, hi), central: ce, max: Math.max(lo, ce, hi) };
  };
  const simulated = rangeOf(codes);
  const central = simulated.central;
  const simulatedAllDistricts = rangeOf(allCodes);

  const effect = observed.value.effect;
  const ratio = effect === 0 ? null : central / effect;
  const absoluteError = central - effect;
  return {
    status: 'computed',
    case: c,
    observed: observed.value,
    simulated,
    simulatedAllDistricts,
    absoluteError,
    relativeError: effect === 0 ? null : absoluteError / Math.abs(effect),
    checks: {
      direction: Math.sign(central) === Math.sign(effect),
      ratio,
      ratioWithinTolerance: ratio !== null && ratio >= c.tolerances.ratioLow && ratio <= c.tolerances.ratioHigh,
      range: simulated.min <= effect && effect <= simulated.max,
    },
  };
}
