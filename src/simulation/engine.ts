// Simulation engine: the per-quarter stage runner (task 10.1) and `step`, `run`, `runRange` (task 10.2).
// Pure functions. Inputs are never mutated; the returned Sim_State is a fresh, deep-frozen object.
// All iteration is over arrays in a fixed order: the Rule_Registry, districts in ascending code, the event list.

import type { DistrictCode, QuarterKey } from '../types/data-files.ts';
import type {
  AreaKey,
  BudgetPlan,
  CauseBreakdown,
  CauseDraft,
  CauseLinks,
  CommuteMatrix,
  EngineBaseline,
  EngineError,
  EngineOptions,
  IndicatorId,
  LagEntry,
  ParameterTable,
  PolicySetting,
  PolicyTimeline,
  QuarterRanges,
  QuarterWork,
  RangeResult,
  ResultRange,
  RuleContext,
  RuleRegistry,
  RunResult,
  ScenarioName,
  SimEvent,
  SimState,
  StepResult,
  ToolEffects,
  ToolId,
  ToolSetting,
} from '../types/simulation.ts';
import { commitQuarter, emptyLedger, planBudget } from './budget.ts';
import { RULE_REGISTRY } from './registry.ts';
import { validateStage0 } from './validate.ts';
import { nonFinite, stockNegative } from './errors.ts';
import { applyEvents } from './events.ts';
import type { EventContribution } from './events.ts';
import { createCauseCache, finish } from './explain.ts';
import { commit, mature } from './lag.ts';
import { migrate } from './migration.ts';
import type { MigrationDistrict, MigrationResult } from './migration.ts';
import { scalar, scenarioTable } from './params.ts';
import { derivedRentBurden } from './derived.ts';
import { nextQuarter, quarterAt, quarterIndex } from './quarter.ts';
import { checkRenterCapacity } from './rules/social-housing.ts';
import { MIGRATION_PARAMETER_IDS } from './rules/population.ts';

export { ENGINE_VERSION } from './constants.ts';

/** Everything `computeQuarter` reads besides the previous state and the quarter. */
export interface QuarterInputs {
  readonly policies: PolicyTimeline;
  readonly events: readonly SimEvent[];
  readonly params: ParameterTable;
  readonly baseline: EngineBaseline;
  readonly realTrack: PolicyTimeline;
  readonly commute: CommuteMatrix;
  readonly registry: RuleRegistry;
  /** Built once per run by `planBudget` (stage 0); used to start the ledger in the first quarter. */
  readonly plan: BudgetPlan;
  readonly options?: Pick<EngineOptions, 'budgetMode'>;
}

export type QuarterResult =
  | { readonly ok: true; readonly value: SimState }
  | { readonly ok: false; readonly error: EngineError };

const NO_SETTING: ToolSetting = {};

function failure(error: EngineError): QuarterResult {
  return { ok: false, error };
}

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function settingFor(timeline: PolicyTimeline, quarter: QuarterKey): PolicySetting | undefined {
  return timeline.find((s) => s.quarter === quarter);
}

function toolSettingOf(setting: PolicySetting | undefined, tool: ToolId): ToolSetting {
  if (setting === undefined || !Object.hasOwn(setting.tools, tool)) return NO_SETTING;
  return setting.tools[tool] ?? NO_SETTING;
}

/** Adds every object reachable from `root` to `into` (used to keep caller-owned objects out of the freeze). */
function collectObjects(root: unknown, into: Set<object>): void {
  if (typeof root !== 'object' || root === null || into.has(root)) return;
  into.add(root);
  for (const child of Object.values(root)) collectObjects(child, into);
}

/** Freezes everything reachable from `root` except the objects in `skip`. */
function deepFreeze<T>(root: T, skip: ReadonlySet<object>): T {
  if (typeof root !== 'object' || root === null) return root;
  if (skip.has(root) || Object.isFrozen(root)) return root;
  Object.freeze(root);
  for (const key in root) {
    const child: unknown = root[key];
    if (typeof child === 'object' && child !== null) deepFreeze(child, skip);
  }
  return root;
}

interface MaturedResult {
  /** Active difference per tool and area, in registry order. */
  readonly active: Record<ToolId, Record<AreaKey, number>>;
  readonly carry: Record<ToolId, Record<AreaKey, number>>;
  readonly pipeline: readonly LagEntry[];
}

/** Stages 1 and 3: commit the differences of `t` to the Lag_Pipeline, then mature the entries of `t`. */
function commitAndMature(
  prev: SimState | null,
  t: QuarterKey,
  inputs: QuarterInputs,
  ctx: RuleContext,
): MaturedResult {
  const { registry, params } = inputs;
  const tools = registry.tools;
  const toolOrder = tools.map((r) => r.id);
  const player = toolSettingsOf(inputs.policies, t);
  const real = toolSettingsOf(inputs.realTrack, t);
  const tIndex = quarterIndex(t);

  const lags: Record<ToolId, number> = {};
  const diffs: Record<ToolId, Readonly<Record<AreaKey, number>>> = {};
  const entries: LagEntry[] = [];
  for (const tool of tools) {
    const lag = scalar(params, tool.lagParameterId);
    lags[tool.id] = lag;
    const diff = tool.difference(player(tool.id), real(tool.id), t, ctx);
    diffs[tool.id] = diff;
    if (lag >= 1) {
      const effect = quarterAt(tIndex + lag);
      for (const area of Object.keys(diff)) {
        entries.push({ tool: tool.id, area, committed: t, effect, value: diff[area] ?? 0 });
      }
    }
  }

  const committedPipeline = commit(prev?.lagPipeline ?? [], entries, toolOrder);
  const { matured, rest } = mature(committedPipeline, t);

  const active: Record<ToolId, Record<AreaKey, number>> = {};
  const carry: Record<ToolId, Record<AreaKey, number>> = {};
  for (const tool of tools) {
    const diff = diffs[tool.id] ?? {};
    const lag = lags[tool.id] ?? 0;
    const incoming: Record<AreaKey, number> = {};
    for (const area of Object.keys(diff)) incoming[area] = 0;
    if (lag >= 1) {
      for (const m of matured) {
        if (m.tool === tool.id) incoming[m.area] = (incoming[m.area] ?? 0) + m.value;
      }
    } else {
      for (const area of Object.keys(diff)) incoming[area] = (incoming[area] ?? 0) + (diff[area] ?? 0);
    }

    if (tool.effect === 'stock') {
      const before = prev?.carry.stock[tool.id] ?? {};
      const after: Record<AreaKey, number> = { ...before };
      for (const area of Object.keys(incoming)) after[area] = (after[area] ?? 0) + (incoming[area] ?? 0);
      carry[tool.id] = after;
      active[tool.id] = after;
    } else {
      active[tool.id] = incoming;
    }
  }
  return { active, carry, pipeline: rest };
}

function toolSettingsOf(timeline: PolicyTimeline, t: QuarterKey): (tool: ToolId) => ToolSetting {
  const setting = settingFor(timeline, t);
  return (tool) => toolSettingOf(setting, tool);
}

/**
 * Requirement 13.7: every Cause links to at least one Parameter id or Source_Id, including a tool Cause whose
 * contribution is 0. A tool that reports no links for an indicator gets its Lag parameter and the indicator's
 * Baseline Source_Ids, because the Lag decides when any difference of that tool could reach the indicator.
 */
function withFallbackLinks(
  tool: RuleRegistry['tools'][number],
  effects: ToolEffects,
  registry: RuleRegistry,
  baseline: EngineBaseline,
): ToolEffects {
  const links: Record<IndicatorId, CauseLinks> = { ...effects.links };
  for (const rule of registry.indicators) {
    const have = Object.hasOwn(links, rule.id) ? links[rule.id] : undefined;
    if (have !== undefined && (have.parameterIds.length > 0 || have.sourceIds.length > 0)) continue;
    const sources = Object.hasOwn(baseline.indicatorSources, rule.id) ? baseline.indicatorSources[rule.id] : undefined;
    links[rule.id] = { parameterIds: [tool.lagParameterId], sourceIds: [...(sources ?? [])].sort() };
  }
  return { ...effects, links };
}

/** Requirement 13.7 for the migration Cause: a Cause with no links gets the migration Parameter ids. */
function withMigrationLinks(draft: CauseDraft): CauseDraft {
  const l = draft.migration.links;
  if (l.parameterIds.length > 0 || l.sourceIds.length > 0) return draft;
  return {
    ...draft,
    migration: { ...draft.migration, links: { parameterIds: MIGRATION_PARAMETER_IDS, sourceIds: [] } },
  };
}

/**
 * Computes the Sim_State of quarter `t` from the previous state (`null` for 2015Q1).
 * Stages: commit, charges and budget, mature, effects, events, pre-migration indicators, migration,
 * post-migration indicators, finite check, build and freeze.
 */
export function computeQuarter(prev: SimState | null, t: QuarterKey, inputs: QuarterInputs): QuarterResult {
  const { registry, params, baseline, realTrack, commute } = inputs;
  const ctx: RuleContext = { params, baseline, realTrack, commute };
  const tIndex = quarterIndex(t);
  const districts: readonly DistrictCode[] = baseline.districts.map((d) => d.code).sort(ascending);

  // Stages 1 and 2: commit, charges and budget checks.
  const playerSetting = settingFor(inputs.policies, t) ?? { quarter: t, tools: {} };
  const ledgerResult = commitQuarter(
    prev?.ledger ?? emptyLedger(inputs.plan),
    t,
    playerSetting,
    registry.tools,
    params,
    inputs.options ?? {},
    ctx,
  );
  if (!ledgerResult.ok) return failure(ledgerResult.error);

  // Stage 3: mature.
  const { active, carry, pipeline } = commitAndMature(prev, t, inputs, ctx);
  for (const tool of registry.tools) {
    if (tool.id !== 'socialHousing') continue;
    const capacity = checkRenterCapacity(active[tool.id] ?? {}, t, ctx);
    if (capacity !== null) return failure(capacity);
  }

  // Stages 4 and 5: tool effects, then events, in registry order.
  const effects: Record<ToolId, ToolEffects> = {};
  const eventContributions: Record<
    ToolId,
    Readonly<Record<IndicatorId, Readonly<Record<DistrictCode, readonly EventContribution[]>>>>
  > = {};
  for (const tool of registry.tools) {
    const raw = tool.effects(active[tool.id] ?? {}, t, ctx);
    const applied = applyEvents(tool, raw, t, inputs.events, params);
    effects[tool.id] = withFallbackLinks(tool, applied.effects, registry, baseline);
    eventContributions[tool.id] = applied.contributions;
  }

  const values: Record<IndicatorId, Record<DistrictCode, number>> = {};
  const causes: Record<IndicatorId, Record<DistrictCode, CauseBreakdown>> = {};
  const workFor = (migration: QuarterWork['migration']): QuarterWork => ({
    quarter: t,
    quarterIndex: tIndex,
    ctx,
    effects,
    eventContributions,
    values,
    migration,
    carry,
  });

  const cache = createCauseCache();
  const runStage = (stage: 'pre-migration' | 'post-migration', migration: QuarterWork['migration']): EngineError | null => {
    for (const rule of registry.indicators) {
      if (rule.stage !== stage) continue;
      const work = workFor(migration);
      const byDistrict: Record<DistrictCode, number> = {};
      const breakdowns: Record<DistrictCode, CauseBreakdown> = {};
      for (const d of districts) {
        const draft = withMigrationLinks(rule.draft(d, work));
        const override = rule.valueOverride?.(d, work);
        const result = finish(draft, {
          indicator: rule.id,
          district: d,
          quarter: t,
          params,
          cache,
          ...(override === undefined ? {} : { valueOverride: override }),
        });
        if (rule.id === 'socialHousingStock') {
          let pre = 0;
          for (const c of result.breakdown.causes) if (c.kind !== 'bound') pre += c.contribution;
          if (Math.round(pre) < 0) return stockNegative(d, t);
        }
        byDistrict[d] = result.value;
        breakdowns[d] = result.breakdown;
      }
      values[rule.id] = byDistrict;
      causes[rule.id] = breakdowns;
    }
    return null;
  };

  // Stage 6: pre-migration indicators.
  const preError = runStage('pre-migration', null);
  if (preError !== null) return failure(preError);

  // Stage 7: migration, from one start-of-quarter snapshot.
  const snapshot: MigrationDistrict[] = districts.map((d) => {
    const base = baseline.indicators['population']?.[d]?.[tIndex];
    const derived = derivedRentBurden(baseline, params, d, tIndex);
    let offset = 0;
    for (const tool of registry.tools) offset += effects[tool.id]?.commuteCostDelta?.[d] ?? 0;
    return {
      code: d,
      population: typeof base === 'number' ? base : Number.NaN,
      rentBurden: values['rentBurden']?.[d] ?? Number.NaN,
      baselineRentBurden: derived.ok ? derived.value : Number.NaN,
      commuteCostOffset: offset,
    };
  });
  const moved: MigrationResult = migrate(snapshot, commute, params);

  // Stage 8: post-migration indicators.
  const postError = runStage('post-migration', {
    net: moved.net,
    displaced: moved.displaced,
    movedIn: moved.in,
    exits: moved.exits,
  });
  if (postError !== null) return failure(postError);

  // Stage 9: finite check.
  for (const rule of registry.indicators) {
    for (const d of districts) {
      const v = values[rule.id]?.[d];
      if (v === undefined || !Number.isFinite(v)) return failure(nonFinite(rule.id, d, t));
    }
  }

  // Stage 10: build and freeze a fresh Sim_State.
  const stock: Record<ToolId, Readonly<Record<AreaKey, number>>> = {};
  for (const tool of registry.tools) {
    const c = carry[tool.id];
    if (tool.effect === 'stock' && c !== undefined) stock[tool.id] = c;
  }
  const state: SimState = {
    quarter: t,
    indicators: registry.indicators.map((r) => ({ id: r.id, unit: r.unit, kind: r.valueKind })),
    values,
    causes,
    lagPipeline: pipeline,
    ledger: ledgerResult.value,
    migration: { displaced: moved.displaced, movedIn: moved.in, exits: moved.exits },
    carry: { stock },
  };

  const skip = new Set<object>();
  collectObjects(params, skip);
  skip.add(state.ledger.plan);
  return { ok: true, value: deepFreeze(state, skip) };
}

// ---------------------------------------------------------------------------
// step, run, runRange (task 10.2)
// ---------------------------------------------------------------------------

const SCENARIOS: readonly ScenarioName[] = ['central', 'low', 'high'];

/** Advances `state` by one quarter. Validates the inputs up to the next quarter first. */
export function step(
  state: SimState,
  policies: PolicyTimeline,
  events: readonly SimEvent[],
  params: ParameterTable,
  baseline: EngineBaseline,
  realTrack: PolicyTimeline,
  commute: CommuteMatrix,
  options: EngineOptions = {},
): StepResult {
  const registry = options.registry ?? RULE_REGISTRY;
  const invalid = validateStage0({
    target: { kind: 'step', quarter: state.quarter },
    registry,
    params,
    baseline,
    realTrack,
    commute,
    policies,
    events,
  });
  if (invalid !== null) return { ok: false, error: invalid };

  const result = computeQuarter(state, nextQuarter(state.quarter), {
    policies,
    events,
    params,
    baseline,
    realTrack,
    commute,
    registry,
    plan: state.ledger.plan,
    options: { budgetMode: options.budgetMode ?? 'enforce' },
  });
  return result.ok ? { ok: true, state: result.value } : { ok: false, error: result.error };
}

/** Computes every Sim_State from 2015Q1 to `target`; returns the first error with its quarter. */
export function run(
  policies: PolicyTimeline,
  events: readonly SimEvent[],
  params: ParameterTable,
  baseline: EngineBaseline,
  realTrack: PolicyTimeline,
  commute: CommuteMatrix,
  target: QuarterKey,
  options: EngineOptions = {},
): RunResult {
  const registry = options.registry ?? RULE_REGISTRY;
  const invalid = validateStage0({
    target: { kind: 'run', target },
    registry,
    params,
    baseline,
    realTrack,
    commute,
    policies,
    events,
  });
  if (invalid !== null) return { ok: false, error: invalid, quarter: null };

  const plan = planBudget(realTrack, params, registry.tools);
  const inputs: QuarterInputs = {
    policies,
    events,
    params,
    baseline,
    realTrack,
    commute,
    registry,
    plan,
    options: { budgetMode: options.budgetMode ?? 'enforce' },
  };
  const last = quarterIndex(target);
  const states: SimState[] = [];
  let prev: SimState | null = null;
  for (let i = 0; i <= last; i += 1) {
    const t = quarterAt(i);
    const result = computeQuarter(prev, t, inputs);
    if (!result.ok) return { ok: false, error: result.error, quarter: t };
    states.push(result.value);
    prev = result.value;
  }
  return { ok: true, states };
}

/** Runs the central, low and high Scenarios on separate tables and builds a Result_Range per value. */
export function runRange(
  policies: PolicyTimeline,
  events: readonly SimEvent[],
  params: ParameterTable,
  baseline: EngineBaseline,
  realTrack: PolicyTimeline,
  commute: CommuteMatrix,
  target: QuarterKey,
  options: EngineOptions = {},
): RangeResult {
  const runs: Record<ScenarioName, readonly SimState[]> = { central: [], low: [], high: [] };
  for (const name of SCENARIOS) {
    const table = scenarioTable(params, name);
    const result = run(policies, events, table, baseline, realTrack, commute, target, options);
    if (!result.ok) return { ok: false, scenario: name, quarter: result.quarter, error: result.error };
    runs[name] = result.states;
  }

  const ranges: QuarterRanges[] = [];
  runs.central.forEach((central, i) => {
    const low = runs.low[i];
    const high = runs.high[i];
    const byIndicator: Record<IndicatorId, Record<DistrictCode, ResultRange>> = {};
    for (const indicator of Object.keys(central.values)) {
      const byDistrict: Record<DistrictCode, ResultRange> = {};
      const centralValues = central.values[indicator] ?? {};
      for (const d of Object.keys(centralValues)) {
        const c = centralValues[d] ?? Number.NaN;
        const l = low?.values[indicator]?.[d] ?? c;
        const h = high?.values[indicator]?.[d] ?? c;
        byDistrict[d] = { min: Math.min(l, c, h), central: c, max: Math.max(l, c, h) };
      }
      byIndicator[indicator] = byDistrict;
    }
    ranges.push({ quarter: central.quarter, ranges: byIndicator });
  });

  return { ok: true, central: runs.central, low: runs.low, high: runs.high, ranges };
}
