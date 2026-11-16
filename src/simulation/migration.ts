// Migration_Rule (Requirement 9). Pure: all data arrives as arguments.
// Every origin is computed from the same start-of-quarter snapshot, and results are summed in
// ascending District_Code order, so the presentation order of the input never changes the output.

import type { DistrictCode } from '../types/data-files.ts';
import type { CommuteMatrix, ParameterTable } from '../types/simulation.ts';
import { apportion } from './numeric.ts';
import { scalar } from './params.ts';

/** One district's start-of-quarter snapshot. */
export interface MigrationDistrict {
  readonly code: DistrictCode;
  /** Baseline population of the quarter (conflict C2). */
  readonly population: number;
  /** Simulated rent burden after this quarter's Policy_Deltas, percent of income. */
  readonly rentBurden: number;
  /** Derived_Baseline rent burden, percent of income. */
  readonly baselineRentBurden: number;
  /**
   * K_o: monthly commute-cost reduction in TWD for pairs starting here (the lagged Commuter_Pass
   * Policy_Difference of the origin's city; negative raises the cost). Absent means 0.
   */
  readonly commuteCostOffset?: number;
}

export interface MigrationResult {
  /** Persons moved into each district, every district present. */
  readonly in: Readonly<Record<DistrictCode, number>>;
  /** Persons moved out of each district (exits included), every district present. */
  readonly out: Readonly<Record<DistrictCode, number>>;
  /** `in − out` per district. */
  readonly net: Readonly<Record<DistrictCode, number>>;
  /** Same as `out`: persons displaced from each district, for the Ghost rule (Requirement 9.7). */
  readonly displaced: Readonly<Record<DistrictCode, number>>;
  /** Persons leaving the metro area in the quarter (whole number). */
  readonly exits: number;
}

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Runs the Migration_Rule for one quarter. The districts may come in any order; the commute
 * matrix is looked up by code. A district missing from the matrix has no row and is skipped as
 * an origin or destination by the caller's earlier validation (Requirement 9.10).
 */
export function migrate(
  districts: readonly MigrationDistrict[],
  commute: CommuteMatrix,
  params: ParameterTable,
): MigrationResult {
  const threshold = scalar(params, 'migration.threshold');
  const share = scalar(params, 'migration.share');
  const exitShare = scalar(params, 'migration.exitShare');
  const weightTime = scalar(params, 'migration.weightTime');
  const weightBurden = scalar(params, 'migration.weightBurden');
  const weightCost = scalar(params, 'migration.weightCost');
  const costPerMinute = scalar(params, 'migration.commuteCostPerMinute');

  const sorted = [...districts].sort((a, b) => ascending(a.code, b.code));
  const matrixIndex = new Map<string, number>();
  commute.codes.forEach((code, i) => matrixIndex.set(code, i));

  const inn: Record<string, number> = {};
  const out: Record<string, number> = {};
  for (const d of sorted) {
    inn[d.code] = 0;
    out[d.code] = 0;
  }
  let exits = 0;

  for (const origin of sorted) {
    if (!(origin.rentBurden - origin.baselineRentBurden > threshold)) continue;
    const moved = Math.floor(share * origin.population);
    if (!(moved > 0)) continue;
    const exiting = Math.floor(exitShare * moved);
    const staying = moved - exiting;
    const row = matrixIndex.get(origin.code);
    const rowMinutes = row === undefined ? undefined : commute.minutes[row];
    const destinations = sorted.filter((d) => d.code !== origin.code);

    // Exponents, then weights exp(x - max x) so the largest weight is exactly 1.
    const exponents = destinations.map((dest) => {
      const col = matrixIndex.get(dest.code);
      const minutes = rowMinutes === undefined || col === undefined ? Number.NaN : (rowMinutes[col] ?? Number.NaN);
      const cost = Math.max(0, costPerMinute * minutes - (origin.commuteCostOffset ?? 0));
      return -weightTime * minutes - weightBurden * dest.rentBurden - weightCost * cost;
    });
    let maxX = Number.NEGATIVE_INFINITY;
    for (const x of exponents) if (x > maxX) maxX = x;
    const weights = exponents.map((x) => Math.exp(x - maxX));
    const parts = apportion(staying, weights);

    out[origin.code] = (out[origin.code] ?? 0) + moved;
    exits += exiting;
    destinations.forEach((dest, i) => {
      inn[dest.code] = (inn[dest.code] ?? 0) + (parts[i] ?? 0);
    });
  }

  const net: Record<string, number> = {};
  for (const d of sorted) {
    const net_ = (inn[d.code] ?? 0) - (out[d.code] ?? 0);
    net[d.code] = net_ === 0 ? 0 : net_;
  }
  return { in: inn, out, net, displaced: { ...out }, exits };
}
