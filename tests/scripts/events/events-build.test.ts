import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dateToQuarter, daysInMonth, isValidDate, precisionOf } from '../../../src/data/event-dates.ts';
import { validateEventsFile } from '../../../src/data/validate-events.ts';
import type { EventCard } from '../../../src/types/events-file.ts';
import { buildEvents, runEventBuild, type ReadText } from '../../../scripts/events/build.ts';
import { deriveCard } from '../../../scripts/events/derive.ts';
import { checkRateCard, parseDiscountRateCsv } from '../../../scripts/events/discount-rate.ts';
import { checkTable, type EventsTable, type SourceRowsFile, type TableRow } from '../../../scripts/events/table.ts';
import { checkCardText } from '../../../scripts/events/text-checks.ts';
import type { WriteFs } from '../../../scripts/pipeline/write.ts';

const CSV = ['legacy header', '2022/3/18,1.5,1.875,3.75', '2020/3/20,1.125,1.5,3.375', '2016/7/1,1.375,1.75,3.625'].join('\n');
const rates = parseDiscountRateCsv(CSV);
const SRC = { label: 'Agency page', publisher: 'Agency', url: 'https://example.gov.tw/a' };

function row(over: Partial<TableRow> = {}): TableRow {
  return {
    id: 'rate-cut-2020-03-20',
    date: '2020-03-20',
    type: 'interest-rate',
    title: 'Central Bank lowers the discount rate',
    description: 'On 20 March 2020 the Central Bank lowered its discount rate.',
    zh: { title: '中央銀行調降重貼現率', description: '2020 年 3 月 20 日，中央銀行調降重貼現率。' },
    role: 'narrative',
    sources: [SRC],
    verification: { kind: 'cbc-discount-rate', change: 'cut', rateAfter: 1.125 },
    ...over,
  };
}

const ctx = { rates, majorIds: new Set(['rate-cut-2020-03-20']) };

describe('event dates', () => {
  it('reads precision and quarter, with calendar checks', () => {
    expect(precisionOf('2020-01-21')).toBe('day');
    expect(precisionOf('2024-08')).toBe('month');
    expect(precisionOf('2017')).toBe('year');
    expect(precisionOf('2017-1')).toBeNull();
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2023-02-29')).toBe(false);
    expect(isValidDate('2023-13')).toBe(false);
    expect(dateToQuarter('2017')).toBe('2017Q1');
    expect(dateToQuarter('2024-08')).toBe('2024Q3');
    expect(dateToQuarter('2020-12-31')).toBe('2020Q4');
  });

  it('Property 2: the quarter is ceil(month / 3) for every valid day 2015 to 2025', () => {
    // Feature: event-library, Property 2: Quarter consistency
    const arbDay = fc
      .record({ y: fc.integer({ min: 2015, max: 2025 }), m: fc.integer({ min: 1, max: 12 }), d: fc.integer({ min: 1, max: 31 }) })
      .filter(({ y, m, d }) => d <= daysInMonth(y, m))
      .map(({ y, m, d }) => ({ m, date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }));
    fc.assert(
      fc.property(arbDay, arbDay, (a, b) => {
        expect(dateToQuarter(a.date)).toBe(`${a.date.slice(0, 4)}Q${Math.ceil(a.m / 3)}`);
        const [start, end] = a.date <= b.date ? [a.date, b.date] : [b.date, a.date];
        expect(dateToQuarter(end) >= dateToQuarter(start)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe('discount-rate file', () => {
  it('skips the header, pads dates and sorts ascending', () => {
    expect(rates.map((r) => r.date)).toEqual(['2016-07-01', '2020-03-20', '2022-03-18']);
    expect(() => parseDiscountRateCsv('h\n2020/3/x,1')).toThrow();
  });

  it('confirms, reports no row, and rejects a wrong rate, a wrong direction or the first row', () => {
    expect(checkRateCard(row(), rates).status).toBe('confirmed');
    expect(checkRateCard(row({ date: '2020-03-19' }), rates).status).toBe('no-row');
    expect(checkRateCard(row({ verification: { kind: 'cbc-discount-rate', change: 'cut', rateAfter: 1.25 } }), rates).status).toBe('mismatch');
    expect(checkRateCard(row({ verification: { kind: 'cbc-discount-rate', change: 'hike', rateAfter: 1.125 } }), rates).status).toBe('mismatch');
    expect(checkRateCard(row({ date: '2016-07-01', verification: { kind: 'cbc-discount-rate', change: 'cut', rateAfter: 1.375 } }), rates).status).toBe('mismatch');
  });
});

describe('derivation', () => {
  it('sets verified and the note from the evidence only', () => {
    const rate = deriveCard(row({ verification: { kind: 'cbc-discount-rate', change: 'cut', rateAfter: 1.125, notesRateAfter: 1.25 } }), ctx);
    expect(rate.verified).toBe(true);
    expect(rate.major).toBe(true);
    expect(rate.verificationNote).toContain('The research notes give 1.25%');
    expect(deriveCard(row({ date: '2020-03-19' }), ctx).verified).toBe(false);
    expect(() => deriveCard(row({ verification: { kind: 'cbc-discount-rate', change: 'hike', rateAfter: 1.125 } }), ctx)).toThrow();

    const month = deriveCard(
      row({ id: 'm', date: '2024-08', verification: { kind: 'compared', original: SRC, comparedOn: '2026-11-17', foundDate: '2024-08', dayUnknown: true } }),
      ctx,
    );
    expect(month).toMatchObject({ verified: true, datePrecision: 'month', firstQuarter: '2024Q3', major: false });
    expect(month.verificationNote).toContain('The day is not known.');

    const pending = deriveCard(row({ id: 'p', verification: { kind: 'pending', against: 'the agency page' } }), ctx);
    expect(pending.verified).toBe(false);
    const ended = deriveCard(row({ id: 'e', endDate: '2021-07-27', date: '2021-05-19', verification: { kind: 'notes-verified' } }), ctx);
    expect([ended.firstQuarter, ended.lastQuarter]).toEqual(['2021Q2', '2021Q3']);
  });

  it('Property 3: verified implies evidence and a note', () => {
    // Feature: event-library, Property 3: Verified implies evidence
    const arbVerification = fc.oneof(
      fc.record({ kind: fc.constant('notes-verified' as const) }),
      fc.record({ kind: fc.constant('pending' as const), against: fc.constant('x') }),
      fc.record({
        kind: fc.constant('compared' as const),
        original: fc.constant(SRC),
        comparedOn: fc.constant('2026-11-17'),
        foundDate: fc.constantFrom('2020-03-20', '2020-03-21'),
      }),
    );
    fc.assert(
      fc.property(arbVerification, (verification) => {
        const card = deriveCard(row({ verification }), ctx);
        const evidence =
          verification.kind === 'notes-verified' || (verification.kind === 'compared' && verification.foundDate === '2020-03-20');
        expect(card.verified).toBe(evidence);
        if (card.verified) expect(card.verificationNote.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('table checks', () => {
  const rowsFile: SourceRowsFile = { schemaVersion: 1, rows: [{ id: 'rate-cut-2020-03-20', section: '1a', notesDate: '2020-03-20', role: 'narrative' }] };
  const table = (events: TableRow[], majorIds: string[] = []): EventsTable => ({ schemaVersion: 1, majorIds, events });

  it('accepts a consistent table', () => {
    expect(checkTable(table([row()]), rowsFile)).toEqual([]);
  });

  it('reports each rule', () => {
    const fields = (t: EventsTable): string[] => checkTable(t, rowsFile).map((i) => i.field);
    expect(fields(table([row(), row()]))).toContain('id');
    expect(fields(table([]))).toContain('id');
    expect(fields(table([row({ role: 'baseline' })]))).toContain('role');
    expect(fields(table([row({ date: '2020-03-21' })]))).toContain('date');
    expect(fields(table([row()], ['nope']))).toContain('majorIds');
    expect(fields(table([row({ sources: [] })]))).toContain('sources');
    const monthRows: SourceRowsFile = { schemaVersion: 1, rows: [{ id: 'm', section: '1a', notesDate: '2024-08', role: 'narrative' }] };
    expect(checkTable(table([row({ id: 'm', date: '2024-08', verification: { kind: 'notes-verified' } })]), monthRows).map((i) => i.field)).toContain(
      'verification.dayUnknown',
    );
  });
});

describe('text checks', () => {
  const terms = ['crash', '國民黨'];
  it('rejects length, non-English characters and banned terms, and honours exempt phrases', () => {
    expect(checkCardText({ title: 'Rail line opens', description: 'The line opened.' }, terms, [])).toEqual([]);
    expect(checkCardText({ title: 'x'.repeat(81), description: 'ok' }, terms, []).length).toBe(1);
    expect(checkCardText({ title: 'Line 捷運', description: 'ok' }, terms, []).length).toBe(1);
    expect(checkCardText({ title: 'Market crash', description: 'ok' }, terms, []).length).toBe(1);
    expect(checkCardText({ title: 'Crash barrier tests', description: 'ok' }, terms, ['crash barrier'])).toEqual([]);
  });
});

describe('output validator', () => {
  const good: EventCard = deriveCard(row(), ctx);
  const file = (events: unknown[]): unknown => ({ schemaVersion: 1, events });

  it('accepts a valid card', () => {
    expect(validateEventsFile(file([good]))).toEqual([]);
  });

  it('Property 1: any extra key on a card is rejected', () => {
    // Feature: event-library, Property 1: No effect fields
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom('modifier', 'magnitude', 'impact', 'affectedIndicators'), fc.string({ minLength: 1, maxLength: 12 })).filter(
          (k) => !(k in good) && k !== '__proto__',
        ),
        (key) => {
          const errors = validateEventsFile(file([{ ...good, [key]: 1 }]));
          expect(errors.some((e) => e.rule === 'keys')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reports wrong quarter, http URL, duplicate id, order and the day-unknown note', () => {
    const rules = (events: unknown[]): string[] => validateEventsFile(file(events)).map((e) => e.rule);
    expect(rules([{ ...good, firstQuarter: '2020Q2' }])).toContain('quarter');
    expect(rules([{ ...good, sources: [{ ...SRC, url: 'http://example.gov.tw' }] }])).toContain('sources');
    expect(rules([good, good])).toContain('id');
    expect(rules([{ ...good, id: 'b', date: '2021-01-01', firstQuarter: '2021Q1', lastQuarter: '2021Q1' }, { ...good, id: 'a' }])).toContain('order');
    expect(rules([{ ...good, date: '2020-03', datePrecision: 'month' }])).toContain('verification');
    expect(rules([{ ...good, date: '2014-12-31', firstQuarter: '2015Q1' }])).toContain('date');
  });
});

describe('build', () => {
  const repo = (over: Record<string, string | undefined> = {}): ReadText => {
    const files: Record<string, string | undefined> = {
      'data/config/events.json': JSON.stringify({ schemaVersion: 1, majorIds: ['rate-cut-2020-03-20'], events: [row()] }),
      'data/config/event-source-rows.json': JSON.stringify({
        schemaVersion: 1,
        rows: [{ id: 'rate-cut-2020-03-20', section: '1a', notesDate: '2020-03-20', role: 'narrative' }],
      }),
      'data/raw/macro/cbc-webF1-discount-rate.csv': CSV,
      'data/config/banned-terms.txt': 'crash\n',
      'data/config/event-banned-terms.txt': 'surge\n',
      'data/config/banned-terms-exempt.txt': '',
      ...over,
    };
    return (p) => files[p];
  };

  function memoryFs(): WriteFs & { writes: string[] } {
    const store = new Map<string, Uint8Array>();
    const writes: string[] = [];
    return {
      writes,
      exists: (f) => store.has(f),
      readBytes: (f) => store.get(f) as Uint8Array,
      writeFile: (f, b) => void (writes.push(f), store.set(f, b)),
      rename: (from, to) => void (store.set(to, store.get(from) as Uint8Array), store.delete(from)),
      remove: (f) => void store.delete(f),
      mkdirp: () => undefined,
    };
  }

  it('Property 4: two builds give byte-identical output and write both files once', () => {
    // Feature: event-library, Property 4: Deterministic build
    const a = buildEvents(repo());
    const b = buildEvents(repo());
    expect(a.ok).toBe(true);
    expect(a.files).toEqual(b.files);
    const fsImpl = memoryFs();
    runEventBuild(repo(), fsImpl, '/r');
    expect(fsImpl.writes.length).toBe(2);
  });

  it('writes nothing on any error', () => {
    for (const over of [
      { 'data/raw/macro/cbc-webF1-discount-rate.csv': undefined },
      { 'data/config/events.json': '{' },
      { 'data/config/event-banned-terms.txt': 'lowers\n' },
    ]) {
      const fsImpl = memoryFs();
      const result = runEventBuild(repo(over), fsImpl, '/r');
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(fsImpl.writes).toEqual([]);
    }
  });
});
