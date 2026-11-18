// Pure Demo_Save checks (game-ui Requirements 14.3, 14.4, 14.13 to 14.17, 14.24).
// Each check returns the failures it found; a failure names the condition with its computed value
// and threshold. Nothing here reads files or throws for typed inputs.

import type { QuarterKey } from '../../src/types/data-files.ts';
import type { CompletionItemView } from '../../src/types/view.ts';
import type { TimelineEntry } from '../../src/types/save.ts';
import type { AreaKey, BudgetLedger, LagEntry, PolicyTimeline, ToolId } from '../../src/types/simulation.ts';
import { realValue } from '../../src/game/core/policy.ts';
import { quarterIndex } from '../../src/simulation/quarter.ts';

export interface CheckFailure {
  /** Requirement id, for example "14.15". */
  readonly requirement: string;
  /** The condition that failed, in words. */
  readonly condition: string;
  /** The computed value, as text. */
  readonly computed: string;
  /** The threshold or expected value, as text. */
  readonly threshold: string;
}

export type CheckResult = readonly CheckFailure[];

/** One entry of a Demo list in `data/config/demo-adjustments.json`. */
export interface DemoAdjustment {
  readonly quarter: QuarterKey;
  readonly tool: ToolId;
  readonly field: string;
  readonly area: AreaKey;
  readonly kind: 'value' | 'real-track';
  readonly value?: number;
}

const FIRST_DEMO_QUARTER = '2015Q1';
const LAST_DEMO_QUARTER = '2016Q4';
const REAL_TRACK_DEADLINE = '2017Q1';
const COMPARISON_PREVIOUS = '2020Q4';
const RENT_SUBSIDY = 'rentSubsidy';
const SOCIAL_HOUSING = 'socialHousing';

function fail(requirement: string, condition: string, computed: string | number, threshold: string): CheckFailure {
  return { requirement, condition, computed: String(computed), threshold };
}

/** One line: "14.15: condition (computed X, threshold Y)". */
export function formatFailure(f: CheckFailure): string {
  return `${f.requirement}: ${f.condition} (computed ${f.computed}, threshold ${f.threshold})`;
}

function inDemoWindow(q: QuarterKey): boolean {
  return quarterIndex(q) >= quarterIndex(FIRST_DEMO_QUARTER) && quarterIndex(q) <= quarterIndex(LAST_DEMO_QUARTER);
}

function sameTarget(
  a: { readonly tool: ToolId; readonly field: string; readonly area: AreaKey },
  b: { readonly tool: ToolId; readonly field: string; readonly area: AreaKey },
): boolean {
  return a.tool === b.tool && a.field === b.field && a.area === b.area;
}

/** 14.3: at least one Timeline_Entry for each Active_Tool. */
export function checkTimelineCoversTools(
  timeline: readonly TimelineEntry[],
  activeToolIds: readonly ToolId[],
): CheckResult {
  const out: CheckFailure[] = [];
  for (const id of activeToolIds) {
    const n = timeline.filter((e) => e.tool === id).length;
    if (n < 1) out.push(fail('14.3', `no Timeline_Entry for Active_Tool ${id}`, n, 'at least 1'));
  }
  return out;
}

/** 14.4: at least one Construction_Entry (social housing, non-zero) with an effect quarter of 2021Q1 or later, in the 2020Q4 pipeline. */
export function checkConstructionEntry(
  lagPipelineAt2020Q4: readonly LagEntry[],
  comparisonQuarter: QuarterKey = '2021Q1',
): CheckResult {
  const n = lagPipelineAt2020Q4.filter(
    (e) => e.tool === SOCIAL_HOUSING && e.value !== 0 && quarterIndex(e.effect) >= quarterIndex(comparisonQuarter),
  ).length;
  return n >= 1
    ? []
    : [fail('14.4', `no social housing Construction_Entry with effect ${comparisonQuarter} or later at ${COMPARISON_PREVIOUS}`, n, 'at least 1')];
}

/** 14.13: a rentSubsidy Value_Adjustment in 2015Q1..2016Q4 whose `after` is below the real value of its quarter. */
export function checkRentSubsidyBelowReal(
  timeline: readonly TimelineEntry[],
  realTrack: PolicyTimeline,
): CheckResult {
  const candidates = timeline.filter((e) => e.kind === 'value' && e.tool === RENT_SUBSIDY && inDemoWindow(e.quarter));
  const below = candidates.filter((e) => {
    const real = realValue(realTrack, e, e.quarter);
    return real !== null && e.after !== null && e.after < real;
  });
  return below.length >= 1
    ? []
    : [fail('14.13', `no ${RENT_SUBSIDY} Value_Adjustment in ${FIRST_DEMO_QUARTER}..${LAST_DEMO_QUARTER} below the real value`, `${below.length} of ${candidates.length} candidates`, 'at least 1')];
}

/** Sum of one field over the given areas and the quarters 2015Q1..2016Q4. */
function sumUnitsStarted(track: PolicyTimeline, districts: readonly AreaKey[]): number {
  let sum = 0;
  for (const s of track) {
    if (!inDemoWindow(s.quarter)) continue;
    const areas = s.tools[SOCIAL_HOUSING]?.['unitsStarted'];
    if (areas === undefined) continue;
    for (const d of districts) {
      const v = Object.hasOwn(areas, d) ? areas[d] : undefined;
      if (typeof v === 'number') sum += v;
    }
  }
  return sum;
}

/** 14.14: sum of socialHousing.unitsStarted over the districts and 2015Q1..2016Q4 is greater for the player than for the real track. */
export function checkSocialHousingSum(
  playerTrack: PolicyTimeline,
  realTrack: PolicyTimeline,
  districts: readonly AreaKey[],
): CheckResult {
  const player = sumUnitsStarted(playerTrack, districts);
  const real = sumUnitsStarted(realTrack, districts);
  return player > real
    ? []
    : [fail('14.14', `sum of ${SOCIAL_HOUSING}.unitsStarted ${FIRST_DEMO_QUARTER}..${LAST_DEMO_QUARTER}, player vs real`, player, `greater than real ${real}`)];
}

function yearCommitted(ledger: BudgetLedger, tool: ToolId, year: number): number {
  const slots = ledger.committed[tool] ?? [];
  const start = (year - 2015) * 4;
  let sum = 0;
  for (let i = start; i < start + 4; i++) sum += slots[i] ?? 0;
  return sum;
}

/**
 * 14.15: per year 2015 and 2016, from the central 2020Q4 ledgers,
 * 0 < SH(demo) - SH(real) <= RS(real) - RS(demo). `realLedger` is the Zero_Delta_Run ledger.
 */
export function checkBudgetShift(demoLedger: BudgetLedger, realLedger: BudgetLedger): CheckResult {
  const out: CheckFailure[] = [];
  for (const year of [2015, 2016]) {
    const sh = yearCommitted(demoLedger, SOCIAL_HOUSING, year) - yearCommitted(realLedger, SOCIAL_HOUSING, year);
    const rs = yearCommitted(realLedger, RENT_SUBSIDY, year) - yearCommitted(demoLedger, RENT_SUBSIDY, year);
    if (!(sh > 0)) {
      out.push(fail('14.15', `${year} social housing charge, demo minus real`, sh, 'greater than 0'));
    } else if (!(sh <= rs)) {
      out.push(fail('14.15', `${year} social housing charge increase, demo minus real`, sh, `at most the rent subsidy saving ${rs}`));
    }
  }
  return out;
}

/**
 * 14.16: every target changed by a 2015Q1..2016Q4 Value_Adjustment has a later Real_Track_Adjustment
 * (later in list order, same or later quarter) with quarter no later than 2017Q1.
 */
export function checkRealTrackReturn(timeline: readonly TimelineEntry[]): CheckResult {
  const out: CheckFailure[] = [];
  const reported = new Set<string>();
  timeline.forEach((e, i) => {
    if (e.kind !== 'value' || !inDemoWindow(e.quarter)) return;
    const id = `${e.tool}.${e.field}/${e.area}`;
    if (reported.has(id)) return;
    const hasReturn = timeline.some(
      (r, j) =>
        j > i &&
        r.kind === 'real-track' &&
        sameTarget(r, e) &&
        quarterIndex(r.quarter) >= quarterIndex(e.quarter) &&
        quarterIndex(r.quarter) <= quarterIndex(REAL_TRACK_DEADLINE),
    );
    if (!hasReturn) {
      reported.add(id);
      out.push(fail('14.16', `no later Real_Track_Adjustment for ${id}`, `none after ${e.quarter}`, `a quarter up to ${REAL_TRACK_DEADLINE}`));
    }
  });
  return out;
}

/** 14.17: a Completion_Item committed 2015Q1..2016Q4 with effect no later than 2020Q4 (items from the states through 2020Q4). */
export function checkCompletionItem(items: readonly CompletionItemView[]): CheckResult {
  const n = items.filter(
    (c) => inDemoWindow(c.committed) && quarterIndex(c.effect) <= quarterIndex(COMPARISON_PREVIOUS),
  ).length;
  return n >= 1
    ? []
    : [fail('14.17', `no Completion_Item committed ${FIRST_DEMO_QUARTER}..${LAST_DEMO_QUARTER} with effect by ${COMPARISON_PREVIOUS}`, n, 'at least 1')];
}

/**
 * 14.24: the enlarged list has the same adjustments as the base list in order, quarter, tool, field,
 * Area and kind; each Value_Adjustment's absolute Policy_Difference (value minus the real value of its
 * quarter) is at least the base one, and larger for at least one.
 */
export function checkDemoLists(
  base: readonly DemoAdjustment[],
  enlarged: readonly DemoAdjustment[],
  realTrack: PolicyTimeline,
): CheckResult {
  if (base.length !== enlarged.length) {
    return [fail('14.24', 'base and enlarged lists have different lengths', enlarged.length, `equal to base ${base.length}`)];
  }
  const out: CheckFailure[] = [];
  let larger = 0;
  for (let i = 0; i < base.length; i++) {
    const b = base[i] as DemoAdjustment;
    const e = enlarged[i] as DemoAdjustment;
    if (b.quarter !== e.quarter || !sameTarget(b, e) || b.kind !== e.kind) {
      out.push(fail('14.24', `item ${i} differs in quarter, tool, field, area or kind`, `${e.quarter} ${e.tool}.${e.field}/${e.area} ${e.kind}`, `${b.quarter} ${b.tool}.${b.field}/${b.area} ${b.kind}`));
      continue;
    }
    if (b.kind !== 'value') continue;
    const real = realValue(realTrack, b, b.quarter);
    if (real === null || b.value === undefined || e.value === undefined) {
      out.push(fail('14.24', `item ${i} has no value or no real value to compare`, 'missing', 'a finite number'));
      continue;
    }
    const db = Math.abs(b.value - real);
    const de = Math.abs(e.value - real);
    if (de < db) out.push(fail('14.24', `item ${i} enlarged absolute difference`, de, `at least base ${db}`));
    else if (de > db) larger++;
  }
  if (out.length === 0 && larger === 0) {
    out.push(fail('14.24', 'no enlarged Value_Adjustment is larger than its base', 0, 'at least 1'));
  }
  return out;
}
