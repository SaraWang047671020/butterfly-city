// Stage-0 validation, steps 1 to 8 (design, "Stage 0: validation order"):
//   1. target Quarter_Key (run) or state quarter (step)
//   2. duplicate Rule_Registry ids
//   3. Parameter_Table, all issues collected into one `parameters-invalid` error
//   4. Commute_Matrix
//   5. Baseline coverage and values (earliest quarter, then lowest District_Code)
//   6. Real_Policy_Track and Player_Policy_Timeline entries for every rule field
//   7. Events and their references
//   8. Policy values: type checks, tool checks, then the Policy_Limits of the player timeline,
//      then the Source_Ids named by the rules
// Pure. Returns the first error or null. `validateStage0` runs steps 1 to 8 in this fixed order.

import type { CityName, DistrictCode, QuarterKey } from '../types/data-files.ts';
import type {
  BudgetLedger,
  CommuteMatrix,
  EngineBaseline,
  EngineError,
  ParameterIssue,
  ParameterProblem,
  ParameterSpec,
  ParameterTable,
  PolicySetting,
  PolicyTimeline,
  RuleContext,
  RuleRegistry,
  SimEvent,
  ToolRule,
} from '../types/simulation.ts';
import { checkLimit } from './budget.ts';
import {
  CITY_ORDER,
  DISTRICT_COUNT,
  FIRST_QUARTER,
  LAST_QUARTER,
  QUARTER_COUNT,
  SHARE_SUM_TOLERANCE,
} from './constants.ts';
import {
  baselineInvalid,
  baselineMissing,
  commuteMatrixInvalid,
  eventInvalid,
  eventReferenceUnknown,
  limitExceeded,
  noLaterQuarter,
  parametersInvalid,
  policyValueInvalid,
  quarterInvalid,
  registryDuplicate,
  ruleReferenceMissing,
  trackMissing,
} from './errors.ts';
import { checkSpecs, expandId, optionalScalar } from './params.ts';
import { parseQuarter, quarterAt, quarterIndex, quarterYear } from './quarter.ts';
import { collectParameterSpecs } from './registry.ts';

export type Stage0Target =
  | { readonly kind: 'run'; readonly target: string }
  | { readonly kind: 'step'; readonly quarter: string };

export interface Stage0Input {
  readonly target: Stage0Target;
  readonly registry: RuleRegistry;
  readonly params: ParameterTable;
  readonly baseline: EngineBaseline;
  readonly realTrack: PolicyTimeline;
  readonly commute: CommuteMatrix;
}

/** Input of the full stage 0: steps 1 to 4 plus the player timeline and the event list. */
export interface Stage0FullInput extends Stage0Input {
  readonly policies: PolicyTimeline;
  readonly events: readonly SimEvent[];
}

// ---------------------------------------------------------------------------
// Step 1
// ---------------------------------------------------------------------------

function inRange(q: string): boolean {
  const key = parseQuarter(q);
  if (key === null) return false;
  const i = quarterIndex(key);
  return i >= 0 && i < QUARTER_COUNT;
}

/** Requirement 1.3 (run target) and 1.4 (step on the last quarter). */
export function checkTargetQuarter(target: Stage0Target): EngineError | null {
  const received = target.kind === 'run' ? target.target : target.quarter;
  if (!inRange(received)) return quarterInvalid(received, FIRST_QUARTER, LAST_QUARTER);
  if (target.kind === 'step' && received === LAST_QUARTER) return noLaterQuarter(received);
  return null;
}

// ---------------------------------------------------------------------------
// Step 2
// ---------------------------------------------------------------------------

/** Requirement 16.6: the first id used by two rules, in registry order (tools first). */
export function checkRegistryIds(registry: RuleRegistry): EngineError | null {
  const seen = new Set<string>();
  for (const rule of [...registry.tools, ...registry.indicators]) {
    if (seen.has(rule.id)) return registryDuplicate(rule.id);
    seen.add(rule.id);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 3
// ---------------------------------------------------------------------------

const GHOST_SIZE_ID = 'ghost.size';
const FIRST_YEAR = quarterYear(FIRST_QUARTER);
const LAST_YEAR = quarterYear(LAST_QUARTER);

/** Specs that no rule declares but stage 0 must check (job shares, Budget_Ceilings). */
function extraSpecs(
  registry: RuleRegistry,
  baseline: EngineBaseline,
): readonly ParameterSpec[] {
  const out: ParameterSpec[] = [];
  for (const d of baseline.districts) {
    out.push({
      id: expandId('commute.jobShare.<code>', { code: d.code }),
      role: 'derivation',
      check: { kind: 'share' },
    });
  }
  for (const tool of registry.tools) {
    for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) {
      out.push({
        id: `budget.ceiling.${tool.id}.${year}`,
        role: 'ceiling',
        check: { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER },
        optional: true,
      });
    }
  }
  return out;
}

function finiteValue(params: ParameterTable, id: string): number | undefined {
  const v = optionalScalar(params, id);
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}

function pushIssue(issues: ParameterIssue[], parameterId: string, problem: ParameterProblem): void {
  issues.push({ parameterId, problem });
}

function checkGhostGroup(params: ParameterTable, issues: ParameterIssue[]): void {
  // ghost.size must be an integer of at least 1 (Requirement 10.2).
  const size = finiteValue(params, GHOST_SIZE_ID);
  if (size !== undefined && (!Number.isInteger(size) || size < 1)) {
    pushIssue(issues, GHOST_SIZE_ID, 'out-of-bounds');
  }

  // shareBoth <= min(shareRent, 1 - shareCommuteWithin.high) (Requirement 10.4).
  const both = finiteValue(params, 'ghost.shareBoth');
  const rent = finiteValue(params, 'ghost.shareRent');
  const withinParam = Object.hasOwn(params, 'ghost.shareCommuteWithin')
    ? params['ghost.shareCommuteWithin']
    : undefined;
  if (both !== undefined && rent !== undefined && withinParam?.kind === 'scalar') {
    const high =
      withinParam.range !== undefined && Number.isFinite(withinParam.range.high)
        ? withinParam.range.high
        : withinParam.value;
    if (Number.isFinite(high) && both > Math.min(rent, 1 - high)) {
      pushIssue(issues, 'ghost.shareBoth', 'group-invalid');
    }
  }
}

function checkJobShares(
  params: ParameterTable,
  baseline: EngineBaseline,
  issues: ParameterIssue[],
): void {
  let sum = 0;
  for (const d of baseline.districts) {
    const v = optionalScalar(params, expandId('commute.jobShare.<code>', { code: d.code }));
    if (v === undefined || !Number.isFinite(v)) return; // reported by the spec check
    sum += v;
  }
  if (Math.abs(sum - 1) > SHARE_SUM_TOLERANCE) pushIssue(issues, 'commute.jobShare', 'group-invalid');
}

function limitFields(tools: readonly ToolRule[]): { tool: ToolRule; field: ToolRule['fields'][number] }[] {
  const out: { tool: ToolRule; field: ToolRule['fields'][number] }[] = [];
  for (const tool of tools) for (const field of tool.fields) out.push({ tool, field });
  return out;
}

/** Real values of one tool field, area by area, per quarter present in the track. */
function realValues(
  realTrack: PolicyTimeline,
  tool: string,
  field: string,
): { quarter: string; area: string; value: number }[] {
  const out: { quarter: string; area: string; value: number }[] = [];
  for (const setting of realTrack) {
    const values = setting.tools[tool]?.[field];
    if (values === undefined) continue;
    for (const area of Object.keys(values)) {
      const value = values[area];
      if (typeof value === 'number' && Number.isFinite(value)) {
        out.push({ quarter: setting.quarter, area, value });
      }
    }
  }
  return out;
}

function checkLimits(
  params: ParameterTable,
  tools: readonly ToolRule[],
  baseline: EngineBaseline,
  realTrack: PolicyTimeline,
  issues: ParameterIssue[],
): void {
  const cityOf = new Map<string, string>(baseline.districts.map((d) => [d.code, d.city]));
  for (const { tool, field } of limitFields(tools)) {
    const base = `limit.${tool.id}.${field.id}`;
    const lowerFactor = finiteValue(params, `${base}.lowerFactor`);
    const upperFactor = finiteValue(params, `${base}.upperFactor`);
    if (lowerFactor !== undefined && lowerFactor > 1) pushIssue(issues, `${base}.lowerFactor`, 'limit-invalid');
    if (upperFactor !== undefined && upperFactor < 1) pushIssue(issues, `${base}.upperFactor`, 'limit-invalid');

    const min = finiteValue(params, `${base}.min`);
    const max = finiteValue(params, `${base}.max`);
    const upperIsPrice = tool.id === 'commuterPass' && field.id === 'subsidy';
    if (min === undefined && (max === undefined || upperIsPrice)) continue;

    // Group the real values by the limit's scope: a quarter, or a city-year total (Decision D6).
    const groups = new Map<string, { value: number; quarters: Set<string> }>();
    for (const r of realValues(realTrack, tool.id, field.id)) {
      const key =
        field.limitScope === 'city-year'
          ? `${cityOf.get(r.area) ?? r.area}|${quarterYear(r.quarter as typeof FIRST_QUARTER)}`
          : `${r.area}|${r.quarter}`;
      const g = groups.get(key) ?? { value: 0, quarters: new Set<string>() };
      g.value += r.value;
      g.quarters.add(r.quarter);
      groups.set(key, g);
    }
    const complete = (quarters: Set<string>): boolean =>
      field.limitScope !== 'city-year' || quarters.size >= 4;
    for (const g of groups.values()) {
      if (min !== undefined && complete(g.quarters) && g.value < min) {
        pushIssue(issues, `${base}.min`, 'limit-invalid');
      }
      if (!upperIsPrice && max !== undefined && g.value > max) {
        pushIssue(issues, `${base}.max`, 'limit-invalid');
      }
    }
  }
}

/** Requirements 7.8, 7.9, 8.8, 9.9, 10.4, 14.2 to 14.5, 14.10 to 14.12, 18.8. */
export function checkParameterTable(
  params: ParameterTable,
  registry: RuleRegistry,
  baseline: EngineBaseline,
  realTrack: PolicyTimeline,
): EngineError | null {
  const specs = [...collectParameterSpecs(registry), ...extraSpecs(registry, baseline)];
  const issues: ParameterIssue[] = [...checkSpecs(params, specs)];
  checkGhostGroup(params, issues);
  checkJobShares(params, baseline, issues);
  checkLimits(params, registry.tools, baseline, realTrack, issues);

  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const key = `${i.parameterId}\u0000${i.problem}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length === 0 ? null : parametersInvalid(unique);
}

// ---------------------------------------------------------------------------
// Step 4
// ---------------------------------------------------------------------------

/** Requirement 9.10: size, code order, then negative, non-finite and diagonal entries (row-major). */
export function checkCommuteMatrix(
  commute: CommuteMatrix,
  baseline: EngineBaseline,
): EngineError | null {
  const rows = commute.minutes.length;
  const firstRow = commute.minutes[0];
  const columns = firstRow === undefined ? 0 : firstRow.length;
  const badRow = commute.minutes.find((r) => r.length !== DISTRICT_COUNT);
  if (rows !== DISTRICT_COUNT || badRow !== undefined || commute.codes.length !== DISTRICT_COUNT) {
    return commuteMatrixInvalid({
      kind: 'size',
      rows,
      columns: badRow !== undefined ? badRow.length : columns,
    });
  }

  const expected = baseline.districts.map((d) => d.code);
  for (let i = 0; i < commute.codes.length; i += 1) {
    const code = commute.codes[i] ?? '';
    const want = expected[i] ?? '';
    if (code !== want) {
      return commuteMatrixInvalid({ kind: 'cell', origin: code, destination: want, reason: 'code-order' });
    }
  }

  for (let i = 0; i < DISTRICT_COUNT; i += 1) {
    const row = commute.minutes[i];
    const origin = commute.codes[i] ?? '';
    for (let j = 0; j < DISTRICT_COUNT; j += 1) {
      const v = row?.[j];
      const destination = commute.codes[j] ?? '';
      const fail = (reason: string): EngineError =>
        commuteMatrixInvalid({ kind: 'cell', origin, destination, reason });
      if (typeof v !== 'number' || !Number.isFinite(v)) return fail('non-finite');
      if (v < 0) return fail('negative');
      if (i === j && v !== 0) return fail('diagonal-not-zero');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Steps 1 to 4 in order
// ---------------------------------------------------------------------------

export function validateStage0Steps1To4(input: Stage0Input): EngineError | null {
  return (
    checkTargetQuarter(input.target) ??
    checkRegistryIds(input.registry) ??
    checkParameterTable(input.params, input.registry, input.baseline, input.realTrack) ??
    checkCommuteMatrix(input.commute, input.baseline)
  );
}

// ---------------------------------------------------------------------------
// Shared helpers for steps 5 to 8
// ---------------------------------------------------------------------------

const REAL_TRACK = 'Real_Policy_Track';
const PLAYER_TIMELINE = 'Player_Policy_Timeline';

/** Baseline indicators the registry rules read for every district and quarter. */
const REQUIRED_BASELINE: readonly string[] = [
  'population',
  'householdIncome',
  'rent',
  'socialHousingStock',
  'mrtEntries',
];

/** The rule that reads a Baseline indicator, for `rule-reference-missing` on its Source_Ids. */
const BASELINE_READER: Readonly<Record<string, string>> = { householdIncome: 'rentBurden' };

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Index of the last quarter the call needs: the run target, or the quarter after the step state. */
function lastQuarterIndex(target: Stage0Target): number {
  const key = parseQuarter(target.kind === 'run' ? target.target : target.quarter);
  const index = key === null ? -1 : quarterIndex(key);
  return target.kind === 'step' ? index + 1 : index;
}

function sortedCodes(baseline: EngineBaseline): readonly DistrictCode[] {
  return baseline.districts.map((d) => d.code).sort(ascending);
}

function settingsByQuarter(timeline: PolicyTimeline): ReadonlyMap<string, PolicySetting> {
  const map = new Map<string, PolicySetting>();
  for (const setting of timeline) if (!map.has(setting.quarter)) map.set(setting.quarter, setting);
  return map;
}

export interface FieldSlot {
  readonly tool: ToolRule;
  readonly field: string;
  readonly integer: boolean;
  readonly areas: readonly string[];
}

/** Every tool field in registry order; track-only fields are included for the Real_Policy_Track only. */
function fieldSlots(
  registry: RuleRegistry,
  baseline: EngineBaseline,
  includeTrackOnly: boolean,
): readonly FieldSlot[] {
  const codes = sortedCodes(baseline);
  const out: FieldSlot[] = [];
  for (const tool of registry.tools) {
    for (const f of tool.fields) {
      out.push({
        tool,
        field: f.id,
        integer: f.integer === true,
        areas: f.area === 'district' ? codes : CITY_ORDER,
      });
    }
    if (includeTrackOnly) {
      for (const field of tool.trackOnlyFields) {
        out.push({ tool, field, integer: false, areas: tool.level === 'district' ? codes : CITY_ORDER });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 5: Baseline coverage and values
// ---------------------------------------------------------------------------

/** Requirements 2.7 and 15.2: earliest quarter first, then lowest District_Code, then indicator order. */
export function checkBaselineValues(baseline: EngineBaseline, lastIndex: number): EngineError | null {
  const codes = sortedCodes(baseline);
  for (let i = 0; i <= lastIndex; i += 1) {
    const quarter = quarterAt(i);
    if (baseline.quarters[i] !== quarter) return baselineMissing('quarters', codes[0] ?? '', quarter);
    for (const code of codes) {
      for (const indicator of REQUIRED_BASELINE) {
        const series = Object.hasOwn(baseline.indicators, indicator) ? baseline.indicators[indicator] : undefined;
        const values = series !== undefined && Object.hasOwn(series, code) ? series[code] : undefined;
        if (values === undefined || i >= values.length) return baselineMissing(indicator, code, quarter);
        const v = values[i];
        if (typeof v !== 'number') return baselineInvalid(indicator, code, quarter, null);
        if (!Number.isFinite(v) || v < 0) return baselineInvalid(indicator, code, quarter, v);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 6: entries of both policy tracks
// ---------------------------------------------------------------------------

/** Requirements 15.2 and 16.7. */
export function checkTrackEntries(
  timeline: PolicyTimeline,
  inputName: string,
  lastIndex: number,
  slots: readonly FieldSlot[],
  firstArea: string,
): EngineError | null {
  const byQuarter = settingsByQuarter(timeline);
  for (let i = 0; i <= lastIndex; i += 1) {
    const quarter = quarterAt(i);
    const setting = byQuarter.get(quarter);
    if (setting === undefined) return trackMissing(inputName, firstArea, quarter);
    for (const slot of slots) {
      const tool = Object.hasOwn(setting.tools, slot.tool.id) ? setting.tools[slot.tool.id] : undefined;
      const byArea = tool !== undefined && Object.hasOwn(tool, slot.field) ? tool[slot.field] : undefined;
      if (byArea === undefined) {
        return ruleReferenceMissing(slot.tool.id, `${slot.field} in ${inputName} ${quarter}`);
      }
      for (const area of slot.areas) {
        if (!Object.hasOwn(byArea, area)) return trackMissing(inputName, area, quarter);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 7: events
// ---------------------------------------------------------------------------

function quarterInBounds(q: string): boolean {
  const key = parseQuarter(q);
  if (key === null) return false;
  const i = quarterIndex(key);
  return i >= 0 && i < QUARTER_COUNT;
}

/** Requirements 11.3, 11.5 and 13.8, in event-list order. */
export function checkEvents(
  events: readonly SimEvent[],
  registry: RuleRegistry,
  baseline: EngineBaseline,
  params: ParameterTable,
): EngineError | null {
  const indicators = new Set<string>([
    ...registry.indicators.map((r) => r.id),
    ...Object.keys(baseline.indicators),
  ]);
  const tools = new Set<string>(registry.tools.map((t) => t.id));
  for (const event of events) {
    for (const q of [event.firstQuarter, event.lastQuarter]) {
      if (!quarterInBounds(q)) return eventReferenceUnknown(event.id, q);
    }
    for (const indicator of event.affectedIndicators) {
      if (!indicators.has(indicator)) return eventReferenceUnknown(event.id, indicator);
    }
    for (const m of event.modifiers) {
      if (!tools.has(m.tool)) return eventReferenceUnknown(event.id, m.tool);
      if (!Object.hasOwn(params, m.parameterId)) return eventReferenceUnknown(event.id, m.parameterId);
    }

    const first = parseQuarter(event.firstQuarter);
    const last = parseQuarter(event.lastQuarter);
    if (first !== null && last !== null && quarterIndex(first) > quarterIndex(last)) {
      return eventInvalid(event.id, `${event.firstQuarter} is later than ${event.lastQuarter}`);
    }
    for (const m of event.modifiers) {
      const p = params[m.parameterId];
      if (p === undefined || p.kind !== 'scalar') return eventInvalid(event.id, m.parameterId);
      const v = p.value;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return eventInvalid(event.id, typeof v === 'number' && Number.isFinite(v) ? v : null);
      }
      if (p.range !== undefined && (v < p.range.low || v > p.range.high)) {
        return eventInvalid(event.id, v);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 8: policy values
// ---------------------------------------------------------------------------

/** Requirement 15.1: negative, non-integer count or non-finite values in a track. */
export function checkTrackValues(
  timeline: PolicyTimeline,
  lastIndex: number,
  slots: readonly FieldSlot[],
): EngineError | null {
  const byQuarter = settingsByQuarter(timeline);
  for (let i = 0; i <= lastIndex; i += 1) {
    const quarter = quarterAt(i);
    const setting = byQuarter.get(quarter);
    if (setting === undefined) continue;
    for (const slot of slots) {
      const byArea = setting.tools[slot.tool.id]?.[slot.field];
      if (byArea === undefined) continue;
      for (const area of slot.areas) {
        const v = byArea[area];
        const where = [slot.tool.id, slot.field, area, quarter] as const;
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          return policyValueInvalid(...where, null, 'not a finite number');
        }
        if (v < 0) return policyValueInvalid(...where, v, 'below 0');
        if (slot.integer && !Number.isInteger(v)) {
          return policyValueInvalid(...where, v, 'not an integer');
        }
      }
    }
  }
  return null;
}

function checkToolSettings(
  input: Stage0FullInput,
  lastIndex: number,
  ctx: RuleContext,
): EngineError | null {
  const real = settingsByQuarter(input.realTrack);
  const player = settingsByQuarter(input.policies);
  for (let i = 0; i <= lastIndex; i += 1) {
    const quarter = quarterAt(i);
    for (const tool of input.registry.tools) {
      const playerTool = player.get(quarter)?.tools[tool.id] ?? {};
      const realTool = real.get(quarter)?.tools[tool.id] ?? {};
      const error = tool.checkSetting(playerTool, realTool, quarter, ctx);
      if (error !== null) return error;
    }
  }
  return null;
}

/**
 * Requirement 18.4: the player timeline only, never clipped, the real track is not checked.
 * City-year fields (social housing) are checked on the running total of the year for the upper
 * limit, and on the full year for the lower limit (Decision D6).
 */
function checkPlayerLimits(
  input: Stage0FullInput,
  lastIndex: number,
  ctx: RuleContext,
): EngineError | null {
  const ledger: BudgetLedger = {
    plan: { real: input.realTrack, realCharges: {}, annualBudget: [], ceilings: {} },
    through: null,
    committed: {},
    year: quarterYear(FIRST_QUARTER),
    remaining: 0,
  };
  const cityOf = new Map<string, CityName>(input.baseline.districts.map((d) => [d.code, d.city]));
  const codes = sortedCodes(input.baseline);
  const player = settingsByQuarter(input.policies);
  const totals = new Map<string, number>();

  for (let i = 0; i <= lastIndex; i += 1) {
    const quarter: QuarterKey = quarterAt(i);
    const setting = player.get(quarter);
    if (setting === undefined) continue;
    const year = quarterYear(quarter);
    for (const tool of input.registry.tools) {
      for (const field of tool.fields) {
        const values = setting.tools[tool.id]?.[field.id] ?? {};
        const limits = (area: string) =>
          checkLimit(tool.id, field.id, area, quarter, ledger, input.params, input.registry.tools, ctx);

        if (field.limitScope === 'quarter') {
          for (const area of field.area === 'district' ? codes : CITY_ORDER) {
            const v = values[area];
            if (typeof v !== 'number') continue;
            const info = limits(area);
            if (v > info.upper) {
              return limitExceeded(tool.id, field.id, area, quarter, v, 'upper', info.upper, info.upperParameterId ?? '');
            }
            if (v < info.lower) {
              return limitExceeded(tool.id, field.id, area, quarter, v, 'lower', info.lower, info.lowerParameterId ?? '');
            }
          }
          continue;
        }

        for (const code of codes) {
          const v = values[code];
          const city = cityOf.get(code);
          if (typeof v !== 'number' || city === undefined) continue;
          const key = `${tool.id}|${field.id}|${city}|${year}`;
          totals.set(key, (totals.get(key) ?? 0) + v);
        }
        for (const city of CITY_ORDER) {
          const total = totals.get(`${tool.id}|${field.id}|${city}|${year}`) ?? 0;
          const info = limits(city);
          const period = String(year);
          if (total > info.upper) {
            return limitExceeded(tool.id, field.id, city, period, total, 'upper', info.upper, info.upperParameterId ?? '');
          }
          if (quarter.endsWith('Q4') && total < info.lower) {
            return limitExceeded(tool.id, field.id, city, period, total, 'lower', info.lower, info.lowerParameterId ?? '');
          }
        }
      }
    }
  }
  return null;
}

/** Requirement 13.8: every Source_Id a rule reads from the Baseline is in the source registry. */
export function checkSourceIds(baseline: EngineBaseline): EngineError | null {
  const known = new Set<string>(baseline.sourceIds);
  for (const indicator of REQUIRED_BASELINE) {
    if (!Object.hasOwn(baseline.indicatorSources, indicator)) continue;
    for (const id of baseline.indicatorSources[indicator] ?? []) {
      if (!known.has(id)) return ruleReferenceMissing(BASELINE_READER[indicator] ?? indicator, id);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Steps 1 to 8 in order
// ---------------------------------------------------------------------------

/** Full stage 0. Returns the first error in the fixed order of the design, or null. */
export function validateStage0(input: Stage0FullInput): EngineError | null {
  const early = validateStage0Steps1To4(input);
  if (early !== null) return early;

  const lastIndex = lastQuarterIndex(input.target);
  const baselineError = checkBaselineValues(input.baseline, lastIndex);
  if (baselineError !== null) return baselineError;

  const firstArea = sortedCodes(input.baseline)[0] ?? '';
  const realSlots = fieldSlots(input.registry, input.baseline, true);
  const playerSlots = fieldSlots(input.registry, input.baseline, false);
  const trackError =
    checkTrackEntries(input.realTrack, REAL_TRACK, lastIndex, realSlots, firstArea) ??
    checkTrackEntries(input.policies, PLAYER_TIMELINE, lastIndex, playerSlots, firstArea);
  if (trackError !== null) return trackError;

  const eventError = checkEvents(input.events, input.registry, input.baseline, input.params);
  if (eventError !== null) return eventError;

  const ctx: RuleContext = {
    params: input.params,
    baseline: input.baseline,
    realTrack: input.realTrack,
    commute: input.commute,
  };
  return (
    checkTrackValues(input.realTrack, lastIndex, realSlots) ??
    checkTrackValues(input.policies, lastIndex, playerSlots) ??
    checkToolSettings(input, lastIndex, ctx) ??
    checkPlayerLimits(input, lastIndex, ctx) ??
    checkSourceIds(input.baseline)
  );
}
