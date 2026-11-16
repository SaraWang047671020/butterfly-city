import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import type { Quarter } from '../../../scripts/lib/time.ts';
import { buildMigration, migrationMonths, MIGRATION_SPLIT_METHOD } from '../../../scripts/pipeline/indicators/migration.ts';
import { buildPopulation, populationMonths } from '../../../scripts/pipeline/indicators/population.ts';
import { parsePopulationCsv, parsePopulationJson, type MigrationVillageRow } from '../../../scripts/pipeline/parsers/household.ts';
import type { AnnualMigrationRow } from '../../../scripts/pipeline/parsers/migration-annual.ts';

const NUM_RUNS = 100;
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/** A small fixed subset of districts across both cities keeps each run fast. */
const SUBSET = [DISTRICTS[0]!, DISTRICTS[5]!, DISTRICTS[12]!, DISTRICTS[20]!, DISTRICTS[40]!];

const pick = (n: number) => fc.shuffledSubarray(SUBSET, { minLength: 1, maxLength: n });

// ---------------------------------------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------------------------------------

const OTHER_CITY_SITES = ['桃園市中壢區', '基隆市中正區', '高雄市前鎮區', '臺中市西屯區'];

/** `台北市` and `臺北市` are both used in source files. */
const spell = (zh: string, useTai: boolean) => (useTai ? zh.replace('臺', '台') : zh);

interface PopScenario {
  readonly quarters: Quarter[];
  readonly districts: typeof SUBSET;
  /** per month: rows with the raw site name, village and count, in file order */
  readonly files: Map<string, { site: string; village: string; total: number; own: string | null }[]>;
}

const quartersArb = fc.constantFrom<Quarter[]>(['2018Q1'], ['2018Q1', '2018Q2'], ['2018Q2', '2018Q3', '2018Q4']);

const popScenarioArb: fc.Arbitrary<PopScenario> = fc
  .tuple(quartersArb, pick(4), fc.boolean())
  .chain(([quarters, districts, tai]) => {
    const months = populationMonths(quarters);
    const own = fc.record({
      d: fc.constantFrom(...districts),
      village: fc.string({ minLength: 1, maxLength: 4, unit: fc.constantFrom('a', 'b', 'c', 'd', '1', '2') }),
      total: fc.integer({ min: 0, max: 50_000 }),
      useTai: fc.boolean(),
    });
    const other = fc.record({
      site: fc.constantFrom(...OTHER_CITY_SITES),
      village: fc.constantFrom('x', 'y'),
      total: fc.integer({ min: 0, max: 50_000 }),
    });
    const month = fc.record({
      own: fc.array(own, { minLength: 0, maxLength: 8 }),
      other: fc.array(other, { minLength: 0, maxLength: 5 }),
    });
    return fc.array(month, { minLength: months.length, maxLength: months.length }).map((perMonth) => {
      const files = new Map<string, { site: string; village: string; total: number; own: string | null }[]>();
      months.forEach((m, i) => {
        const rows: { site: string; village: string; total: number; own: string | null }[] = [];
        // Every district gets at least one row so that the build is valid.
        for (const d of districts) rows.push({ site: spell(d.zh, tai), village: 'base', total: 1, own: d.code });
        for (const r of perMonth[i]!.own) rows.push({ site: spell(r.d.zh, r.useTai), village: r.village, total: r.total, own: r.d.code });
        for (const r of perMonth[i]!.other) rows.push({ site: r.site, village: r.village, total: r.total, own: null });
        files.set(m, rows);
      });
      return { quarters, districts, files };
    });
  });

/** Writes the rows as a ris.gov.tw JSON file of the given month. */
function toJson(month: string, rows: readonly { site: string; village: string; total: number }[]): string {
  return JSON.stringify(rows.map((r) => ({ statistic_yyymm: month, site_id: r.site, village: r.village, people_total: String(r.total) })));
}

/** Writes the rows as an ODRP005-style CSV file. */
function toCsv(month: string, rows: readonly { site: string; village: string; total: number }[]): string {
  return ['statistic_yyymm,site_id,village,people_total', ...rows.map((r) => `${month},${r.site},${r.village},${r.total}`)].join('\n') + '\n';
}

describe('data-pipeline properties: population', () => {
  // Feature: data-pipeline, Property 4: Population equals the sum of the district's village rows
  it('Property 4: population equals the sum of the district village rows', () => {
    // **Validates: Requirements 5.1, 5.3, 5.4**
    fc.assert(
      fc.property(popScenarioArb, fc.constantFrom('json', 'csv'), (s, format) => {
        const parsed = new Map<string, ReturnType<typeof parsePopulationJson>>();
        const withoutOthers = new Map<string, ReturnType<typeof parsePopulationJson>>();
        for (const [month, rows] of s.files) {
          const text = format === 'json' ? toJson(month, rows) : toCsv(month, rows);
          const parse = format === 'json' ? parsePopulationJson : parsePopulationCsv;
          parsed.set(month, parse(text, 'mem'));
          const ownRows = rows.filter((r) => r.own !== null);
          withoutOthers.set(month, parse(format === 'json' ? toJson(month, ownRows) : toCsv(month, ownRows), 'mem'));
        }
        const series = buildPopulation(parsed, s.districts, s.quarters);
        const own = buildPopulation(withoutOthers, s.districts, s.quarters);
        expect(series).toEqual(own); // rows of other cities change nothing
        const months = populationMonths(s.quarters);
        for (const d of s.districts) {
          expect(series[d.code]).toHaveLength(s.quarters.length);
          months.forEach((m, i) => {
            const expected = sum(s.files.get(m)!.filter((r) => r.own === d.code).map((r) => r.total));
            expect(series[d.code]![i]).toEqual({ value: expected, estimated: false });
          });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Property 3
// ---------------------------------------------------------------------------------------------------------

const MIG_QUARTERS: Quarter[] = ['2015Q1', '2015Q2', '2015Q3', '2015Q4', '2016Q1', '2016Q2', '2016Q3', '2016Q4', '2017Q1', '2017Q2'];
/** Months 2015-12..2017-06 as ROC keys: the December count, 2016 and the first half of 2017. */
const MIG_MONTHS = migrationMonths(MIG_QUARTERS);

interface MigScenario {
  readonly districts: typeof SUBSET;
  /** month -> district code -> [in, out] split into two villages */
  readonly counts: Map<string, Map<string, { in: number; out: number }>>;
  readonly monthly: Map<string, MigrationVillageRow[]>;
  readonly annual: AnnualMigrationRow[];
}

const countArb = fc.record({ in: fc.integer({ min: 0, max: 3000 }), out: fc.integer({ min: 0, max: 3000 }) });

const migScenarioArb: fc.Arbitrary<MigScenario> = pick(3).chain((districts) =>
  fc
    .tuple(
      fc.array(fc.array(countArb, { minLength: districts.length, maxLength: districts.length }), {
        minLength: MIG_MONTHS.length,
        maxLength: MIG_MONTHS.length,
      }),
      fc.array(fc.record({ extraIn: fc.integer({ min: 0, max: 20_000 }), extraOut: fc.integer({ min: 0, max: 20_000 }) }), {
        minLength: districts.length,
        maxLength: districts.length,
      }),
      fc.integer({ min: 0, max: 5 }),
    )
    .map(([grid, extras, zeroWeightIdx]) => {
      const counts = new Map<string, Map<string, { in: number; out: number }>>();
      const monthly = new Map<string, MigrationVillageRow[]>();
      MIG_MONTHS.forEach((month, mi) => {
        const perDistrict = new Map<string, { in: number; out: number }>();
        const rows: MigrationVillageRow[] = [];
        districts.forEach((d, di) => {
          // Sometimes zero out all 2016 weights of the first district to hit the equal-split path.
          const zero = di === 0 && zeroWeightIdx === 0 && month.startsWith('105');
          const c = zero ? { in: 0, out: 0 } : grid[mi]![di]!;
          perDistrict.set(d.code, c);
          // Two village rows, male and female columns used, so the sum has several terms.
          const inA = Math.floor(c.in / 2);
          const outA = Math.floor(c.out / 2);
          rows.push({ month, districtCode: d.code, village: 'v1', inMale: inA, inFemale: 0, outMale: outA, outFemale: 0 });
          rows.push({ month, districtCode: d.code, village: 'v2', inMale: 0, inFemale: c.in - inA, outMale: 0, outFemale: c.out - outA });
        });
        counts.set(month, perDistrict);
        monthly.set(month, rows);
      });
      const dec = counts.get('10412')!;
      const annual = districts.map((d, di) => ({
        districtCode: d.code,
        year: 2015,
        moveIn: dec.get(d.code)!.in + extras[di]!.extraIn,
        moveOut: dec.get(d.code)!.out + extras[di]!.extraOut,
      }));
      return { districts, counts, monthly, annual };
    }),
);

describe('data-pipeline properties: migration', () => {
  // Feature: data-pipeline, Property 3: Migration quarters are monthly sums with the correct flags
  it('Property 3: migration quarters are monthly sums with the correct flags', () => {
    // **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    fc.assert(
      fc.property(migScenarioArb, (s) => {
        const built = buildMigration(s.monthly, s.annual, s.districts, MIG_QUARTERS);
        for (const d of s.districts) {
          const annual = s.annual.find((a) => a.districtCode === d.code)!;
          for (const [key, series, total] of [
            ['in', built.moveIn[d.code]!, annual.moveIn],
            ['out', built.moveOut[d.code]!, annual.moveOut],
          ] as const) {
            expect(series).toHaveLength(MIG_QUARTERS.length);
            const december = s.counts.get('10412')!.get(d.code)![key];
            const q = series.map((r) => r.value as number);

            // 2015Q1-Q4: estimated with the split method; the eleven estimated months sum to annual - December.
            for (const r of series.slice(0, 4)) {
              expect(r.estimated).toBe(true);
              expect((r as { method?: string }).method).toBe(MIGRATION_SPLIT_METHOD);
            }
            expect(q[0]! + q[1]! + q[2]! + (q[3]! - december)).toBe(total - december);
            expect(q[3]! - december).toBeGreaterThanOrEqual(0);
            expect(sum(q.slice(0, 4))).toBe(total);

            // Later quarters: plain sums of the three monthly values, not estimated, no method.
            // 2016Q1 = 10501..10503, 2016Q2 = 10504..10506, ... 2017Q2 = 10604..10606.
            const months = ['10501', '10502', '10503', '10504', '10505', '10506', '10507', '10508', '10509', '10510', '10511', '10512', '10601', '10602', '10603', '10604', '10605', '10606'];
            for (let i = 4; i < MIG_QUARTERS.length; i++) {
              const three = months.slice((i - 4) * 3, (i - 4) * 3 + 3).map((m) => s.counts.get(m)!.get(d.code)![key]);
              expect(series[i]).toEqual({ value: sum(three), estimated: false });
              expect('method' in series[i]!).toBe(false);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
