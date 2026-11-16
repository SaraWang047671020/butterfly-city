// Cause breakdowns (Requirement 13). Turns a CauseDraft into the reported value and its Cause_Breakdown.
// Pure functions. Inputs are never mutated.

import type { DistrictCode, QuarterKey } from '../types/data-files.ts';
import type {
  Cause,
  CauseBreakdown,
  CauseDraft,
  CauseLinks,
  CauseParameter,
  IndicatorId,
  ParameterTable,
} from '../types/simulation.ts';
import { clamp, roundHalfUp } from './numeric.ts';

export interface FinishContext {
  readonly indicator: IndicatorId;
  readonly district: DistrictCode;
  readonly quarter: QuarterKey;
  /** The Parameter_Table; status, estimated marker and range are copied from it (14.8, 14.11). */
  readonly params: ParameterTable;
  /**
   * Reported value chosen by the indicator's own rule. Used by the Ghost count, whose floor is set by
   * its rule; the difference to the summed contributions goes to the Bound_Adjustment.
   */
  readonly valueOverride?: number;
  /** Optional per-quarter memo of link metadata; same results, built once per distinct link list. */
  readonly cache?: CauseCache;
}

/** Memo of the sorted ids and parameter details per distinct link list. Create one per quarter (the table is fixed). */
export interface CauseCache {
  readonly parameters: Map<string, { ids: readonly string[]; details: readonly CauseParameter[] }>;
  readonly sources: Map<string, readonly string[]>;
  /** Same memo keyed by the link array object, so a reused array skips building the string key. */
  readonly parametersByRef: WeakMap<readonly string[], { ids: readonly string[]; details: readonly CauseParameter[] }>;
  readonly sourcesByRef: WeakMap<readonly string[], readonly string[]>;
}

export function createCauseCache(): CauseCache {
  return { parameters: new Map(), sources: new Map(), parametersByRef: new WeakMap(), sourcesByRef: new WeakMap() };
}

function normalizeZero(x: number): number {
  return x === 0 ? 0 : x;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function parameterDetail(params: ParameterTable, id: string): CauseParameter | null {
  if (!Object.hasOwn(params, id)) return null;
  const p = params[id];
  if (p === undefined) return null;
  const base: CauseParameter = { parameterId: id, status: p.status };
  if (p.estimated !== undefined) {
    if (p.kind === 'scalar' && p.range !== undefined) {
      return { ...base, estimated: p.estimated, range: p.range };
    }
    return { ...base, estimated: p.estimated };
  }
  if (p.kind === 'scalar' && p.range !== undefined) return { ...base, range: p.range };
  return base;
}

function makeCause(
  kind: Cause['kind'],
  id: string,
  contribution: number,
  links: CauseLinks,
  params: ParameterTable,
  cache: CauseCache | undefined,
): Cause {
  const build = (): { ids: readonly string[]; details: readonly CauseParameter[] } => {
    const ids = sortedUnique(links.parameterIds);
    const details: CauseParameter[] = [];
    for (const parameterId of ids) {
      const detail = parameterDetail(params, parameterId);
      if (detail !== null) details.push(detail);
    }
    return { ids, details };
  };
  let meta: { ids: readonly string[]; details: readonly CauseParameter[] };
  let sourceIds: readonly string[];
  if (cache === undefined) {
    meta = build();
    sourceIds = sortedUnique(links.sourceIds);
  } else {
    // Identity fast path: the same link array object is reused across districts; the string key is the fallback.
    const byRefMeta = cache.parametersByRef.get(links.parameterIds);
    if (byRefMeta !== undefined) {
      meta = byRefMeta;
    } else {
      const pKey = links.parameterIds.join('\u0000');
      const cachedMeta = cache.parameters.get(pKey);
      if (cachedMeta === undefined) {
        meta = build();
        cache.parameters.set(pKey, meta);
      } else {
        meta = cachedMeta;
      }
      cache.parametersByRef.set(links.parameterIds, meta);
    }
    const byRefSources = cache.sourcesByRef.get(links.sourceIds);
    if (byRefSources !== undefined) {
      sourceIds = byRefSources;
    } else {
      const sKey = links.sourceIds.join('\u0000');
      const cachedSources = cache.sources.get(sKey);
      if (cachedSources === undefined) {
        sourceIds = sortedUnique(links.sourceIds);
        cache.sources.set(sKey, sourceIds);
      } else {
        sourceIds = cachedSources;
      }
      cache.sourcesByRef.set(links.sourceIds, sourceIds);
    }
  }
  return {
    kind,
    id,
    contribution: normalizeZero(contribution),
    parameterIds: meta.ids,
    sourceIds,
    parameters: meta.details,
  };
}

/** Bounds the summed contributions per value kind (12.3, 12.4). */
export function boundValue(kind: CauseDraft['kind'], pre: number): number {
  if (kind === 'bounded') return clamp(pre, 0, 100);
  if (kind === 'non-negative') return pre < 0 ? 0 : pre;
  return Math.max(roundHalfUp(pre), 0);
}

/**
 * Sums the contributions left to right in Cause order, bounds the sum, and returns the value and its
 * breakdown. Cause order: Baseline, one Cause per tool, Events, migration, Bound_Adjustment. A draft with
 * `groups` (Ghost count) uses: Baseline, the group Causes, Bound_Adjustment. The Bound_Adjustment is
 * `value - pre`, exactly 0 when `pre` is already valid (12.5).
 */
export function finish(
  draft: CauseDraft,
  ctx: FinishContext,
): { readonly value: number; readonly breakdown: CauseBreakdown } {
  const { params } = ctx;
  const causes: Cause[] = [];
  let pre = 0;

  const add = (kind: Cause['kind'], id: string, value: number, links: CauseLinks): void => {
    causes.push(makeCause(kind, id, value, links, params, ctx.cache));
    pre += value;
  };

  add('baseline', 'baseline', draft.start.value, draft.start.links);

  if (draft.groups !== undefined) {
    for (const g of draft.groups) add('ghost-group', g.groupId, g.value, g.links);
  } else {
    for (const t of draft.tools) add('tool', t.tool, t.value, t.links);
    for (const e of draft.events) add('event', e.eventId, e.value, e.links);
    add('migration', 'migration', draft.migration.value, draft.migration.links);
  }

  const value = normalizeZero(ctx.valueOverride ?? boundValue(draft.kind, pre));
  const bound = value === pre ? 0 : value - pre;
  causes.push({
    kind: 'bound',
    id: 'bound',
    contribution: normalizeZero(bound),
    parameterIds: [],
    sourceIds: [],
    parameters: [],
  });

  return {
    value,
    breakdown: {
      indicator: ctx.indicator,
      district: ctx.district,
      quarter: ctx.quarter,
      value,
      causes,
    },
  };
}
