// Ghost groups and count (Requirement 10). Pure functions. One function computes R, C, O and the count for
// both the Derived_Baseline (empty group list, D = 0) and the simulated quarter, so with zero differences
// both evaluate the same expression on the same numbers (Requirement 3.3).

import type {
  CauseDraft,
  CauseLinks,
  Contribution,
  GhostGroupContribution,
  GhostGroupId,
  ParameterTable,
} from '../types/simulation.ts';
import { GHOST_FLOOR_TOLERANCE } from './constants.ts';
import { clamp } from './numeric.ts';
import { scalar } from './params.ts';

export interface GhostInput {
  /** Population P of the district (after migration for a simulated quarter). */
  readonly population: number;
  /** Mean commute time T in minutes. */
  readonly commuteTime: number;
  /** Residents moved out of the district by the Migration_Rule in the quarter. */
  readonly displaced: number;
  /** Rent-group contributions collected from the registry tools (empty for the Derived_Baseline). */
  readonly groups: readonly GhostGroupContribution[];
}

export interface GhostValues {
  readonly rent: number; // R
  readonly commute: number; // C
  readonly overlap: number; // O
  readonly displaced: number; // D
  readonly count: number;
}

export interface GhostDraftInput extends GhostInput {
  /** Derived_Baseline population P0 and mean commute time T0. */
  readonly baselinePopulation: number;
  readonly baselineCommuteTime: number;
}

export interface GhostResult {
  /** Reported Ghost count; pass it as `valueOverride` to `finish`. */
  readonly count: number;
  readonly draft: CauseDraft;
}

/** Group ids in Cause order, with the rent-group source each one reads. */
const RENT_GROUPS: readonly { readonly id: GhostGroupId; readonly source: GhostGroupContribution['source'] }[] = [
  { id: 'ghost-rent-housed', source: 'housed' },
  { id: 'ghost-rent-spillover', source: 'spillover' },
  { id: 'ghost-rent-subsidy', source: 'subsidy' },
  { id: 'ghost-rent-sublease', source: 'sublease' },
];

function ghostValues(
  params: ParameterTable,
  input: GhostInput,
  P0: number,
  T0: number,
): GhostValues {
  const { population: P, displaced: D } = input;
  const bR = scalar(params, 'ghost.shareRent');
  const bC = 1 - scalar(params, 'ghost.shareCommuteWithin');
  const bO = scalar(params, 'ghost.shareBoth');
  const sigma = scalar(params, 'ghost.sensitivityRent');
  const sensCommute = scalar(params, 'ghost.sensitivityCommute');
  const size = scalar(params, 'ghost.size');

  let personPp = 0;
  for (const g of input.groups) personPp += g.personPp;

  const R0 = P0 * bR;
  const R = clamp(R0 + sigma * personPp, 0, P);
  const sR = P === 0 ? 0 : R / P;
  const sC = clamp(bC + sensCommute * (input.commuteTime - T0), 0, 1);
  const sO = clamp(bO + (sR - bR) * bC + (sC - bC) * bR, 0, Math.min(sR, sC));
  const C = P * sC;
  const O = P * sO;
  const exact = (R + C - O + D) / size;
  const count = P === 0 ? 0 : Math.floor(exact + GHOST_FLOOR_TOLERANCE * Math.max(1, Math.abs(exact)));
  return { rent: R, commute: C, overlap: O, displaced: D, count };
}

/** Ghost values of one district, relative to the Derived_Baseline population P0 and commute time T0. */
export function computeGhostValues(
  params: ParameterTable,
  input: GhostInput,
  baselinePopulation: number,
  baselineCommuteTime: number,
): GhostValues {
  return ghostValues(params, input, baselinePopulation, baselineCommuteTime);
}

/**
 * Derived_Baseline Ghost count: the same function at (P0, T0, D = 0) with an empty group list.
 * `params` is the running Scenario's table, so the count differs between Scenarios (Requirement 19.8).
 */
export function derivedGhostCount(
  params: ParameterTable,
  baselinePopulation: number,
  baselineCommuteTime: number,
): number {
  return computeGhostValues(
    params,
    { population: baselinePopulation, commuteTime: baselineCommuteTime, displaced: 0, groups: [] },
    baselinePopulation,
    baselineCommuteTime,
  ).count;
}

function mergeLinks(parts: readonly CauseLinks[], extraParameterIds: readonly string[]): CauseLinks {
  const parameterIds = new Set<string>(extraParameterIds);
  const sourceIds = new Set<string>();
  for (const p of parts) {
    for (const id of p.parameterIds) parameterIds.add(id);
    for (const id of p.sourceIds) sourceIds.add(id);
  }
  return { parameterIds: [...parameterIds].sort(), sourceIds: [...sourceIds].sort() };
}

// Links that do not depend on the district or quarter; built once and shared (the output is deep-frozen).
const GHOST_COMMUTE_LINKS: CauseLinks = mergeLinks([], [
  'ghost.commuteThreshold',
  'ghost.sensitivityCommute',
  'ghost.shareCommuteWithin',
  'ghost.size',
]);
const GHOST_OVERLAP_LINKS: CauseLinks = mergeLinks([], [
  'ghost.shareBoth',
  'ghost.shareCommuteWithin',
  'ghost.shareRent',
  'ghost.size',
]);
const GHOST_DISPLACED_LINKS: CauseLinks = mergeLinks([], ['ghost.size']);

/** Builds the Ghost count and its CauseDraft: Baseline, then the seven group Causes in order (Requirement 10.6). */
export function ghostDraft(params: ParameterTable, input: GhostDraftInput): GhostResult {
  const size = scalar(params, 'ghost.size');
  const sigma = scalar(params, 'ghost.sensitivityRent');
  const { baselinePopulation: P0, baselineCommuteTime: T0 } = input;

  const base = computeGhostValues(
    params,
    { population: P0, commuteTime: T0, displaced: 0, groups: [] },
    P0,
    T0,
  );
  const sim = computeGhostValues(params, input, P0, T0);

  const start: Contribution = {
    value: base.count,
    links: {
      parameterIds: [
        'ghost.commuteThreshold',
        'ghost.rentThreshold',
        'ghost.shareBoth',
        'ghost.shareCommuteWithin',
        'ghost.shareRent',
        'ghost.size',
      ],
      sourceIds: [],
    },
  };

  const groups: (Contribution & { readonly groupId: GhostGroupId })[] = [];
  for (const rg of RENT_GROUPS) {
    const entries = input.groups.filter((g) => g.source === rg.source);
    let personPp = 0;
    for (const e of entries) personPp += e.personPp;
    groups.push({
      groupId: rg.id,
      value: (sigma * personPp) / size,
      links: mergeLinks(
        entries.map((e) => e.links),
        ['ghost.sensitivityRent', 'ghost.size'],
      ),
    });
  }
  groups.push({
    groupId: 'ghost-commute',
    value: (sim.commute - base.commute) / size,
    links: GHOST_COMMUTE_LINKS,
  });
  groups.push({
    groupId: 'ghost-overlap',
    value: -(sim.overlap - base.overlap) / size,
    links: GHOST_OVERLAP_LINKS,
  });
  groups.push({
    groupId: 'ghost-displaced',
    value: sim.displaced / size,
    links: GHOST_DISPLACED_LINKS,
  });

  const empty: Contribution = { value: 0, links: { parameterIds: [], sourceIds: [] } };
  const draft: CauseDraft = {
    kind: 'count',
    start,
    tools: [],
    events: [],
    migration: empty,
    groups,
  };
  return { count: sim.count, draft };
}
