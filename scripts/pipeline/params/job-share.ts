/**
 * District job shares for `commute.jobShare.<code>` (Requirements 22.10, 28.5).
 *
 *   jobShare(d) = apportion(1_000_000, employees)[d] / 1_000_000   over the 41 districts in code order
 *
 * Largest-remainder apportionment keeps the 41 integer parts summing to exactly 1,000,000, so the shares
 * sum to 1 within one part in a million.
 */
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import { DISTRICTS } from '../../lib/districts.ts';
import { DataError } from '../errors.ts';
import { apportion } from '../numeric.ts';
import { JOB_SHARE_METHOD_TEXT, type CensusEmployeeRow } from './census-employees.ts';

/**
 * Method text that a group of Parameter_Entries carries, for the Sources_Document (read by task 25.8).
 * `ids` is the list of entry ids, or one pattern such as `commute.jobShare.<code>` for a group.
 */
export interface ParamMethodNote {
  readonly ids: readonly string[];
  readonly method: string;
}

/** Id of the job-share entry of a district; the same text as `jobShareId` of src/simulation/params.ts. */
export const jobShareEntryId = (code: string): string => `commute.jobShare.${code}`;

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

export interface JobShareEntries {
  /** Entries keyed by id `commute.jobShare.<code>`, in ascending code order. */
  readonly entries: ReadonlyMap<string, ScalarParameter>;
  readonly methods: readonly ParamMethodNote[];
}

/**
 * The 41 `commute.jobShare.<code>` Parameter_Entries (status `secondary`). Source: table 10 of the 2021
 * DGBAS Industry and Service Census report of the district's city (URL and page from the committed table).
 * The press-release totals are a note in SOURCES.md only. Every entry passes `checkParameterEntry`.
 */
export function jobShareEntries(employees: readonly CensusEmployeeRow[]): JobShareEntries {
  const shares = jobShares(employees);
  const rowOf = new Map(employees.map((e) => [e.districtCode, e]));
  const entries = new Map<string, ScalarParameter>();
  for (const [code, value] of shares) {
    const row = rowOf.get(code) as CensusEmployeeRow;
    const id = jobShareEntryId(code);
    const entry: ScalarParameter = {
      kind: 'scalar',
      value,
      unit: JOB_SHARE_UNIT,
      status: 'secondary',
      source: {
        citation: `DGBAS, 2021 Industry and Service Census report, table ${row.tableId}, page ${row.page}: persons engaged at year end by township and district`,
        url: row.sourceUrl,
      },
      estimated: { method: JOB_SHARE_METHOD_TEXT },
    };
    const issues = checkParameterEntry(id, entry);
    if (issues.length > 0) throw new DataError('job-share-entry-invalid', id, issues.map((i) => i.problem));
    entries.set(id, entry);
  }
  return { entries, methods: [{ ids: ['commute.jobShare.<code>'], method: JOB_SHARE_METHOD_TEXT }] };
}
