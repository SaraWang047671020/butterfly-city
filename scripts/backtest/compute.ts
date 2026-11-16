/**
 * Computes one Backtest_Case (Requirements 20.2, 20.3, 20.4, 20.10; design conflict C1).
 *
 * 1. The observed effect is computed from history.json mrtEntries (through the adapter's baseline) before
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

export interface ObservedEffect {
  /** Sum of the compared indicator over the compared districts, per period. */
  readonly postChangeYear: number;
  readonly postComparisonYear: number;
  readonly preChangeYear: number;
  readonly preComparisonYear: number;
  /** (postChangeYear - postComparisonYear) - (preChangeYear - preComparisonYear). */
  readonly effect: number;
  readonly districtCount: number;
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

function sumQuarters(
  baseline: EngineBaseline,
  indicator: string,
  codes: readonly DistrictCode[],
  year: number,
  parts: readonly string[],
): Sum {
  const series = Object.hasOwn(baseline.indicators, indicator) ? baseline.indicators[indicator] : undefined;
  if (series === undefined) return { ok: false, reason: `history.json has no indicator ${indicator}` };
  let total = 0;
  for (const part of parts) {
    const quarter = `${year}${part}`;
    const index = baseline.quarters.indexOf(quarter as QuarterKey);
    for (const code of codes) {
      const value = index < 0 ? undefined : series[code]?.[index];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, reason: `observed value missing for district ${code} in ${quarter}` };
      }
      total += value;
    }
  }
  return { ok: true, value: total };
}

/** The observed effect of a case, from the baseline's mrtEntries (Requirement 20.2). */
export function computeObserved(
  c: BacktestCase,
  baseline: EngineBaseline,
): { readonly ok: true; readonly value: ObservedEffect } | { readonly ok: false; readonly reason: string } {
  const o = c.observed;
  const codes = districtsOf(baseline, o.cities);
  if (codes.length === 0) return { ok: false, reason: `no districts found for ${o.cities.join(', ')}` };
  const sums: Sum[] = [
    sumQuarters(baseline, o.indicator, codes, o.changeYear, o.postQuarters),
    sumQuarters(baseline, o.indicator, codes, o.comparisonYear, o.postQuarters),
    sumQuarters(baseline, o.indicator, codes, o.changeYear, o.preQuarters),
    sumQuarters(baseline, o.indicator, codes, o.comparisonYear, o.preQuarters),
  ];
  for (const s of sums) if (!s.ok) return s;
  const [a, b, d, e] = sums.map((s) => (s.ok ? s.value : 0)) as [number, number, number, number];
  return {
    ok: true,
    value: {
      postChangeYear: a,
      postComparisonYear: b,
      preChangeYear: d,
      preComparisonYear: e,
      effect: a - b - (d - e),
      districtCount: codes.length,
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
export function computeCase(c: BacktestCase, inputs: BacktestInputs): CaseResult {
  if (c.tool !== SUPPORTED_TOOL || c.change.field !== 'commuterPassPrice') {
    return notComputed(c.id, `unsupported change: tool ${c.tool}, field ${c.change.field}`);
  }
  const { baseline } = inputs;

  // The observed effect is fixed before the engine runs (Requirement 20.2).
  const observed = computeObserved(c, baseline);
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

  const codes = districtsOf(baseline, c.areas);
  const central = simulatedSum(result.central, c, codes);
  const low = simulatedSum(result.low, c, codes);
  const high = simulatedSum(result.high, c, codes);
  const simulated: ResultRange = { min: Math.min(low, central, high), central, max: Math.max(low, central, high) };

  const effect = observed.value.effect;
  const ratio = effect === 0 ? null : central / effect;
  const absoluteError = central - effect;
  return {
    status: 'computed',
    case: c,
    observed: observed.value,
    simulated,
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
