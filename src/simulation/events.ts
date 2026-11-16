// Event modifiers and Event Causes (Requirement 11).
// An Event can only scale a tool's delta on the tool's modifiable indicators. It never adds a value of its own,
// never scales the social housing stock, ghostGroups or the commute cost, and never reads an Event's affected
// indicators, magnitude or type (11.7). Real data has no modifier (11.9), so with real data nothing changes.
// Pure functions. Inputs are never mutated.

import type { DistrictCode, QuarterKey } from '../types/data-files.ts';
import type {
  CauseLinks,
  Contribution,
  EngineError,
  IndicatorId,
  ParameterTable,
  SimEvent,
  ToolEffects,
  ToolId,
  ToolRule,
} from '../types/simulation.ts';
import { CAUSE_TOLERANCE } from './constants.ts';
import { eventInvalid, eventReferenceUnknown } from './errors.ts';
import { optionalScalar } from './params.ts';
import { parseQuarter, quarterIndex } from './quarter.ts';

export type EventContribution = Contribution & { readonly eventId: string };

export interface AppliedEvents {
  /** The tool effects with the modifiers applied (`v_n`) on the modifiable indicators. */
  readonly effects: ToolEffects;
  /** The tool effects as given (`u`). The tool Cause keeps these values (11.4). */
  readonly unmodified: ToolEffects;
  /** Event Causes by indicator and district, in event-list order. Only entries above the tolerance. */
  readonly contributions: Readonly<
    Record<IndicatorId, Readonly<Record<DistrictCode, readonly EventContribution[]>>>
  >;
}

/** True when the Event covers the quarter, first and last inclusive. */
export function eventCovers(event: SimEvent, quarter: QuarterKey): boolean {
  const i = quarterIndex(quarter);
  return quarterIndex(event.firstQuarter) <= i && i <= quarterIndex(event.lastQuarter);
}

/**
 * Checks the Events against the known tools, indicators and parameters (Requirements 11.3 and 11.5).
 * Returns the first problem in event-list order, or null.
 */
export function validateEvents(
  events: readonly SimEvent[],
  toolIds: readonly ToolId[],
  indicatorIds: readonly IndicatorId[],
  params: ParameterTable,
): EngineError | null {
  for (const event of events) {
    if (parseQuarter(event.firstQuarter) === null) {
      return eventReferenceUnknown(event.id, event.firstQuarter);
    }
    if (parseQuarter(event.lastQuarter) === null) {
      return eventReferenceUnknown(event.id, event.lastQuarter);
    }
    if (quarterIndex(event.firstQuarter) > quarterIndex(event.lastQuarter)) {
      return eventInvalid(event.id, `${event.firstQuarter} is later than ${event.lastQuarter}`);
    }
    for (const indicator of event.affectedIndicators) {
      if (!indicatorIds.includes(indicator)) return eventReferenceUnknown(event.id, indicator);
    }
    for (const modifier of event.modifiers) {
      if (!toolIds.includes(modifier.tool)) return eventReferenceUnknown(event.id, modifier.tool);
      const parameter = Object.hasOwn(params, modifier.parameterId)
        ? params[modifier.parameterId]
        : undefined;
      if (parameter === undefined || parameter.kind !== 'scalar') {
        return eventReferenceUnknown(event.id, modifier.parameterId);
      }
      const m = parameter.value;
      if (!Number.isFinite(m) || m < 0) return eventInvalid(event.id, m);
      if (parameter.range !== undefined && (m < parameter.range.low || m > parameter.range.high)) {
        return eventInvalid(event.id, m);
      }
    }
  }
  return null;
}

function mergeLinks(links: CauseLinks | undefined, parameterId: string, sources: readonly string[]): CauseLinks {
  const parameterIds = new Set<string>([parameterId]);
  const sourceIds = new Set<string>(sources);
  for (const id of links?.parameterIds ?? []) parameterIds.add(id);
  return {
    parameterIds: [...parameterIds].sort(),
    sourceIds: [...sourceIds].sort(),
  };
}

/**
 * Applies the modifiers of the Events that cover `quarter` to one tool's effects.
 * For a delta `u` the Events that cover the quarter and have a modifier for the tool are applied in event-list
 * order: `v_j = v_{j-1} * m`, Event Cause `v_j - v_{j-1}`, listed only above the tolerance.
 * Call only after `validateEvents`; a missing modifier parameter is treated as "no modifier".
 */
export function applyEvents(
  tool: ToolRule,
  effects: ToolEffects,
  quarter: QuarterKey,
  events: readonly SimEvent[],
  params: ParameterTable,
): AppliedEvents {
  // Active modifiers for this tool in event-list order.
  const active: { event: SimEvent; parameterId: string; m: number }[] = [];
  for (const event of events) {
    if (!eventCovers(event, quarter)) continue;
    for (const modifier of event.modifiers) {
      if (modifier.tool !== tool.id) continue;
      const m = optionalScalar(params, modifier.parameterId);
      if (m === undefined) continue;
      active.push({ event, parameterId: modifier.parameterId, m });
    }
  }

  if (active.length === 0) {
    return { effects, unmodified: effects, contributions: {} };
  }

  const deltas: Record<IndicatorId, Record<DistrictCode, number>> = {};
  for (const [indicator, byDistrict] of Object.entries(effects.deltas)) {
    deltas[indicator] = { ...byDistrict };
  }
  const contributions: Record<IndicatorId, Record<DistrictCode, EventContribution[]>> = {};

  for (const indicator of tool.modifiable) {
    const source = effects.deltas[indicator];
    if (source === undefined) continue;
    const target = deltas[indicator] ?? {};
    const list: Record<DistrictCode, EventContribution[]> = {};
    for (const [district, u] of Object.entries(source)) {
      let v = u;
      const entries: EventContribution[] = [];
      for (const a of active) {
        const next = v * a.m;
        const change = next - v;
        const scale = Math.max(1, Math.abs(u), Math.abs(next));
        if (Math.abs(change) > CAUSE_TOLERANCE * scale) {
          entries.push({
            eventId: a.event.id,
            value: change,
            links: mergeLinks(undefined, a.parameterId, a.event.sources),
          });
        }
        v = next;
      }
      target[district] = v;
      if (entries.length > 0) list[district] = entries;
    }
    deltas[indicator] = target;
    if (Object.keys(list).length > 0) contributions[indicator] = list;
  }

  return {
    effects: { ...effects, deltas },
    unmodified: effects,
    contributions,
  };
}
