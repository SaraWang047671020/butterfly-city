/**
 * District job shares for `commute.jobShare.<code>` (Requirements 22.10, 28.5).
 *
 *   jobShare(d) = apportion(1_000_000, employees)[d] / 1_000_000   over the 41 districts in code order
 *
 * Largest-remainder apportionment keeps the 41 integer parts summing to exactly 1,000,000, so the shares
 * sum to 1 within one part in a million.
 */
import { DISTRICTS } from '../../lib/districts.ts';
import { apportion } from '../numeric.ts';
import type { CensusEmployeeRow } from './census-employees.ts';

/** Unit text of each `commute.jobShare.<code>` entry. */
export const JOB_SHARE_UNIT = 'share of the 41-district total';

export const JOB_SHARE_SCALE = 1_000_000;

/** Job share per district, keyed by District_Code, in ascending code order. */
export function jobShares(employees: readonly CensusEmployeeRow[]): Map<string, number> {
  const byCode = new Map(employees.map((e) => [e.districtCode, e.employees]));
  const codes = DISTRICTS.map((d) => d.code).sort();
  const weights = codes.map((code) => {
    const value = byCode.get(code);
    if (value === undefined) throw new Error(`jobShares: no employee row for district ${code}`);
    return value;
  });
  const parts = apportion(JOB_SHARE_SCALE, weights);
  return new Map(codes.map((code, i) => [code, parts[i]! / JOB_SHARE_SCALE]));
}
