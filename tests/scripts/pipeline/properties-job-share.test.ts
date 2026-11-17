import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { jobShares } from "../../../scripts/pipeline/params/job-share.ts";
import type { CensusEmployeeRow } from "../../../scripts/pipeline/params/census-employees.ts";
import { DISTRICTS } from "../../../scripts/lib/districts.ts";

const NUM_RUNS = 200;
const TIMEOUT = 120_000;
const SCALE = 1_000_000;

function rows(counts: readonly number[]): CensusEmployeeRow[] {
  return DISTRICTS.map((d, i) => ({
    row: i + 2,
    districtCode: d.code,
    employees: counts[i] ?? 0,
    sourceUrl: "https://example.test",
    tableId: "10",
    page: 140,
  }));
}

const countsArb = fc
  .array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: DISTRICTS.length, maxLength: DISTRICTS.length })
  .filter((c) => c.some((v) => v > 0));

describe("Property 40: Job shares are largest-remainder shares that sum to 1", () => {
  // **Validates: Requirements 20.11, 22.10, 28.5**
  it(
    "shares are whole multiples of 1e-6, sum to 1, track employees/total, and are scale invariant",
    () => {
      fc.assert(
        fc.property(countsArb, fc.integer({ min: 1, max: 1000 }), (counts, k) => {
          const total = counts.reduce((a, b) => a + b, 0);
          const shares = jobShares(rows(counts));
          const scaled = jobShares(rows(counts.map((v) => v * k)));
          let sum = 0;
          let multiples = true;
          let close = true;
          let invariant = shares.size === DISTRICTS.length;
          DISTRICTS.forEach((d, i) => {
            const s = shares.get(d.code) ?? NaN;
            sum += s;
            if (Math.abs(s * SCALE - Math.round(s * SCALE)) > 1e-6) multiples = false;
            if (!(Math.abs(s - counts[i]! / total) < 1 / SCALE)) close = false;
            if (scaled.get(d.code) !== s) invariant = false;
          });
          return multiples && close && invariant && Math.abs(sum - 1) <= 1e-12;
        }),
        { numRuns: NUM_RUNS },
      );
      expect(true).toBe(true);
    },
    TIMEOUT,
  );
});
