/**
 * Curated event table (data/config/events.json) and the expected rows (data/config/event-source-rows.json),
 * with the table-level checks of event-library Requirements 2.2 to 2.4, 3.1, 6.1 and 7.3.
 */
import { precisionOf } from '../../src/data/event-dates.ts';
import type { EventRole, EventType, SourceLink } from '../../src/types/events-file.ts';

export const TABLE_FILE = 'data/config/events.json';
export const ROWS_FILE = 'data/config/event-source-rows.json';

export type Verification =
  | { readonly kind: 'cbc-discount-rate'; readonly change: 'cut' | 'hike'; readonly rateAfter: number; readonly notesRateAfter?: number }
  | { readonly kind: 'notes-verified' }
  | {
      readonly kind: 'compared';
      readonly original: SourceLink;
      readonly comparedOn: string;
      readonly foundDate: string;
      readonly notesDate?: string;
      readonly dayUnknown?: boolean;
    }
  | { readonly kind: 'pending'; readonly against: string; readonly dayUnknown?: boolean };

export interface TableRow {
  readonly id: string;
  readonly date: string;
  readonly endDate?: string;
  readonly type: EventType;
  readonly title: string;
  readonly description: string;
  readonly role: EventRole;
  readonly sources: readonly SourceLink[];
  readonly verification: Verification;
}

export interface EventsTable {
  readonly schemaVersion: 1;
  readonly majorIds: readonly string[];
  readonly events: readonly TableRow[];
}

export interface SourceRow {
  readonly id: string;
  readonly section: '1a' | '1b' | '1c' | '1d' | '1e';
  readonly notesDate: string;
  readonly role: EventRole;
}

export interface SourceRowsFile {
  readonly schemaVersion: 1;
  readonly rows: readonly SourceRow[];
}

/** One table problem, named by card id (or `table`) and field. */
export interface TableIssue {
  readonly id: string;
  readonly field: string;
  readonly message: string;
}

/** Every table problem; an empty list means the table is consistent with the expected rows. */
export function checkTable(table: EventsTable, rows: SourceRowsFile): TableIssue[] {
  const issues: TableIssue[] = [];
  const add = (id: string, field: string, message: string): void => void issues.push({ id, field, message });

  const byId = new Map<string, TableRow>();
  for (const row of table.events) {
    if (byId.has(row.id)) add(row.id, 'id', 'duplicate id in the table');
    byId.set(row.id, row);
  }
  const expected = new Map(rows.rows.map((r) => [r.id, r]));
  for (const r of rows.rows) if (!byId.has(r.id)) add(r.id, 'id', `expected row from section ${r.section} is missing in the table`);
  for (const row of table.events) if (!expected.has(row.id)) add(row.id, 'id', 'not an expected row of the research notes');

  // Order within each section follows the rows file.
  for (const section of ['1a', '1b', '1c', '1d', '1e'] as const) {
    const want = rows.rows.filter((r) => r.section === section).map((r) => r.id);
    const ids = new Set(want);
    const got = table.events.filter((e) => ids.has(e.id)).map((e) => e.id);
    if (want.join(',') !== got.join(',')) add('table', 'order', `section ${section} order differs from ${ROWS_FILE}`);
  }

  for (const row of table.events) {
    const src = expected.get(row.id);
    if (src !== undefined) {
      if (row.role !== src.role) add(row.id, 'role', `role is "${row.role}", the expected row says "${src.role}"`);
      if (row.date !== src.notesDate) {
        const v = row.verification;
        if (v.kind !== 'compared' || v.foundDate !== row.date) {
          add(row.id, 'date', `date ${row.date} differs from the notes date ${src.notesDate} without a compared record that found it`);
        } else if (v.notesDate !== src.notesDate) {
          add(row.id, 'verification.notesDate', `a changed date must record the notes date ${src.notesDate}`);
        }
      }
    }
    const v = row.verification;
    if (v.kind === 'compared' && v.foundDate !== row.date) add(row.id, 'verification.foundDate', `found ${v.foundDate}, the card says ${row.date}`);
    const precision = precisionOf(row.date);
    if (precision === null) add(row.id, 'date', `"${row.date}" is not YYYY-MM-DD, YYYY-MM or YYYY`);
    if (precision !== null && precision !== 'day') {
      const flagged = (v.kind === 'compared' || v.kind === 'pending') && v.dayUnknown === true;
      if (!flagged) add(row.id, 'verification.dayUnknown', `a ${precision}-precision date needs dayUnknown: true`);
    }
    if (row.sources.length === 0) add(row.id, 'sources', 'at least one source is required');
  }

  for (const id of table.majorIds) if (!byId.has(id)) add(id, 'majorIds', 'major id has no card');
  if (new Set(table.majorIds).size !== table.majorIds.length) add('table', 'majorIds', 'duplicate major id');
  return issues;
}
