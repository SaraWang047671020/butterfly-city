import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { quartersBetween, type Quarter } from '../../../scripts/lib/time.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import {
  lookupEffective,
  parseCommuterPassProducts,
  parseHoldingTaxRates,
} from '../../../scripts/pipeline/parsers/policy-tables.ts';
import { buildHoldingTaxRates } from '../../../scripts/pipeline/policy/holding-tax.ts';
import { buildCommuterPassPrice } from '../../../scripts/pipeline/policy/commuter-pass.ts';

const quarters = quartersBetween();
const quarterArb = fc.constantFrom(...quarters);
const CITIES = ['Taipei', 'New Taipei'] as const;
type City = (typeof CITIES)[number];

const DAY_MS = 86_400_000;
const iso = (dayNumber: number): string => new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
/** Day number of 2013-01-01 (days since 1970-01-01). */
const BASE = Date.UTC(2013, 0, 1) / DAY_MS;

/** Independent last day of a quarter: day 0 of the next quarter's first month. */
function lastDay(q: Quarter): string {
  const year = Number(q.slice(0, 4));
  const n = Number(q.slice(5));
  return new Date(Date.UTC(year, n * 3, 0)).toISOString().slice(0, 10);
}

/** 1..6 strictly increasing ISO dates between 2013 and 2026. */
const datesArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 4800 }), { minLength: 1, maxLength: 6 })
  .map((xs) => [...xs].sort((a, b) => a - b).map((d) => iso(BASE + d)));

const pricesArb = fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 6, maxLength: 6 });

interface Line {
  readonly city: City;
  readonly date: string;
  readonly price: number;
}

function commuterCsv(lines: readonly Line[], mutate?: (cells: string[], i: number) => void): string {
  const out = ['city,product,start_date,price_twd,source,url'];
  lines.forEach((l, i) => {
    const cells = [l.city, 'pass', l.date, String(l.price), 'policy/trtc-products', ''];
    mutate?.(cells, i);
    out.push(cells.join(','));
  });
  return out.join('\n');
}

const commuterLinesArb = fc
  .tuple(datesArb, datesArb, pricesArb, pricesArb)
  .map(([a, b, pa, pb]): Line[] => [
    ...a.map((date, i) => ({ city: 'Taipei' as const, date, price: pa[i]! })),
    ...b.map((date, i) => ({ city: 'New Taipei' as const, date, price: pb[i]! })),
  ]);

describe('effective-dated lookup properties', () => {
  // Feature: data-pipeline, Property 16: Effective-dated lookup
  it('Property 16: commuter pass price is the latest product on or before the quarter end, 0 before the first', () => {
    // **Validates: Requirements 12.12, 12.13, 12.15**
    fc.assert(
      fc.property(commuterLinesArb, (lines) => {
        const rows = parseCommuterPassProducts(commuterCsv(lines), 'data/config/commuter-pass-products.csv');
        const track = buildCommuterPassPrice(rows, quarters);
        for (const city of CITIES) {
          quarters.forEach((q, k) => {
            const inForce = lines.filter((l) => l.city === city && l.date <= lastDay(q));
            const record = track[city][k]!;
            if (inForce.length === 0) {
              expect(record.value).toBe(0);
              expect(record.estimated).toBe(false);
            } else {
              const expected = inForce[inForce.length - 1]!; // dates increase within a city
              expect(record.value).toBe(expected.price);
              expect(record.estimated).toBe(false);
              expect(record.source).toBe('policy/trtc-products');
            }
          });
        }
        // the plain lookup agrees for any quarter
        const q = quarters[quarters.length - 1]!;
        const found = lookupEffective(rows, 'Taipei', lastDay(q));
        const last = lines.filter((l) => l.city === 'Taipei' && l.date <= lastDay(q)).pop();
        expect(found?.priceTwd).toBe(last?.price);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: data-pipeline, Property 16: Effective-dated lookup
  it('Property 16: holding tax rate is the latest city row, or the statutory lower limit estimated, for New Taipei before its first row', () => {
    // **Validates: Requirements 12.9, 12.10, 12.15**
    const rateArb = fc.tuple(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 40 }));
    const seriesArb = (n: number) => fc.array(rateArb, { minLength: n, maxLength: n });
    const datesAfterArb = fc
      .uniqueArray(fc.integer({ min: 1, max: 4000 }), { minLength: 0, maxLength: 4 })
      .map((xs) => [...xs].sort((a, b) => a - b));
    fc.assert(
      fc.property(
        datesArb,
        datesArb,
        datesAfterArb,
        seriesArb(6),
        seriesArb(6),
        seriesArb(5),
        (taipeiDates, ntDates, statExtra, taipeiRates, ntRates, statRates) => {
          // the statutory table starts before 2015Q1, so some row is always in force
          const statDates = ['2012-06-06', ...statExtra.map((d) => iso(BASE + d))];
          const header = 'city,effective_date,lowest_rate,highest_rate,legal_text,article_or_version,source,url';
          interface Rate {
            city: string;
            date: string;
            low: number;
            high: number;
            source: string;
          }
          const mk = (city: string, dates: string[], rates: [number, number][], source: string): Rate[] =>
            dates.map((date, i) => ({ city, date, low: rates[i]![0] / 10, high: (rates[i]![0] + rates[i]![1]) / 10, source }));
          const all = [
            ...mk('statutory', statDates, statRates, 'policy/house-tax-act'),
            ...mk('Taipei', taipeiDates, taipeiRates, 'policy/taipei-ordinance'),
            ...mk('New Taipei', ntDates, ntRates, 'policy/ntpc-ordinance'),
          ];
          const csv = [header, ...all.map((r) => [r.city, r.date, r.low, r.high, 'text', 'Art.', r.source, ''].join(','))].join('\n');
          const rows = parseHoldingTaxRates(csv, 'data/config/holding-tax-rates.csv');
          const { lowest, highest } = buildHoldingTaxRates(rows, quarters);
          for (const city of CITIES) {
            quarters.forEach((q, k) => {
              const day = lastDay(q);
              const own = all.filter((r) => r.city === city && r.date <= day).pop();
              for (const [track, pick] of [
                [lowest, (r: Rate) => r.low],
                [highest, (r: Rate) => r.high],
              ] as const) {
                const record = track[city][k]!;
                if (own !== undefined) {
                  expect(record).toEqual({ value: pick(own), source: own.source, estimated: false });
                } else {
                  const stat = all.filter((r) => r.city === 'statutory' && r.date <= day).pop()!;
                  // both tiers fall back to the lower limit of the statutory range
                  expect(record).toEqual({
                    value: stat.low,
                    source: stat.source,
                    estimated: true,
                    method: 'holding-tax-statutory-minimum',
                  });
                }
              }
            });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: data-pipeline, Property 16: Effective-dated lookup
  it('Property 16: a date not later than the previous row, a non-positive value or an empty source stops the build with table path and row number', () => {
    // **Validates: Requirements 12.15**
    const file = 'data/config/commuter-pass-products.csv';
    const badArb = fc.constantFrom('date', 'zero', 'negative', 'source');
    fc.assert(
      fc.property(
        datesArb.filter((d) => d.length >= 2),
        pricesArb,
        badArb,
        fc.nat(),
        fc.boolean(),
        (dates, prices, bad, pickIndex, repeat) => {
          const lines: Line[] = dates.map((date, i) => ({ city: 'Taipei', date, price: prices[i]! }));
          // a date check needs a previous row, so it targets index >= 1
          const target = bad === 'date' ? 1 + (pickIndex % (lines.length - 1)) : pickIndex % lines.length;
          const csv = commuterCsv(lines, (cells, i) => {
            if (i !== target) return;
            if (bad === 'date') cells[2] = repeat ? lines[i - 1]!.date : iso(BASE - 1 - i);
            if (bad === 'zero') cells[3] = '0';
            if (bad === 'negative') cells[3] = '-5';
            if (bad === 'source') cells[4] = '';
          });
          let caught: unknown;
          try {
            parseCommuterPassProducts(csv, file);
          } catch (e) {
            caught = e;
          }
          expect(caught).toBeInstanceOf(DataError);
          const message = (caught as DataError).message;
          expect(message).toContain(file);
          expect(message).toContain(`row ${target + 2}`); // header is row 1
        },
      ),
      { numRuns: 100 },
    );

    // the holding tax table applies the same checks
    const header = 'city,effective_date,lowest_rate,highest_rate,legal_text,article_or_version,source,url';
    const holdingFile = 'data/config/holding-tax-rates.csv';
    const cases: [string, string[]][] = [
      ['same date', ['New Taipei,2017-07-01,2.4,2.4,t,A,s,', 'New Taipei,2017-07-01,2.5,2.5,t,A,s,']],
      ['zero rate', ['New Taipei,2017-07-01,0,2.4,t,A,s,']],
      ['empty source', ['New Taipei,2017-07-01,2.4,2.4,t,A,,']],
    ];
    for (const [, body] of cases) {
      const text = [header, ...body].join('\n');
      expect(() => parseHoldingTaxRates(text, holdingFile)).toThrow(DataError);
      expect(() => parseHoldingTaxRates(text, holdingFile)).toThrow(new RegExp(`${holdingFile} row ${body.length + 1}`));
    }
  });
});
