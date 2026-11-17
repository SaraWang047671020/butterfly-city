/**
 * Low-use housing indicators (Requirement 26): `lowUseHousingCount` and `lowUseHousingRate`.
 *
 * A district has a published value for a half-year period (`YYYYH1` / `YYYYH2`) or it does not. The value is
 * placed at the Reference_Quarter of the period (Q2 for H1, Q4 for H2) with `estimated: false`, no method and
 * `dataPeriod`. Every other record is `{ value: null, estimated: false }`. Nothing is interpolated, held,
 * extrapolated or pooled. `dataGaps` (districts with 44 null records) is computed from the built records.
 * More than 5 such districts throws `low-use-too-many-gaps` before any file is written.
 */
import type { ValueRecord } from '../../src/types/data-files.ts';
import type { LowUseContext } from '../../src/data/validate.ts';
import type { Quarter } from '../lib/time.ts';
import type { BuildContext } from './context.ts';
import { DataError } from './errors.ts';
import type { CodeRef, DistrictSeries } from './indicators/series.ts';
import { parseLowUse, periodsPresent as periodsOf, type LowUseRow } from './parsers/low-use.ts';
import type { BuildState, Step } from './run.ts';

export const MAX_LOW_USE_GAPS = 5;

export interface LowUseResult {
  readonly count: DistrictSeries;
  readonly rate: DistrictSeries;
  readonly dataGaps: readonly string[];
  readonly periodsPresent: readonly string[];
  readonly missing: readonly { readonly district: string; readonly period: string }[];
}

/** `2020H1` → `2020Q2`; `2020H2` → `2020Q4`. */
export function referenceQuarter(period: string): string {
  const m = /^(\d{4})H([12])$/.exec(period);
  if (m === null) throw new DataError('low-use-period', period, ['expected YYYYH1 or YYYYH2']);
  return `${m[1]}Q${m[2] === '1' ? 2 : 4}`;
}

/** Pure builder. Rows outside the 44 quarters (none expected) are ignored. */
export function buildLowUse(
  rows: readonly LowUseRow[],
  districts: readonly CodeRef[],
  quarters: readonly Quarter[],
): LowUseResult {
  const periods = periodsOf(rows);
  const byKey = new Map<string, LowUseRow>();
  for (const r of rows) byKey.set(`${r.districtCode}|${r.period}`, r);
  const index = new Map<string, number>(quarters.map((q, i) => [q as string, i]));

  const count: DistrictSeries = {};
  const rate: DistrictSeries = {};
  const missing: { district: string; period: string }[] = [];
  const dataGaps: string[] = [];

  for (const d of districts) {
    const c: ValueRecord[] = quarters.map(() => ({ value: null, estimated: false }));
    const r: ValueRecord[] = quarters.map(() => ({ value: null, estimated: false }));
    let any = false;
    for (const period of periods) {
      const row = byKey.get(`${d.code}|${period}`);
      if (row === undefined) {
        missing.push({ district: d.code, period });
        continue;
      }
      const i = index.get(referenceQuarter(period));
      if (i === undefined) continue;
      c[i] = { value: row.count, estimated: false, dataPeriod: period };
      r[i] = { value: row.ratePercent, estimated: false, dataPeriod: period };
      any = true;
    }
    count[d.code] = c;
    rate[d.code] = r;
    if (!any) dataGaps.push(d.code);
  }

  if (dataGaps.length > MAX_LOW_USE_GAPS) {
    throw new DataError('low-use-too-many-gaps', 'low-use housing', [
      `${dataGaps.length} districts have no published value (more than ${MAX_LOW_USE_GAPS}): ${dataGaps.join(', ')}`,
    ]);
  }
  return { count, rate, dataGaps, periodsPresent: periods, missing };
}

/** Step: reads the 34 current-method files and sets the two series and `state.lowUse`. */
export function lowUseStep(): Step {
  return {
    name: 'low-use',
    run(ctx: BuildContext, state: BuildState) {
      const result = buildLowUse(parseLowUse(ctx.reader), ctx.districts, ctx.quarters);
      state.lowUseHousingCount = result.count;
      state.lowUseHousingRate = result.rate;
      const lowUse: LowUseContext = {
        dataGaps: result.dataGaps,
        periodsPresent: result.periodsPresent,
        missing: result.missing,
      };
      state.lowUse = lowUse;
      if (result.dataGaps.length > 0) {
        state.notes.push(`low-use housing: no published value for districts ${result.dataGaps.join(', ')}`);
      }
    },
  };
}
