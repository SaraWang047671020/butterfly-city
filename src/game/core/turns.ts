// Next_Quarter_Action and Fast_Forward_Action (Requirements 5.1, 7.1, 7.2, 7.5, 7.7, 7.8, 9.8).
// Holds no simulation formulas: the Engine runs through runRange, limits and budget through checks.ts.
// One runRange from 2015Q1 to the computed quarter per quarter (design decision G4).

import type { QuarterKey } from '../../types/data-files.ts';
import type { EventCard } from '../../types/events-file.ts';
import { CITY_NAMES } from '../../types/data-files.ts';
import type { BudgetProblemView, LimitProblem } from '../../types/view.ts';
import type { EngineError, PolicyTimeline, RangeResult, RuleContext } from '../../types/simulation.ts';
import { checkBudget, emptyLedger, planBudget } from '../../simulation/budget.ts';
import { runRange } from '../../simulation/engine.ts';
import { nextQuarter, quarterIndex } from '../../simulation/quarter.ts';
import { QUARTER_COUNT } from '../../simulation/constants.ts';
import { limitVerdict } from './checks.ts';
import type { EditSession } from './checks.ts';
import { playerTimeline, playerValue } from './policy.ts';
import type { FieldTarget } from './policy.ts';

export type StopReason =
  | 'one-quarter'
  | 'four-quarters'
  | 'complete'
  | 'major-event'
  | 'engine-error'
  | 'carried-check'
  /** life-story Requirement 7.3: a Life_Event is triggered for the new Planning_Quarter. */
  | 'life-event';

/** The successful `runRange` result of the last computed quarter (Displayed_Quarter = its last state). */
export type ComputedRun = Extract<RangeResult, { readonly ok: true }>;

/**
 * The part of a game session the turns read and write. The GameSession of session.ts (task 7.2) extends this
 * (and so EditSession). `next` is the Planning_Quarter and always equals `planning`; both are updated together.
 */
export interface TurnSession extends EditSession {
  readonly next: QuarterKey | 'complete';
  /** Null before any quarter is computed. */
  readonly computed: ComputedRun | null;
  /** Event_Cards of events.json, in file order. */
  readonly cards: readonly EventCard[];
}

export type CarriedProblem = {
  readonly target: FieldTarget;
  readonly quarter: QuarterKey;
  readonly value: number;
  readonly problem:
    | { readonly kind: 'limit'; readonly limit: LimitProblem }
    | { readonly kind: 'budget'; readonly budget: BudgetProblemView };
};

export interface TurnOutcome<S extends TurnSession = TurnSession> {
  readonly session: S;
  /** Quarters computed in this Computation_Run. */
  readonly computed: readonly QuarterKey[];
  readonly stop: StopReason;
  /** Major_Events whose firstQuarter is the last computed quarter. */
  readonly majorEventIds: readonly string[];
  /** Major_Events of every computed quarter (Requirement 17.7). */
  readonly runEventIds: readonly string[];
  readonly engineError: { readonly quarter: QuarterKey; readonly error: EngineError } | null;
  readonly carried: CarriedProblem | null;
}

export type RecomputeResult<S extends TurnSession = TurnSession> =
  | { readonly ok: true; readonly session: S }
  | { readonly ok: false; readonly quarter: QuarterKey; readonly error: EngineError };

const LAST_QUARTER = `${2015 + QUARTER_COUNT / 4 - 1}Q4` as QuarterKey;

function context(s: EditSession): RuleContext {
  return { params: s.params, baseline: s.baseline, realTrack: s.realTrack, commute: s.commute };
}

function run(s: TurnSession, target: QuarterKey): RangeResult {
  return runRange(
    playerTimeline(s.realTrack, s.diffs),
    s.events,
    s.params,
    s.baseline,
    s.realTrack,
    s.commute,
    target,
    { registry: s.registry },
  );
}

function withRun<S extends TurnSession>(s: S, r: ComputedRun, through: QuarterKey): S {
  const last = r.central[r.central.length - 1];
  return {
    ...s,
    computed: r,
    ledger: last === undefined ? null : last.ledger,
    next: through === LAST_QUARTER ? 'complete' : nextQuarter(through),
    planning: through === LAST_QUARTER ? 'complete' : nextQuarter(through),
  };
}

function majorIds(s: TurnSession, q: QuarterKey): string[] {
  return s.cards.filter((c) => c.major && c.firstQuarter === q).map((c) => c.id);
}

function sortAreas(areas: readonly string[], cityScope: boolean): string[] {
  if (!cityScope) return [...areas].sort();
  const order = (a: string): number => {
    const i = (CITY_NAMES as readonly string[]).indexOf(a);
    return i < 0 ? CITY_NAMES.length : i;
  };
  return [...areas].sort((a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * First limit or budget break of the player timeline as it stands at `q` (Requirement 9.8), or null.
 * Targets: every field with a non-zero difference at `q`; for a city-year field also every city with a
 * non-zero difference in any quarter of the year through `q`. Order: registry, field, Area.
 */
export function carriedCheck(session: TurnSession, q: QuarterKey): CarriedProblem | null {
  const ctx = context(session);
  const tools = session.registry.tools;
  const ledger = session.ledger ?? emptyLedger(planBudget(session.realTrack, session.params, tools, ctx));
  const timeline: PolicyTimeline = playerTimeline(session.realTrack, session.diffs);
  const qi = quarterIndex(q);
  const yearStart = qi - (qi % 4);
  const cityOf = (code: string): string | undefined => session.baseline.districts.find((d) => d.code === code)?.city;

  let firstTarget: FieldTarget | null = null;
  let firstValue = 0;
  for (const rule of tools) {
    for (const field of rule.fields) {
      const series = session.diffs.filter((d) => d.tool === rule.id && d.field === field.id);
      const cityYear = field.limitScope === 'city-year';
      const active = series.filter((d) => {
        const from = cityYear ? yearStart : qi;
        for (let i = from; i <= qi; i += 1) if ((d.diffs[i] ?? 0) !== 0) return true;
        return false;
      });
      const areas = sortAreas(
        active.map((d) => d.area),
        field.area === 'city',
      );
      const seenCities = new Set<string>();
      for (const area of areas) {
        const target: FieldTarget = { tool: rule.id, field: field.id, area };
        if (cityYear) {
          const city = cityOf(area) ?? area;
          if (seenCities.has(city)) continue;
          seenCities.add(city);
        }
        const value = playerValue(session.realTrack, session.diffs, target, q);
        if (value === null) continue;
        if (firstTarget === null && (session.diffs.find((d) => d.tool === rule.id && d.field === field.id && d.area === area)?.diffs[qi] ?? 0) !== 0) {
          firstTarget = target;
          firstValue = value;
        }
        const { problem } = limitVerdict(session, field, target, q, timeline, ledger, ctx);
        if (problem !== null) return { target, quarter: q, value, problem: { kind: 'limit', limit: problem } };
      }
    }
  }

  const setting = timeline.find((x) => x.quarter === q);
  if (setting === undefined || firstTarget === null) return null;
  const budget = checkBudget(setting, ledger, session.params, tools, ctx);
  if (budget.ok) return null;
  if (budget.reason === 'annual-budget') {
    return {
      target: firstTarget,
      quarter: q,
      value: firstValue,
      problem: { kind: 'budget', budget: { reason: 'annual-budget', year: budget.year, budget: budget.annualBudget, over: budget.over } },
    };
  }
  if (budget.reason === 'tool-ceiling') {
    return {
      target: firstTarget,
      quarter: q,
      value: firstValue,
      problem: { kind: 'budget', budget: { reason: 'tool-ceiling', year: budget.year, budget: budget.ceiling, over: budget.over } },
    };
  }
  return null;
}

/** Re-runs the Engine to the quarter before `next` (to 2025Q4 when complete); no call when `next` is 2015Q1. */
export function recompute<S extends TurnSession>(session: S): RecomputeResult<S> {
  if (session.next === '2015Q1') return { ok: true, session: { ...session, computed: null, ledger: null } };
  const target: QuarterKey = session.next === 'complete' ? LAST_QUARTER : previousQuarter(session.next);
  const r = run(session, target);
  if (!r.ok) return { ok: false, quarter: r.quarter ?? target, error: r.error };
  const last = r.central[r.central.length - 1];
  return { ok: true, session: { ...session, computed: r, ledger: last === undefined ? null : last.ledger } };
}

function previousQuarter(q: QuarterKey): QuarterKey {
  const i = quarterIndex(q) - 1;
  return `${2015 + Math.floor(i / 4)}Q${(i % 4) + 1}` as QuarterKey;
}

/** Computes up to `limit` quarters; shared by the Next_Quarter_Action (1) and the Fast_Forward_Action (4). */
function loop<S extends TurnSession>(
  start: S,
  limit: number,
  full: StopReason,
  afterQuarter?: (s: S) => void,
  stopAfter?: (s: S) => boolean,
): TurnOutcome<S> {
  let session = start;
  const computed: QuarterKey[] = [];
  const runEventIds: string[] = [];
  let majors: string[] = [];
  const done = (
    stop: StopReason,
    engineError: TurnOutcome<S>['engineError'] = null,
    carried: CarriedProblem | null = null,
  ): TurnOutcome<S> => ({ session, computed, stop, majorEventIds: majors, runEventIds, engineError, carried });

  for (;;) {
    const t = session.next;
    if (t === 'complete') return done('complete');
    const carried = carriedCheck(session, t);
    if (carried !== null) return done('carried-check', null, carried);
    const r = run(session, t);
    if (!r.ok) return done('engine-error', { quarter: r.quarter ?? t, error: r.error });
    session = withRun(session, r, t);
    computed.push(t);
    majors = majorIds(session, t);
    runEventIds.push(...majors);
    afterQuarter?.(session);
    if (majors.length > 0) return done('major-event');
    if (t === LAST_QUARTER) return done('complete');
    if (computed.length >= limit) return done(full);
    if (stopAfter?.(session) === true) return done('life-event');
  }
}

export function computeNext<S extends TurnSession>(session: S): TurnOutcome<S> {
  return loop(session, 1, 'one-quarter');
}

/**
 * Computes up to 4 quarters. `stopAfter` ends the run early after a computed quarter (life-story Requirement 7.3: a
 * Life_Event is asked in its own Decide_Step).
 */
export function fastForward<S extends TurnSession>(session: S, afterQuarter?: (s: S) => void, stopAfter?: (s: S) => boolean): TurnOutcome<S> {
  return loop(session, 4, 'four-quarters', afterQuarter, stopAfter);
}
