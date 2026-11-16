import type { QuarterKey } from '../types/data-files.ts';
import type { LagEntry, ToolId } from '../types/simulation.ts';
import { quarterIndex } from './quarter.ts';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toolRank(toolOrder: readonly ToolId[], tool: ToolId): number {
  const i = toolOrder.indexOf(tool);
  return i < 0 ? toolOrder.length : i;
}

/**
 * Sort order: effect quarter, tool registry index, area code, committed quarter.
 * Tools missing from `toolOrder` come last, ordered by id. The sort is stable, so
 * entries equal on every key keep their relative order.
 */
function compareEntries(toolOrder: readonly ToolId[]) {
  return (a: LagEntry, b: LagEntry): number =>
    quarterIndex(a.effect) - quarterIndex(b.effect) ||
    toolRank(toolOrder, a.tool) - toolRank(toolOrder, b.tool) ||
    compareText(a.tool, b.tool) ||
    compareText(a.area, b.area) ||
    quarterIndex(a.committed) - quarterIndex(b.committed);
}

/**
 * Appends entries to the pipeline and returns a new sorted array.
 * Entries are never merged or changed, and the inputs are not mutated.
 * `toolOrder` is the Rule_Registry order of tool ids.
 */
export function commit(
  pipeline: readonly LagEntry[],
  entries: readonly LagEntry[],
  toolOrder: readonly ToolId[] = [],
): readonly LagEntry[] {
  return [...pipeline, ...entries].sort(compareEntries(toolOrder));
}

/**
 * Splits the pipeline into the entries whose effect quarter is `t` and the rest.
 * Both parts keep the pipeline order. Entries with a later effect quarter
 * (including those after 2025Q4) stay in `rest`.
 */
export function mature(
  pipeline: readonly LagEntry[],
  t: QuarterKey,
): { readonly matured: readonly LagEntry[]; readonly rest: readonly LagEntry[] } {
  const matured: LagEntry[] = [];
  const rest: LagEntry[] = [];
  for (const entry of pipeline) {
    (entry.effect === t ? matured : rest).push(entry);
  }
  return { matured, rest };
}
