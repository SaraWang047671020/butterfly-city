// Construction_Entries and Completion_Items: display grouping of the social housing lag pipeline.
// No formulas beyond quarter-index differences (design: Construction_Entries, Completion_Items).

import type { DistrictCode } from '../../types/data-files.ts';
import type { LagEntry, SimState } from '../../types/simulation.ts';
import type { CompletionItemView, ConstructionRowView } from '../../types/view.ts';
import { LAST_QUARTER } from '../../simulation/constants.ts';
import { quarterIndex } from '../../simulation/quarter.ts';

const TOOL = 'socialHousing';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function nameOf(names: ReadonlyMap<DistrictCode, string>, area: string): string {
  return names.get(area) ?? area;
}

/** Social housing Lag entries with a non-zero difference in the displayed state's pipeline, as rows. */
export function constructionEntries(
  displayed: SimState,
  names: ReadonlyMap<DistrictCode, string>,
): readonly ConstructionRowView[] {
  const shown = quarterIndex(displayed.quarter);
  const rows: ConstructionRowView[] = [];
  for (const e of displayed.lagPipeline) {
    if (e.tool !== TOOL || e.value === 0) continue;
    rows.push({
      district: e.area,
      districtName: nameOf(names, e.area),
      committed: e.committed,
      effect: e.effect,
      difference: e.value,
      lag: quarterIndex(e.effect) - quarterIndex(e.committed),
      progress: shown - quarterIndex(e.committed),
      afterEnd: quarterIndex(e.effect) > quarterIndex(LAST_QUARTER),
    });
  }
  return rows.sort(
    (a, b) =>
      quarterIndex(a.effect) - quarterIndex(b.effect) ||
      compareText(a.districtName, b.districtName) ||
      quarterIndex(a.committed) - quarterIndex(b.committed),
  );
}

/**
 * Non-zero social housing entries seen in any computed central state whose effect quarter is at or
 * before the last state's quarter (the Displayed_Quarter), one per (area, committed).
 * `names` is optional; without it the district code stands in for the name.
 */
export function completionItems(
  states: readonly SimState[],
  names: ReadonlyMap<DistrictCode, string> = new Map(),
): readonly CompletionItemView[] {
  const last = states[states.length - 1];
  if (last === undefined) return [];
  const shown = quarterIndex(last.quarter);
  const seen = new Map<string, LagEntry>();
  for (const s of states) {
    for (const e of s.lagPipeline) {
      if (e.tool !== TOOL || e.value === 0 || quarterIndex(e.effect) > shown) continue;
      seen.set(`${e.area}|${e.committed}`, e);
    }
  }
  return [...seen.values()]
    .map((e) => ({
      district: e.area,
      districtName: nameOf(names, e.area),
      committed: e.committed,
      effect: e.effect,
      difference: e.value,
    }))
    .sort(
      (a, b) =>
        quarterIndex(a.effect) - quarterIndex(b.effect) ||
        compareText(a.districtName, b.districtName) ||
        quarterIndex(a.committed) - quarterIndex(b.committed),
    );
}
