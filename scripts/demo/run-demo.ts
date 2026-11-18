// Demo_Script core (game-ui Requirement 14, task 10.3). Pure: reads nothing from disk.
// Reuses the game core (newSession, applyAdjustment, computeNext) and the Engine; it holds no formulas
// and sets or changes no Parameter (14.18).

import type { LoadedData } from '../../src/data/convert.ts';
import type { DistrictCode, QuarterKey } from '../../src/types/data-files.ts';
import type { DemoSummary, Save } from '../../src/types/save.ts';
import type { RuleRegistry, SimState } from '../../src/types/simulation.ts';
import { runRange } from '../../src/simulation/engine.ts';
import { quarterIndex } from '../../src/simulation/quarter.ts';
import { encodeSave } from '../../src/save/codec.ts';
import { newSession, toSave } from '../../src/game/core/session.ts';
import type { GameSession } from '../../src/game/core/session.ts';
import { applyAdjustment } from '../../src/game/core/checks.ts';
import { computeNext } from '../../src/game/core/turns.ts';
import { completionItems } from '../../src/game/core/construction.ts';
import { playerTimeline } from '../../src/game/core/policy.ts';
import {
  checkBudgetShift,
  checkCompletionItem,
  checkConstructionEntry,
  checkDemoLists,
  checkRealTrackReturn,
  checkRentSubsidyBelowReal,
  checkSocialHousingSum,
  checkTimelineCoversTools,
  formatFailure,
} from './checks.ts';
import type { CheckResult, DemoAdjustment } from './checks.ts';

/** Shape of `data/config/demo-adjustments.json`. */
export interface DemoConfig {
  readonly schemaVersion: number;
  readonly status: string;
  readonly ghostThreshold: number;
  readonly rentBurdenThreshold: number;
  readonly base: readonly DemoAdjustment[];
  readonly enlarged: readonly DemoAdjustment[];
}

export interface DemoInputs {
  readonly data: LoadedData;
  readonly registry: RuleRegistry;
  readonly config: DemoConfig;
}

export type ListName = 'base' | 'enlarged';
export type FallbackStep = 0 | 1 | 2;

const COMPARISON = '2021Q1' as const;
const PREVIOUS_INDEX = 23; // 2020Q4

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

export interface FallbackInput {
  readonly ghostThreshold: number;
  readonly rentBurdenThreshold: number;
  /** Central Demo_Ghost_Difference of the base list run. */
  readonly baseGhost: number;
  /** Central Demo_Ghost_Difference of the enlarged list run; null when it was not computed. */
  readonly enlargedGhost: number | null;
  /** Largest absolute Demo_Rent_Burden_Difference of the enlarged list run; null when not computed. */
  readonly enlargedRent: number | null;
}

export interface FallbackDecision {
  /** Step reached, or null when no step meets its condition. */
  readonly step: FallbackStep | null;
  /** Report line per step tried (14.25). */
  readonly report: readonly string[];
  /** Failed conditions with value and threshold (14.23); empty when a step was reached. */
  readonly failed: readonly string[];
}

/** Requirements 14.20 to 14.23. Tries the steps in order and stops at the first that is met. */
export function decideFallback(i: FallbackInput): FallbackDecision {
  const report: string[] = [];
  const failed: string[] = [];
  const g = i.ghostThreshold;
  const r = i.rentBurdenThreshold;

  report.push(`Step 0 (base list): |Demo_Ghost_Difference| ${Math.abs(i.baseGhost)}, threshold ${g}`);
  if (Math.abs(i.baseGhost) >= g) return { step: 0, report, failed };
  failed.push(`14.20: |Demo_Ghost_Difference| of the base list is ${Math.abs(i.baseGhost)}, threshold ${g}`);

  if (i.enlargedGhost === null || i.enlargedRent === null) return { step: null, report, failed };

  report.push(`Step 1 (enlarged list): |Demo_Ghost_Difference| ${Math.abs(i.enlargedGhost)}, threshold ${g}`);
  if (Math.abs(i.enlargedGhost) >= g) return { step: 1, report, failed };
  failed.push(`14.21: |Demo_Ghost_Difference| of the enlarged list is ${Math.abs(i.enlargedGhost)}, threshold ${g}`);

  report.push(`Step 2 (enlarged list): largest |Demo_Rent_Burden_Difference| ${Math.abs(i.enlargedRent)}, threshold ${r}`);
  if (Math.abs(i.enlargedRent) >= r) return { step: 2, report, failed };
  failed.push(`14.22: largest |Demo_Rent_Burden_Difference| of the enlarged list is ${Math.abs(i.enlargedRent)}, threshold ${r}`);
  return { step: null, report, failed };
}

/** Largest absolute difference; the lowest District_Code on a tie (14.26, 14.27). Null for an empty record. */
export function selectDistrict(diffs: Readonly<Record<DistrictCode, number>>): { district: DistrictCode; difference: number } | null {
  let best: { district: DistrictCode; difference: number } | null = null;
  for (const code of Object.keys(diffs).sort()) {
    const d = diffs[code] as number;
    if (best === null || Math.abs(d) > Math.abs(best.difference)) best = { district: code, difference: d };
  }
  return best;
}

// ---------------------------------------------------------------------------
// One list run
// ---------------------------------------------------------------------------

interface Measure {
  readonly ghostCentral: number;
  readonly ghostMin: number;
  readonly ghostMax: number;
  readonly ghostByDistrict: Record<DistrictCode, number>;
  readonly rentByDistrict: Record<DistrictCode, number>;
  readonly maxRent: { district: DistrictCode; difference: number } | null;
}

interface ListRun {
  readonly list: ListName;
  /** Session with Planning_Quarter 2021Q1, before the lookahead. */
  readonly session: GameSession;
  readonly measure: Measure;
}

export type DemoFailure = {
  readonly ok: false;
  readonly list: ListName | null;
  /** Failing adjustment, when one was rejected. */
  readonly adjustment: DemoAdjustment | null;
  readonly quarter: QuarterKey | null;
  readonly lastStep: FallbackStep | null;
  readonly failures: readonly string[];
  readonly message: string;
  readonly report: readonly string[];
};

export interface DemoSuccess {
  readonly ok: true;
  readonly save: Save;
  readonly saveCode: string;
  readonly summary: DemoSummary;
  readonly summaryText: string;
  /** Text of `src/save/demo-save.generated.ts`. */
  readonly fileText: string;
  readonly report: readonly string[];
}

export type DemoResult = DemoSuccess | DemoFailure;

function listFailure(
  list: ListName | null,
  message: string,
  extra: Partial<Pick<DemoFailure, 'adjustment' | 'quarter' | 'lastStep' | 'failures' | 'report'>> = {},
): DemoFailure {
  return {
    ok: false,
    list,
    adjustment: extra.adjustment ?? null,
    quarter: extra.quarter ?? null,
    lastStep: extra.lastStep ?? null,
    failures: extra.failures ?? [],
    message,
    report: extra.report ?? [],
  };
}

function describe(a: DemoAdjustment): string {
  return `${a.quarter} ${a.tool}.${a.field}/${a.area} ${a.kind}${a.kind === 'value' ? ` ${a.value}` : ''}`;
}

function sortedCodes(state: SimState, id: string): string[] {
  return Object.keys(state.values[id] ?? {}).sort();
}

function total(state: SimState, id: string): number {
  let sum = 0;
  for (const c of sortedCodes(state, id)) sum += state.values[id]?.[c] ?? 0;
  return sum;
}

function measure(
  look: { central: readonly SimState[]; low: readonly SimState[]; high: readonly SimState[] },
  zero: { central: readonly SimState[]; low: readonly SimState[]; high: readonly SimState[] },
): Measure {
  const last = (r: readonly SimState[]): SimState => r[r.length - 1] as SimState;
  const diffOf = (s: 'central' | 'low' | 'high'): number => total(last(look[s]), 'ghostCount') - total(last(zero[s]), 'ghostCount');
  const c = diffOf('central');
  const l = diffOf('low');
  const h = diffOf('high');
  const lc = last(look.central);
  const zc = last(zero.central);
  const ghostByDistrict: Record<DistrictCode, number> = {};
  for (const code of sortedCodes(lc, 'ghostCount')) {
    ghostByDistrict[code] = (lc.values['ghostCount']?.[code] ?? 0) - (zc.values['ghostCount']?.[code] ?? 0);
  }
  const rentByDistrict: Record<DistrictCode, number> = {};
  for (const code of sortedCodes(lc, 'rentBurden')) {
    rentByDistrict[code] = (lc.values['rentBurden']?.[code] ?? 0) - (zc.values['rentBurden']?.[code] ?? 0);
  }
  return {
    ghostCentral: c,
    ghostMin: Math.min(l, c, h),
    ghostMax: Math.max(l, c, h),
    ghostByDistrict,
    rentByDistrict,
    maxRent: selectDistrict(rentByDistrict),
  };
}

/** Applies one list quarter by quarter (9.6, 9.14), computes 2015Q1..2020Q4, then the lookahead at 2021Q1. */
function runList(inputs: DemoInputs, list: ListName, adjustments: readonly DemoAdjustment[], zero: Parameters<typeof measure>[1]): ListRun | DemoFailure {
  let session: GameSession = newSession(inputs.data, inputs.registry, true);
  let index = 0;
  const previousIndex = quarterIndex('2020Q4');

  const applyDue = (q: QuarterKey): DemoFailure | null => {
    while (index < adjustments.length && (adjustments[index] as DemoAdjustment).quarter === q) {
      const a = adjustments[index] as DemoAdjustment;
      index += 1;
      const r = applyAdjustment(session, {
        target: { tool: a.tool, field: a.field, area: a.area },
        kind: a.kind,
        text: a.kind === 'value' ? String(a.value) : '',
      });
      if (r.check.status !== 'ok') {
        return listFailure(list, `The ${list} list adjustment ${describe(a)} was rejected: ${r.check.status}.`, {
          adjustment: a,
          quarter: q,
        });
      }
      session = r.session;
    }
    return null;
  };

  for (let i = 0; i <= previousIndex; i += 1) {
    const q = `${2015 + Math.floor(i / 4)}Q${(i % 4) + 1}` as QuarterKey;
    const due = applyDue(q);
    if (due !== null) return due;
    const out = computeNext(session);
    if (out.computed.length !== 1) {
      const why = out.engineError !== null ? `engine error ${out.engineError.error.code}` : `stop ${out.stop}`;
      return listFailure(list, `The ${list} list run stopped at ${q} (${why}).`, { quarter: q });
    }
    session = out.session;
  }
  const due = applyDue(COMPARISON);
  if (due !== null) return due;
  if (index < adjustments.length) {
    const a = adjustments[index] as DemoAdjustment;
    return listFailure(list, `The ${list} list adjustment ${describe(a)} is after ${COMPARISON}.`, { adjustment: a, quarter: a.quarter });
  }

  const look = computeNext(session);
  const c = look.session.computed;
  if (look.computed.length !== 1 || c === null) {
    const why = look.engineError !== null ? `engine error ${look.engineError.error.code}` : `stop ${look.stop}`;
    return listFailure(list, `The ${list} list lookahead stopped at ${COMPARISON} (${why}).`, { quarter: COMPARISON });
  }
  return { list, session, measure: measure(c, zero) };
}

function listChecks(inputs: DemoInputs, run: ListRun): CheckResult {
  const s = run.session;
  const central = s.computed?.central ?? [];
  const previous = central[PREVIOUS_INDEX];
  const zeroLedger = zeroLedgerOf(inputs, s);
  const districts = inputs.data.engine.baseline.districts.map((d) => d.code);
  return [
    ...checkTimelineCoversTools(s.timeline, inputs.registry.tools.map((t) => t.id)),
    ...(previous === undefined ? [] : checkConstructionEntry(previous.lagPipeline)),
    ...checkRentSubsidyBelowReal(s.timeline, s.realTrack),
    ...checkSocialHousingSum(playerTimeline(s.realTrack, s.diffs), s.realTrack, districts),
    ...(previous === undefined || zeroLedger === null ? [] : checkBudgetShift(previous.ledger, zeroLedger)),
    ...checkRealTrackReturn(s.timeline),
    ...checkCompletionItem(completionItems(central)),
  ];
}

function zeroLedgerOf(inputs: DemoInputs, s: GameSession) {
  const r = runRange(
    inputs.data.engine.realTrack,
    s.events,
    s.params,
    s.baseline,
    s.realTrack,
    s.commute,
    '2020Q4',
    { registry: s.registry },
  );
  return r.ok ? (r.central[PREVIOUS_INDEX]?.ledger ?? null) : null;
}

/** Text of the generated module (design decision G10). */
export function renderDemoModule(saveCode: string, summaryText: string): string {
  return [
    '// GENERATED by `npm run demo` (scripts/build-demo.ts). Do not edit by hand.',
    '',
    `export const DEMO_SAVE_CODE = ${JSON.stringify(saveCode)};`,
    '',
    `export const DEMO_SUMMARY_TEXT = ${JSON.stringify(summaryText)};`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// runDemo
// ---------------------------------------------------------------------------

export function runDemo(inputs: DemoInputs): DemoResult {
  const { data, config } = inputs;
  const report: string[] = [];

  // 14.18: the Engine table must be params.json exactly as read, plus the commuter pass prices only.
  for (const id of Object.keys(data.paramsFileTable)) {
    if (JSON.stringify(data.engine.params[id]) !== JSON.stringify(data.paramsFileTable[id])) {
      return listFailure(null, `Parameter ${id} of the Engine table differs from params.json (14.18).`);
    }
  }

  const listFailures = checkDemoLists(config.base, config.enlarged, data.engine.realTrack);
  if (listFailures.length > 0) {
    return listFailure('enlarged', 'The enlarged list does not satisfy 14.24.', { failures: listFailures.map(formatFailure) });
  }

  const zeroResult = runRange(
    data.engine.realTrack,
    data.engine.events,
    data.engine.params,
    data.engine.baseline,
    data.engine.realTrack,
    data.engine.commute,
    COMPARISON,
    { registry: inputs.registry },
  );
  if (!zeroResult.ok) {
    return listFailure(null, `The Zero_Delta_Run failed (${zeroResult.error.code}).`, { quarter: zeroResult.quarter });
  }

  const finish = (run: ListRun, step: FallbackStep, reportLines: readonly string[]): DemoResult => {
    const checks = listChecks(inputs, run);
    if (checks.length > 0) {
      return listFailure(run.list, `The ${run.list} list at Fallback_Step ${step} fails its checks.`, {
        lastStep: step,
        failures: checks.map(formatFailure),
        report: reportLines,
      });
    }
    const m = run.measure;
    const pick = step === 2 ? m.maxRent : selectDistrict(m.ghostByDistrict);
    if (pick === null) return listFailure(run.list, 'No district to select.', { lastStep: step, report: reportLines });
    const rentDifference = m.rentByDistrict[pick.district] ?? 0;
    const summary: DemoSummary = {
      comparisonQuarter: COMPARISON,
      fallbackStep: step,
      ghostDifference: { central: m.ghostCentral, min: m.ghostMin, max: m.ghostMax },
      ghostThreshold: config.ghostThreshold,
      rentBurden: { district: pick.district, difference: step === 2 ? pick.difference : rentDifference },
      rentBurdenThreshold: config.rentBurdenThreshold,
    };
    const save = toSave({ ...run.session, mapIndicator: 'rentBurden', selectedDistrict: pick.district });
    const saveCode = encodeSave(save);
    const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
    return { ok: true, save, saveCode, summary, summaryText, fileText: renderDemoModule(saveCode, summaryText), report: reportLines };
  };

  const base = runList(inputs, 'base', config.base, zeroResult);
  if (!('measure' in base)) return { ...base, report };
  const first = decideFallback({
    ghostThreshold: config.ghostThreshold,
    rentBurdenThreshold: config.rentBurdenThreshold,
    baseGhost: base.measure.ghostCentral,
    enlargedGhost: null,
    enlargedRent: null,
  });
  report.push(...first.report);
  if (first.step === 0) return finish(base, 0, report);

  const enlarged = runList(inputs, 'enlarged', config.enlarged, zeroResult);
  if (!('measure' in enlarged)) return { ...enlarged, report };
  const d = decideFallback({
    ghostThreshold: config.ghostThreshold,
    rentBurdenThreshold: config.rentBurdenThreshold,
    baseGhost: base.measure.ghostCentral,
    enlargedGhost: enlarged.measure.ghostCentral,
    enlargedRent: enlarged.measure.maxRent === null ? 0 : enlarged.measure.maxRent.difference,
  });
  report.length = 0;
  report.push(...d.report);
  if (d.step === null) {
    return listFailure('enlarged', 'No Fallback_Step meets its condition.', { lastStep: 2, failures: d.failed, report });
  }
  return finish(enlarged, d.step, report);
}
