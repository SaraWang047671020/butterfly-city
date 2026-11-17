import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DISTRICTS } from "../../../scripts/lib/districts.ts";
import type { City } from "../../../scripts/lib/districts.ts";
import {
  commuteGhostParams,
  rentGhostParams,
  type CityWorkplace,
  type CommuteGhostInput,
  type WorkplaceRow,
  type RentGhostDistrictInput,
  type RentGhostInput,
} from "../../../scripts/pipeline/params/ghost.ts";

const NUM_RUNS = 100;
const TIMEOUT = 120_000;
/** normalCdf has an absolute error below 1.5e-7, so monotonicity holds up to a few of those. */
const CDF_TOL = 1e-6;

// ---------------------------------------------------------------------------------------------
// Property 41: Rent-burden tail share and sensitivity are bounded and monotone
// **Validates: Requirements 22.7**
// ---------------------------------------------------------------------------------------------

interface DistrictDraw {
  readonly m: number;
  readonly q1: number;
  readonly q3: number;
  readonly rent: number;
  readonly pop: number;
}

const districtDraw: fc.Arbitrary<DistrictDraw> = fc
  .record({
    m: fc.double({ min: 100_000, max: 5_000_000, noNaN: true }),
    q1: fc.double({ min: 50_000, max: 1_000_000, noNaN: true }),
    ratio: fc.double({ min: 1.05, max: 6, noNaN: true }),
    rent: fc.double({ min: 100, max: 3_000, noNaN: true }),
    pop: fc.integer({ min: 1_000, max: 600_000 }),
  })
  .map((d) => ({ m: d.m, q1: d.q1, q3: d.q1 * d.ratio, rent: d.rent, pop: d.pop }));

const scenario = fc.record({
  draws: fc.array(districtDraw, { minLength: DISTRICTS.length, maxLength: DISTRICTS.length }),
  dwellingSize: fc.double({ min: 10, max: 100, noNaN: true }),
  renterTaipei: fc.double({ min: 0.01, max: 1, noNaN: true }),
  renterNewTaipei: fc.double({ min: 0.01, max: 1, noNaN: true }),
  threshold: fc.integer({ min: 2, max: 100 }),
  rentFactor: fc.double({ min: 1, max: 3, noNaN: true }),
  incomeFactor: fc.double({ min: 1, max: 3, noNaN: true }),
});

type Scenario = typeof scenario extends fc.Arbitrary<infer T> ? T : never;

function build(s: Scenario, rentScale = 1, incomeScale = 1): RentGhostInput {
  const districts: RentGhostDistrictInput[] = DISTRICTS.map((d, i) => {
    const x = s.draws[i]!;
    return {
      districtCode: d.code,
      city: d.city,
      householdIncome: [x.m * incomeScale, x.m * incomeScale, x.m * incomeScale, x.m * incomeScale],
      rent: [x.rent * rentScale, x.rent * rentScale, x.rent * rentScale, x.rent * rentScale],
      population: x.pop,
      q1: x.q1,
      q3: x.q3,
    };
  });
  return {
    districts,
    dwellingSize: s.dwellingSize,
    renterRate: { Taipei: s.renterTaipei, "New Taipei": s.renterNewTaipei },
    rentThreshold: s.threshold,
  };
}

describe("Property 41: rent-burden tail share and sensitivity are bounded and monotone", () => {
  it("share and sensitivity lie in [0, 1]", () => {
    let bad: string | undefined;
    fc.assert(
      fc.property(scenario, (s) => {
        const r = rentGhostParams(build(s));
        const a = r.shareRent.value;
        const b = r.sensitivityRent.value;
        if (bad === undefined && !(a >= 0 && a <= 1 && b >= -CDF_TOL && b <= 1)) bad = `share ${a}, sensitivity ${b}`;
        return bad === undefined;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(bad).toBeUndefined();
  }, TIMEOUT);

  it("share does not decrease when rent increases", () => {
    let bad: string | undefined;
    fc.assert(
      fc.property(scenario, (s) => {
        const lo = rentGhostParams(build(s)).shareRent.value;
        const hi = rentGhostParams(build(s, s.rentFactor)).shareRent.value;
        if (bad === undefined && hi < lo - CDF_TOL) bad = `rent x${s.rentFactor}: ${lo} -> ${hi}`;
        return bad === undefined;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(bad).toBeUndefined();
  }, TIMEOUT);

  it("share does not increase when income increases", () => {
    let bad: string | undefined;
    fc.assert(
      fc.property(scenario, (s) => {
        const lo = rentGhostParams(build(s)).shareRent.value;
        const hi = rentGhostParams(build(s, 1, s.incomeFactor)).shareRent.value;
        if (bad === undefined && hi > lo + CDF_TOL) bad = `income x${s.incomeFactor}: ${lo} -> ${hi}`;
        return bad === undefined;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(bad).toBeUndefined();
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------
// Property 42: Commute shares are ordered and bounded
// **Validates: Requirements 22.9**
// ---------------------------------------------------------------------------------------------

const minutesArb = fc.oneof(
  fc.integer({ min: 0, max: 150 }),
  fc.double({ min: 0, max: 150, noNaN: true }),
  fc.double({ min: 58, max: 61, noNaN: true }),
);

const countArb = fc.integer({ min: 0, max: 10_000 });

const commuteScenario = fc.record({
  minutes: fc.array(fc.array(minutesArb, { minLength: DISTRICTS.length, maxLength: DISTRICTS.length }), {
    minLength: DISTRICTS.length,
    maxLength: DISTRICTS.length,
  }),
  counts: fc.array(fc.tuple(countArb, countArb, countArb), { minLength: DISTRICTS.length, maxLength: DISTRICTS.length }),
  jobShare: fc.array(fc.double({ min: 0.01, max: 10, noNaN: true }), {
    minLength: DISTRICTS.length,
    maxLength: DISTRICTS.length,
  }),
});

type CommuteScenario = typeof commuteScenario extends fc.Arbitrary<infer T> ? T : never;

function buildCommute(s: CommuteScenario): CommuteGhostInput {
  const cities: City[] = ["Taipei", "New Taipei"];
  const seen = new Set<City>();
  const rows = new Map<City, Map<string, WorkplaceRow>>(cities.map((c) => [c, new Map()]));
  DISTRICTS.forEach((d, i) => {
    const [a, b, c] = s.counts[i]!;
    // The first district of each city gets one extra same-district worker so the sum is positive.
    const same = seen.has(d.city) ? a : a + 1;
    seen.add(d.city);
    rows.get(d.city)!.set(d.code, { total: same + b + c, sameDistrict: same, otherDistrictSameCity: b, otherCountyOrAbroad: c });
  });
  const zero: WorkplaceRow = { total: 0, sameDistrict: 0, otherDistrictSameCity: 0, otherCountyOrAbroad: 0 };
  return {
    workplace: cities.map((city): CityWorkplace => ({ city, districts: rows.get(city)!, totals: zero })),
    jobShare: new Map(DISTRICTS.map((d, i) => [d.code, s.jobShare[i]!])),
    matrix: { codes: DISTRICTS.map((d) => d.code), minutes: s.minutes },
  };
}

describe("Property 42: commute shares are ordered and bounded", () => {
  it("0 <= low <= value = high <= 1 and the sensitivity lies in [0, 1] below the share above 59 minutes", () => {
    let bad: string | undefined;
    fc.assert(
      fc.property(commuteScenario, (s) => {
        const r = commuteGhostParams(buildCommute(s));
        const share = r.shareCommuteWithin;
        const low = share.range?.low;
        const high = share.range?.high;
        const sens = r.sensitivityCommute.value;
        // Share above 59 minutes = share above 60 minutes + sensitivity band (59, 60].
        const above59 = 1 - r.within60 + sens;
        const ok =
          low !== undefined &&
          high !== undefined &&
          low >= 0 &&
          low <= share.value &&
          share.value === high &&
          high <= 1 + 1e-12 &&
          r.within45 <= r.within60 &&
          sens >= 0 &&
          sens <= 1 + 1e-12 &&
          sens <= above59 + 1e-12;
        if (bad === undefined && !ok) bad = `low ${low}, value ${share.value}, high ${high}, sensitivity ${sens}, above59 ${above59}`;
        return bad === undefined;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(bad).toBeUndefined();
  }, TIMEOUT);
});
