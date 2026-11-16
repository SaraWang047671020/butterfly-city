// Property tests for the schema validator (Properties 20 and 21) in the data-pipeline spec.
//
// Placement: tests/data/ because the file imports only src/data/validate.ts, the shared builders in
// tests/data/helpers.ts and one pure function from the pipeline, serializeJson (scripts/pipeline/serialize.ts).
//
// Oracle for Property 20: every defect is a typed mutation that edits a deep copy of a valid file at a
// chosen location and returns the exact JSON path at which the validator reports it. The validator must
// report at least one error whose `path` equals that path. Locations of the defects in one run never
// collide: record-level defects use disjoint quarters (or disjoint series), key-level defects use
// disjoint district keys, and district-level defects use disjoint district-index slots.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateDistrictsFile, validateHistoryFile, validatePolicyTrackFile } from '../../src/data/validate.ts';
import type { ValidationError } from '../../src/data/validate.ts';
import { serializeJson } from '../../scripts/pipeline/serialize.ts';
import { DISTRICT_CODES, validContext, validDistrictsFile, validHistoryFile, validPolicyTrackFile } from './helpers.ts';
import type { Json } from './helpers.ts';

const ctx = validContext();
const NUM_RUNS = 100;
const TIMEOUT_MS = 30000;
const CITIES = ['Taipei', 'New Taipei'] as const;

// ---------------------------------------------------------------------------------------------
// Property 20 infrastructure

interface Mutation {
  /** Applies the defect to `file` (mutating it) and returns the JSON path where it must be reported. */
  readonly apply: (file: Json) => string;
}
interface Seed {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly v: number;
}
type Builder = (s: Seed) => Mutation;

const seedArb: fc.Arbitrary<Seed> = fc.record({ a: fc.nat(1000), b: fc.nat(1000), c: fc.nat(1000), v: fc.nat(2) });

function defectsArb(builders: readonly Builder[]): fc.Arbitrary<Mutation[]> {
  return fc
    .uniqueArray(fc.record({ kind: fc.nat(builders.length - 1), seed: seedArb }), {
      selector: (d) => d.kind,
      minLength: 1,
      maxLength: 5,
    })
    .map((list) => list.map((d) => (builders[d.kind] as Builder)(d.seed)));
}

const keyPath = (p: string, k: string): string => `${p}[${JSON.stringify(k)}]`;

function reportsAll(
  make: () => Json,
  validate: (x: unknown) => ValidationError[],
  mutations: readonly Mutation[],
): { baseErrors: ValidationError[]; missing: string[]; paths: string[] } {
  const baseErrors = validate(make());
  const file = make();
  const paths = mutations.map((m) => m.apply(file));
  const errors = validate(file);
  const missing = paths.filter((p) => !errors.some((e) => e.path === p));
  return { baseErrors, missing, paths };
}

function runProperty(make: () => Json, validate: (x: unknown) => ValidationError[], builders: readonly Builder[]): void {
  fc.assert(
    fc.property(defectsArb(builders), (mutations) => {
      const { baseErrors, missing, paths } = reportsAll(make, validate, mutations);
      expect(baseErrors).toEqual([]);
      expect(new Set(paths).size).toBe(paths.length); // defects sit at distinct locations
      expect(missing).toEqual([]);
    }),
    { numRuns: NUM_RUNS },
  );
}

// Shared builders -----------------------------------------------------------------------------

const BAD_SOURCE = 'no/such-source';

function apiKeyUrl(s: Seed): string {
  const name = ['api_key', 'token', 'key'][s.v] as string;
  return `https://data.example.gov.tw/x?format=json&${name}=SECRET${s.b}`;
}

function badQuarter(s: Seed): string {
  return ['2026Q1', '2014Q4', '2015Q5'][s.v] as string;
}

function nonFinite(s: Seed): number {
  return [NaN, Infinity, -Infinity][s.v] as number;
}

const apiKeyBuilder: Builder = (s) => ({
  apply: (f) => {
    const i = s.a % 2;
    f.sources[i].url = apiKeyUrl(s);
    return `$.sources[${i}].url`;
  },
});

const quarterBuilder: Builder = (s) => ({
  apply: (f) => {
    const i = s.a % 44;
    f.quarters[i] = badQuarter(s);
    return `$.quarters[${i}]`;
  },
});

// History builders ----------------------------------------------------------------------------

/** Record-level defects use indicator 0 (district) or 2 (city) and a disjoint quarter band per kind. */
function historyRecord(f: Json, s: Seed, band: number, onlyDistrict: boolean): { rec: Json; path: string } {
  const i = onlyDistrict || s.a % 2 === 0 ? 0 : 2;
  const key = i === 0 ? (DISTRICT_CODES[s.b % DISTRICT_CODES.length] as string) : (CITIES[s.b % 2] as string);
  const q = band * 8 + (s.c % 8);
  const sp = keyPath(`$.indicators[${i}].series`, key);
  return { rec: f.indicators[i].series[key][q], path: `${sp}[${q}]` };
}

const historyBuilders: Builder[] = [
  // removed required field
  (s) => ({
    apply: (f) => {
      const i = s.a % 3;
      delete f.indicators[i].description;
      return `$.indicators[${i}].description`;
    },
  }),
  // wrong type
  (s) => ({
    apply: (f) => {
      const i = s.a % 3;
      f.indicators[i].unit = [42, true, null][s.v];
      return `$.indicators[${i}].unit`;
    },
  }),
  // NaN or ±Infinity
  (s) => ({
    apply: (f) => {
      const { rec, path } = historyRecord(f, s, 0, false);
      rec.value = nonFinite(s);
      return `${path}.value`;
    },
  }),
  // estimated true without a method
  (s) => ({
    apply: (f) => {
      const { rec, path } = historyRecord(f, s, 1, false);
      rec.estimated = true;
      return `${path}.method`;
    },
  }),
  // estimated false with a method
  (s) => ({
    apply: (f) => {
      const { rec, path } = historyRecord(f, s, 2, false);
      rec.method = 'trend-extrapolation';
      return `${path}.method`;
    },
  }),
  // unknown method id
  (s) => ({
    apply: (f) => {
      const { rec, path } = historyRecord(f, s, 3, false);
      rec.estimated = true;
      rec.method = 'no-such-method';
      return `${path}.method`;
    },
  }),
  // negative count
  (s) => ({
    apply: (f) => {
      const { rec, path } = historyRecord(f, s, 4, true);
      rec.value = -(1 + (s.b % 1000));
      return `${path}.value`;
    },
  }),
  // unknown source id
  (s) => ({
    apply: (f) => {
      const i = s.a % 3;
      f.indicators[i].sources[0] = BAD_SOURCE;
      return `$.indicators[${i}].sources[0]`;
    },
  }),
  apiKeyBuilder,
  // unknown district code (indicator 1, one of the first 20 keys)
  (s) => ({
    apply: (f) => {
      const old = DISTRICT_CODES[s.a % 20] as string;
      const series = f.indicators[1].series;
      series['99999999'] = series[old];
      delete series[old];
      return keyPath('$.indicators[1].series', '99999999');
    },
  }),
  // series of the wrong length (indicator 1, one of the last 21 keys)
  (s) => ({
    apply: (f) => {
      const key = DISTRICT_CODES[20 + (s.b % 21)] as string;
      const records = f.indicators[1].series[key];
      if (s.v === 0) records.pop();
      else records.push({ ...records[0] });
      return keyPath('$.indicators[1].series', key);
    },
  }),
  quarterBuilder,
];

// Districts builders --------------------------------------------------------------------------

/** District index for a slot: slots are 4 apart and index 0 is never touched. */
const slotIndex = (slot: number, s: Seed): number => slot * 4 + 1 + (s.a % 3);

const districtBuilders: Builder[] = [
  // removed required field
  (s) => ({
    apply: (f) => {
      const i = slotIndex(0, s);
      delete f.districts[i].name;
      return `$.districts[${i}].name`;
    },
  }),
  // wrong type
  (s) => ({
    apply: (f) => {
      const i = slotIndex(1, s);
      f.districts[i].city = [5, false, null][s.v];
      return `$.districts[${i}].city`;
    },
  }),
  // NaN or ±Infinity
  (s) => ({
    apply: (f) => {
      const i = slotIndex(2, s);
      f.districts[i].areaKm2 = nonFinite(s);
      return `$.districts[${i}].areaKm2`;
    },
  }),
  // unknown district code
  (s) => ({
    apply: (f) => {
      const i = slotIndex(3, s);
      f.districts[i].code = '99999999';
      return `$.districts[${i}].code`;
    },
  }),
  // duplicated district code
  (s) => ({
    apply: (f) => {
      const i = slotIndex(4, s);
      f.districts[i].code = DISTRICT_CODES[0];
      return `$.districts[${i}].code`;
    },
  }),
  // wrong ring winding
  (s) => ({
    apply: (f) => {
      const i = slotIndex(5, s);
      f.districts[i].geometry.coordinates[0].reverse();
      return `$.districts[${i}].geometry.coordinates[0]`;
    },
  }),
  // unclosed ring
  (s) => ({
    apply: (f) => {
      const i = slotIndex(6, s);
      const ring = f.districts[i].geometry.coordinates[0];
      const last = ring[ring.length - 1];
      ring[ring.length - 1] = [Math.round((last[0] + 0.01) * 1e5) / 1e5, last[1]];
      return `$.districts[${i}].geometry.coordinates[0]`;
    },
  }),
  // unknown source id in provenance
  (s) => ({
    apply: (f) => {
      const field = ['code', 'city', 'name', 'areaKm2', 'centroid', 'geometry'][s.a % 6] as string;
      f.provenance[field].sources[0] = BAD_SOURCE;
      return `$.provenance.${field}.sources[0]`;
    },
  }),
  apiKeyBuilder,
];

// Policy-track builders -----------------------------------------------------------------------

/** City series indices used by record-level defects; each kind owns one series. */
function trackRecord(f: Json, s: Seed, seriesIndex: number): { rec: Json; path: string } {
  const key = CITIES[s.b % 2] as string;
  const q = s.c % 44;
  const sp = keyPath(`$.policySeries[${seriesIndex}].series`, key);
  return { rec: f.policySeries[seriesIndex].series[key][q], path: `${sp}[${q}]` };
}

const policyBuilders: Builder[] = [
  // removed required field
  (s) => ({
    apply: (f) => {
      const i = s.a % 10;
      delete f.policySeries[i].description;
      return `$.policySeries[${i}].description`;
    },
  }),
  // wrong type
  (s) => ({
    apply: (f) => {
      const i = s.a % 10;
      f.policySeries[i].unit = [42, true, null][s.v];
      return `$.policySeries[${i}].unit`;
    },
  }),
  // NaN or ±Infinity
  (s) => ({
    apply: (f) => {
      const { rec, path } = trackRecord(f, s, 7);
      rec.value = nonFinite(s);
      return `${path}.value`;
    },
  }),
  // estimated true without a method
  (s) => ({
    apply: (f) => {
      const { rec, path } = trackRecord(f, s, 8);
      rec.estimated = true;
      return `${path}.method`;
    },
  }),
  // estimated false with a method
  (s) => ({
    apply: (f) => {
      const { rec, path } = trackRecord(f, s, 9);
      rec.method = 'trend-extrapolation';
      return `${path}.method`;
    },
  }),
  // unknown method id
  (s) => ({
    apply: (f) => {
      const { rec, path } = trackRecord(f, s, 2);
      rec.estimated = true;
      rec.method = 'no-such-method';
      return `${path}.method`;
    },
  }),
  // Track_Record whose source id is not defined
  (s) => ({
    apply: (f) => {
      const { rec, path } = trackRecord(f, s, 3);
      rec.source = BAD_SOURCE;
      return `${path}.source`;
    },
  }),
  // negative count Track_Record
  (s) => ({
    apply: (f) => {
      const { rec, path } = trackRecord(f, s, 1);
      rec.value = -(1 + (s.b % 1000));
      return `${path}.value`;
    },
  }),
  // percentage outside 0..100 (highest-tier holding tax rate)
  (s) => ({
    apply: (f) => {
      const { rec, path } = trackRecord(f, s, 5);
      rec.value = [100.5, 250, -1][s.v];
      return `${path}.value`;
    },
  }),
  // unknown source id
  (s) => ({
    apply: (f) => {
      const i = s.a % 10;
      f.policySeries[i].sources[0] = BAD_SOURCE;
      return `$.policySeries[${i}].sources[0]`;
    },
  }),
  apiKeyBuilder,
  // unknown district code (series 0, one of the first 20 keys)
  (s) => ({
    apply: (f) => {
      const old = DISTRICT_CODES[s.a % 20] as string;
      const series = f.policySeries[0].series;
      series['99999999'] = series[old];
      delete series[old];
      return keyPath('$.policySeries[0].series', '99999999');
    },
  }),
  // series of the wrong length (series 0, one of the last 21 keys)
  (s) => ({
    apply: (f) => {
      const key = DISTRICT_CODES[20 + (s.b % 21)] as string;
      const records = f.policySeries[0].series[key];
      if (s.v === 0) records.pop();
      else records.push({ ...records[0] });
      return keyPath('$.policySeries[0].series', key);
    },
  }),
  quarterBuilder,
];

describe('Property 20: The validator detects every injected defect', () => {
  // Feature: data-pipeline, Property 20: The validator detects every injected defect
  // **Validates: Requirements 3.1, 3.4, 3.5, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 12.2, 12.3, 14.3, 14.4, 14.5, 14.7, 16.1, 16.2, 16.3, 16.4, 16.5**
  it(
    'history.json: 1 to 5 injected defects are each reported at their JSON path; no error without defects',
    () => runProperty(validHistoryFile, (x) => validateHistoryFile(x, ctx), historyBuilders),
    TIMEOUT_MS,
  );

  // Feature: data-pipeline, Property 20: The validator detects every injected defect
  it(
    'districts.json: 1 to 5 injected defects are each reported at their JSON path; no error without defects',
    () => runProperty(validDistrictsFile, (x) => validateDistrictsFile(x, ctx), districtBuilders),
    TIMEOUT_MS,
  );

  // Feature: data-pipeline, Property 20: The validator detects every injected defect
  it(
    'policy-track.json: 1 to 5 injected defects are each reported at their JSON path; no error without defects',
    () => runProperty(validPolicyTrackFile, (x) => validatePolicyTrackFile(x, ctx), policyBuilders),
    TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------------------------
// Property 21: serialize, parse and validate round trip

function expectRoundTrip(file: Json, validate: (x: unknown) => ValidationError[]): void {
  expect(validate(file)).toEqual([]);
  const parsed: unknown = JSON.parse(serializeJson(file));
  expect(parsed).toEqual(file);
  expect(validate(parsed)).toEqual([]);
}

const rotate = <T>(pool: readonly T[], shift: number, q: number): T => pool[(q + shift) % pool.length] as T;

const QUARTER_COUNT = 44;

// History -------------------------------------------------------------------------------------

const historyItemArb = fc.record({
  n: fc.nat(10_000_000),
  est: fc.boolean(),
  nul: fc.boolean(),
  method: fc.constantFrom('interp-annual-quarterly', 'trend-extrapolation'),
});
type HistoryItem = { n: number; est: boolean; nul: boolean; method: string };

function historyRecordOf(item: HistoryItem, value: number): Json {
  if (item.est && item.nul) return { value: null, estimated: true, method: 'no-data-reason' };
  if (item.est) return { value, estimated: true, method: item.method };
  return { value, estimated: false };
}

const historyPoolsArb = fc.record({
  population: fc.array(historyItemArb, { minLength: QUARTER_COUNT, maxLength: QUARTER_COUNT }),
  rent: fc.array(historyItemArb, { minLength: QUARTER_COUNT, maxLength: QUARTER_COUNT }),
  ratio: fc.array(historyItemArb, { minLength: QUARTER_COUNT, maxLength: QUARTER_COUNT }),
});

function randomHistoryFile(pools: { population: HistoryItem[]; rent: HistoryItem[]; ratio: HistoryItem[] }): Json {
  const f = validHistoryFile();
  const fill = (ind: Json, pool: HistoryItem[], toValue: (n: number) => number): void => {
    Object.keys(ind.series).forEach((key, k) => {
      ind.series[key] = ind.series[key].map((_: unknown, q: number) => {
        const item = rotate(pool, k * 3, q);
        return historyRecordOf(item, toValue(item.n));
      });
    });
  };
  fill(f.indicators[0], pools.population, (n) => n);
  fill(f.indicators[1], pools.rent, (n) => (n + 1) / 10);
  fill(f.indicators[2], pools.ratio, (n) => (n + 1) / 100);
  return f;
}

// Districts -----------------------------------------------------------------------------------

const districtItemArb = fc.record({
  area: fc.integer({ min: 1, max: 1_000_000 }),
  ux: fc.nat(300_000),
  uy: fc.nat(300_000),
  w: fc.integer({ min: 1, max: 5000 }),
  h: fc.integer({ min: 1, max: 5000 }),
  multi: fc.boolean(),
  name: fc.stringMatching(/^[A-Za-z][A-Za-z' ]{0,12}[A-Za-z]$/),
});
type DistrictItem = { area: number; ux: number; uy: number; w: number; h: number; multi: boolean; name: string };

function randomDistrictsFile(items: DistrictItem[]): Json {
  const f = validDistrictsFile();
  f.districts.forEach((d: Json, i: number) => {
    const it = items[i] as DistrictItem;
    const u = (n: number): number => n / 1e5;
    const x0 = 12_000_000 + it.ux;
    const y0 = 2_400_000 + it.uy;
    const x1 = x0 + it.w;
    const y1 = y0 + it.h;
    const ring = [
      [u(x0), u(y0)],
      [u(x0), u(y1)],
      [u(x1), u(y1)],
      [u(x1), u(y0)],
      [u(x0), u(y0)],
    ];
    d.name = it.name;
    d.areaKm2 = it.area / 100;
    d.centroid = [u(x0 + Math.floor(it.w / 2)), u(y0 + Math.floor(it.h / 2))];
    d.geometry = it.multi ? { type: 'MultiPolygon', coordinates: [[ring]] } : { type: 'Polygon', coordinates: [ring] };
  });
  return f;
}

// Policy track --------------------------------------------------------------------------------

const trackItemArb = fc.record({
  n: fc.nat(10_000_000),
  lo: fc.nat(5000),
  extra: fc.nat(5000),
  est: fc.boolean(),
  src: fc.constantFrom('test/source-a', 'test/source-b'),
});
type TrackItem = { n: number; lo: number; extra: number; est: boolean; src: string };

function randomPolicyFile(pool: TrackItem[]): Json {
  const f = validPolicyTrackFile();
  for (const s of f.policySeries as Json[]) {
    Object.keys(s.series).forEach((key, k) => {
      s.series[key] = s.series[key].map((_: unknown, q: number) => {
        const item = rotate(pool, k * 5, q);
        const value =
          s.id === 'holdingTaxRateLowestTier'
            ? item.lo / 100
            : s.id === 'holdingTaxRateHighestTier'
              ? (item.lo + item.extra) / 100
              : item.n;
        return item.est
          ? { value, source: item.src, estimated: true, method: 'trend-extrapolation' }
          : { value, source: item.src, estimated: false };
      });
    });
  }
  return f;
}

describe('Property 21: Serialize, parse and validate round trip', () => {
  // Feature: data-pipeline, Property 21: Serialize, parse and validate round trip
  // **Validates: Requirements 16.10, 16.11, 16.12**
  it(
    'history.json with random rounded values survives serializeJson and JSON.parse unchanged and valid',
    () => {
      fc.assert(
        fc.property(historyPoolsArb, (pools) => {
          expectRoundTrip(randomHistoryFile(pools), (x) => validateHistoryFile(x, ctx));
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT_MS,
  );

  // Feature: data-pipeline, Property 21: Serialize, parse and validate round trip
  it(
    'districts.json with random geometry, areas and names survives the round trip unchanged and valid',
    () => {
      fc.assert(
        fc.property(fc.array(districtItemArb, { minLength: 41, maxLength: 41 }), (items) => {
          expectRoundTrip(randomDistrictsFile(items), (x) => validateDistrictsFile(x, ctx));
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT_MS,
  );

  // Feature: data-pipeline, Property 21: Serialize, parse and validate round trip
  it(
    'policy-track.json with random Track_Records survives the round trip unchanged and valid',
    () => {
      fc.assert(
        fc.property(fc.array(trackItemArb, { minLength: QUARTER_COUNT, maxLength: QUARTER_COUNT }), (pool) => {
          expectRoundTrip(randomPolicyFile(pool), (x) => validatePolicyTrackFile(x, ctx));
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT_MS,
  );
});
