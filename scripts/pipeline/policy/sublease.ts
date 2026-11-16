/**
 * Sublease and rental management units matched per city and quarter (Requirement 12.8).
 *
 * For each city and channel (city-run or central), phase i spans from its start date to the start date of
 * phase i+1 of the same channel, or to the `as_of` date of the last phase (end excluded):
 *
 *   span(i)    = days in [start(i), end(i))
 *   counted(i) = days of that span on or before the last day of the last quarter (2025-12-31)
 *   units(i)   = round(total(i) · counted(i) / span(i))
 *   quarter q  = apportion(units(i), counted days of the span in each quarter), summed over channels and phases
 *
 * So the whole units of a phase sum exactly to its counted part. A quarter before the first phase start is 0.
 * Every record is estimated with `sublease-phase-spread`.
 */
import type { Quarter } from '../../lib/time.ts';
import { DataError } from '../errors.ts';
import type { SubleasePhaseRow } from '../parsers/policy-tables.ts';
import { apportion } from '../numeric.ts';
import { cityTrack, dayNumber, estimatedRecord, overlapDays, quarterDayRange, type CityTrack } from './track.ts';

export const SUBLEASE_SERIES = 'subleaseUnitsMatched';
export const SUBLEASE_SOURCE = 'policy/moi-b5010';
export const SUBLEASE_METHOD = 'sublease-phase-spread';

export function buildSubleaseUnits(rows: readonly SubleasePhaseRow[], quarters: readonly Quarter[]): CityTrack {
  const firstQuarter = quarters[0];
  const lastQuarter = quarters[quarters.length - 1];
  if (firstQuarter === undefined || lastQuarter === undefined) throw new Error('buildSubleaseUnits needs at least one quarter');
  const ranges = quarters.map(quarterDayRange);
  const countEnd = ranges[ranges.length - 1]!.endExclusive; // day after the last counted day

  return cityTrack((city) => {
    const own = rows.filter((r) => r.city === city);
    if (own.length === 0) {
      throw new DataError('missing-table-rows', `${SUBLEASE_SERIES} ${city} ${firstQuarter}`, ['no row for this city in sublease-phases.csv']);
    }
    const values = quarters.map(() => 0);
    for (const channel of ['city', 'central'] as const) {
      const phases = own.filter((r) => r.channel === channel).sort((a, b) => a.phase - b.phase);
      phases.forEach((p, i) => {
        const start = dayNumber(p.startDate);
        const next = phases[i + 1];
        const end = next !== undefined ? dayNumber(next.startDate) : dayNumber(p.asOf);
        const span = end - start;
        if (span <= 0) {
          throw new DataError('empty-phase-span', `${SUBLEASE_SERIES} ${city} ${firstQuarter}`, [
            `${channel} phase ${p.phase}: start ${p.startDate} is not before ${next !== undefined ? next.startDate : p.asOf}`,
          ]);
        }
        const counted = Math.max(0, Math.min(end, countEnd) - start);
        const units = Math.round((p.totalUnits * counted) / span);
        const weights = ranges.map((r) => overlapDays(start, end, r.start, r.endExclusive));
        const split = apportion(units, weights);
        split.forEach((v, k) => {
          values[k]! += v;
        });
      });
    }
    return values.map((v) => estimatedRecord(v, SUBLEASE_SOURCE, SUBLEASE_METHOD));
  });
}
