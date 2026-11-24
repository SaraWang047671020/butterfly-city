// Edit checks and the one write path for Policy_Adjustments (Requirements 9.1-9.7, 9.9-9.12, 9.14, 9.15, 8.5).
// Holds no simulation formulas: limits and budget come from src/simulation/budget.ts, the range run from runRange.
// The limit verdict repeats only the running city-year rule of engine Decision D6 (design decision G5).
// Limit ids that the rules do not declare (commuterPass and rentSubsidy limit.*, the engine gap) are read from the
// parameter table by checkLimit, so nothing here lists them.

import { MAX_TIMELINE_ENTRIES } from '../../types/save.ts';
import type { TimelineEntry } from '../../types/save.ts';
import type { QuarterKey } from '../../types/data-files.ts';
import type {
  BudgetFiguresView,
  YearEndView,
  EditCheckView,
  LimitProblem,
  ParameterRefView,
} from '../../types/view.ts';
import type {
  BudgetCheck,
  BudgetLedger,
  CommuteMatrix,
  EngineBaseline,
  ParameterTable,
  PolicySetting,
  PolicyTimeline,
  RuleContext,
  RuleRegistry,
  SimEvent,
  ToolField,
  ToolRule,
} from '../../types/simulation.ts';
import { emptyLedger, checkBudget, checkLimit, commitQuarter, planBudget } from '../../simulation/budget.ts';
import { runRange } from '../../simulation/engine.ts';
import { nextQuarter, quarterYear } from '../../simulation/quarter.ts';
import { followsRealTrack, playerTimeline, playerValue, withRealTrack, withValue } from './policy.ts';
import type { FieldTarget, PolicyDiffs } from './policy.ts';
import { fieldUnit } from './tools.ts';
import type { SeriesUnits } from './tools.ts';

export type EditCheck = EditCheckView;

/**
 * The part of a game session the checks read. The full GameSession (task 7) must extend this shape;
 * `applyAdjustment` is generic so it returns the caller's own session type.
 */
export interface EditSession {
  readonly registry: RuleRegistry;
  /** Central parameter table (parameters merged with the commuter pass prices). */
  readonly params: ParameterTable;
  readonly baseline: EngineBaseline;
  readonly realTrack: PolicyTimeline;
  readonly commute: CommuteMatrix;
  readonly events: readonly SimEvent[];
  /** Series units of policy-track.json, by series id. */
  readonly units: SeriesUnits;
  readonly diffs: PolicyDiffs;
  readonly timeline: readonly TimelineEntry[];
  /** Planning_Quarter, or the Completed_Marker. */
  readonly planning: QuarterKey | 'complete';
  /** Central ledger through the Displayed_Quarter; null before any quarter. */
  readonly ledger: BudgetLedger | null;
}

export type ParsedInput =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly expected: 'integer' | 'number' };

const NUMBER_FORMAT = /^-?\d+(\.\d+)?$/;
const INTEGER_FORMAT = /^-?\d+$/;

/** Requirements 9.9 and 9.10. No Engine call. */
export function parseInput(text: string, countField: boolean): ParsedInput {
  const expected = countField ? 'integer' : 'number';
  if (!(countField ? INTEGER_FORMAT : NUMBER_FORMAT).test(text)) return { ok: false, expected };
  const value = Number(text) + 0; // + 0 turns -0 into 0
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, expected };
}

export interface EditRequest {
  readonly target: FieldTarget;
  readonly kind: 'value' | 'real-track';
  /** Ignored for 'real-track'. */
  readonly text: string;
}

function context(s: EditSession): RuleContext {
  return { params: s.params, baseline: s.baseline, realTrack: s.realTrack, commute: s.commute };
}

function findField(s: EditSession, target: FieldTarget): { rule: ToolRule; field: ToolField } {
  const rule = s.registry.tools.find((t) => t.id === target.tool);
  const field = rule?.fields.find((f) => f.id === target.field);
  if (rule === undefined || field === undefined) {
    throw new Error(`Unknown tool field ${target.tool}.${target.field}`);
  }
  return { rule, field };
}

export function refOf(params: ParameterTable, id: string | null, value: number): ParameterRefView | null {
  if (id === null) return null;
  const p = Object.hasOwn(params, id) ? params[id] : undefined;
  if (p === undefined) return null;
  return {
    parameterId: id,
    value,
    unit: p.unit,
    citation: p.source.citation === '' ? null : p.source.citation,
    url: p.source.url === '' ? null : p.source.url,
    status: p.status,
    estimatedMethod: p.estimated?.method ?? null,
    assumption: p.assumption ?? null,
  };
}

function figures(c: Extract<BudgetCheck, { ok: true }>): BudgetFiguresView {
  return { year: c.year, annualBudget: c.annualBudget, committed: c.committed, remaining: c.remaining };
}

function settingOf(timeline: PolicyTimeline, quarter: QuarterKey): PolicySetting | undefined {
  return timeline.find((x) => x.quarter === quarter);
}

/**
 * The year of `from` with `timeline` kept to the year's last quarter: each quarter is checked against the budget and
 * then recorded, as the turn loop would (play-loop task 9). Returns the year-end figures and the first overrun.
 */
export function projectYear(
  timeline: PolicyTimeline,
  ledger: BudgetLedger,
  from: QuarterKey,
  params: ParameterTable,
  tools: RuleRegistry['tools'],
  ctx: ReturnType<typeof context>,
): YearEndView | null {
  const year = quarterYear(from);
  let led = ledger;
  let q: QuarterKey = from;
  let last: YearEndView | null = null;
  for (;;) {
    const setting = settingOf(timeline, q);
    if (setting === undefined) return last;
    const b = checkBudget(setting, led, params, tools, ctx);
    if (!b.ok) {
      if (b.reason === 'annual-budget' || b.reason === 'tool-ceiling') {
        return { year, committed: last?.committed ?? 0, remaining: last?.remaining ?? 0, overrun: { quarter: q, over: b.over } };
      }
      return last;
    }
    last = { year, committed: b.committed, remaining: b.remaining, overrun: null };
    const c = commitQuarter(led, q, setting, tools, params, { budgetMode: 'record' }, ctx);
    if (!c.ok || q.endsWith('Q4')) return last;
    led = c.value;
    const n = nextQuarter(q);
    if (quarterYear(n) !== year) return last;
    q = n;
  }
}

/** Candidate diffs of a request from the Planning_Quarter on. */
function candidateDiffs(s: EditSession, req: EditRequest, from: QuarterKey, value: number): PolicyDiffs {
  return req.kind === 'value'
    ? withValue(s.diffs, s.realTrack, req.target, from, value)
    : withRealTrack(s.diffs, req.target, from);
}

export interface LimitVerdict {
  readonly problem: LimitProblem | null;
}

export function limitVerdict(
  s: EditSession,
  field: ToolField,
  target: FieldTarget,
  p: QuarterKey,
  candidate: PolicyTimeline,
  ledger: BudgetLedger,
  ctx: RuleContext,
): LimitVerdict {
  const tools = s.registry.tools;
  const unit = (id: string | null): string => fieldUnit(s.units, target.tool, target.field) ?? (id === null ? '' : (refOf(s.params, id, 0)?.unit ?? ''));
  const problemOf = (
    side: 'lower' | 'upper',
    limit: number,
    id: string | null,
    period: QuarterKey | number,
  ): LimitProblem => ({ side, limit, unit: unit(id), period, ref: refOf(s.params, id, limit) });

  if (field.limitScope === 'quarter') {
    const v = candidateValue(candidate, target, p);
    if (v === null) return { problem: null };
    const info = checkLimit(target.tool, target.field, target.area, p, ledger, s.params, tools, ctx);
    if (Number.isFinite(info.upper) && v > info.upper) {
      return { problem: problemOf('upper', info.upper, info.upperParameterId, p) };
    }
    if (Number.isFinite(info.lower) && v < info.lower) {
      return { problem: problemOf('lower', info.lower, info.lowerParameterId, p) };
    }
    return { problem: null };
  }

  // city-year: running total of the year through p for the target's city (Decision D6).
  const year = quarterYear(p);
  const city = s.baseline.districts.find((d) => d.code === target.area)?.city;
  if (city === undefined) return { problem: null };
  const codes = s.baseline.districts.filter((d) => d.city === city).map((d) => d.code);
  let total = 0;
  for (let i = 1; i <= 4; i += 1) {
    const q = `${year}Q${i}` as QuarterKey;
    if (q > p) break;
    const values = settingOf(candidate, q)?.tools[target.tool]?.[target.field];
    if (values === undefined) continue;
    for (const code of codes) total += values[code] ?? 0;
  }
  const info = checkLimit(target.tool, target.field, city, p, ledger, s.params, tools, ctx);
  if (Number.isFinite(info.upper) && total > info.upper) {
    return { problem: problemOf('upper', info.upper, info.upperParameterId, year) };
  }
  if (p.endsWith('Q4') && Number.isFinite(info.lower) && total < info.lower) {
    return { problem: problemOf('lower', info.lower, info.lowerParameterId, year) };
  }
  return { problem: null };
}

function candidateValue(candidate: PolicyTimeline, t: FieldTarget, q: QuarterKey): number | null {
  const v = settingOf(candidate, q)?.tools[t.tool]?.[t.field]?.[t.area];
  return typeof v === 'number' ? v : null;
}

/** Largest search value of `affordableValue`; far above any real field value. */
const AFFORD_CAP = 1e12;

/**
 * The largest value of a field the Annual_Budget and the tool ceiling allow in the Planning_Quarter, with every
 * other field as it is (housing-tools Requirement 2.2: a field without a Documented_Limit is limited by the budget
 * only). Used as the slider end; the check of an edit stays `checkEditSync`. Integer fields give an integer;
 * other fields are searched to 1 unit. Returns the current value when even that does not fit.
 */
export function affordableValue(session: EditSession, target: FieldTarget, integer: boolean): number {
  const p = session.planning;
  if (p === 'complete') return 0;
  const ctx = context(session);
  const tools = session.registry.tools;
  const ledger = session.ledger ?? emptyLedger(planBudget(session.realTrack, session.params, tools, ctx));
  const fits = (v: number): boolean => {
    const setting = settingOf(playerTimeline(session.realTrack, withValue(session.diffs, session.realTrack, target, p, v)), p);
    return setting !== undefined && checkBudget(setting, ledger, session.params, tools, ctx).ok;
  };
  const current = playerValue(session.realTrack, session.diffs, target, p) ?? 0;
  let lo = Math.max(0, current);
  if (!fits(lo)) return lo;
  let hi = Math.max(1, lo * 2);
  while (hi < AFFORD_CAP && fits(hi)) {
    lo = hi;
    hi *= 2;
  }
  if (hi >= AFFORD_CAP && fits(AFFORD_CAP)) return AFFORD_CAP;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return integer ? Math.floor(lo) : lo;
}

/** Phase 1 (no Engine run). */
export function checkEditSync(session: EditSession, req: EditRequest): EditCheck {
  const p = session.planning;
  if (p === 'complete') return { status: 'fixed-quarter', planning: null };

  const { field } = findField(session, req.target);

  let value = 0;
  if (req.kind === 'value') {
    const parsed = parseInput(req.text, field.integer === true);
    if (!parsed.ok) return { status: 'invalid-format', expected: parsed.expected };
    value = parsed.value;
  }
  if (session.timeline.length >= MAX_TIMELINE_ENTRIES) return { status: 'timeline-full' };

  const ctx = context(session);
  const tools = session.registry.tools;
  const ledger = session.ledger ?? emptyLedger(planBudget(session.realTrack, session.params, tools, ctx));
  const budgetOf = (diffs: PolicyDiffs): BudgetCheck => {
    const setting = settingOf(playerTimeline(session.realTrack, diffs), p);
    return setting === undefined
      ? { ok: false, reason: 'wrong-quarter', expected: p, received: p }
      : checkBudget(setting, ledger, session.params, tools, ctx);
  };

  const current = playerValue(session.realTrack, session.diffs, req.target, p);
  const unchanged =
    req.kind === 'value' ? current !== null && current === value : followsRealTrack(session.diffs, req.target, p);
  if (unchanged) {
    const b = budgetOf(session.diffs);
    return { status: 'unchanged', budget: b.ok ? figures(b) : null };
  }

  const candidate = candidateDiffs(session, req, p, value);
  const budget = budgetOf(candidate);
  if (!budget.ok && budget.reason === 'wrong-quarter') return { status: 'fixed-quarter', planning: p };

  const limit = limitVerdict(session, field, req.target, p, playerTimeline(session.realTrack, candidate), ledger, ctx);
  if (limit.problem !== null) {
    return { status: 'limit', limit: limit.problem, budget: budget.ok ? figures(budget) : null };
  }

  if (!budget.ok) {
    if (budget.reason === 'annual-budget') {
      return {
        status: 'budget',
        problem: { reason: 'annual-budget', year: budget.year, budget: budget.annualBudget, over: budget.over },
      };
    }
    if (budget.reason === 'tool-ceiling') {
      return {
        status: 'budget',
        problem: { reason: 'tool-ceiling', year: budget.year, budget: budget.ceiling, over: budget.over },
      };
    }
    return { status: 'fixed-quarter', planning: p };
  }
  const yearEnd = projectYear(playerTimeline(session.realTrack, candidate), ledger, p, session.params, tools, ctx);
  // The same quarter with the current values, so the Quick_Preview shows the cost of the edit alone.
  const before = budgetOf(session.diffs);
  return {
    status: 'pending-range',
    budget: figures(budget),
    ...(yearEnd === null ? {} : { yearEnd }),
    ...(before.ok ? { budgetBefore: figures(before) } : {}),
  };
}

/** Phase 2: runRange to the Planning_Quarter on the candidate timeline. Runs phase 1 first. */
export function checkEditRange(session: EditSession, req: EditRequest): EditCheck {
  const sync = checkEditSync(session, req);
  const p = session.planning;
  if (sync.status !== 'pending-range' || p === 'complete') return sync;

  const parsed = req.kind === 'value' ? parseInput(req.text, false) : null;
  const value = parsed !== null && parsed.ok ? parsed.value : 0;
  const candidate = candidateDiffs(session, req, p, value);
  const result = runRange(
    playerTimeline(session.realTrack, candidate),
    session.events,
    session.params,
    session.baseline,
    session.realTrack,
    session.commute,
    p,
    { registry: session.registry },
  );
  if (!result.ok) return { status: 'engine', error: result.error, budget: sync.budget };
  return {
    status: 'ok',
    budget: sync.budget,
    ...(sync.yearEnd === undefined ? {} : { yearEnd: sync.yearEnd }),
    ...(sync.budgetBefore === undefined ? {} : { budgetBefore: sync.budgetBefore }),
  };
}

/**
 * The one write path of Policy_Adjustments (design decision G3). Re-runs both phases; on `ok` returns the
 * session with the new differences and exactly one Timeline_Entry, otherwise the check and the same session.
 */
export function applyAdjustment<S extends EditSession>(
  session: S,
  req: EditRequest,
): { readonly check: EditCheck; readonly session: S } {
  const check = checkEditRange(session, req);
  const p = session.planning;
  if (check.status !== 'ok' || p === 'complete') return { check, session };

  const parsed = req.kind === 'value' ? parseInput(req.text, false) : null;
  const value = parsed !== null && parsed.ok ? parsed.value : 0;
  const before = playerValue(session.realTrack, session.diffs, req.target, p) ?? 0;
  const base = { quarter: p, tool: req.target.tool, field: req.target.field, area: req.target.area, before };
  const entry: TimelineEntry =
    req.kind === 'value' ? { kind: 'value', ...base, after: value } : { kind: 'real-track', ...base, after: null };
  return {
    check,
    session: {
      ...session,
      diffs: candidateDiffs(session, req, p, value),
      timeline: [...session.timeline, entry],
    },
  };
}
