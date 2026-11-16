/**
 * Parser for the MOI district rent statistics ODS (`1140123全國行政區租金統計-修正.ods`, contracts valid on
 * 2024-12-31). The file has no mean, so Requirement 9.4 uses the median: the 50th percentile (`租金50分位`) of the
 * `不分類` (all housing types) row of each district (Decision D17).
 *
 * Table layout (found by header name, not position): header row with `編號`, `縣市`, `行政區`, `房屋類型`, `契約數`,
 * `租金25分位`, `租金50分位`, `租金75分位`. Each district has one `不分類` row with all those cells, followed by
 * sub-type rows (整戶(層), 獨立套房, 分租套(雅)房) that have fewer cells and are skipped. The city table further down
 * (rows that start with a city name and `不分類`) is skipped too. Rows outside Taipei and New Taipei are skipped.
 *
 * Only the 35 of the 41 districts present in the published statistics are returned; Shiding, Pinglin, Shimen,
 * Pingxi, Shuangxi and Wulai are absent from the source (Requirement 9.5).
 *
 * Errors: a file that is not an ODS, a missing header or column, a count or percentile that is not a positive
 * integer, or a district listed twice throws `ParseError`. A `不分類` row of Taipei or New Taipei that matches none
 * of the 41 districts throws `DataError` (rule `unmatched-district`). Row numbers are 1-based positions among
 * the rows the ODS reader returns.
 */
import { readOdsRows } from '../../lib/zip.ts';
import { districtByZh } from '../../lib/districts.ts';
import { DataError, ParseError } from '../errors.ts';
import { normalizeTai } from './household.ts';

export interface RentStatsRow {
  readonly districtCode: string;
  /** Number of valid contracts behind the percentiles. */
  readonly contracts: number;
  /** 50th percentile of monthly rent per contract (NT$), row `不分類`. */
  readonly p50: number;
}

const COLUMNS = { city: '縣市', district: '行政區', type: '房屋類型', contracts: '契約數', p50: '租金50分位' } as const;
const ALL_TYPES = '不分類';

function positiveInteger(value: string): number {
  const v = value.replace(/,/g, '').trim();
  return /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : Number.NaN;
}

/** Per-district P50 monthly rent (all housing types) of the two cities from the MOI rent statistics ODS. */
export function parseRentStats(bytes: Uint8Array, file: string): RentStatsRow[] {
  let rows: string[][];
  try {
    rows = readOdsRows(Buffer.from(bytes));
  } catch (e) {
    throw new ParseError(file, undefined, ['an ODS spreadsheet with content.xml'], [e instanceof Error ? e.message : String(e)], 'cannot read the ODS file');
  }
  const headerAt = rows.findIndex((r) => r[0] === '編號');
  if (headerAt < 0) {
    throw new ParseError(file, 1, ['a header row starting with 編號'], [`first row: ${(rows[0] ?? []).join(' | ')}`], 'no header row');
  }
  const header = rows[headerAt] ?? [];
  const idx = Object.fromEntries(Object.entries(COLUMNS).map(([k, n]) => [k, header.indexOf(n)])) as Record<keyof typeof COLUMNS, number>;
  for (const [key, name] of Object.entries(COLUMNS)) {
    if (idx[key as keyof typeof COLUMNS] < 0) {
      throw new ParseError(file, headerAt + 1, Object.values(COLUMNS), header, `missing required column ${name}`);
    }
  }
  const out = new Map<string, RentStatsRow>();
  for (let i = headerAt + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const row = i + 1;
    if (cells.length !== header.length || cells[idx.type] !== ALL_TYPES) continue;
    const city = normalizeTai(cells[idx.city] ?? '');
    if (city !== '臺北市' && city !== '新北市') continue;
    const zh = `${city}${(cells[idx.district] ?? '').trim()}`;
    const district = districtByZh(zh);
    if (!district) throw new DataError('unmatched-district', `${file} row ${row}`, [`value: ${zh}`]);
    const contracts = positiveInteger(cells[idx.contracts] ?? '');
    const p50 = positiveInteger(cells[idx.p50] ?? '');
    if (Number.isNaN(contracts) || Number.isNaN(p50)) {
      const bad = Number.isNaN(p50) ? COLUMNS.p50 : COLUMNS.contracts;
      const value = Number.isNaN(p50) ? cells[idx.p50] : cells[idx.contracts];
      throw new ParseError(file, row, [`${bad}: positive integer`], [`${bad}: ${JSON.stringify(value ?? null)}`], `${bad} is not a positive integer`);
    }
    if (out.has(district.code)) {
      throw new ParseError(file, row, [`one ${ALL_TYPES} row per district`], [`duplicate row for ${zh}`], 'duplicate district row');
    }
    out.set(district.code, { districtCode: district.code, contracts, p50 });
  }
  if (out.size === 0) {
    throw new ParseError(file, headerAt + 1, [`${ALL_TYPES} rows of Taipei or New Taipei districts`], ['none found'], 'no district rows');
  }
  return [...out.values()].sort((a, b) => (a.districtCode < b.districtCode ? -1 : 1));
}
