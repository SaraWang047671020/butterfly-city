// Demo_Save conditions on the real files (game-ui task 19.4; Requirements 14.1, 14.3, 14.4, 14.13 to 14.17,
// 14.22, 14.24, 14.27, 14.28, 14.29, 19.7). The committed summary records Fallback_Step 2, so the conditions
// asserted are those of step 2 (rent burden is the main effect), not those of step 0 or 1.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readDemoInputs } from '../../../scripts/demo/inputs.ts';
import { runDemo, selectDistrict } from '../../../scripts/demo/run-demo.ts';
import type { DemoInputs } from '../../../scripts/demo/run-demo.ts';
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
} from '../../../scripts/demo/checks.ts';
import type { CheckResult } from '../../../scripts/demo/checks.ts';
import { DEMO_SAVE_CODE, DEMO_SUMMARY_TEXT } from '../../../src/save/demo-save.generated.ts';
import { readDemo, demoEffectOrder, describeDemo } from '../../../src/game/demo.ts';
import { fromSave } from '../../../src/game/core/session.ts';
import type { GameSession } from '../../../src/game/core/session.ts';
import { computeNext } from '../../../src/game/core/turns.ts';
import { completionItems } from '../../../src/game/core/construction.ts';
import { playerTimeline } from '../../../src/game/core/policy.ts';
import { runRange } from '../../../src/simulation/engine.ts';
import type { DemoSummary, Save } from '../../../src/types/save.ts';
import type { SimState } from '../../../src/types/simulation.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const TIMEOUT = 120_000;

type Run = { central: readonly SimState[]; low: readonly SimState[]; high: readonly SimState[] };

let inputs: DemoInputs;
let save: Save;
let summary: DemoSummary;
let base: GameSession; // Planning_Quarter 2021Q1, Displayed_Quarter 2020Q4
let look: Run; // through 2021Q1 with the Demo_Save adjustments
let zero: Run; // Zero_Delta_Run through 2021Q1
let reportLines: readonly string[];

const last = (r: readonly SimState[]): SimState => r[r.length - 1] as SimState;
const total = (s: SimState, id: string): number =>
  Object.values(s.values[id] ?? {}).reduce((a, v) => a + (v ?? 0), 0);
const noFailures = (r: CheckResult): string[] => r.map(formatFailure);

beforeAll(async () => {
  const read = await readDemoInputs(ROOT);
  if (!read.ok) throw new Error(`${read.message} ${read.details.join('; ')}`);
  inputs = read.inputs;

  const source = readDemo(
    { registry: inputs.registry, districts: inputs.data.districts.map((d) => ({ code: d.code, city: d.city })) },
    DEMO_SAVE_CODE,
    DEMO_SUMMARY_TEXT,
  );
  if (!source.ok) throw new Error(source.reason);
  save = source.save;
  summary = source.summary;

  const loaded = fromSave(save, inputs.data, inputs.registry);
  if (!loaded.ok) throw new Error(`fromSave failed at ${loaded.quarter}`);
  base = loaded.session;
  const out = computeNext(base);
  if (out.session.computed === null || out.computed.length !== 1) throw new Error('lookahead did not compute 2021Q1');
  look = out.session.computed;

  const z = runRange(
    inputs.data.engine.realTrack,
    inputs.data.engine.events,
    inputs.data.engine.params,
    inputs.data.engine.baseline,
    inputs.data.engine.realTrack,
    inputs.data.engine.commute,
    '2021Q1',
    { registry: inputs.registry },
  );
  if (!z.ok) throw new Error(`Zero_Delta_Run failed (${z.error.code})`);
  zero = z;

  const r = runDemo(inputs);
  if (!r.ok) throw new Error(`runDemo failed: ${r.message}`);
  reportLines = r.report;
}, TIMEOUT);

/** Absolute ghost difference printed by runDemo for the step line that starts with `prefix`. */
function reportedGhost(prefix: string): number {
  const line = reportLines.find((l) => l.startsWith(prefix));
  const m = line === undefined ? null : /\|Demo_Ghost_Difference\| (\S+),/.exec(line);
  if (m === null) throw new Error(`no report line for ${prefix}`);
  return Number(m[1]);
}

function rentDiffs(): Record<string, number> {
  const out: Record<string, number> = {};
  const lc = last(look.central).values['rentBurden'] ?? {};
  const zc = last(zero.central).values['rentBurden'] ?? {};
  for (const code of Object.keys(lc)) out[code] = (lc[code] ?? 0) - (zc[code] ?? 0);
  return out;
}

describe('Demo_Save conditions on the real files', () => {
  it('14.1: Planning_Quarter 2021Q1, Displayed_Quarter 2020Q4, demo flag', () => {
    expect(save.next).toBe('2021Q1');
    expect(save.demo).toBe(true);
    expect(base.computed?.central.length).toBe(24);
    expect(last(base.computed?.central ?? []).quarter).toBe('2020Q4');
    expect(summary.comparisonQuarter).toBe('2021Q1');
  }, TIMEOUT);

  it('14.3 and 14.4: a Timeline_Entry for every Active_Tool and a Construction_Entry effective 2021Q1 or later', () => {
    const ids = inputs.registry.tools.map((t) => t.id);
    expect(noFailures(checkTimelineCoversTools(save.timeline, ids))).toEqual([]);
    const previous = (base.computed?.central ?? [])[23] as SimState;
    expect(noFailures(checkConstructionEntry(previous.lagPipeline))).toEqual([]);
  }, TIMEOUT);

  it('Fallback_Step 2 condition holds (14.22): both ghost differences below threshold, a rent burden difference at or above it', () => {
    expect(summary.fallbackStep).toBe(2);
    const g = summary.ghostThreshold;
    expect(reportedGhost('Step 0')).toBeLessThan(g);
    expect(reportedGhost('Step 1')).toBeLessThan(g);
    const central = total(last(look.central), 'ghostCount') - total(last(zero.central), 'ghostCount');
    expect(Math.abs(central)).toBeLessThan(g);
    const best = selectDistrict(rentDiffs());
    expect(best).not.toBeNull();
    expect(Math.abs(best?.difference ?? 0)).toBeGreaterThanOrEqual(summary.rentBurdenThreshold);
  }, TIMEOUT);

  it('14.27: Rent_Burden indicator, the district of the largest absolute rent burden difference, summary equals recompute, rent line first', () => {
    expect(save.mapIndicator).toBe('rentBurden');
    const best = selectDistrict(rentDiffs());
    expect(best?.district).toBe(save.selectedDistrict);
    expect(summary.rentBurden.district).toBe(best?.district);
    expect(summary.rentBurden.difference).toBeCloseTo(best?.difference ?? NaN, 9);
    const diff = (s: 'central' | 'low' | 'high'): number => total(last(look[s]), 'ghostCount') - total(last(zero[s]), 'ghostCount');
    const all = [diff('low'), diff('central'), diff('high')];
    expect(summary.ghostDifference.central).toBeCloseTo(diff('central'), 9);
    expect(summary.ghostDifference.min).toBeCloseTo(Math.min(...all), 9);
    expect(summary.ghostDifference.max).toBeCloseTo(Math.max(...all), 9);
    expect(demoEffectOrder(summary.fallbackStep)).toEqual(['rentBurden', 'ghost']);
    const view = describeDemo(save, summary, (c) => c);
    expect(view.fallbackStep).toBe(2);
    expect(view.rentBurden.district).toBe(best?.district);
    expect(view.entries.length).toBe(save.timeline.length);
  }, TIMEOUT);

  it('14.17: a Completion_Item committed 2015Q1..2016Q4 with effect by 2020Q4', () => {
    expect(noFailures(checkCompletionItem(completionItems(base.computed?.central ?? [])))).toEqual([]);
  }, TIMEOUT);

  it('14.28: the Parameter_Table equals params.json parameters; the merged table adds only commuterPass.price.* entries', () => {
    const file = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'params.json'), 'utf8')) as {
      parameters: Record<string, unknown>;
    };
    expect(inputs.data.paramsFileTable).toEqual(file.parameters);
    const merged = inputs.data.engine.params;
    for (const id of Object.keys(file.parameters)) expect(merged[id]).toEqual(file.parameters[id]);
    const added = Object.keys(merged).filter((id) => !Object.hasOwn(file.parameters, id));
    expect(added.length).toBeGreaterThan(0);
    expect(added.filter((id) => !id.startsWith('commuterPass.price.'))).toEqual([]);
    // The session that produced the Demo_Save used that same table.
    expect(base.params).toBe(inputs.data.engine.params);
  }, TIMEOUT);

  it('14.13, 14.14, 14.16: rent subsidy below real, more social housing starts, return to the real track (14.29)', () => {
    expect(noFailures(checkRentSubsidyBelowReal(save.timeline, base.realTrack))).toEqual([]);
    const districts = inputs.data.engine.baseline.districts.map((d) => d.code);
    expect(districts.length).toBe(41);
    expect(
      noFailures(checkSocialHousingSum(playerTimeline(base.realTrack, base.diffs), base.realTrack, districts)),
    ).toEqual([]);
    expect(noFailures(checkRealTrackReturn(save.timeline))).toEqual([]);
  }, TIMEOUT);

  it('14.15: yearly budget shift in 2015 and 2016 from the central ledgers (14.29)', () => {
    const previousPlayer = (base.computed?.central ?? [])[23] as SimState;
    const previousReal = zero.central[23] as SimState;
    expect(noFailures(checkBudgetShift(previousPlayer.ledger, previousReal.ledger))).toEqual([]);
  }, TIMEOUT);

  it('14.24: the Demo_Enlarged_List relates to the Demo_Base_List as required, and the save holds the enlarged list (14.29)', () => {
    const { base: baseList, enlarged } = inputs.config;
    expect(noFailures(checkDemoLists(baseList, enlarged, base.realTrack))).toEqual([]);
    // Fallback_Step 2 is produced from the enlarged list: the timeline matches it entry by entry.
    expect(save.timeline.length).toBe(enlarged.length);
    enlarged.forEach((a, i) => {
      const t = save.timeline[i];
      expect(t?.quarter).toBe(a.quarter);
      expect(t?.tool).toBe(a.tool);
      expect(t?.field).toBe(a.field);
      expect(t?.area).toBe(a.area);
      expect(t?.kind).toBe(a.kind);
      if (t?.kind === 'value') expect(t.after).toBe(a.value);
    });
  }, TIMEOUT);
});
