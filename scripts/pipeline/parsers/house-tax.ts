/**
 * Parser for MOF dataset 6742 (national tax collections by region, NT$ thousand).
 *
 * The first column `地區別` holds labels such as `90年/ 總計`, `90年/ 新北市(改制後)`, `90年/ 臺北市` for annual rows and
 * `90年 1月/ 臺北市` for monthly rows. Only annual rows of Taipei (`臺北市` or `台北市`) and New Taipei (`新北市` with
 * or without `(改制後)`) are read; every other label is skipped. The `房屋稅` column is the house tax net collection in
 * NT$ thousand. Years 2015..2025 (ROC 104..114) are returned; every city and year must be present and numeric.
 */
import { parseCsv, parseNumber } from '../../lib/csv.ts';
import { ROC_OFFSET } from '../../lib/time.ts';
import { ParseError } from '../errors.ts';
import type { PolicyCity } from './rent-subsidy.ts';

export interface HouseTaxRow {
  readonly city: PolicyCity;
  readonly year: number;
  /** House tax net collections, NT$ thousand. */
  readonly amountThousand: number;
}

export const HOUSE_TAX_FIRST_YEAR = 2015;
export const HOUSE_TAX_LAST_YEAR = 2025;

/** `90年/ 新北市(改制後)` → { rocYear: 90, city: 'New Taipei' }; undefined for any other label. */
export function parseRegionLabel(label: string): { rocYear: number; city: PolicyCity } | undefined {
  const m = /^(\d{2,3})年\/\s*(.+?)\s*$/.exec(label.trim());
  if (!m) return undefined;
  const name = (m[2] as string).replace(/\s+/g, '');
  let city: PolicyCity | undefined;
  if (name === '臺北市' || name === '台北市') city = 'Taipei';
  else if (name === '新北市' || name === '新北市(改制後)') city = 'New Taipei';
  return city === undefined ? undefined : { rocYear: Number(m[1]), city };
}

export function parseHouseTax6742(text: string, file: string): HouseTaxRow[] {
  const [rawHeader, ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const expected = ['地區別', '房屋稅'];
  const idx = expected.map((n) => header.indexOf(n));
  const missing = idx.findIndex((i) => i < 0);
  if (missing >= 0) {
    throw new ParseError(file, 1, expected, header, `missing required column ${expected[missing]}`);
  }
  const [labelCol, taxCol] = idx as [number, number];
  const out: HouseTaxRow[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const parsed = parseRegionLabel(r[labelCol] ?? '');
    if (!parsed) return;
    const year = parsed.rocYear + ROC_OFFSET;
    if (year < HOUSE_TAX_FIRST_YEAR || year > HOUSE_TAX_LAST_YEAR) return;
    const row = i + 2;
    const raw = (r[taxCol] ?? '').trim();
    const n = parseNumber(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new ParseError(file, row, ['房屋稅: non-negative number'], [`房屋稅: ${JSON.stringify(raw)}`], '房屋稅 is not a non-negative number');
    }
    const key = `${parsed.city}|${year}`;
    if (seen.has(key)) {
      throw new ParseError(file, row, ['one annual row per city and year'], [key], `duplicate row for ${parsed.city} ${year}`);
    }
    seen.add(key);
    out.push({ city: parsed.city, year, amountThousand: n });
  });
  for (const city of ['Taipei', 'New Taipei'] as const) {
    for (let y = HOUSE_TAX_FIRST_YEAR; y <= HOUSE_TAX_LAST_YEAR; y++) {
      if (!seen.has(`${city}|${y}`)) {
        throw new ParseError(file, undefined, [`annual row for ${city} ${y - ROC_OFFSET}年`], ['not found'], `no annual row for ${city} ${y}`);
      }
    }
  }
  return out;
}
