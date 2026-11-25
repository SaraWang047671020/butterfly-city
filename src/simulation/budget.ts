// Budget plan, ledger and per-quarter charges (Requirements 8 and 18.5, 18.6).
// Pure functions. All money values are integer TWD. Nothing here throws for typed inputs.
// checkBudget and checkLimit (task 5.4) reuse `quarterIncrements` and `firstOverrun`.

import type { QuarterKey } from '../types/data-files.ts';
import type {
  AreaKey,
  BudgetCheck,
  BudgetLedger,
  BudgetPlan,
  Citation,
  LimitInfo,
  EngineBaseline,
  EngineError,
  EngineOptions,
  ParameterTable,
  PolicySetting,
  PolicyTimeline,
  RuleContext,
  ToolId,
  ToolRule,
  ToolSetting,
} from '../types/simulation.ts';
import { FIRST_QUARTER, QUARTER_COUNT } from './constants.ts';
import { budgetExceeded, ceilingExceeded, err, ok } from './errors.ts';
import type { ScheduleShare } from './numeric.ts';
import { roundHalfUp, splitBySchedule } from './numeric.ts';
import { expandId, optionalScalar, scalar, schedule } from './params.ts';
import { nextQuarter, quarterAt, quarterIndex, quarterYear } from './quarter.ts';

/** Calendar years of the Historical mode, 2015 to 2025. */
const YEAR_COUNT = QUARTER_COUNT / 4;
const FIRST_YEAR = quarterYear(FIRST_QUARTER);

const NO_SETTING: ToolSetting = {};

function zeros(n: number): number[] {
  return new Array<number>(n).fill(0);
}

function yearIndexOfSlot(slot: number): number {
  return Math.floor(slot / 4);
}

/** The Cost_Schedule of a tool, or one charge at offset 0 when the tool has none (Requirement 7.7). */
function costSchedule(params: ParameterTable, tool: ToolId): readonly ScheduleShare[] {
  const p = schedule(params, `${tool}.costSchedule`);
  if (p === undefined) return [{ offset: 0, share: 1 }];
  return p.offsets.map((offset, i) => ({ offset, share: p.shares[i] ?? 0 }));
}

/**
 * Spreads one whole-TWD charge of quarter index `q` over the 44 slots.
 * A slot after 2025Q4 is recorded in 2025Q4 (Requirement 4.8).
 */
function spread(total: number, q: number, sched: readonly ScheduleShare[]): number[] {
  const slots = zeros(QUARTER_COUNT);
  for (const { offset, amount } of splitBySchedule(total, sched)) {
    const slot = Math.min(q + offset, QUARTER_COUNT - 1);
    slots[slot] = (slots[slot] ?? 0) + amount;
  }
  return slots;
}

function settingOf(timeline: PolicyTimeline, quarter: QuarterKey): PolicySetting | undefined {
  return timeline.find((s) => s.quarter === quarter);
}

function toolSetting(setting: PolicySetting | undefined, tool: ToolId): ToolSetting {
  return setting?.tools[tool] ?? NO_SETTING;
}

/** A context for charge calls when the caller has none; charges read no Baseline or commute data. */
function fallbackContext(params: ParameterTable, realTrack: PolicyTimeline): RuleContext {
  const baseline: EngineBaseline = {
    quarters: [],
    districts: [],
    indicators: {},
    indicatorSources: {},
    sourceIds: [],
  };
  return { params, baseline, realTrack, commute: { codes: [], minutes: [] } };
}

/**
 * Builds the immutable BudgetPlan once (stage 0).
 *
 * - `realCharges[tool][q]` is the 44-slot increment of the real charge of quarter `q`
 *   after the Cost_Schedule (all zeros for a quarter absent from the track).
 * - `annualBudget[y]` sums the increments of every tool that fall into year `y`, from every
 *   quarter present in the track, so it does not depend on the target quarter (conflict C3).
 * - `ceilings[tool][y]` is `budget.ceiling.<tool>.<year>` or the Annual_Budget of the year.
 *
 * `ctx` is optional; charges do not read the Baseline or the commute matrix.
 */
export function planBudget(
  realTrack: PolicyTimeline,
  params: ParameterTable,
  tools: readonly ToolRule[],
  ctx: RuleContext = fallbackContext(params, realTrack),
): BudgetPlan {
  const realCharges: Record<ToolId, readonly (readonly number[])[]> = {};
  const annualBudget = zeros(YEAR_COUNT);

  for (const tool of tools) {
    const sched = costSchedule(params, tool.id);
    const perQuarter: (readonly number[])[] = [];
    for (let q = 0; q < QUARTER_COUNT; q += 1) {
      const quarter = quarterAt(q);
      const setting = settingOf(realTrack, quarter);
      if (setting === undefined) {
        perQuarter.push(zeros(QUARTER_COUNT));
        continue;
      }
      const real = toolSetting(setting, tool.id);
      const total = tool.charge(real, real, quarter, ctx).real;
      const slots = spread(total, q, sched);
      perQuarter.push(slots);
      slots.forEach((amount, slot) => {
        const y = yearIndexOfSlot(slot);
        annualBudget[y] = (annualBudget[y] ?? 0) + amount;
      });
    }
    realCharges[tool.id] = perQuarter;
  }

  const ceilings: Record<ToolId, readonly number[]> = {};
  for (const tool of tools) {
    ceilings[tool.id] = annualBudget.map(
      (budget, y) => optionalScalar(params, `budget.ceiling.${tool.id}.${FIRST_YEAR + y}`) ?? budget,
    );
  }

  return { real: realTrack, realCharges, annualBudget, ceilings };
}

function sumYear(slots: readonly number[], yearIndex: number): number {
  let sum = 0;
  for (let s = yearIndex * 4; s < yearIndex * 4 + 4; s += 1) sum += slots[s] ?? 0;
  return sum;
}

function totalYear(
  committed: Readonly<Record<ToolId, readonly number[]>>,
  tools: readonly ToolId[],
  yearIndex: number,
): number {
  let sum = 0;
  for (const id of tools) sum += sumYear(committed[id] ?? [], yearIndex);
  return sum;
}

/** The ledger before any quarter: real charges are not yet committed. */
export function emptyLedger(plan: BudgetPlan): BudgetLedger {
  const committed: Record<ToolId, readonly number[]> = {};
  for (const id of Object.keys(plan.realCharges)) committed[id] = zeros(QUARTER_COUNT);
  return {
    plan,
    through: null,
    committed,
    year: FIRST_YEAR,
    remaining: plan.annualBudget[0] ?? 0,
  };
}

/**
 * The 44-slot increments of quarter `quarter` per tool: the real charge increments from the plan
 * plus the Cost_Schedule split of the difference charge. Shared by `step` and `checkBudget`.
 * A negative difference gives negative increments.
 */
export function quarterIncrements(
  plan: BudgetPlan,
  quarter: QuarterKey,
  player: PolicySetting,
  tools: readonly ToolRule[],
  params: ParameterTable,
  ctx: RuleContext = fallbackContext(params, plan.real),
): Readonly<Record<ToolId, readonly number[]>> {
  const q = quarterIndex(quarter);
  const realSetting = settingOf(plan.real, quarter);
  const out: Record<ToolId, readonly number[]> = {};
  for (const tool of tools) {
    const realSlots = plan.realCharges[tool.id]?.[q] ?? zeros(QUARTER_COUNT);
    const difference = tool.charge(
      toolSetting(player, tool.id),
      toolSetting(realSetting, tool.id),
      quarter,
      ctx,
    ).difference;
    const diffSlots = spread(roundHalfUp(difference), q, costSchedule(params, tool.id));
    out[tool.id] = realSlots.map((amount, slot) => amount + (diffSlots[slot] ?? 0) + 0);
  }
  return out;
}

/** Adds increments to the committed slots without changing the input. */
function addIncrements(
  committed: Readonly<Record<ToolId, readonly number[]>>,
  increments: Readonly<Record<ToolId, readonly number[]>>,
  tools: readonly ToolId[],
): Record<ToolId, readonly number[]> {
  const next: Record<ToolId, readonly number[]> = { ...committed };
  for (const id of tools) {
    const base = committed[id] ?? zeros(QUARTER_COUNT);
    const inc = increments[id] ?? [];
    next[id] = base.map((amount, slot) => amount + (inc[slot] ?? 0) + 0);
  }
  return next;
}

/**
 * Checks every year that an increment touched, in ascending order: for each year the tool
 * ceilings (registry order) first, then the Annual_Budget. Returns the first error or null.
 */
function firstOverrun(
  plan: BudgetPlan,
  committed: Readonly<Record<ToolId, readonly number[]>>,
  increments: Readonly<Record<ToolId, readonly number[]>>,
  tools: readonly ToolId[],
): EngineError | null {
  for (let y = 0; y < YEAR_COUNT; y += 1) {
    const touched = tools.some((id) => {
      const inc = increments[id] ?? [];
      for (let s = y * 4; s < y * 4 + 4; s += 1) if ((inc[s] ?? 0) !== 0) return true;
      return false;
    });
    if (!touched) continue;
    const year = FIRST_YEAR + y;
    for (const id of tools) {
      const ceiling = plan.ceilings[id]?.[y] ?? 0;
      const spent = sumYear(committed[id] ?? [], y);
      if (spent > ceiling) return ceilingExceeded(id, year, ceiling, spent);
    }
    const budget = plan.annualBudget[y] ?? 0;
    const total = totalYear(committed, tools, y);
    if (total > budget) return budgetExceeded(year, budget, total);
  }
  return null;
}

/**
 * Commits the charges of `quarter` to the ledger and checks the budget.
 * The input ledger is never changed. With `budgetMode: 'record'` no overrun is reported
 * (conflict C1) but the ledger is still updated. `remaining` is the Annual_Budget of the
 * quarter's year minus the charges recorded in that year, with no carry-over (Requirement 8.7).
 */
export function commitQuarter(
  ledger: BudgetLedger,
  quarter: QuarterKey,
  player: PolicySetting,
  tools: readonly ToolRule[],
  params: ParameterTable,
  options: Pick<EngineOptions, 'budgetMode'> = {},
  ctx?: RuleContext,
): { readonly ok: true; readonly value: BudgetLedger } | { readonly ok: false; readonly error: EngineError } {
  const ids = tools.map((t) => t.id);
  const increments = quarterIncrements(ledger.plan, quarter, player, tools, params, ctx);
  const committed = addIncrements(ledger.committed, increments, ids);

  if (options.budgetMode !== 'record') {
    const error = firstOverrun(ledger.plan, committed, increments, ids);
    if (error !== null) return err(error);
  }

  const yearIndex = quarterYear(quarter) - FIRST_YEAR;
  return ok({
    plan: ledger.plan,
    through: quarter,
    committed,
    year: quarterYear(quarter),
    remaining: (ledger.plan.annualBudget[yearIndex] ?? 0) - totalYear(committed, ids, yearIndex),
  });
}

// ---------------------------------------------------------------------------
// checkBudget (Requirements 8.3 to 8.5, 18.6)
// ---------------------------------------------------------------------------

function detail(error: EngineError, key: string): number {
  const v = error.details[key];
  return typeof v === 'number' ? v : Number.NaN;
}

/**
 * Checks a proposed Policy_Setting for the quarter after `ledger.through` without side effects.
 * It shares `quarterIncrements` and `firstOverrun` with the step's commit, so the decision equals
 * the step's decision in `'enforce'` mode. `tools` is the registry's tool list (the three-argument
 * form of the design is completed by the caller, which owns the registry; `src/simulation/budget.ts`
 * does not import it).
 */
export function checkBudget(
  proposed: PolicySetting,
  ledger: BudgetLedger,
  params: ParameterTable,
  tools: readonly ToolRule[],
  ctx?: RuleContext,
): BudgetCheck {
  const expectedIndex = ledger.through === null ? 0 : quarterIndex(ledger.through) + 1;
  const expected: QuarterKey =
    ledger.through === null
      ? FIRST_QUARTER
      : expectedIndex >= QUARTER_COUNT
        ? ledger.through
        : nextQuarter(ledger.through);
  if (expectedIndex >= QUARTER_COUNT || proposed.quarter !== expected) {
    return { ok: false, reason: 'wrong-quarter', expected, received: proposed.quarter };
  }

  const ids = tools.map((t) => t.id);
  const increments = quarterIncrements(ledger.plan, proposed.quarter, proposed, tools, params, ctx);
  const committed = addIncrements(ledger.committed, increments, ids);
  const error = firstOverrun(ledger.plan, committed, increments, ids);
  if (error !== null) {
    if (error.code === 'ceiling-exceeded') {
      return {
        ok: false,
        reason: 'tool-ceiling',
        tool: String(error.details['tool']),
        year: detail(error, 'year'),
        ceiling: detail(error, 'ceiling'),
        committed: detail(error, 'committed'),
        over: detail(error, 'over'),
      };
    }
    return {
      ok: false,
      reason: 'annual-budget',
      year: detail(error, 'year'),
      annualBudget: detail(error, 'annualBudget'),
      committed: detail(error, 'committed'),
      over: detail(error, 'over'),
    };
  }

  const year = quarterYear(proposed.quarter);
  const yearIndex = year - FIRST_YEAR;
  const annualBudget = ledger.plan.annualBudget[yearIndex] ?? 0;
  const total = totalYear(committed, ids, yearIndex);
  return { ok: true, year, annualBudget, committed: total, remaining: annualBudget - total };
}

// ---------------------------------------------------------------------------
// checkLimit (Requirements 18.1 to 18.4, 18.7)
// ---------------------------------------------------------------------------

function citationOf(params: ParameterTable, id: string | null): Citation | null {
  if (id === null || !Object.hasOwn(params, id)) return null;
  return params[id]?.source ?? null;
}

/** The area of a limit id: the city for a city-year limit, else the area itself. */
function limitArea(area: AreaKey, scope: 'quarter' | 'city-year', ctx: RuleContext): string {
  if (scope === 'quarter') return area;
  return ctx.baseline.districts.find((d) => d.code === area)?.city ?? area;
}

/** The real value of the period: the quarter value, or the real city-year total (Decision D6). */
function realValue(
  ledger: BudgetLedger,
  tool: ToolId,
  field: string,
  area: AreaKey,
  quarter: QuarterKey,
  scope: 'quarter' | 'city-year',
  ctx: RuleContext,
): number {
  const real = ledger.plan.real;
  if (scope === 'quarter') {
    return settingOf(real, quarter)?.tools[tool]?.[field]?.[area] ?? 0;
  }
  const districts = ctx.baseline.districts;
  const city = districts.find((d) => d.code === area)?.city ?? area;
  const codes = districts.filter((d) => d.city === city).map((d) => d.code);
  const year = quarterYear(quarter);
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    const setting = settingOf(real, `${year}Q${i + 1}` as QuarterKey);
    const values = setting?.tools[tool]?.[field];
    if (values === undefined) continue;
    for (const code of codes) sum += values[code] ?? 0;
  }
  return sum;
}

/**
 * Policy_Limit and Budget_Ceiling lookup for one tool field, area and quarter. No side effects.
 * Social housing (scope `'city-year'`) needs `ctx.baseline.districts` to map districts to cities.
 * `upper` is checked against the running total of the year and `lower` only once the year is
 * complete (Decision D6); that is the caller's rule, this function reports the limits and the scope.
 * A value outside a limit is never clipped here.
 */
export function checkLimit(
  tool: ToolId,
  field: string,
  area: AreaKey,
  quarter: QuarterKey,
  ledger: BudgetLedger,
  params: ParameterTable,
  tools: readonly ToolRule[],
  ctx: RuleContext = fallbackContext(params, ledger.plan.real),
): LimitInfo {
  const rule = tools.find((t) => t.id === tool);
  const scope = rule?.fields.find((f) => f.id === field)?.limitScope ?? 'quarter';
  const v = realValue(ledger, tool, field, area, quarter, scope, ctx);
  const base = `limit.${tool}.${field}`;

  // Documented_Limits only (housing-tools Requirement 2, simulation.md "Policy tool limits"). The factor ids are
  // kept for older parameter tables and test stubs; without any lower parameter the lower limit is 0.
  // The most specific documented minimum, as for the maximum below: area and year, then area, then the field.
  const minYear = quarterYear(quarter);
  const minIds = [`${base}.min.${limitArea(area, scope, ctx)}.${minYear}`, `${base}.min.${limitArea(area, scope, ctx)}`, `${base}.min`];
  const minId = minIds.find((id) => optionalScalar(params, id) !== undefined) ?? `${base}.min`;
  const minValue = optionalScalar(params, minId);
  const lowerFactorId = `${base}.lowerFactor`;
  const lowerFactor = optionalScalar(params, lowerFactorId);
  const lowerParameterId = minValue !== undefined ? minId : lowerFactor !== undefined ? lowerFactorId : null;
  const lower = minValue ?? (lowerFactor === undefined ? 0 : lowerFactor * v);

  let upper: number;
  let upperParameterId: string | null;
  if (tool === 'commuterPass' && field === 'subsidy') {
    upperParameterId = expandId('commuterPass.price.<city>.<quarter>', { city: area, quarter });
    upper = optionalScalar(params, upperParameterId) ?? 0;
  } else {
    // The most specific documented maximum: area and year, then area, then the field.
    const year = quarterYear(quarter);
    const maxIds = [`${base}.max.${limitArea(area, scope, ctx)}.${year}`, `${base}.max.${limitArea(area, scope, ctx)}`, `${base}.max`];
    const maxId = maxIds.find((id) => optionalScalar(params, id) !== undefined);
    const upperFactorId = `${base}.upperFactor`;
    const upperFactor = optionalScalar(params, upperFactorId);
    if (maxId !== undefined) {
      upperParameterId = maxId;
      upper = optionalScalar(params, maxId) ?? Number.POSITIVE_INFINITY;
    } else if (upperFactor !== undefined) {
      upperParameterId = upperFactorId;
      upper = Math.max(upperFactor * v, optionalScalar(params, `${base}.upperMin`) ?? 0);
    } else {
      // No Documented_Limit: only the Annual_Budget limits the field.
      upperParameterId = null;
      upper = Number.POSITIVE_INFINITY;
    }
  }

  const yearIndex = quarterYear(quarter) - FIRST_YEAR;
  const ceiling = ledger.plan.ceilings[tool]?.[yearIndex] ?? 0;
  const remainingCeiling = ceiling - sumYear(ledger.committed[tool] ?? [], yearIndex);

  return {
    lower,
    upper,
    lowerParameterId,
    upperParameterId,
    lowerSource: citationOf(params, lowerParameterId),
    upperSource: citationOf(params, upperParameterId),
    scope,
    ceiling,
    remainingCeiling,
  };
}
