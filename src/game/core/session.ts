// Game session: new game, Save conversion (Requirements 12.1, 12.6, 13.8, 7.14).
// Holds no simulation formulas: fromSave re-runs the Engine through recompute (one runRange).

import type { DistrictCode, QuarterKey } from '../../types/data-files.ts';
import type { EventCard } from '../../types/events-file.ts';
import type { LoadedData } from '../../data/convert.ts';
import type { EngineError, RuleRegistry } from '../../types/simulation.ts';
import { SAVE_SCHEMA_VERSION } from '../../types/save.ts';
import type { MapIndicatorId, PolicyDiffSeries, Save } from '../../types/save.ts';
import { ENGINE_VERSION } from '../../simulation/constants.ts';
import { recompute } from './turns.ts';
import type { ComputedRun, TurnSession } from './turns.ts';
import type { PolicyDiffs } from './policy.ts';
import type { SeriesUnits } from './tools.ts';

export type { ComputedRun } from './turns.ts';
export type { PolicyDiffs } from './policy.ts';

export interface GameSession extends TurnSession {
  readonly cards: readonly EventCard[];
  readonly mapIndicator: MapIndicatorId;
  readonly selectedDistrict: DistrictCode | null;
  readonly demo: boolean;
  readonly seed: number;
}

export type FromSaveResult =
  | {
      readonly ok: true;
      readonly session: GameSession;
      readonly versionNotice: { readonly saved: string; readonly current: string } | null;
    }
  | { readonly ok: false; readonly quarter: QuarterKey; readonly error: EngineError };

function unitsOf(data: LoadedData): SeriesUnits {
  const units: Record<string, string> = {};
  for (const s of data.policyTrack.policySeries) units[s.id] = s.unit;
  return units;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function base(data: LoadedData, registry: RuleRegistry): GameSession {
  return {
    registry,
    params: data.engine.params,
    baseline: data.engine.baseline,
    realTrack: data.engine.realTrack,
    commute: data.engine.commute,
    events: data.engine.events,
    units: unitsOf(data),
    diffs: [],
    timeline: [],
    planning: '2015Q1',
    ledger: null,
    next: '2015Q1',
    computed: null,
    cards: data.events,
    mapIndicator: 'rentBurden',
    selectedDistrict: null,
    demo: false,
    seed: 0,
  };
}

export function newSession(data: LoadedData, registry: RuleRegistry, demo = false): GameSession {
  return { ...base(data, registry), demo };
}

/** No Sim_State (Requirement 12.1). Series sorted by tool, field, area. */
export function toSave(session: GameSession): Save {
  const policy: PolicyDiffSeries[] = [...session.diffs].sort(
    (a, b) => cmp(a.tool, b.tool) || cmp(a.field, b.field) || cmp(a.area, b.area),
  );
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    next: session.next,
    policy,
    timeline: session.timeline,
    mapIndicator: session.mapIndicator,
    selectedDistrict: session.selectedDistrict,
    demo: session.demo,
    seed: session.seed,
  };
}

export function fromSave(save: Save, data: LoadedData, registry: RuleRegistry): FromSaveResult {
  const diffs: PolicyDiffs = save.policy;
  const start: GameSession = {
    ...base(data, registry),
    diffs,
    timeline: save.timeline,
    next: save.next,
    planning: save.next,
    mapIndicator: save.mapIndicator,
    selectedDistrict: save.selectedDistrict,
    demo: save.demo,
    seed: save.seed,
  };
  const r = recompute(start);
  if (!r.ok) return { ok: false, quarter: r.quarter, error: r.error };
  const versionNotice =
    save.engineVersion === ENGINE_VERSION ? null : { saved: save.engineVersion, current: ENGINE_VERSION };
  return { ok: true, session: r.session, versionNotice };
}
