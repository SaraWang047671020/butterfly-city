// Policy differences and adjustments (Requirements 9.6, 9.14, 8.10, 12.1, 13.2).
// Differences are stored as `value - real`, unrounded (design decisions G1, G2). No simulation formulas.

import type { QuarterKey } from '../../types/data-files.ts';
import type { PolicyDiffSeries } from '../../types/save.ts';
import type { AreaKey, PolicySetting, PolicyTimeline, ToolId, ToolSetting } from '../../types/simulation.ts';
import { QUARTER_COUNT } from '../../simulation/constants.ts';
import { quarterAt, quarterIndex } from '../../simulation/quarter.ts';

/** Stored Policy_Differences: sorted by tool, field, area; no all-zero series. */
export type PolicyDiffs = readonly PolicyDiffSeries[];

export interface FieldTarget {
  readonly tool: ToolId;
  readonly field: string;
  readonly area: AreaKey;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sameTarget(s: PolicyDiffSeries, t: FieldTarget): boolean {
  return s.tool === t.tool && s.field === t.field && s.area === t.area;
}

function settingAt(track: PolicyTimeline, q: QuarterKey): PolicySetting | undefined {
  return track.find((s) => s.quarter === q);
}

/** Real value of one target and quarter from the Real_Policy_Track, or null when none is recorded. */
export function realValue(track: PolicyTimeline, t: FieldTarget, q: QuarterKey): number | null {
  const tools = settingAt(track, q)?.tools;
  if (tools === undefined || !Object.hasOwn(tools, t.tool)) return null;
  const setting = tools[t.tool] as ToolSetting;
  if (!Object.hasOwn(setting, t.field)) return null;
  const areas = setting[t.field] as Readonly<Record<AreaKey, number>>;
  if (!Object.hasOwn(areas, t.area)) return null;
  const v = areas[t.area];
  return typeof v === 'number' ? v : null;
}

function diffAt(diffs: PolicyDiffs, t: FieldTarget, index: number): number {
  const s = diffs.find((d) => sameTarget(d, t));
  return s?.diffs[index] ?? 0;
}

/** real + diff (G1). null when the real value is null. */
export function playerValue(
  track: PolicyTimeline,
  diffs: PolicyDiffs,
  t: FieldTarget,
  q: QuarterKey,
): number | null {
  const real = realValue(track, t, q);
  if (real === null) return null;
  return real + diffAt(diffs, t, quarterIndex(q));
}

/** 44 settings: the real track with every stored difference added; track-only fields copied from real. */
export function playerTimeline(track: PolicyTimeline, diffs: PolicyDiffs): PolicyTimeline {
  const out: PolicySetting[] = [];
  for (let i = 0; i < QUARTER_COUNT; i++) {
    const quarter = quarterAt(i);
    const real = settingAt(track, quarter);
    const tools: Record<ToolId, ToolSetting> = {};
    if (real !== undefined) {
      for (const [toolId, setting] of Object.entries(real.tools)) {
        const fields: Record<string, Record<AreaKey, number>> = {};
        for (const [field, areas] of Object.entries(setting)) fields[field] = { ...areas };
        tools[toolId] = fields;
      }
    }
    for (const s of diffs) {
      const d = s.diffs[i] ?? 0;
      const areas = Object.hasOwn(tools, s.tool) ? tools[s.tool]?.[s.field] : undefined;
      if (areas === undefined || !Object.hasOwn(areas, s.area)) continue;
      (areas as Record<AreaKey, number>)[s.area] = (areas[s.area] as number) + d;
    }
    out.push({ quarter, tools });
  }
  return out;
}

/** Replace the series of `t` with `slots`, dropping it when all zero; keeps the sort order. */
function withSeries(diffs: PolicyDiffs, t: FieldTarget, slots: readonly number[]): PolicyDiffs {
  const rest = diffs.filter((s) => !sameTarget(s, t));
  if (slots.every((v) => v === 0)) return rest;
  const next: PolicyDiffSeries = { tool: t.tool, field: t.field, area: t.area, diffs: slots };
  return [...rest, next].sort(
    (a, b) => cmp(a.tool, b.tool) || cmp(a.field, b.field) || cmp(a.area, b.area),
  );
}

function currentSlots(diffs: PolicyDiffs, t: FieldTarget): number[] {
  const s = diffs.find((d) => sameTarget(d, t));
  const slots: number[] = [];
  for (let i = 0; i < QUARTER_COUNT; i++) slots.push(s?.diffs[i] ?? 0);
  return slots;
}

/** Value_Adjustment: slot q := value - real(q) for every q from `from` to 2025Q4 (Requirement 9.6). */
export function withValue(
  diffs: PolicyDiffs,
  track: PolicyTimeline,
  t: FieldTarget,
  from: QuarterKey,
  value: number,
): PolicyDiffs {
  const slots = currentSlots(diffs, t);
  for (let i = Math.max(0, quarterIndex(from)); i < QUARTER_COUNT; i++) {
    const real = realValue(track, t, quarterAt(i));
    slots[i] = real === null ? 0 : value - real + 0; // + 0 turns -0 into 0
  }
  return withSeries(diffs, t, slots);
}

/** Real_Track_Adjustment: slot q := 0 for every q from `from` to 2025Q4 (Requirement 9.14). */
export function withRealTrack(diffs: PolicyDiffs, t: FieldTarget, from: QuarterKey): PolicyDiffs {
  const slots = currentSlots(diffs, t);
  for (let i = Math.max(0, quarterIndex(from)); i < QUARTER_COUNT; i++) slots[i] = 0;
  return withSeries(diffs, t, slots);
}

/** True when every slot from `from` to 2025Q4 is 0: the Set_To_Real_Control is disabled (Requirement 8.10). */
export function followsRealTrack(diffs: PolicyDiffs, t: FieldTarget, from: QuarterKey): boolean {
  const s = diffs.find((d) => sameTarget(d, t));
  if (s === undefined) return true;
  for (let i = Math.max(0, quarterIndex(from)); i < QUARTER_COUNT; i++) {
    if ((s.diffs[i] ?? 0) !== 0) return false;
  }
  return true;
}
