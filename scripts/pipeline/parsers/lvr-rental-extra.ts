/**
 * Extra rental fields of the real-price registration files (`租賃筆棟數`, `出租型態`) used only by the
 * whole-dwelling filter of `housing.dwellingSize`. The shared parser `lvr.ts` is unchanged; this helper parses
 * the same rows in the same order and zips them with the shared records.
 */
import { parseCsv } from '../../lib/csv.ts';
import { codePointCompare } from '../numeric.ts';
import { classifyLvr, parseLvrCsv, type LvrRecord } from './lvr.ts';

export type RentalFilterReason = 'parking' | 'suite-or-room' | 'other-type';

export interface RentalRecord extends LvrRecord {
  /** `出租型態`, empty when blank or when the file has no such column. */
  readonly rentType: string;
  /** True when `車位N` of `租賃筆棟數` is above 0 or `交易標的` contains `車位`. */
  readonly hasParking: boolean;
}

/** Rent types kept as whole-dwelling rentals; blank is kept too. */
export const WHOLE_DWELLING_TYPES: ReadonlySet<string> = new Set(['', '整棟(戶)出租']);
/** Rent types that are suites or rooms or part of a building. */
export const SUITE_OR_ROOM_TYPES: ReadonlySet<string> = new Set(['獨立套房', '分租套房', '分租雅房', '分層出租']);

export function parkingCount(counts: string): number {
  const m = /車位(\d+)/.exec(counts);
  return m ? Number(m[1]) : 0;
}

/** Same rows and order as `parseLvrCsv(text, file, 'rental')`, with the two extra fields added. */
export function parseRentalExtras(text: string, file: string): RentalRecord[] {
  const base = parseLvrCsv(text, file, 'rental');
  const [rawHeader, , ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const typeCol = header.indexOf('出租型態');
  const countCol = header.indexOf('租賃筆棟數');
  const dataRows = rows.filter((r) => !(r.length === 1 && (r[0] ?? '').trim() === ''));
  return base.map((r, i) => {
    const row = dataRows[i] ?? [];
    const rentType = typeCol < 0 ? '' : (row[typeCol] ?? '').trim();
    const counts = countCol < 0 ? '' : (row[countCol] ?? '').trim();
    return { ...r, rentType, hasParking: parkingCount(counts) > 0 || r.target.includes('車位') };
  });
}

/** Same rule as `dedupeById`: files in code point order of their names, first non-empty id wins. */
export function dedupeRentals(files: readonly { file: string; records: readonly RentalRecord[] }[]): RentalRecord[] {
  const sorted = [...files].sort((a, b) => codePointCompare(a.file, b.file));
  const seen = new Set<string>();
  const out: RentalRecord[] = [];
  for (const f of sorted) {
    for (const r of f.records) {
      if (r.id !== '') {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
      }
      out.push(r);
    }
  }
  return out;
}

export interface WholeDwellingSplit {
  /** Records that pass `classifyLvr` (residential, in range, rent and area above 0). */
  readonly qualifying: readonly RentalRecord[];
  readonly kept: readonly RentalRecord[];
  readonly excluded: Readonly<Record<RentalFilterReason, number>>;
}

/** Parking is checked first, then suite or room types; an unknown non-blank type is its own reason and is excluded. */
export function splitWholeDwellings(records: readonly RentalRecord[]): WholeDwellingSplit {
  const qualifying = records.filter((r) => classifyLvr(r) === undefined);
  const excluded: Record<RentalFilterReason, number> = { parking: 0, 'suite-or-room': 0, 'other-type': 0 };
  const kept: RentalRecord[] = [];
  for (const r of qualifying) {
    if (r.hasParking) excluded.parking++;
    else if (SUITE_OR_ROOM_TYPES.has(r.rentType)) excluded['suite-or-room']++;
    else if (!WHOLE_DWELLING_TYPES.has(r.rentType)) excluded['other-type']++;
    else kept.push(r);
  }
  return { qualifying, kept, excluded };
}
