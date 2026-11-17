import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkCensusTotals, type CensusEmployeeRow, type CensusTotalRow } from "../../../scripts/pipeline/params/census-employees.ts";
import { DISTRICTS } from "../../../scripts/lib/districts.ts";
import { DataError } from "../../../scripts/pipeline/errors.ts";

const NUM_RUNS = 200;
const TIMEOUT = 120_000;
const CITIES = ["Taipei", "New Taipei"] as const;

function employeeRows(counts: readonly number[]): CensusEmployeeRow[] {
  return DISTRICTS.map((d, i) => ({
    row: i + 2,
    districtCode: d.code,
    employees: counts[i] ?? 0,
    sourceUrl: "https://example.test",
    tableId: "10",
    page: 140,
  }));
}

function totalRows(counts: readonly number[]): CensusTotalRow[] {
  return CITIES.map((city, i) => ({
    row: i + 2,
    city,
    employees: DISTRICTS.reduce((acc, d, k) => (d.city === city ? acc + (counts[k] ?? 0) : acc), 0),
    sourceUrl: "https://example.test",
    tableId: "10",
    page: 140,
  }));
}

const countsArb = fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: DISTRICTS.length, maxLength: DISTRICTS.length });

function outcome(fn: () => void): { threw: boolean; detail: readonly string[]; isDataError: boolean } {
  try {
    fn();
    return { threw: false, detail: [], isDataError: false };
  } catch (e) {
    return { threw: true, detail: e instanceof DataError ? e.details : [], isDataError: e instanceof DataError };
  }
}

describe("Property 46: census employee totals check accepts exactly the consistent tables", () => {
  it(
    "accepts any table whose city sums equal the printed totals",
    () => {
      // **Validates: Requirements 28.3, 28.4, 28.9**
      let bad = 0;
      fc.assert(
        fc.property(countsArb, (counts) => {
          const r = outcome(() => checkCensusTotals(employeeRows(counts), totalRows(counts)));
          if (r.threw) bad++;
          return !r.threw;
        }),
        { numRuns: NUM_RUNS, endOnFailure: true },
      );
      expect(bad).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "rejects a table with one changed count and names the city whose sum no longer matches",
    () => {
      // **Validates: Requirements 28.3, 28.4, 28.9**
      const caseArb = fc
        .tuple(countsArb, fc.integer({ min: 0, max: DISTRICTS.length - 1 }), fc.integer({ min: 1, max: 1_000_000 }), fc.boolean())
        .map(([counts, index, amount, up]) => {
          const old = counts[index] ?? 0;
          const next = up ? old + amount : Math.max(0, old - amount);
          return { counts, index, next: next === old ? old + amount : next };
        });
      fc.assert(
        fc.property(caseArb, ({ counts, index, next }) => {
          const changed = counts.map((c, i) => (i === index ? next : c));
          const expectedCity = DISTRICTS[index]?.city;
          const r = outcome(() => checkCensusTotals(employeeRows(changed), totalRows(counts)));
          return r.threw && r.isDataError && r.detail.includes(`city: ${expectedCity}`);
        }),
        { numRuns: NUM_RUNS, endOnFailure: true },
      );
    },
    TIMEOUT,
  );
});
