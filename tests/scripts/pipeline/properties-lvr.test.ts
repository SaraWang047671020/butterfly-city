import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { quartersBetween, type Quarter } from '../../../scripts/lib/time.ts';
import { buildPriceToIncome } from '../../../scripts/pipeline/indicators/price-to-income.ts';
import { buildSalePrice } from '../../../scripts/pipeline/indicators/sale-price.ts';
import {
  dedupeById,
  EXCLUSION_REASONS,
  filterLvr,
  formatExclusions,
  parseLvrCsv,
  qualifyRental,
  qualifySale,
  type ExclusionReason,
  type LvrKind,
  type LvrRecord,
} from '../../../scripts/pipeline/parsers/lvr.ts';

const quarters = quartersBetween();
const NUM_RUNS = 100;

/** Median written independently of scripts/pipeline/numeric.ts. */
function refMedian(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
}

function sale(code: string, quarter: Quarter, unitPrice: number, totalPrice = unitPrice * 50, id = ''): LvrRecord {
  return {
    id,
    kind: 'sale',
    districtCode: code,
    quarter,
    target: '房地(土地+建物)',
    use: '住家用',
    unitPrice,
    totalPrice,
    rent: 0,
    area: 50,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Property 8
// ---------------------------------------------------------------------------------------------------------------

const TARGETS = ['房地(土地+建物)', '房地(土地+建物)+車位', '建物', '土地', '車位', '', '房地'];
const USES = ['住家用', '住宅', '住商用', '住家用/商業用', '商業用', '工業用', '', '見其他登記事項'];
const amountArb = fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 1_000_000 }));

const anyRecordArb: fc.Arbitrary<LvrRecord> = fc.record({
  id: fc.constant(''),
  kind: fc.constantFrom<LvrKind>('sale', 'rental'),
  districtCode: fc.option(fc.constantFrom(...DISTRICTS.map((d) => d.code)), { nil: undefined }),
  quarter: fc.option(
    fc
      .tuple(fc.integer({ min: 2012, max: 2028 }), fc.constantFrom(1, 2, 3, 4))
      .map(([y, q]) => `${y}Q${q}` as Quarter),
    { nil: undefined },
  ),
  target: fc.constantFrom(...TARGETS),
  use: fc.constantFrom(...USES),
  unitPrice: amountArb,
  totalPrice: amountArb,
  rent: amountArb,
  area: amountArb,
});

/** Independent oracle of the filter table: reasons are tested in the documented order. */
function oracleReason(r: LvrRecord): Exclude<ExclusionReason, 'duplicate'> | undefined {
  const checks: ReadonlyArray<[Exclude<ExclusionReason, 'duplicate'>, boolean]> = [
    ['invalid-date', r.quarter === undefined],
    ['out-of-range', r.quarter !== undefined && (Number(r.quarter.slice(0, 4)) < 2015 || Number(r.quarter.slice(0, 4)) > 2025)],
    ['unknown-district', r.districtCode === undefined],
    ['non-residential', !/住家用|住宅/.test(r.use)],
    ['non-building', r.kind === 'sale' && !['房地(土地+建物)', '房地(土地+建物)+車位', '建物'].includes(r.target)],
    ['zero-value', r.kind === 'sale' ? r.unitPrice <= 0 : r.rent <= 0 || r.area <= 0],
  ];
  return checks.find(([, hit]) => hit)?.[0];
}

describe('Property 8: filters match their definitions and exclusions are counted', () => {
  // Feature: data-pipeline, Property 8: Sale and rental filters match their definitions and exclusions are counted
  // **Validates: Requirements 8.2, 8.5, 9.1**
  it('qualifies exactly the records the oracle accepts, and exclusion counts sum to the rest', () => {
    fc.assert(
      fc.property(fc.array(anyRecordArb, { maxLength: 80 }), fc.integer({ min: 0, max: 20 }), (records, duplicates) => {
        const expectedQualifying = records.filter((r) => oracleReason(r) === undefined);
        const { qualifying, exclusions } = filterLvr(records, duplicates);
        expect(qualifying).toEqual(expectedQualifying);

        for (const r of records) {
          expect(qualifySale(r) || qualifyRental(r)).toBe(oracleReason(r) === undefined);
          expect(qualifySale(r)).toBe(r.kind === 'sale' && oracleReason(r) === undefined);
        }

        const expectedCounts = new Map<string, number>();
        for (const r of records) {
          const reason = oracleReason(r);
          if (reason !== undefined) expectedCounts.set(reason, (expectedCounts.get(reason) ?? 0) + 1);
        }
        for (const reason of EXCLUSION_REASONS) {
          expect(exclusions[reason]).toBe(reason === 'duplicate' ? duplicates : (expectedCounts.get(reason) ?? 0));
        }

        const nonQualifying = records.length - expectedQualifying.length;
        const printed = formatExclusions(exclusions).map((line) => Number(line.split(': ')[1]));
        expect(printed.reduce((a, b) => a + b, 0)).toBe(nonQualifying + duplicates);
        expect(printed).toHaveLength(EXCLUSION_REASONS.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------------------------------------------

const SALE_HEADER = ['鄉鎮市區', '交易標的', '交易年月日', '建物移轉總面積平方公尺', '主要用途', '總價元', '單價元平方公尺', '編號'];
const SEASONS = 6;

interface Spec {
  readonly id: string;
  readonly districtIndex: number; // index into DISTRICTS
  readonly quarterIndex: number;
  readonly unitPrice: number;
}

function dateOf(quarterIndex: number): string {
  const year = 2015 + Math.floor(quarterIndex / 4);
  const month = (quarterIndex % 4) * 3 + 1;
  return `${String(year - 1911).padStart(3, '0')}${String(month).padStart(2, '0')}15`;
}

/** One season file for one city: both header rows and one row per spec. */
function fileText(specs: readonly Spec[]): string {
  const rows = specs.map((s) => {
    const d = DISTRICTS[s.districtIndex] as (typeof DISTRICTS)[number];
    return [
      d.zh.replace(/^(臺北市|新北市)/, ''),
      '房地(土地+建物)',
      dateOf(s.quarterIndex),
      '50',
      '住家用',
      String(s.unitPrice * 50),
      String(s.unitPrice),
      s.id,
    ].join(',');
  });
  return [SALE_HEADER.join(','), SALE_HEADER.map((_, i) => `en${i}`).join(','), ...rows].join('\n') + '\n';
}

interface Placed {
  readonly spec: Spec;
  readonly season: number;
  readonly copySeason: number | undefined;
}

/** 1-3 distinct districts, each with >= 1 sale; every sale is placed in a season file and may be copied to another. */
const scenarioArb = fc
  .uniqueArray(fc.integer({ min: 0, max: DISTRICTS.length - 1 }), { minLength: 1, maxLength: 3 })
  .chain((districtIndexes) =>
    fc
      .tuple(
        ...districtIndexes.map((districtIndex) =>
          fc.tuple(fc.constantFrom(3, 10, 43), fc.array(fc.tuple(fc.nat(43), fc.integer({ min: 1, max: 500 })), { minLength: 1, maxLength: 40 })).map(
            ([spread, sales]) => sales.map(([q, price]) => ({ districtIndex, quarterIndex: q % (spread + 1), price })),
          ),
        ),
      )
      .map((perDistrict) => ({ districtIndexes, sales: perDistrict.flat() })),
  )
  .chain(({ districtIndexes, sales }) =>
    fc
      .tuple(
        ...sales.map(() =>
          fc.record({
            season: fc.integer({ min: 0, max: SEASONS - 1 }),
            copy: fc.option(fc.integer({ min: 1, max: SEASONS - 1 }), { nil: undefined }),
          }),
        ),
      )
      .map((placement) => ({
        districtIndexes,
        placed: sales.map(
          (s, i): Placed => ({
            spec: { id: `R${i}`, districtIndex: s.districtIndex, quarterIndex: s.quarterIndex, unitPrice: s.price },
            season: (placement[i] as { season: number }).season,
            copySeason:
              (placement[i] as { copy: number | undefined }).copy === undefined
                ? undefined
                : ((placement[i] as { season: number }).season + (placement[i] as { copy: number }).copy) % SEASONS,
          }),
        ),
      })),
  );

describe('Property 9: quarter bucketing ignores the publication season and duplicates', () => {
  // Feature: data-pipeline, Property 9: Quarter bucketing ignores the publication season and duplicates
  // **Validates: Requirements 8.4, 8.6**
  it('spreading records over season files and repeating some leaves counts and medians unchanged', () => {
    fc.assert(
      fc.property(scenarioArb, ({ districtIndexes, placed }) => {
        const districts = districtIndexes.map((i) => ({ code: (DISTRICTS[i] as (typeof DISTRICTS)[number]).code }));

        // Distributed: bucket by (season, city letter); copies go to a different season file.
        const buckets = new Map<string, Spec[]>();
        const add = (season: number, spec: Spec) => {
          const letter = (DISTRICTS[spec.districtIndex] as (typeof DISTRICTS)[number]).city === 'Taipei' ? 'a' : 'f';
          const name = `${104 + season}S1_${letter}_lvr_land_a.csv`;
          const list = buckets.get(name);
          if (list === undefined) buckets.set(name, [spec]);
          else list.push(spec);
        };
        let copies = 0;
        for (const p of placed) {
          add(p.season, p.spec);
          if (p.copySeason !== undefined) {
            add(p.copySeason, p.spec);
            copies++;
          }
        }
        const spread = dedupeById(
          [...buckets].map(([file, specs]) => ({ file, records: parseLvrCsv(fileText(specs), file, 'sale') })),
        );

        // Reference: every original once, in a single file per city.
        const single = new Map<string, Spec[]>();
        for (const p of placed) {
          const letter = (DISTRICTS[p.spec.districtIndex] as (typeof DISTRICTS)[number]).city === 'Taipei' ? 'a' : 'f';
          const name = `104S1_${letter}_lvr_land_a.csv`;
          const list = single.get(name);
          if (list === undefined) single.set(name, [p.spec]);
          else list.push(p.spec);
        }
        const reference = dedupeById(
          [...single].map(([file, specs]) => ({ file, records: parseLvrCsv(fileText(specs), file, 'sale') })),
        );

        expect(spread.duplicates).toBe(copies);
        expect(reference.duplicates).toBe(0);
        const a = filterLvr(spread.records, spread.duplicates);
        const b = filterLvr(reference.records);
        expect(a.qualifying).toHaveLength(placed.length);
        expect(b.qualifying).toHaveLength(placed.length);
        expect(a.exclusions.duplicate).toBe(copies);

        const countOf = (records: readonly LvrRecord[]) => {
          const m = new Map<string, number>();
          for (const r of records) m.set(`${r.districtCode}|${r.quarter}`, (m.get(`${r.districtCode}|${r.quarter}`) ?? 0) + 1);
          return m;
        };
        const expected = new Map<string, number>();
        for (const p of placed) {
          const key = `${(DISTRICTS[p.spec.districtIndex] as (typeof DISTRICTS)[number]).code}|${quarters[p.spec.quarterIndex]}`;
          expected.set(key, (expected.get(key) ?? 0) + 1);
        }
        expect(countOf(a.qualifying)).toEqual(expected);
        expect(countOf(b.qualifying)).toEqual(expected);

        expect(buildSalePrice(a.qualifying, districts, quarters).series).toEqual(
          buildSalePrice(b.qualifying, districts, quarters).series,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------------------------------------------

const salesScenarioArb = fc
  .uniqueArray(fc.integer({ min: 0, max: DISTRICTS.length - 1 }), { minLength: 1, maxLength: 3 })
  .chain((indexes) =>
    fc.tuple(
      ...indexes.map((i) =>
        fc
          .tuple(
            fc.constantFrom(3, 10, 43),
            fc.array(fc.tuple(fc.nat(43), fc.integer({ min: 1, max: 1_000_000 })), { minLength: 1, maxLength: 150 }),
          )
          .map(([spread, sales]) => ({
            code: (DISTRICTS[i] as (typeof DISTRICTS)[number]).code,
            sales: sales.map(([q, price]) => ({ q: q % (spread + 1), price })),
          })),
      ),
    ),
  );

describe('Property 7: sale-price medians, thin-cell flags and pooled windows', () => {
  // Feature: data-pipeline, Property 7: Sale-price medians, thin-cell flags and pooled windows
  // **Validates: Requirements 8.1, 8.7, 8.8**
  it('uses the own median at >= 10 sales and the smallest symmetric window with >= 10 sales otherwise', () => {
    fc.assert(
      fc.property(salesScenarioArb, (perDistrict) => {
        const records = perDistrict.flatMap((d) => d.sales.map((s) => sale(d.code, quarters[s.q] as Quarter, s.price)));
        const { series } = buildSalePrice(records, perDistrict.map((d) => ({ code: d.code })), quarters);

        for (const d of perDistrict) {
          const cells: number[][] = quarters.map(() => []);
          for (const s of d.sales) (cells[s.q] as number[]).push(s.price);
          const out = series[d.code] ?? [];
          expect(out).toHaveLength(44);
          for (let i = 0; i < 44; i++) {
            const own = cells[i] as number[];
            const rec = out[i];
            if (own.length >= 10) {
              expect(rec).toEqual({ value: Math.round(refMedian(own)), estimated: false });
              continue;
            }
            let r = 1;
            let window: number[] = [];
            for (;; r++) {
              const lo = Math.max(0, i - r);
              const hi = Math.min(43, i + r);
              window = cells.slice(lo, hi + 1).flat();
              if (window.length >= 10 || (lo === 0 && hi === 43)) break;
            }
            expect(rec).toEqual({ value: Math.round(refMedian(window)), estimated: true, method: 'sale-price-pooled-window' });
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Property 12
// ---------------------------------------------------------------------------------------------------------------

describe('Property 12: price-to-income ratio is the median total price over income', () => {
  // Feature: data-pipeline, Property 12: Price-to-income ratio is the median total price over income
  // **Validates: Requirements 10.2, 10.3**
  const quarterCountArb = fc.integer({ min: 1, max: 2 });
  const cityQuarterArb = fc.record({
    prices: fc.array(fc.integer({ min: 1, max: 200_000_000 }), { minLength: 100, maxLength: 130 }),
    zeroTotals: fc.integer({ min: 0, max: 5 }),
    income: fc.double({ min: 1000, max: 5_000_000, noNaN: true, noDefaultInfinity: true }),
  });

  it('ratio = round(median total / income, 2), estimated with price-to-income-computed', () => {
    fc.assert(
      fc.property(
        quarterCountArb.chain((n) => fc.tuple(fc.array(cityQuarterArb, { minLength: n, maxLength: n }), fc.array(cityQuarterArb, { minLength: n, maxLength: n }))),
        ([taipei, newTaipei]) => {
          const qs = quarters.slice(0, taipei.length);
          const taipeiDistrict = DISTRICTS.find((d) => d.city === 'Taipei') as (typeof DISTRICTS)[number];
          const newTaipeiDistrict = DISTRICTS.find((d) => d.city === 'New Taipei') as (typeof DISTRICTS)[number];
          const sales: LvrRecord[] = [];
          const income = new Map<'Taipei' | 'New Taipei', Map<Quarter, number>>([
            ['Taipei', new Map()],
            ['New Taipei', new Map()],
          ]);
          const fill = (cells: typeof taipei, district: typeof taipeiDistrict) => {
            cells.forEach((c, i) => {
              const q = qs[i] as Quarter;
              income.get(district.city)?.set(q, c.income);
              for (const p of c.prices) sales.push(sale(district.code, q, 1, p));
              for (let z = 0; z < c.zeroTotals; z++) sales.push(sale(district.code, q, 1, 0));
            });
          };
          fill(taipei, taipeiDistrict);
          fill(newTaipei, newTaipeiDistrict);

          const out = buildPriceToIncome(
            sales,
            income,
            [
              { code: taipeiDistrict.code, city: 'Taipei' },
              { code: newTaipeiDistrict.code, city: 'New Taipei' },
            ],
            qs,
          );
          const check = (cells: typeof taipei, got: (typeof out)['Taipei']) => {
            expect(got).toHaveLength(qs.length);
            cells.forEach((c, i) => {
              expect(got[i]).toEqual({
                value: Math.round((refMedian(c.prices) / c.income) * 100) / 100,
                estimated: true,
                method: 'price-to-income-computed',
              });
            });
          };
          check(taipei, out.Taipei);
          check(newTaipei, out['New Taipei']);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

it('keeps the shared helpers honest (sanity)', () => {
  expect(refMedian([1, 3, 2])).toBe(2);
  expect(refMedian([1, 2, 3, 4])).toBe(2.5);
});
