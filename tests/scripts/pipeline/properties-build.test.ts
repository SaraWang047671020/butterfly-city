/**
 * Property tests for the transactional writer and the full build (task 14.3).
 *
 * Property 23 (order independence, no input mutation) is checked on a fixture-scale set of the pure builders.
 * Covered: buildPopulation, buildMigration (with the 2015 split), buildSalePrice, buildPriceToIncome,
 * buildSocialHousing, buildSocialHousingStarts, buildSubleaseUnits, buildHoldingTaxRates, buildHouseTaxRevenue,
 * buildCommuterPassPrice and buildDistrictsFile.
 * Not covered (their inputs are heavy or come from fixed tables): buildIncome, buildRent, buildMrtEntries,
 * buildRentSubsidyHouseholds, buildRentSubsidyAmount, buildCommuterPassesSold and the SOURCES.md renderer.
 * Order-dependent contracts (first-in-sorted-file-order de-duplication) are only shuffled within the contract:
 * the projects and sales used here have distinct ids.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Ring } from '../../../scripts/geo/shapefile.ts';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import type { Quarter } from '../../../scripts/lib/time.ts';
import { buildDistrictsFile, type ShapeInput } from '../../../scripts/pipeline/districts-file.ts';
import { WriteError } from '../../../scripts/pipeline/errors.ts';
import { summarizeHistory } from '../../../scripts/pipeline/history-file.ts';
import { buildMigration, migrationMonths } from '../../../scripts/pipeline/indicators/migration.ts';
import { buildPopulation, populationMonths } from '../../../scripts/pipeline/indicators/population.ts';
import { buildPriceToIncome } from '../../../scripts/pipeline/indicators/price-to-income.ts';
import { buildSalePrice } from '../../../scripts/pipeline/indicators/sale-price.ts';
import { buildSocialHousing } from '../../../scripts/pipeline/indicators/social-housing.ts';
import type { MigrationVillageRow, PopulationVillageRow } from '../../../scripts/pipeline/parsers/household.ts';
import type { AnnualMigrationRow } from '../../../scripts/pipeline/parsers/migration-annual.ts';
import type { LvrRecord } from '../../../scripts/pipeline/parsers/lvr.ts';
import type { CommuterPassProductRow, HoldingTaxRateRow, SubleasePhaseRow } from '../../../scripts/pipeline/parsers/policy-tables.ts';
import type { HouseTaxRow } from '../../../scripts/pipeline/parsers/house-tax.ts';
import type { SocialHousingDetail, SocialHousingProject } from '../../../scripts/pipeline/parsers/social-housing.ts';
import { summarizePolicyTrack } from '../../../scripts/pipeline/policy-file.ts';
import { buildCommuterPassPrice } from '../../../scripts/pipeline/policy/commuter-pass.ts';
import { buildHoldingTaxRates, buildHouseTaxRevenue } from '../../../scripts/pipeline/policy/holding-tax.ts';
import { buildSocialHousingStarts } from '../../../scripts/pipeline/policy/social-housing-starts.ts';
import { buildSubleaseUnits } from '../../../scripts/pipeline/policy/sublease.ts';
import { dayNumber, isoDate } from '../../../scripts/pipeline/policy/track.ts';
import { formatSummaryLine } from '../../../scripts/pipeline/run.ts';
import { serializeJson } from '../../../scripts/pipeline/serialize.ts';
import { writeAll, type PlannedWrite } from '../../../scripts/pipeline/write.ts';
import { validHistoryFile, validPolicyTrackFile } from '../../data/helpers.ts';
import { FakeWriteFs, type Failure, type FsOp } from './helpers-write.ts';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------------------------------------
// Property 30: summary counts match the file
// ---------------------------------------------------------------------------------------------------------

/** Rewrites estimated flags and series lengths from the drawn numbers (cycled), so counts are not constant. */
function randomize(series: Record<string, { estimated: boolean }[]>, flags: readonly boolean[], lengths: readonly number[]): void {
  let f = 0;
  let l = 0;
  for (const key of Object.keys(series)) {
    const records = series[key] as { estimated: boolean }[];
    records.length = Math.min(records.length, lengths[l++ % lengths.length] as number);
    for (const r of records) r.estimated = flags[f++ % flags.length] as boolean;
  }
}

const flagsArb = fc.array(fc.boolean(), { minLength: 1, maxLength: 120 });
const lengthsArb = fc.array(fc.integer({ min: 0, max: 44 }), { minLength: 1, maxLength: 20 });

function expectedCounts(series: Record<string, { estimated: boolean }[]>): { values: number; estimated: number } {
  let values = 0;
  let estimated = 0;
  for (const records of Object.values(series)) {
    for (const r of records) {
      values += 1;
      if (r.estimated === true) estimated += 1;
    }
  }
  return { values, estimated };
}

describe('data-pipeline properties: summary', () => {
  // Feature: data-pipeline, Property 30: Summary counts match the file
  it('Property 30: summary counts match the file', () => {
    // **Validates: Requirements 1.4**
    fc.assert(
      fc.property(flagsArb, lengthsArb, flagsArb, lengthsArb, (hFlags, hLengths, pFlags, pLengths) => {
        const history = validHistoryFile();
        for (const ind of history.indicators) randomize(ind.series, hFlags, hLengths);
        const summaries = summarizeHistory(history);
        expect(summaries).toHaveLength(history.indicators.length);
        history.indicators.forEach((ind: { id: string; series: Record<string, { estimated: boolean }[]> }, i: number) => {
          const expected = expectedCounts(ind.series);
          expect(summaries[i]).toEqual({ id: ind.id, ...expected });
          expect(formatSummaryLine(summaries[i]!)).toBe(`${ind.id}: ${expected.values} values, ${expected.estimated} estimated`);
        });

        const track = validPolicyTrackFile();
        for (const s of track.policySeries) randomize(s.series, pFlags, pLengths);
        const policy = summarizePolicyTrack(track);
        expect(policy).toHaveLength(track.policySeries.length);
        track.policySeries.forEach((s: { id: string; series: Record<string, { estimated: boolean }[]> }, i: number) => {
          const expected = expectedCounts(s.series);
          expect(policy[i]).toEqual({ id: s.id, ...expected });
          expect(formatSummaryLine(policy[i]!)).toBe(`${s.id}: ${expected.values} values, ${expected.estimated} estimated`);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Property 25: transactional write restores the previous state on failure
// ---------------------------------------------------------------------------------------------------------

const OUT_DIR = path.resolve('/butterfly-fake-out');
const fileName = (i: number) => `f${i}.json`;
const filePath = (i: number) => path.join(OUT_DIR, fileName(i));

const FAILABLE_OPS: readonly FsOp[] = ['exists', 'readBytes', 'writeFile', 'rename', 'mkdirp'];

interface WriteScenario {
  readonly texts: string[];
  /** Previous content per target, or null when the target did not exist. */
  readonly before: (string | null)[];
  readonly failure: Failure;
}

const textArb = fc.string({ maxLength: 40 });

const writeScenarioArb: fc.Arbitrary<WriteScenario> = fc.integer({ min: 1, max: 4 }).chain((n) =>
  fc.record({
    texts: fc.array(textArb, { minLength: n, maxLength: n }),
    before: fc.array(fc.option(textArb, { nil: null }), { minLength: n, maxLength: n }),
    failure: fc.record({
      op: fc.constantFrom(...FAILABLE_OPS),
      // n + 1 is past the last call of every kind, so some scenarios do not fail.
      nth: fc.integer({ min: 1, max: n + 1 }),
    }),
  }),
);

/** Index of the planned write that the failing call belongs to, or undefined when the call cannot fail. */
function failedIndex(s: WriteScenario): number | undefined {
  const { op, nth } = s.failure;
  if (op === 'readBytes') {
    const existing = s.before.flatMap((b, i) => (b === null ? [] : [i]));
    return existing[nth - 1];
  }
  return nth - 1 < s.texts.length ? nth - 1 : undefined;
}

describe('data-pipeline properties: writer', () => {
  // Feature: data-pipeline, Property 25: Transactional write restores the previous state on failure
  it('Property 25: transactional write restores the previous state on failure', () => {
    // **Validates: Requirements 2.5, 16.7, 16.8**
    fc.assert(
      fc.property(writeScenarioArb, (s) => {
        const initial: Record<string, string> = {};
        s.before.forEach((b, i) => {
          if (b !== null) initial[filePath(i)] = b;
        });
        const writes: PlannedWrite[] = s.texts.map((text, i) => ({ path: filePath(i), text }));
        const fake = new FakeWriteFs(initial, [s.failure]);

        let thrown: unknown;
        try {
          writeAll(writes, fake);
        } catch (error) {
          thrown = error;
        }

        const expectedFail = failedIndex(s);
        if (expectedFail === undefined) {
          expect(thrown).toBeUndefined();
        }
        if (thrown === undefined) {
          // Success: exactly the planned texts, no temp file.
          writes.forEach((w) => expect(fake.text(w.path)).toBe(w.text));
          expect(fake.tempFiles()).toEqual([]);
          expect(fake.files.size).toBe(writes.length);
          return;
        }
        // Failure: WriteError naming the failed file, previous state restored, nothing else left behind.
        expect(thrown).toBeInstanceOf(WriteError);
        expect(expectedFail).toBeDefined();
        expect((thrown as WriteError).file.endsWith(fileName(expectedFail as number))).toBe(true);
        s.before.forEach((b, i) => {
          expect(fake.text(filePath(i))).toBe(b === null ? undefined : b);
        });
        expect(fake.tempFiles()).toEqual([]);
        expect(fake.files.size).toBe(s.before.filter((b) => b !== null).length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Property 23: output is independent of input order and does not mutate inputs
// ---------------------------------------------------------------------------------------------------------

const keysArb = fc.array(fc.integer(), { minLength: 1, maxLength: 40 });

/** A permutation of `xs` drawn from `keys` (stable on ties); `salt` makes different lists use different orders. */
function shuffle<T>(xs: readonly T[], keys: readonly number[], salt = 0): T[] {
  return xs
    .map((x, i) => ({ x, i, k: keys[(i + salt) % keys.length] as number }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((e) => e.x);
}

/**
 * Builds from `input`, again from `input`, and from `shuffled(input)`: all three serialized outputs must be
 * byte-identical, and the input must be deep-equal to a snapshot taken before the first build.
 */
function checkOrderIndependent<I>(input: I, shuffled: (input: I) => I, build: (input: I) => unknown): void {
  const snapshot = structuredClone(input);
  const first = serializeJson(build(input));
  const second = serializeJson(build(input));
  expect(input).toEqual(snapshot);
  const other = shuffled(input);
  const third = serializeJson(build(other));
  expect(other).toEqual(shuffled(snapshot));
  expect(input).toEqual(snapshot);
  expect(second).toBe(first);
  expect(third).toBe(first);
}

const SUBSET = [DISTRICTS[0]!, DISTRICTS[5]!, DISTRICTS[12]!];
const quarterList = (year: number, count: number): Quarter[] =>
  Array.from({ length: count }, (_, i) => `${year + Math.floor(i / 4)}Q${(i % 4) + 1}` as Quarter);

describe('data-pipeline properties: build order independence', () => {
  // Feature: data-pipeline, Property 23: Output is independent of input order and does not mutate inputs
  it('Property 23: population and migration', () => {
    // **Validates: Requirements 2.6, 4.10, 17.1, 17.2, 17.6**
    const popQuarters = quarterList(2018, 2);
    const popMonths = populationMonths(popQuarters);
    const popRowArb = fc.record({ d: fc.integer({ min: 0, max: 2 }), village: fc.constantFrom('a', 'b', 'c'), total: fc.integer({ min: 0, max: 50_000 }) });
    const popArb = fc.array(fc.array(popRowArb, { maxLength: 8 }), { minLength: popMonths.length, maxLength: popMonths.length });
    fc.assert(
      fc.property(popArb, keysArb, (perMonth, keys) => {
        const map = new Map<string, PopulationVillageRow[]>();
        popMonths.forEach((month, i) => {
          const rows = SUBSET.map((d) => ({ month, districtCode: d.code, village: 'base', peopleTotal: 1 }));
          for (const r of perMonth[i]!) rows.push({ month, districtCode: SUBSET[r.d]!.code, village: r.village, peopleTotal: r.total });
          map.set(month, rows);
        });
        checkOrderIndependent(
          map,
          (m) => new Map(shuffle([...m], keys).map(([month, rows], i) => [month, shuffle(rows, keys, i + 1)] as const)),
          (m) => buildPopulation(m, SUBSET, popQuarters),
        );
      }),
      { numRuns: NUM_RUNS },
    );

    const migQuarters: Quarter[] = quarterList(2015, 5);
    const migMonths = migrationMonths(migQuarters);
    const cell = fc.record({ in: fc.integer({ min: 0, max: 3000 }), out: fc.integer({ min: 0, max: 3000 }) });
    const migArb = fc.tuple(
      fc.array(fc.array(cell, { minLength: 3, maxLength: 3 }), { minLength: migMonths.length, maxLength: migMonths.length }),
      fc.array(cell, { minLength: 3, maxLength: 3 }),
    );
    fc.assert(
      fc.property(migArb, keysArb, ([grid, extras], keys) => {
        const monthly = new Map<string, MigrationVillageRow[]>();
        migMonths.forEach((month, mi) => {
          const rows: MigrationVillageRow[] = [];
          SUBSET.forEach((d, di) => {
            const c = grid[mi]![di]!;
            rows.push({ month, districtCode: d.code, village: 'v1', inMale: c.in, inFemale: 0, outMale: c.out, outFemale: 0 });
            rows.push({ month, districtCode: d.code, village: 'v2', inMale: 0, inFemale: 1, outMale: 0, outFemale: 1 });
          });
          monthly.set(month, rows);
        });
        const dec = monthly.get('10412')!;
        const annual: AnnualMigrationRow[] = SUBSET.map((d, di) => {
          const own = dec.filter((r) => r.districtCode === d.code);
          const sumOf = (pick: (r: MigrationVillageRow) => number) => own.reduce((s, r) => s + pick(r), 0);
          return {
            districtCode: d.code,
            year: 2015,
            moveIn: sumOf((r) => r.inMale + r.inFemale) + extras[di]!.in,
            moveOut: sumOf((r) => r.outMale + r.outFemale) + extras[di]!.out,
          };
        });
        checkOrderIndependent(
          { monthly, annual },
          (i) => ({
            monthly: new Map(shuffle([...i.monthly], keys).map(([month, rows], k) => [month, shuffle(rows, keys, k + 1)] as const)),
            annual: shuffle(i.annual, keys, 3),
          }),
          (i) => buildMigration(i.monthly, i.annual, SUBSET, migQuarters),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 23: sale price and price-to-income ratio', () => {
    // **Validates: Requirements 2.6, 4.10, 17.1, 17.2, 17.6**
    const quarters = quarterList(2018, 4);
    const lvr = (districtCode: string, quarter: Quarter, unitPrice: number, totalPrice: number): LvrRecord => ({
      id: '',
      kind: 'sale',
      districtCode,
      quarter,
      target: '',
      use: '',
      unitPrice,
      totalPrice,
      rent: 0,
      area: 0,
    });
    const saleArb = fc.array(
      fc.record({ d: fc.integer({ min: 0, max: 2 }), q: fc.integer({ min: 0, max: 3 }), price: fc.integer({ min: 1, max: 900_000 }) }),
      { maxLength: 60 },
    );
    fc.assert(
      fc.property(saleArb, keysArb, (drawn, keys) => {
        // One sale per district keeps every widest window non-empty.
        const sales = [
          ...SUBSET.map((d) => lvr(d.code, quarters[0]!, 100_000, 1_000_000)),
          ...drawn.map((r) => lvr(SUBSET[r.d]!.code, quarters[r.q]!, r.price, r.price * 30)),
        ];
        checkOrderIndependent(
          sales,
          (xs) => shuffle(xs, keys),
          (xs) => buildSalePrice(xs, SUBSET, quarters).series,
        );
      }),
      { numRuns: NUM_RUNS },
    );

    const ptiQuarters = quarterList(2018, 1);
    const cities = [DISTRICTS.find((d) => d.city === 'Taipei')!, DISTRICTS.find((d) => d.city === 'New Taipei')!];
    const totals = fc.array(fc.integer({ min: 1_000_000, max: 90_000_000 }), { minLength: 100, maxLength: 112 });
    fc.assert(
      fc.property(totals, totals, keysArb, (taipei, newTaipei, keys) => {
        const make = (d: (typeof cities)[number], xs: readonly number[]) => xs.map((t) => lvr(d.code, ptiQuarters[0]!, 1, t));
        const sales = [...make(cities[0]!, taipei), ...make(cities[1]!, newTaipei)];
        const income = new Map([
          ['Taipei' as const, new Map([[ptiQuarters[0]!, 400_000]])],
          ['New Taipei' as const, new Map([[ptiQuarters[0]!, 300_000]])],
        ]);
        checkOrderIndependent(
          sales,
          (xs) => shuffle(xs, keys),
          (xs) => buildPriceToIncome(xs, income, cities, ptiQuarters),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 23: social housing completions, stock and starts', () => {
    // **Validates: Requirements 2.6, 4.10, 17.1, 17.2, 17.6**
    const quarters = quarterList(2017, 8);
    const dateArb = fc.oneof(
      fc.constant(''),
      fc.record({ y: fc.integer({ min: 104, max: 109 }), m: fc.integer({ min: 1, max: 12 }), d: fc.integer({ min: 1, max: 28 }) }).map(
        ({ y, m, d }) => `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
      ),
    );
    const projectArb = fc.record({
      status: fc.constantFrom('已完工', '興建中'),
      units: fc.integer({ min: 0, max: 900 }),
      start: dateArb,
      end: dateArb,
      detail: fc.constantFrom(0, 1, 2, 3, 4), // 0..2 a district of SUBSET, 3 unknown town, 4 no detail file
    });
    fc.assert(
      fc.property(fc.array(projectArb, { maxLength: 25 }), keysArb, (drawn, keys) => {
        const projects: SocialHousingProject[] = drawn.map((p, i) => ({
          guid: `guid-${i}`,
          status: p.status,
          householdNum: p.units,
          strStartDate: p.start,
          strEndDate: p.end,
          city: i % 2 === 0 ? 'Taipei' : 'New Taipei',
          file: 'mem',
        }));
        const details = new Map<string, SocialHousingDetail>();
        drawn.forEach((p, i) => {
          if (p.detail === 4) return;
          const townCode = p.detail <= 2 ? SUBSET[p.detail]!.code : '99999999';
          details.set(`guid-${i}`, { guid: `guid-${i}`, cityCode: 'A', townCode });
        });
        const byGuid = <T extends { guid: string }>(xs: readonly T[]) => [...xs].sort((a, b) => (a.guid < b.guid ? -1 : 1));
        checkOrderIndependent(
          { projects, details },
          (i) => ({ projects: shuffle(i.projects, keys), details: new Map(shuffle([...i.details], keys, 1)) }),
          (i) => {
            const completed = buildSocialHousing(i.projects, i.details, SUBSET, quarters);
            const starts = buildSocialHousingStarts(i.projects, i.details, SUBSET, quarters);
            return {
              completions: completed.completions,
              stock: completed.stock,
              completionExclusions: byGuid(completed.exclusions),
              starts: starts.series,
              startExclusions: byGuid(starts.exclusions),
            };
          },
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 23: policy table builders', () => {
    // **Validates: Requirements 2.6, 4.10, 17.1, 17.2, 17.6**
    const quarters = quarterList(2017, 12);
    const cityNames = ['Taipei', 'New Taipei'] as const;
    const base = dayNumber('2017-03-01');

    const phasesArb = fc.array(
      fc.record({
        phases: fc.array(fc.record({ gap: fc.integer({ min: 20, max: 200 }), total: fc.integer({ min: 0, max: 5000 }) }), { minLength: 1, maxLength: 3 }),
        tail: fc.integer({ min: 30, max: 300 }),
      }),
      { minLength: 4, maxLength: 4 },
    );
    fc.assert(
      fc.property(phasesArb, keysArb, (groups, keys) => {
        const rows: SubleasePhaseRow[] = [];
        groups.forEach((g, gi) => {
          const city = cityNames[gi % 2]!;
          const channel = gi < 2 ? 'city' : 'central';
          let start = base;
          g.phases.forEach((p, i) => {
            start += p.gap;
            const next = start + (i === g.phases.length - 1 ? g.tail : 0);
            rows.push({ row: rows.length + 2, city, channel, phase: i + 1, startDate: isoDate(start), totalUnits: p.total, asOf: isoDate(next), source: 's', url: 'u' });
          });
        });
        checkOrderIndependent(rows, (xs) => shuffle(xs, keys), (xs) => buildSubleaseUnits(xs, quarters));
      }),
      { numRuns: NUM_RUNS },
    );

    const datesArb = (max: number) => fc.uniqueArray(fc.integer({ min: 0, max: 1200 }), { minLength: 0, maxLength: max });
    const rateArb = fc.integer({ min: 1, max: 50 }).map((n) => n / 10);
    fc.assert(
      fc.property(datesArb(3), datesArb(3), fc.array(rateArb, { minLength: 8, maxLength: 8 }), keysArb, (taipeiDays, newTaipeiDays, rates, keys) => {
        const rows: HoldingTaxRateRow[] = [
          { row: 2, city: 'statutory', effectiveDate: '2010-01-01', lowestRate: 1.2, highestRate: 3.6, legalText: 't', articleOrVersion: 'a', source: 's0', url: 'u' },
        ];
        [taipeiDays, newTaipeiDays].forEach((days, ci) => {
          days.forEach((offset, i) => {
            const rate = rates[(ci * 4 + i) % rates.length]!;
            rows.push({
              row: rows.length + 2,
              city: cityNames[ci]!,
              effectiveDate: isoDate(base + offset),
              lowestRate: rate,
              highestRate: rate + 1,
              legalText: 't',
              articleOrVersion: 'a',
              source: `s${ci}-${i}`,
              url: 'u',
            });
          });
        });
        checkOrderIndependent(rows, (xs) => shuffle(xs, keys), (xs) => buildHoldingTaxRates(xs, quarters));

        const products: CommuterPassProductRow[] = [];
        [taipeiDays, newTaipeiDays].forEach((days, ci) => {
          days.forEach((offset, i) => {
            products.push({
              row: products.length + 2,
              city: cityNames[ci]!,
              product: `p${i}`,
              effectiveDate: isoDate(base + offset),
              priceTwd: 500 + Math.round(rates[(ci * 4 + i) % rates.length]! * 100),
              source: `s${ci}-${i}`,
              url: 'u',
            });
          });
        });
        checkOrderIndependent(products, (xs) => shuffle(xs, keys), (xs) => buildCommuterPassPrice(xs, quarters));
      }),
      { numRuns: NUM_RUNS },
    );

    const amountArb = fc.array(fc.integer({ min: 0, max: 9_000_000 }), { minLength: 6, maxLength: 6 });
    fc.assert(
      fc.property(amountArb, keysArb, (amounts, keys) => {
        const rows: HouseTaxRow[] = [];
        for (const city of cityNames) for (const year of [2017, 2018, 2019]) rows.push({ city, year, amountThousand: amounts[rows.length]! / 2 });
        checkOrderIndependent(rows, (xs) => shuffle(xs, keys), (xs) => buildHouseTaxRevenue(xs, quarters));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 23: districts file', { timeout: 30_000 }, () => {
    // **Validates: Requirements 2.6, 3.6, 4.10, 17.1, 17.2, 17.6**
    const r5 = (x: number) => Number(x.toFixed(5));
    const square = (i: number): Ring => {
      const x0 = r5(121 + i * 0.01);
      const x1 = r5(121 + (i + 1) * 0.01);
      return [
        [x0, 25],
        [x0, 25.01],
        [x1, 25.01],
        [x1, 25],
        [x0, 25],
      ];
    };
    const records: ShapeInput[] = DISTRICTS.map((d, i) => ({ attributes: { TOWNCODE: d.code }, polygons: [[square(i)]] }));
    fc.assert(
      fc.property(keysArb, (keys) => {
        checkOrderIndependent(records, (xs) => shuffle(xs, keys), (xs) => buildDistrictsFile(xs));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
