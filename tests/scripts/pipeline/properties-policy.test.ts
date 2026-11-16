import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { quartersBetween, type Quarter } from '../../../scripts/lib/time.ts';
import type { SocialHousingDetail, SocialHousingProject } from '../../../scripts/pipeline/parsers/social-housing.ts';
import type { HouseTaxRow } from '../../../scripts/pipeline/parsers/house-tax.ts';
import type { SubleasePhaseRow } from '../../../scripts/pipeline/parsers/policy-tables.ts';
import type { E3010Row, PolicyCity, RentAmountRow } from '../../../scripts/pipeline/parsers/rent-subsidy.ts';
import {
  buildCommuterPassesSold,
  CUMULATIVE_DAYS,
  CUMULATIVE_PASSES,
} from '../../../scripts/pipeline/policy/commuter-pass.ts';
import { buildHouseTaxRevenue } from '../../../scripts/pipeline/policy/holding-tax.ts';
import { buildRentSubsidyAmount, buildRentSubsidyHouseholds } from '../../../scripts/pipeline/policy/rent-subsidy.ts';
import { buildSocialHousingStarts } from '../../../scripts/pipeline/policy/social-housing-starts.ts';
import { buildSubleaseUnits } from '../../../scripts/pipeline/policy/sublease.ts';
import { dayNumber, observed, type CityTrack } from '../../../scripts/pipeline/policy/track.ts';

const QUARTERS = quartersBetween();
const CITY_NAMES: PolicyCity[] = ['Taipei', 'New Taipei'];
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const NUM_RUNS = 100;

// Feature: data-pipeline, Property 17: Sublease phase spread conserves the counted totals
describe('Property 17: Sublease phase spread conserves the counted totals', () => {
  const FIRST_DAY = dayNumber('2015-01-01');
  const COUNT_END = dayNumber('2026-01-01');
  const iso = (day: number): string => new Date(day * 86_400_000).toISOString().slice(0, 10);

  const phasesArb = fc.record({
    offsets: fc.uniqueArray(fc.integer({ min: 0, max: 4500 }), { minLength: 1, maxLength: 5 }).map((a) => a.sort((x, y) => x - y)),
    totals: fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 5, maxLength: 5 }),
    publishedAfter: fc.integer({ min: 1, max: 900 }),
    channel: fc.constantFrom('city', 'central'),
    city: fc.constantFrom(...CITY_NAMES),
  });

  /**
   * **Validates: Requirements 12.8, 12.13**
   */
  it('gives non-negative integers, 0 before the first start, the rounded counted total, all estimated', () => {
    fc.assert(
      fc.property(phasesArb, ({ offsets, totals, publishedAfter, channel, city }) => {
        const starts = offsets.map((o) => FIRST_DAY + o);
        const asOf = iso(starts[starts.length - 1]! + publishedAfter);
        const other = CITY_NAMES.find((c) => c !== city)!;
        const mk = (c: PolicyCity, phase: number, start: number, total: number): SubleasePhaseRow => ({
          row: phase,
          city: c,
          channel,
          phase,
          startDate: iso(start),
          totalUnits: total,
          asOf,
          source: 'policy/moi-b5010',
          url: '',
        });
        const rows = [
          ...starts.map((s, i) => mk(city, i + 1, s, totals[i]!)),
          // the builder needs at least one row for every city
          mk(other, 1, starts[0]!, 0),
        ];
        const track = buildSubleaseUnits(rows, QUARTERS);
        const values = track[city].map((r) => r.value);

        for (const v of values) {
          expect(Number.isInteger(v) && v >= 0).toBe(true);
        }
        const firstQuarter = QUARTERS.findIndex((q) => {
          const y = Number(q.slice(0, 4));
          const m = Number(q.slice(5)) * 3;
          return dayNumber(`${y}-${String(m).padStart(2, '0')}-${m === 6 || m === 9 ? '30' : '31'}`) >= starts[0]!;
        });
        for (let k = 0; k < firstQuarter; k++) expect(values[k]).toBe(0);

        let expected = 0;
        starts.forEach((s, i) => {
          const end = i + 1 < starts.length ? starts[i + 1]! : dayNumber(asOf);
          const counted = Math.max(0, Math.min(end, COUNT_END) - s);
          expected += Math.round((totals[i]! * counted) / (end - s));
        });
        expect(sum(values)).toBe(expected);

        for (const r of [...track.Taipei, ...track['New Taipei']]) {
          expect(r.estimated).toBe(true);
          expect(r.estimated && r.method).toBe('sublease-phase-spread');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: data-pipeline, Property 31: Social housing starts bucketing, de-duplication and exclusion
describe('Property 31: Social housing starts bucketing, de-duplication and exclusion', () => {
  const quarters: Quarter[] = QUARTERS;
  type StartKind = 'valid' | 'empty' | 'unparseable';
  interface Spec {
    status: string;
    district: number;
    kind: StartKind;
    year: number;
    month: number;
    day: number;
    hasDetail: boolean;
    units: number;
  }
  const specArb = fc.record({
    status: fc.constantFrom('已完工', '興建中', '規劃中'),
    district: fc.integer({ min: 0, max: 40 }),
    kind: fc.constantFrom<StartKind>('valid', 'valid', 'valid', 'empty', 'unparseable'),
    year: fc.integer({ min: 2012, max: 2028 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hasDetail: fc.boolean(),
    units: fc.integer({ min: 0, max: 600 }),
  });

  const startOf = (s: Spec): string => {
    if (s.kind === 'empty') return '';
    if (s.kind === 'unparseable') return 'not-a-date';
    return `${String(s.year - 1911).padStart(3, '0')}/${String(s.month).padStart(2, '0')}/${String(s.day).padStart(2, '0')}`;
  };

  /**
   * **Validates: Requirements 12.4, 12.5**
   */
  it('buckets by start quarter, ignores duplicate guids, reports exclusions, never estimates', () => {
    fc.assert(
      fc.property(
        fc.array(specArb, { maxLength: 30 }),
        fc.array(fc.nat({ max: 29 }), { maxLength: 15 }),
        fc.integer({ min: 0, max: 600 }),
        (specs, dupIndexes, dupUnits) => {
          const projects: SocialHousingProject[] = specs.map((s, i) => ({
            guid: `G${i}`,
            status: s.status,
            householdNum: s.units,
            strStartDate: startOf(s),
            strEndDate: '',
            city: DISTRICTS[s.district]!.city,
            file: 'f.json',
          }));
          const details = new Map<string, SocialHousingDetail>();
          specs.forEach((s, i) => {
            if (s.hasDetail) details.set(`G${i}`, { guid: `G${i}`, cityCode: '', townCode: DISTRICTS[s.district]!.code });
          });

          const base = buildSocialHousingStarts(projects, details, DISTRICTS, quarters);

          // expected values from the statement
          const expected = new Map<string, number[]>(DISTRICTS.map((d) => [d.code, quarters.map(() => 0)]));
          let excluded = 0;
          for (const s of specs) {
            if (s.kind !== 'valid' || !s.hasDetail) {
              excluded++;
              continue;
            }
            const k = quarters.indexOf(`${s.year}Q${Math.ceil(s.month / 3)}` as Quarter);
            if (k >= 0) expected.get(DISTRICTS[s.district]!.code)![k]! += s.units;
          }
          for (const d of DISTRICTS) {
            expect(base.series[d.code]!.map((r) => r.value)).toEqual(expected.get(d.code));
            for (const r of base.series[d.code]!) expect(r.estimated).toBe(false);
          }
          expect(base.exclusions).toHaveLength(excluded);
          for (const e of base.exclusions) expect(e.reason.length).toBeGreaterThan(0);

          // duplicates (same guid, any other content) change nothing
          const dups = specs.length === 0 ? [] : dupIndexes.map((n) => ({ ...projects[n % specs.length]!, householdNum: dupUnits }));
          const withDups = buildSocialHousingStarts([...projects, ...dups], details, DISTRICTS, quarters);
          expect(withDups.series).toEqual(base.series);
          expect(withDups.exclusions).toEqual(base.exclusions);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 30000);
});

// Feature: data-pipeline, Property 32: Rent subsidy households and amount
describe('Property 32: Rent subsidy households and amount', () => {
  const tableArb = fc.array(
    fc.record({
      city: fc.constantFrom(...CITY_NAMES),
      quarter: fc.constantFrom(...QUARTERS),
      value: fc.integer({ min: 0, max: 100_000 }),
    }),
    { maxLength: 60 },
  );
  const toRows = (cells: { city: PolicyCity; quarter: Quarter; value: number }[]): E3010Row[] => {
    const seen = new Map<string, E3010Row>();
    for (const c of cells) seen.set(`${c.city}|${c.quarter}`, c);
    return [...seen.values()];
  };
  const amountArb = fc.record({
    hmTaipei: fc.integer({ min: 1, max: 200_000 }),
    hmNew: fc.integer({ min: 1, max: 200_000 }),
    perTaipei: fc.integer({ min: 1100, max: 9900 }),
    perNew: fc.integer({ min: 1100, max: 9900 }),
  });

  /**
   * **Validates: Requirements 12.6, 12.7**
   */
  it('sums the two tables, and carries the rounded 2023 average with the right method', () => {
    fc.assert(
      fc.property(tableArb, tableArb, amountArb, (a, b, amt) => {
        const ra = toRows(a);
        const rb = toRows(b);
        const hh = buildRentSubsidyHouseholds(ra, rb, QUARTERS);
        const get = (rows: E3010Row[], city: PolicyCity, q: Quarter): number =>
          rows.find((r) => r.city === city && r.quarter === q)?.value ?? 0;
        for (const city of CITY_NAMES) {
          QUARTERS.forEach((q, k) => {
            expect(hh[city][k]!.value).toBe(get(ra, city, q) + get(rb, city, q));
            expect(hh[city][k]!.estimated).toBe(false);
          });
        }

        const rows: RentAmountRow[] = [
          { city: 'Taipei', year: 2023, householdMonths: amt.hmTaipei, amountThousand: (amt.hmTaipei * amt.perTaipei) / 1000 },
          { city: 'New Taipei', year: 2023, householdMonths: amt.hmNew, amountThousand: (amt.hmNew * amt.perNew) / 1000 },
        ];
        const amount = buildRentSubsidyAmount(rows, QUARTERS);
        for (const [city, row] of [['Taipei', rows[0]!], ['New Taipei', rows[1]!]] as const) {
          const expected = Math.round((row.amountThousand * 1000) / row.householdMonths);
          QUARTERS.forEach((q, k) => {
            const r = amount[city][k]!;
            expect(r.value).toBe(expected);
            expect(r.estimated).toBe(true);
            expect(r.estimated && r.method).toBe(q.startsWith('2023') ? 'rent-amount-annual-average' : 'rent-amount-carry');
          });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 30000);
});

// Feature: data-pipeline, Property 33: House tax and commuter passes sold conserve their totals
describe('Property 33: House tax and commuter passes sold conserve their totals', () => {
  const taxArb = fc.array(fc.integer({ min: 0, max: 100_000_000 }), { minLength: 22, maxLength: 22 });

  /**
   * **Validates: Requirements 12.11**
   */
  it('splits each annual house tax total into four quarters that differ by at most 1', () => {
    fc.assert(
      fc.property(taxArb, (totals) => {
        const rows: HouseTaxRow[] = [];
        for (let y = 2015; y <= 2025; y++) {
          rows.push({ city: 'Taipei', year: y, amountThousand: totals[y - 2015]! });
          rows.push({ city: 'New Taipei', year: y, amountThousand: totals[11 + y - 2015]! });
        }
        const track = buildHouseTaxRevenue(rows, QUARTERS);
        for (const city of CITY_NAMES) {
          for (let y = 2015; y <= 2025; y++) {
            const quarterly = track[city].slice((y - 2015) * 4, (y - 2015) * 4 + 4).map((r) => r.value);
            for (const v of quarterly) expect(Number.isInteger(v) && v >= 0).toBe(true);
            expect(sum(quarterly)).toBe(rows.find((r) => r.city === city && r.year === y)!.amountThousand);
            expect(Math.max(...quarterly) - Math.min(...quarterly)).toBeLessThanOrEqual(1);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 30000);

  const populationArb = fc.array(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 44, maxLength: 44 });
  const priceArb = fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 3000 })), { minLength: 44, maxLength: 44 });

  /**
   * **Validates: Requirements 12.12**
   */
  it('apportions exactly 5,150,000 passes over 2018Q2..2019Q4 (October 2019 as the last day) and sells none at price 0', () => {
    const from = QUARTERS.indexOf('2018Q2');
    const to = QUARTERS.indexOf('2019Q4');
    const heldDays2019Q4 = 61; // 2019-11-01 .. 2019-12-31, held daily rate on top of the October part
    fc.assert(
      fc.property(populationArb, populationArb, priceArb, priceArb, (popT, popN, priceT, priceN) => {
        const pT = [...priceT];
        pT[from] = Math.max(pT[from]!, 1); // at least one active quarter in the window
        const mk = (prices: number[]): CityTrack['Taipei'] => prices.map((v) => observed(v, 'policy/trtc-products'));
        const price: CityTrack = { Taipei: mk(pT), 'New Taipei': mk(priceN) };
        const sold = buildCommuterPassesSold(price, { Taipei: popT, 'New Taipei': popN }, QUARTERS);

        const window: number[] = [];
        for (const city of CITY_NAMES) {
          sold[city].forEach((r, k) => {
            expect(Number.isInteger(r.value) && r.value >= 0).toBe(true);
            if (price[city][k]!.value === 0) expect(r.value).toBe(0);
            if (k >= from && k <= to) {
              // Exact part: the cell minus the held-rate Nov-Dec part (reference computation) in 2019Q4.
              const pop = city === 'Taipei' ? popT : popN;
              const heldRef = k === to && price[city][k]!.value > 0 ? Math.round(((CUMULATIVE_PASSES / CUMULATIVE_DAYS) * heldDays2019Q4 * pop[k]!) / (popT[k]! + popN[k]!)) : 0;
              window.push(r.value - heldRef);
            }
          });
        }
        expect(sum(window)).toBe(CUMULATIVE_PASSES);
      }),
      { numRuns: NUM_RUNS },
    );
  }, 30000);
});
