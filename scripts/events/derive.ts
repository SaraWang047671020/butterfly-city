/**
 * Table row -> EventCard (event-library Requirements 1.6, 1.10, 5.1 to 5.3, 5.5, 7.1, 7.2).
 * `verified` and `verificationNote` come only from the evidence in the row, through fixed templates.
 */
import { dateToQuarter, precisionOf } from '../../src/data/event-dates.ts';
import { DAY_UNKNOWN_TEXT, type EventCard } from '../../src/types/events-file.ts';
import { checkRateCard, type RateRow } from './discount-rate.ts';
import type { TableRow } from './table.ts';

export class RateMismatchError extends Error {
  readonly id: string;
  constructor(id: string, date: string, reason: string) {
    super(`${id}: discount-rate check failed for ${date}: ${reason}`);
    this.name = 'RateMismatchError';
    this.id = id;
  }
}

export interface DeriveContext {
  readonly rates: readonly RateRow[];
  readonly majorIds: ReadonlySet<string>;
}

function evidence(row: TableRow, rates: readonly RateRow[]): { verified: boolean; note: string } {
  const v = row.verification;
  switch (v.kind) {
    case 'cbc-discount-rate': {
      const check = checkRateCard(row, rates);
      if (check.status === 'mismatch') throw new RateMismatchError(row.id, row.date, check.reason);
      if (check.status === 'no-row') {
        return { verified: false, note: 'No row for this date in the Central Bank discount-rate file; to be compared.' };
      }
      let note = `Compared with the Central Bank discount-rate file cbc-webF1-discount-rate.csv (data.gov.tw dataset 6022): same date, rate ${check.fileRate}%.`;
      if (v.notesRateAfter !== undefined) note += ` The research notes give ${v.notesRateAfter}%; the file value is used.`;
      return { verified: true, note };
    }
    case 'notes-verified':
      return { verified: true, note: 'The research notes mark this row verified with the linked sources.' };
    case 'compared': {
      let note = `Compared with ${v.original.label} (${v.original.url}) on ${v.comparedOn}: date matches.`;
      if (v.notesDate !== undefined && v.notesDate !== row.date) note += ` The research notes gave ${v.notesDate}.`;
      if (v.dayUnknown === true) note += ` ${DAY_UNKNOWN_TEXT}`;
      return { verified: v.foundDate === row.date, note };
    }
    case 'pending': {
      let note = `Not yet compared. To check against: ${v.against}.`;
      if (v.dayUnknown === true) note += ` ${DAY_UNKNOWN_TEXT}`;
      return { verified: false, note };
    }
  }
}

export function deriveCard(row: TableRow, ctx: DeriveContext): EventCard {
  const precision = precisionOf(row.date);
  if (precision === null) throw new RangeError(`${row.id}: invalid date ${row.date}`);
  const { verified, note } = evidence(row, ctx.rates);
  const firstQuarter = dateToQuarter(row.date);
  return {
    id: row.id,
    date: row.date,
    datePrecision: precision,
    firstQuarter,
    lastQuarter: row.endDate !== undefined ? dateToQuarter(row.endDate) : firstQuarter,
    type: row.type,
    title: row.title,
    description: row.description,
    zh: { title: row.zh.title, description: row.zh.description },
    role: row.role,
    major: ctx.majorIds.has(row.id),
    verified,
    verificationNote: note,
    sources: row.sources.map((s) => ({ label: s.label, publisher: s.publisher, url: s.url })),
  };
}

/** Cards sorted by date, then id (plain string comparison). */
export function sortCards(cards: readonly EventCard[]): EventCard[] {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return [...cards].sort((a, b) => cmp(a.date, b.date) || cmp(a.id, b.id));
}
