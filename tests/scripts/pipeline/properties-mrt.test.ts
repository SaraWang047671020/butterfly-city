import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { quartersBetween, type Quarter } from "../../../scripts/lib/time.ts";
import type { DistrictShape } from "../../../scripts/pipeline/geo.ts";
import { buildMrtEntries, mrtSeasonalShares } from "../../../scripts/pipeline/indicators/mrt.ts";
import type { MrtAnnualRow, MrtDailyRow } from "../../../scripts/pipeline/parsers/mrt.ts";
import type { MrtRowEntry } from "../../../scripts/pipeline/tables/mrt-stations.ts";

const NUM_RUNS = 100;
const YEARS = Array.from({ length: 11 }, (_, i) => 2015 + i);
const QUARTER_END = ["03-31", "06-30", "09-30", "12-31"];
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** One daily row per month of a year (day 2), entries from `perMonth` (12 values) for one column. */
function dailyMonths(year: number, perMonth: readonly number[], column: string): MrtDailyRow[] {
  return perMonth.map((n, m) => ({ date: `${year}-${pad2(m + 1)}-02`, entries: new Map([[column, n]]) }));
}

describe("MRT entries: properties", () => {
  // Feature: data-pipeline, Property 14: Seasonal shares are non-negative and sum to one
  it("Property 14: seasonal shares are non-negative and sum to one", () => {
    // **Validates: Requirements 11.6**
    const monthsArb = fc.array(fc.integer({ min: 0, max: 100000 }), { minLength: 12, maxLength: 12 }).filter((a) => a.some((n) => n > 0));
    fc.assert(
      fc.property(
        monthsArb,
        monthsArb,
        fc.constantFrom("before-2015", "2015-01-01", "2016-01-01"),
        (y2015, y2016, opened) => {
          const row: MrtRowEntry = { name: "R", station: "S", dailyName: "S", opened };
          const daily = [...dailyMonths(2015, y2015, "S"), ...dailyMonths(2016, y2016, "S")];
          const shares = mrtSeasonalShares(row, daily);
          expect(shares).toBeDefined();
          expect(shares).toHaveLength(4);
          for (const s of shares!) expect(s).toBeGreaterThanOrEqual(0);
          expect(Math.abs(shares!.reduce((a, b) => a + b, 0) - 1)).toBeLessThanOrEqual(1e-9);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: data-pipeline, Property 15: MRT quarterly entries respect opening dates and annual totals
  it("Property 15: MRT quarterly entries respect opening dates and annual totals", () => {
    // **Validates: Requirements 11.4, 11.5, 11.7, 11.9, 11.10, 11.13, 11.14**
    const square = (code: string, x: number): DistrictShape => ({
      code,
      polygons: [[[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]]],
    });
    // Districts R0..R3 hold one row each, T holds two rows, E holds none.
    const codes = ["R0", "R1", "R2", "R3", "T", "E"];
    const shapes = codes.map((c, i) => square(c, i));
    const districts = codes.map((code) => ({ code }));
    const quarters = quartersBetween(2015, 2025);
    const quarterIndex = new Map(quarters.map((q, i) => [q, i] as const));

    const openedArb = fc.oneof(
      fc.constant("before-2015"),
      fc
        .record({ year: fc.integer({ min: 2015, max: 2025 }), month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) })
        .map((d) => `${d.year}-${pad2(d.month)}-${pad2(d.day)}`),
    );
    const specArb = fc.record({
      opened: openedArb,
      entries: fc.array(fc.integer({ min: 0, max: 1000000 }), { minLength: 11, maxLength: 11 }),
      // daily counts of the row's own column in 2015 and 2016 (12 months each, always positive)
      own: fc.array(fc.integer({ min: 1, max: 100000 }), { minLength: 24, maxLength: 24 }),
    });
    const baseArb = fc.array(fc.integer({ min: 1, max: 100000 }), { minLength: 24, maxLength: 24 });

    fc.assert(
      fc.property(fc.array(specArb, { minLength: 1, maxLength: 4 }), fc.array(specArb, { minLength: 2, maxLength: 2 }), baseArb, (single, twin, base) => {
        const placed = [
          ...single.map((s, i) => ({ ...s, district: `R${i}`, name: `row${i}` })),
          ...twin.map((s, i) => ({ ...s, district: "T", name: `twin${i}` })),
        ];
        const makeRows = (list: typeof placed): MrtRowEntry[] => [
          { name: "BASE", station: "BASE", dailyName: "BASE", opened: "before-2015" },
          ...list.map((p): MrtRowEntry =>
            p.opened === "before-2015"
              ? { name: p.name, station: p.name, dailyName: p.name, opened: p.opened }
              : { name: p.name, station: p.name, opened: p.opened, comparable: "BASE" },
          ),
        ];
        const daily: MrtDailyRow[] = [];
        const addDaily = (column: string, counts: readonly number[]): void => {
          daily.push(...dailyMonths(2015, counts.slice(0, 12), column), ...dailyMonths(2016, counts.slice(12), column));
        };
        addDaily("BASE", base);
        for (const p of placed) addDaily(p.name, p.own);
        const stationPoints = placed.map((p) => ({ name: p.name, lon: codes.indexOf(p.district) + 0.5, lat: 0.5 }));
        const isActive = (opened: string, year: number, k: number): boolean => opened === "before-2015" || opened <= `${year}-${QUARTER_END[k]}`;
        const annualFor = (list: typeof placed): MrtAnnualRow[] =>
          list.flatMap((p) =>
            YEARS.filter((y) => [0, 1, 2, 3].some((k) => isActive(p.opened, y, k))).map((y) => ({ year: y, name: p.name, entries: p.entries[y - 2015]! })),
          );
        const build = (list: typeof placed) =>
          buildMrtEntries({ annualRows: annualFor(list), daily, stationPoints, shapes, districts, quarters, rows: makeRows(list) });

        const result = build(placed);
        const valueOf = (r: typeof result, code: string, year: number, k: number) => r.series[code]![quarterIndex.get(`${year}Q${k + 1}` as Quarter)!]!;

        // Single-row districts: per-row checks.
        single.forEach((s, i) => {
          for (const year of YEARS) {
            let sum = 0;
            let anyActive = false;
            for (let k = 0; k < 4; k++) {
              const rec = valueOf(result, `R${i}`, year, k);
              expect(Number.isInteger(rec.value)).toBe(true);
              expect(rec.value!).toBeGreaterThanOrEqual(0);
              if (isActive(s.opened, year, k)) {
                anyActive = true;
                sum += rec.value!;
                expect(rec.estimated).toBe(true);
                expect("method" in rec ? rec.method : undefined).toBe("mrt-seasonal-split");
              } else {
                expect(rec.value).toBe(0);
                expect(rec.estimated).toBe(false);
              }
            }
            if (anyActive) expect(sum).toBe(s.entries[year - 2015]);
          }
        });

        // District with two rows: value is the sum over its active rows (each computed alone).
        const alone = twin.map((_, i) => build([placed[single.length + i]!]));
        for (const year of YEARS) {
          for (let k = 0; k < 4; k++) {
            const rec = valueOf(result, "T", year, k);
            const parts = alone.map((r) => valueOf(r, "T", year, k));
            expect(rec.value).toBe(parts[0]!.value! + parts[1]!.value!);
            const anyActive = twin.some((t) => isActive(t.opened, year, k));
            expect(rec.estimated).toBe(anyActive);
            if (anyActive) expect("method" in rec ? rec.method : undefined).toBe("mrt-seasonal-split");
            else expect(rec.value).toBe(0);
          }
        }

        // A district without any row has 0 and is not estimated.
        for (const rec of result.series.E!) expect(rec).toEqual({ value: 0, estimated: false });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
