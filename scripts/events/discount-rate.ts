/**
 * Central Bank discount-rate file (data/raw/macro/cbc-webF1-discount-rate.csv, data.gov.tw dataset 6022)
 * and the check of a rate card against it (event-library Requirements 5.4, 5.5).
 *
 * Row 1 is a header in a legacy encoding, so it is skipped and columns are read by position:
 * date `YYYY/M/D` (no zero padding), discount rate, secured-loan rate, short-term rate.
 */
import { ParseError } from '../pipeline/errors.ts';
import type { TableRow } from './table.ts';

export const DISCOUNT_RATE_FILE = 'data/raw/macro/cbc-webF1-discount-rate.csv';

export interface RateRow {
  readonly date: string; // ISO YYYY-MM-DD
  readonly rate: number; // percent
}

export type RateCheck =
  | { readonly status: 'confirmed'; readonly fileRate: number; readonly previousRate: number }
  | { readonly status: 'no-row' }
  | { readonly status: 'mismatch'; readonly reason: string };

const DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

/** Parses the file and returns the rows sorted by date, oldest first. Throws ParseError on a malformed row. */
export function parseDiscountRateCsv(text: string): RateRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const rows: RateRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    if (line === '') continue;
    const cells = line.split(',').map((c) => c.trim());
    const m = DATE.exec(cells[0] ?? '');
    const rate = Number(cells[1]);
    if (m === null || cells[1] === undefined || cells[1] === '' || !Number.isFinite(rate)) {
      throw new ParseError(DISCOUNT_RATE_FILE, i + 1, ['YYYY/M/D', 'discount rate'], cells.slice(0, 2));
    }
    const date = `${m[1]}-${(m[2] as string).padStart(2, '0')}-${(m[3] as string).padStart(2, '0')}`;
    rows.push({ date, rate });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Compares a `cbc-discount-rate` row with the file: same date, same rate after, and the stated direction. */
export function checkRateCard(row: TableRow, rates: readonly RateRow[]): RateCheck {
  const v = row.verification;
  if (v.kind !== 'cbc-discount-rate') return { status: 'mismatch', reason: 'not a discount-rate card' };
  const i = rates.findIndex((r) => r.date === row.date);
  if (i < 0) return { status: 'no-row' };
  const hit = rates[i] as RateRow;
  if (hit.rate !== v.rateAfter) {
    return { status: 'mismatch', reason: `rate after is ${v.rateAfter}% in the table and ${hit.rate}% in the file` };
  }
  if (i === 0) return { status: 'mismatch', reason: 'no previous row in the file to check the direction' };
  const previousRate = (rates[i - 1] as RateRow).rate;
  const direction = previousRate > hit.rate ? 'cut' : previousRate < hit.rate ? 'hike' : 'unchanged';
  if (direction !== v.change) {
    return { status: 'mismatch', reason: `the table says ${v.change}, the file goes from ${previousRate}% to ${hit.rate}%` };
  }
  return { status: 'confirmed', fileRate: hit.rate, previousRate };
}
