// Date helpers for event cards (event-library Requirements 1.4, 1.5, 1.11). Hand-parsed, no Date objects,
// so there is no time-zone behaviour. Shared by the event builder (scripts/events/) and validateEventsFile.

import type { QuarterKey } from '../types/data-files.ts';
import type { DatePrecision } from '../types/events-file.ts';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const YEAR = /^(\d{4})$/;

/** Precision from the date format, or null when the string matches none of YYYY-MM-DD, YYYY-MM, YYYY. */
export function precisionOf(date: string): DatePrecision | null {
  if (DAY.test(date)) return 'day';
  if (MONTH.test(date)) return 'month';
  if (YEAR.test(date)) return 'year';
  return null;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Year, month (1 for year precision) and day (1 unless day precision); null when the date is not a calendar date. */
function partsOf(date: string): { y: number; m: number; d: number } | null {
  let m = DAY.exec(date);
  if (m !== null) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y, m: mo, d };
  }
  m = MONTH.exec(date);
  if (m !== null) {
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? { y: Number(m[1]), m: mo, d: 1 } : null;
  }
  m = YEAR.exec(date);
  return m !== null ? { y: Number(m[1]), m: 1, d: 1 } : null;
}

/** True for a well-formed calendar date in one of the three precisions. */
export function isValidDate(date: string): boolean {
  return partsOf(date) !== null;
}

/** Quarter of a date; a year-precision date uses month 1. Throws RangeError for an invalid date. */
export function dateToQuarter(date: string): QuarterKey {
  const p = partsOf(date);
  if (p === null) throw new RangeError(`Invalid event date: ${date}`);
  return `${p.y}Q${Math.ceil(p.m / 3) as 1 | 2 | 3 | 4}`;
}
