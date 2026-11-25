// fast-check generators for the simulation engine tests (fast-check 4.x).
// All values are built in memory on top of the fixtures; no file I/O (Requirement 17.6).
//
// Composition notes
// - Baseline, Real_Policy_Track, Parameter_Table and Player_Policy_Timeline must agree on the number of
//   quarters and on the commuter pass price. `arbPassSetup` draws the quarter in which the pass price
//   becomes positive and the price; pass the same setup to `arbParams`, `arbRealTrack` and
//   `arbPlayerTimeline`. `arbEngineInputs` does this composition for the property tests.
// - Policy_Limit factors are fixed at the fixture defaults (lower 0, upper 2), so the player modes
//   below know the limits. The pass price is the upper limit of the commuter pass subsidy.
// - A generated rent subsidy household count can exceed the renter households of a district with a
//   very small population (Baseline population starts at 0, as the spec asks); tests that need a
//   successful run should treat `households-exceed-renters` as an acceptable outcome or use `fc.pre`.

import * as fc from 'fast-check';
import type { CityName, DistrictCode, QuarterKey } from '../../src/types/data-files.ts';
import type {
  AreaKey,
  CommuteMatrix,
  EngineBaseline,
  EngineErrorCode,
  ParameterProblem,
  ParameterStatus,
  ParameterTable,
  PolicyTimeline,
  SimEvent,
  ToolId,
} from '../../src/types/simulation.ts';
import { quarterAt } from '../../src/simulation/quarter.ts';
import {
  CITIES,
  DISTRICT_CODES,
  buildBaseline,
  buildParams,
  cityOf,
  districtsOf,
  makeEvent,
  scalar,
  schedule,
  withModifierParameters,
} from './fixtures/index.ts';
import type { ParameterEntry } from './fixtures/index.ts';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const TOOLS: readonly ToolId[] = ['socialHousing', 'commuterPass', 'rentSubsidy', 'sublease', 'holdingTax'];

function dbl(min: number, max: number): fc.Arbitrary<number> {
  return fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
}

/** [low, value, high] with low <= value <= high, all inside [min, max]. */
function ranged(min: number, max: number): fc.Arbitrary<readonly [number, number, number]> {
  return fc.tuple(dbl(min, max), dbl(min, max), dbl(min, max)).map((t) => {
    const [low = min, value = min, high = max] = [...t].sort((a, b) => a - b);
    return [low, value, high] as const;
  });
}

const unit = dbl(0, 1);

// ---------------------------------------------------------------------------
// Pass setup
// ---------------------------------------------------------------------------

export interface PassSetup {
  /** Quarter index (0 is 2015Q1) from which the commuter pass price is positive. 44 or more: never. */
  readonly start: number;
  /** Pass price in TWD per month while positive. */
  readonly price: number;
}

export const DEFAULT_PASS_SETUP: PassSetup = { start: 32, price: 1280 };

/** The pass price is 0 before `start`, so both "price 0" and "price positive" occur in 1 to 8 quarters. */
export const arbPassSetup: fc.Arbitrary<PassSetup> = fc.record({
  start: fc.integer({ min: 0, max: 10 }),
  price: fc.integer({ min: 500, max: 3000 }),
});

export function priceAt(pass: PassSetup, quarterIdx: number): number {
  return quarterIdx >= pass.start ? pass.price : 0;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

/**
 * Baseline with 41 districts. Population 0 to 500,000, income 300,000 to 3,000,000, rent 100 to 2,000,
 * MRT entries 0 to 20,000,000 (0 in about a third of the cells), stock 0 to 20,000.
 * `quarters` fixed, or 1 to 8 when omitted.
 */
export function arbBaseline(quarters?: number): fc.Arbitrary<EngineBaseline> {
  const count = quarters === undefined ? fc.integer({ min: 1, max: 8 }) : fc.constant(quarters);
  return count.chain((n) => {
    const len = n * DISTRICT_CODES.length;
    const cells = <T>(a: fc.Arbitrary<T>) => fc.array(a, { minLength: len, maxLength: len });
    return fc
      .tuple(
        cells(fc.integer({ min: 0, max: 500_000 })),
        cells(fc.integer({ min: 300_000, max: 3_000_000 })),
        cells(dbl(100, 2000)),
        cells(fc.oneof({ weight: 1, arbitrary: fc.constant(0) }, { weight: 2, arbitrary: fc.integer({ min: 0, max: 20_000_000 }) })),
        cells(fc.integer({ min: 0, max: 20_000 })),
      )
      .map(([pop, inc, rent, mrt, stock]) =>
        buildBaseline({
          quarters: n,
          population: (i, q) => pop[i * n + q] ?? 0,
          householdIncome: (i, q) => inc[i * n + q] ?? 1,
          rent: (i, q) => rent[i * n + q] ?? 100,
          mrtEntries: (i, q) => mrt[i * n + q] ?? 0,
          socialHousingStock: (i, q) => stock[i * n + q] ?? 0,
        }),
      );
  });
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const NLMA_NOTE = 'Median of NLMA portal projects, whole quarters (NLMA derivation, generated).';

/** Lag 0 to 43, below, inside and above the 12 to 20 band. */
const arbLag = fc.oneof(
  fc.integer({ min: 0, max: 11 }),
  fc.integer({ min: 12, max: 20 }),
  fc.integer({ min: 21, max: 43 }),
);

const arbScheduleParts: fc.Arbitrary<{ offsets: readonly number[]; shares: readonly number[] }> = fc
  .uniqueArray(fc.integer({ min: 0, max: 11 }), { minLength: 1, maxLength: 8 })
  .chain((offs) =>
    fc
      .array(fc.integer({ min: 1, max: 20 }), { minLength: offs.length, maxLength: offs.length })
      .map((w) => {
        const total = w.reduce((a, b) => a + b, 0);
        return { offsets: [...offs].sort((a, b) => a - b), shares: w.map((x) => x / total) };
      }),
  );

/** Replaces status metadata so every rule of the metadata checks holds. */
function withStatus(
  entry: ParameterEntry,
  status: ParameterStatus,
  keepEstimated: boolean,
): ParameterEntry {
  const { estimated: oldEstimated, assumption: oldAssumption, ...rest } = entry;
  const needsEstimate = status === 'secondary' || status === 'gap';
  const estimated =
    needsEstimate || keepEstimated ? (oldEstimated ?? { method: 'Generated estimate method.' }) : undefined;
  const assumption =
    status === 'gap' ? (oldAssumption ?? 'Generated assumption.') : keepEstimated ? oldAssumption : undefined;
  return {
    ...rest,
    status,
    ...(estimated === undefined ? {} : { estimated }),
    ...(assumption === undefined ? {} : { assumption }),
  } as ParameterEntry;
}

const STATUSES: readonly ParameterStatus[] = ['verified', 'check', 'secondary', 'gap'];
const PROTECTED_IDS = new Set(['socialHousing.lag', 'socialHousing.rentRatio', 'ghost.sensitivityRent']);

export interface ParamsOptions {
  readonly pass?: PassSetup;
  /** Values of the synthetic `test.modifier.<n>` parameters (synthetic events only). */
  readonly modifierValues?: readonly number[];
}

/**
 * Valid Parameter_Table. Ranged parameters take a value inside [low, high]; every parameter carries a
 * status with the estimate and assumption the metadata checks need.
 */
export function arbParams(options: ParamsOptions = {}): fc.Arbitrary<ParameterTable> {
  const pass = options.pass ?? DEFAULT_PASS_SETUP;
  const modifierValues = options.modifierValues ?? [];
  return fc
    .record({
      lags: fc.tuple(arbLag, arbLag, arbLag),
      statusSeeds: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 16, maxLength: 16 }),
      lagStatus: fc.integer({ min: 0, max: 3 }),
      unitCost: ranged(3_000_000, 10_000_000),
      rentPerUnit: ranged(-0.002, 0.005),
      rentRatio: ranged(0.05, 1),
      elasticity: ranged(-1, -0.05),
      passThrough: ranged(0, 1),
      commuteThreshold: ranged(45, 60),
      within: ranged(0.3, 0.8),
      shareRent: dbl(0.05, 0.5),
      bothFraction: unit,
      sensitivityRent: fc.oneof(fc.constant(0), dbl(0.0001, 1)),
      sensitivityCommute: dbl(0, 0.01),
      ghostSize: fc.integer({ min: 1, max: 5000 }),
      perMinuteExtra: dbl(0, 50),
      other: fc.record({
        unitCosts: fc.tuple(dbl(0.5, 2), dbl(0.5, 2)),
        dwelling: dbl(15, 80),
        householdSize: fc.tuple(dbl(1.5, 4), dbl(1.5, 4)),
        renterRate: fc.tuple(dbl(0.1, 0.9), dbl(0.1, 0.9)),
        migration: fc.tuple(dbl(0, 20), dbl(0, 0.05), unit, dbl(0.001, 0.2), dbl(0.001, 0.2), dbl(0, 0.01), dbl(0, 50)),
      }),
      socialSchedule: arbScheduleParts,
      commuterSchedule: fc.option(arbScheduleParts, { nil: undefined }),
      rentSchedule: fc.option(arbScheduleParts, { nil: undefined }),
      atRisk: fc.boolean(),
    })
    .map((g) => {
      const o: Record<string, ParameterEntry | null> = {};
      const [socialLag, commuterLag, rentLag] = g.lags;
      o['socialHousing.lag'] = withStatus(
        scalar(socialLag, { unit: 'quarters', estimated: NLMA_NOTE }),
        STATUSES[g.lagStatus] ?? 'secondary',
        true,
      );
      o['commuterPass.lag'] = scalar(commuterLag, { unit: 'quarters' });
      o['rentSubsidy.lag'] = scalar(rentLag, { unit: 'quarters' });

      const [uLow, uVal, uHigh] = g.unitCost;
      o['socialHousing.unitCost'] = scalar(uVal, {
        unit: 'TWD per dwelling',
        range: [uLow, uHigh],
        status: 'secondary',
        estimated: 'Generated estimate method.',
      });
      o['socialHousing.costSchedule'] = schedule(g.socialSchedule.offsets, g.socialSchedule.shares);
      if (g.commuterSchedule !== undefined) {
        o['commuterPass.costSchedule'] = schedule(g.commuterSchedule.offsets, g.commuterSchedule.shares);
      }
      if (g.rentSchedule !== undefined) {
        o['rentSubsidy.costSchedule'] = schedule(g.rentSchedule.offsets, g.rentSchedule.shares);
      }

      const [rpLow, rpVal, rpHigh] = g.rentPerUnit;
      o['socialHousing.rentPerUnit'] = scalar(rpVal, { unit: 'TWD per m2 per month per unit', range: [rpLow, rpHigh] });
      const [rrLow, rrVal, rrHigh] = g.rentRatio;
      o['socialHousing.rentRatio'] = scalar(rrVal, {
        unit: 'share of market rent',
        status: 'secondary',
        range: [rrLow, rrHigh],
        estimated: 'Generated estimate method.',
        assumption: 'Taipei and New Taipei social housing rent rules are still to be checked.',
      });
      const [elLow, elVal, elHigh] = g.elasticity;
      o['commuterPass.elasticity'] = scalar(elVal, { unit: 'elasticity', range: [elLow, elHigh] });
      const [ptLow, ptVal, ptHigh] = g.passThrough;
      o['rentSubsidy.passThrough'] = scalar(ptVal, { unit: 'share', range: [ptLow, ptHigh] });

      const [ctLow, ctVal, ctHigh] = g.commuteThreshold;
      o['ghost.commuteThreshold'] = scalar(ctVal, { unit: 'minutes one way', range: [ctLow, ctHigh] });
      const [wLow, wVal, wHigh] = g.within;
      o['ghost.shareCommuteWithin'] = scalar(wVal, { unit: 'share', range: [wLow, wHigh] });
      o['ghost.shareRent'] = scalar(g.shareRent, { unit: 'share' });
      // shareBoth <= min(shareRent, 1 - shareCommuteWithin.high)
      o['ghost.shareBoth'] = scalar(g.bothFraction * Math.min(g.shareRent, 1 - wHigh), { unit: 'share' });
      o['ghost.sensitivityRent'] = scalar(g.sensitivityRent, {
        unit: 'share per percentage point',
        status: 'gap',
        estimated: 'No source yet; generated value.',
        assumption: 'Generated assumption.',
      });
      o['ghost.sensitivityCommute'] = scalar(g.sensitivityCommute, { unit: 'share per minute' });
      o['ghost.size'] = scalar(g.ghostSize, { unit: 'residents per ghost' });
      if (!g.atRisk) o['ghost.atRiskThreshold'] = null; // optional, never read

      const [uc1, uc2] = g.other.unitCosts;
      o['commuterPass.unitCost'] = scalar(uc1, { unit: 'TWD of budget per TWD of subsidy' });
      o['rentSubsidy.unitCost'] = scalar(uc2, { unit: 'TWD of budget per TWD of subsidy' });
      o['housing.dwellingSize'] = scalar(g.other.dwelling, { unit: 'm2' });
      o['housing.householdSize.Taipei'] = scalar(g.other.householdSize[0], { unit: 'persons per household' });
      o['housing.householdSize.New Taipei'] = scalar(g.other.householdSize[1], { unit: 'persons per household' });
      o['housing.renterRate.Taipei'] = scalar(g.other.renterRate[0], { unit: 'share' });
      o['housing.renterRate.New Taipei'] = scalar(g.other.renterRate[1], { unit: 'share' });
      const [mThreshold, mShare, mExit, mTime, mBurden, mCost, mPerMinute] = g.other.migration;
      o['migration.threshold'] = scalar(mThreshold, { unit: 'percentage points' });
      o['migration.share'] = scalar(mShare, { unit: 'share' });
      o['migration.exitShare'] = scalar(mExit, { unit: 'share' });
      o['migration.weightTime'] = scalar(mTime, { unit: 'per minute' });
      o['migration.weightBurden'] = scalar(mBurden, { unit: 'per percentage point' });
      o['migration.weightCost'] = scalar(mCost, { unit: 'per TWD' });
      o['migration.commuteCostPerMinute'] = scalar(mPerMinute, {
        unit: 'TWD per minute per month',
        range: [0, mPerMinute + g.perMinuteExtra],
      });

      for (const city of CITIES) {
        for (let q = 0; q < 44; q++) {
          o[`commuterPass.price.${city}.${quarterAt(q)}`] = scalar(priceAt(pass, q), { unit: 'TWD per month' });
        }
      }

      const table = buildParams({ overrides: o });
      // Spread status over the remaining parameters (the protected ids carry their own metadata).
      const ids = Object.keys(table).sort();
      const out: Record<string, ParameterEntry> = {};
      ids.forEach((id, i) => {
        const entry = table[id];
        if (entry === undefined) return;
        if (PROTECTED_IDS.has(id) || id.startsWith('commuterPass.price.')) {
          out[id] = entry;
          return;
        }
        const status = STATUSES[g.statusSeeds[i % g.statusSeeds.length] ?? 0] ?? 'verified';
        out[id] = withStatus(entry, status, false);
      });
      return withModifierParameters(out, modifierValues);
    });
}

// ---------------------------------------------------------------------------
// Commute matrix
// ---------------------------------------------------------------------------

/** 41 x 41 minutes, zero diagonal, 1 to 120 off the diagonal (not necessarily symmetric). */
export const arbCommuteMatrix: fc.Arbitrary<CommuteMatrix> = (() => {
  const n = DISTRICT_CODES.length;
  return fc.array(fc.integer({ min: 1, max: 120 }), { minLength: n * n, maxLength: n * n }).map((flat) => ({
    codes: DISTRICT_CODES,
    minutes: DISTRICT_CODES.map((_, i) => DISTRICT_CODES.map((__, j) => (i === j ? 0 : (flat[i * n + j] ?? 1)))),
  }));
})();

// ---------------------------------------------------------------------------
// Real_Policy_Track
// ---------------------------------------------------------------------------

const PER_QUARTER = DISTRICT_CODES.length + CITIES.length * 5; // 41 districts + 2 cities x 5 fields

/**
 * Real track for `quarters` quarters. Social housing units started 1 to 50 per district; commuter pass
 * fields only while the price is positive (subsidy below the price, so the real net price is positive);
 * rent subsidy households 0 to 3,000 and amount 0 to 20,000,000 per city; sublease homes matched 0 to 500 per city.
 */
export function arbRealTrack(quarters: number, pass: PassSetup = DEFAULT_PASS_SETUP): fc.Arbitrary<PolicyTimeline> {
  return fc
    .array(unit, { minLength: quarters * PER_QUARTER, maxLength: quarters * PER_QUARTER })
    .map((fr) => {
      const out: { quarter: QuarterKey; tools: Record<string, Record<string, Record<AreaKey, number>>> }[] = [];
      for (let q = 0; q < quarters; q++) {
        const base = q * PER_QUARTER;
        const price = priceAt(pass, q);
        const unitsStarted: Record<AreaKey, number> = {};
        DISTRICT_CODES.forEach((code, i) => {
          unitsStarted[code] = 1 + Math.floor((fr[base + i] ?? 0) * 50);
        });
        const subsidy: Record<AreaKey, number> = {};
        const passesSold: Record<AreaKey, number> = {};
        const households: Record<AreaKey, number> = {};
        const amount: Record<AreaKey, number> = {};
        const unitsMatched: Record<AreaKey, number> = {};
        CITIES.forEach((city, c) => {
          const k = base + DISTRICT_CODES.length + c * 5;
          subsidy[city] = price > 0 ? Math.floor((fr[k] ?? 0) * Math.floor(price * 0.9)) : 0;
          passesSold[city] = price > 0 ? 1 + Math.floor((fr[k + 1] ?? 0) * 500_000) : 0;
          households[city] = Math.floor((fr[k + 2] ?? 0) * 3000);
          amount[city] = Math.floor((fr[k + 3] ?? 0) * 20_000_000);
          unitsMatched[city] = Math.floor((fr[k + 4] ?? 0) * 500);
        });
        out.push({
          quarter: quarterAt(q),
          tools: {
            socialHousing: { unitsStarted },
            commuterPass: { subsidy, passesSold },
            rentSubsidy: { households, amount },
            sublease: { unitsMatched },
            // Rates stay on the real track in every generated timeline (not in EDITABLE): lowest <= highest always.
            holdingTax: { lowestRate: { Taipei: 2.4, 'New Taipei': 1.5 }, highestRate: { Taipei: 3.6, 'New Taipei': 1.5 } },
          },
        });
      }
      return out;
    });
}

// ---------------------------------------------------------------------------
// Player_Policy_Timeline
// ---------------------------------------------------------------------------

export type PlayerMode =
  | 'all-zero'
  | 'equal-to-real'
  | 'largest-accepted'
  | 'in-limit'
  | 'reallocation'
  | 'helping-direction';

export const PLAYER_MODES: readonly PlayerMode[] = [
  'all-zero',
  'equal-to-real',
  'largest-accepted',
  'in-limit',
  'reallocation',
  'helping-direction',
];

/** Fixture limit factors (`buildParams`): lower 0, upper 2. */
const UPPER_FACTOR = 2;

type MutableTools = Record<string, Record<string, Record<AreaKey, number>>>;

function cloneTools(tools: PolicyTimeline[number]['tools']): MutableTools {
  const out: MutableTools = {};
  for (const [tool, fields] of Object.entries(tools)) {
    const f: Record<string, Record<AreaKey, number>> = {};
    for (const [field, areas] of Object.entries(fields)) f[field] = { ...areas };
    out[tool] = f;
  }
  return out;
}

function realValue(real: PolicyTimeline, q: number, tool: string, field: string, area: AreaKey): number {
  return real[q]?.tools[tool]?.[field]?.[area] ?? 0;
}

/** Upper Policy_Limit of an editable field under the fixture factors. */
function upperLimit(real: PolicyTimeline, pass: PassSetup, q: number, tool: string, field: string, area: AreaKey): number {
  if (tool === 'commuterPass' && field === 'subsidy') return priceAt(pass, q);
  return UPPER_FACTOR * realValue(real, q, tool, field, area);
}

const EDITABLE: readonly { readonly tool: string; readonly field: string; readonly level: 'district' | 'city' }[] = [
  { tool: 'socialHousing', field: 'unitsStarted', level: 'district' },
  { tool: 'commuterPass', field: 'subsidy', level: 'city' },
  { tool: 'rentSubsidy', field: 'households', level: 'city' },
  { tool: 'rentSubsidy', field: 'amount', level: 'city' },
  { tool: 'sublease', field: 'unitsMatched', level: 'city' },
];

function areasOf(level: 'district' | 'city'): readonly AreaKey[] {
  return level === 'district' ? DISTRICT_CODES : CITIES;
}

/**
 * Player timeline over the same quarters as `real`.
 * - `all-zero`: every editable field 0 (lower limit factor is 0).
 * - `equal-to-real`: a copy of the real track.
 * - `largest-accepted`: every editable field at its upper limit (not budget neutral).
 * - `in-limit`: every editable field between its limits.
 * - `reallocation`: units moved between districts of one city in one quarter, so the totals and the
 *   budget stay equal and every value stays within its limits.
 * - `helping-direction`: exactly one tool field of one district or city and quarter changes, in the
 *   direction that helps renters (more units, a higher pass subsidy, more households or more money);
 *   every other value equals the real track.
 * `mode` fixed, or drawn from all six when omitted.
 */
export function arbPlayerTimeline(
  real: PolicyTimeline,
  pass: PassSetup = DEFAULT_PASS_SETUP,
  mode?: PlayerMode,
): fc.Arbitrary<PolicyTimeline> {
  const modeArb = mode === undefined ? fc.constantFrom(...PLAYER_MODES) : fc.constant(mode);
  const n = real.length;
  const fracLen = n * PER_QUARTER;
  return fc
    .record({
      mode: modeArb,
      fr: fc.array(unit, { minLength: fracLen, maxLength: fracLen }),
      moves: fc.array(fc.tuple(unit, unit, unit, unit, unit), { minLength: 1, maxLength: 3 }),
      help: fc.tuple(fc.integer({ min: 0, max: 4 }), unit, unit, unit),
    })
    .map(({ mode: m, fr, moves, help }) => {
      const timeline = real.map((s) => ({ quarter: s.quarter, tools: cloneTools(s.tools) }));
      if (n === 0 || m === 'equal-to-real') return timeline;

      if (m === 'all-zero' || m === 'largest-accepted' || m === 'in-limit') {
        timeline.forEach((s, q) => {
          let k = q * PER_QUARTER;
          for (const { tool, field, level } of EDITABLE) {
            const target = s.tools[tool]?.[field];
            if (target === undefined) continue;
            for (const area of areasOf(level)) {
              const upper = upperLimit(real, pass, q, tool, field, area);
              const f = fr[k++ % fracLen] ?? 0;
              target[area] = m === 'all-zero' ? 0 : m === 'largest-accepted' ? upper : Math.min(upper, Math.floor(f * (upper + 1)));
            }
          }
        });
        return timeline;
      }

      if (m === 'reallocation') {
        for (const [fq, fcity, fa, fb, fd] of moves) {
          const q = Math.min(n - 1, Math.floor(fq * n));
          const city: CityName = fcity < 0.5 ? 'Taipei' : 'New Taipei';
          const codes = districtsOf(city);
          const ia = Math.min(codes.length - 1, Math.floor(fa * codes.length));
          let ib = Math.min(codes.length - 1, Math.floor(fb * codes.length));
          if (ib === ia) ib = (ib + 1) % codes.length;
          const a = codes[ia];
          const b = codes[ib];
          const units = timeline[q]?.tools.socialHousing?.unitsStarted;
          if (a === undefined || b === undefined || units === undefined) continue;
          const curA = units[a] ?? 0;
          const curB = units[b] ?? 0;
          const room = Math.max(0, upperLimit(real, pass, q, 'socialHousing', 'unitsStarted', b) - curB);
          const d = Math.min(Math.min(curA, room), Math.floor(fd * (Math.min(curA, room) + 1)));
          units[a] = curA - d;
          units[b] = curB + d;
        }
        return timeline;
      }

      // helping-direction
      const [kindIdx, fqq, farea, fmag] = help;
      const spec = EDITABLE[kindIdx % EDITABLE.length] ?? EDITABLE[0];
      if (spec === undefined) return timeline;
      const q = Math.min(n - 1, Math.floor(fqq * n));
      const areas = areasOf(spec.level);
      const area = areas[Math.min(areas.length - 1, Math.floor(farea * areas.length))];
      if (area === undefined) return timeline;
      const target = timeline[q]?.tools[spec.tool]?.[spec.field];
      if (target === undefined) return timeline;
      const current = realValue(real, q, spec.tool, spec.field, area);
      const upper = upperLimit(real, pass, q, spec.tool, spec.field, area);
      if (upper > current) target[area] = current + Math.max(1, Math.floor(fmag * (upper - current)));
      return timeline;
    });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventMode = 'real-style' | 'synthetic';

export interface GeneratedEvents {
  readonly events: readonly SimEvent[];
  /** Values for `test.modifier.<n>`, n from 0; empty in real-style mode. Pass to `arbParams`. */
  readonly modifierValues: readonly number[];
}

/**
 * 0 to 10 events inside the first `quarters` quarters. Real-style events carry no modifier and need no
 * modifier parameter. Synthetic events carry 0 to 3 modifiers each; their values (0 to 3) are returned
 * so the caller can add the `test.modifier.<n>` parameters. The two modes are never mixed.
 */
export function arbEvents(quarters: number, mode: EventMode): fc.Arbitrary<GeneratedEvents> {
  const last = Math.max(0, quarters - 1);
  const spec = fc.record({
    first: fc.integer({ min: 0, max: last }),
    span: fc.integer({ min: 0, max: 3 }),
    tools: mode === 'synthetic'
      ? fc.array(fc.constantFrom(...TOOLS), { minLength: 0, maxLength: 3 })
      : fc.constant([] as ToolId[]),
  });
  return fc
    .record({
      specs: fc.array(spec, { minLength: 0, maxLength: 10 }),
      values: fc.array(dbl(0, 3), { minLength: 30, maxLength: 30 }),
    })
    .map(({ specs, values }) => {
      let next = 0;
      const events = specs.map((s, i) => {
        const modifiers = s.tools.map((tool) => ({ tool, parameterId: `test.modifier.${next++}` }));
        return makeEvent(`event-${i}`, quarterAt(s.first), quarterAt(Math.min(last, s.first + s.span)), modifiers);
      });
      return { events, modifierValues: values.slice(0, next) };
    });
}

// ---------------------------------------------------------------------------
// Whole input set
// ---------------------------------------------------------------------------

export interface EngineInputs {
  readonly policies: PolicyTimeline;
  readonly events: readonly SimEvent[];
  readonly params: ParameterTable;
  readonly baseline: EngineBaseline;
  readonly realTrack: PolicyTimeline;
  readonly commute: CommuteMatrix;
  /** Last quarter of the baseline. A string so defects can make it malformed. */
  readonly target: string;
}

export interface EngineInputsOptions {
  readonly eventMode?: EventMode;
  readonly playerMode?: PlayerMode;
  readonly quarters?: number;
}

/** Consistent valid inputs for `run`: 1 to 8 quarters (or `options.quarters`), every part agreeing. */
export function arbEngineInputs(options: EngineInputsOptions = {}): fc.Arbitrary<EngineInputs> {
  const quarters = options.quarters === undefined ? fc.integer({ min: 1, max: 8 }) : fc.constant(options.quarters);
  return fc
    .tuple(quarters, arbPassSetup)
    .chain(([n, pass]) =>
      fc
        .tuple(
          arbBaseline(n),
          arbRealTrack(n, pass),
          arbEvents(n, options.eventMode ?? 'real-style'),
          arbCommuteMatrix,
        )
        .chain(([baseline, realTrack, ev, commute]) =>
          fc
            .tuple(
              arbParams({ pass, modifierValues: ev.modifierValues }),
              arbPlayerTimeline(realTrack, pass, options.playerMode),
            )
            .map(([params, policies]): EngineInputs => ({
              policies,
              events: ev.events,
              params,
              baseline,
              realTrack,
              commute,
              target: quarterAt(n - 1),
            })),
        ),
    );
}

// ---------------------------------------------------------------------------
// Defects (Properties 19, 20 and 26)
// ---------------------------------------------------------------------------

export type DefectKind =
  // Property 19: invalid inputs
  | 'target-malformed'
  | 'baseline-null'
  | 'baseline-district-missing'
  | 'baseline-negative'
  | 'baseline-non-finite'
  | 'track-player-quarter-missing'
  | 'track-real-field-missing'
  | 'policy-negative'
  | 'policy-fractional'
  | 'policy-non-finite'
  | 'subsidy-above-price'
  | 'event-reference-unknown'
  | 'matrix-negative'
  | 'matrix-non-finite'
  | 'matrix-diagonal'
  | 'matrix-size'
  // Property 20: parameter validation
  | 'param-missing'
  | 'param-non-finite'
  | 'param-unit-blank'
  | 'param-source-blank'
  | 'param-range-inverted'
  | 'param-value-outside-range'
  | 'param-lag-out-of-range'
  | 'param-unit-cost-nonpositive'
  | 'param-share-out-of-range'
  | 'param-ghost-size-low'
  | 'param-schedule-sum'
  | 'param-limit-factor'
  | 'param-absolute-limit'
  // Property 20 and 26: metadata
  | 'nlma-note-missing'
  | 'status-missing'
  | 'status-unknown'
  | 'estimated-missing'
  | 'estimated-blank'
  | 'assumption-missing';

/** One injected defect. Every field is a random knob; `kind` decides which ones are used. */
export interface Defect {
  readonly property: 19 | 20 | 26;
  readonly kind: DefectKind;
  readonly district: number; // 0 to 40
  readonly quarter: number; // 0 to 7, clamped to the quarters present
  readonly variant: number; // 0 to 99
}

const PROPERTY_19_KINDS: readonly DefectKind[] = [
  'target-malformed', 'baseline-null', 'baseline-district-missing', 'baseline-negative', 'baseline-non-finite',
  'track-player-quarter-missing', 'track-real-field-missing', 'policy-negative', 'policy-fractional',
  'policy-non-finite', 'subsidy-above-price', 'event-reference-unknown', 'matrix-negative',
  'matrix-non-finite', 'matrix-diagonal', 'matrix-size',
];
const PROPERTY_20_KINDS: readonly DefectKind[] = [
  'param-missing', 'param-non-finite', 'param-unit-blank', 'param-source-blank', 'param-range-inverted',
  'param-value-outside-range', 'param-lag-out-of-range', 'param-unit-cost-nonpositive',
  'param-share-out-of-range', 'param-ghost-size-low', 'param-schedule-sum', 'param-limit-factor',
  'param-absolute-limit', 'nlma-note-missing',
];
const PROPERTY_26_KINDS: readonly DefectKind[] = [
  'status-missing', 'status-unknown', 'estimated-missing', 'estimated-blank', 'assumption-missing',
  'nlma-note-missing',
];

/** One defect of Property 19, 20 or 26 (or any of them when `property` is omitted). */
export function arbDefect(property?: 19 | 20 | 26): fc.Arbitrary<Defect> {
  const pick = (p: 19 | 20 | 26): fc.Arbitrary<Defect> =>
    fc.record({
      property: fc.constant(p),
      kind: fc.constantFrom(...(p === 19 ? PROPERTY_19_KINDS : p === 20 ? PROPERTY_20_KINDS : PROPERTY_26_KINDS)),
      district: fc.integer({ min: 0, max: DISTRICT_CODES.length - 1 }),
      quarter: fc.integer({ min: 0, max: 7 }),
      variant: fc.integer({ min: 0, max: 99 }),
    });
  return property === undefined ? fc.oneof(pick(19), pick(20), pick(26)) : pick(property);
}

export interface DefectExpectation {
  /** Acceptable error codes (ambiguous defects list more than one). */
  readonly codes: readonly EngineErrorCode[];
  readonly district?: DistrictCode;
  readonly quarter?: QuarterKey;
  /** parameters-invalid only: the corrupted ids with their acceptable problem codes. */
  readonly issues?: readonly { readonly parameterId: string; readonly problems: readonly ParameterProblem[] }[];
}

type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;

function mutableCopy<T>(value: T): DeepMutable<T> {
  return structuredClone(value) as DeepMutable<T>;
}

const BASELINE_REQUIRED = ['population', 'householdIncome', 'rent'] as const;
const GENERIC_PARAMS: readonly string[] = [
  'housing.dwellingSize', 'migration.threshold', 'migration.share', 'ghost.size', 'commuterPass.lag',
  'rentSubsidy.unitCost', 'commuterPass.elasticity', 'socialHousing.unitCost',
];
const RANGED_PARAMS: readonly string[] = ['commuterPass.elasticity', 'rentSubsidy.passThrough', 'socialHousing.unitCost'];
const LAG_PARAMS: readonly string[] = ['socialHousing.lag', 'commuterPass.lag', 'rentSubsidy.lag'];
const UNIT_COST_PARAMS: readonly string[] = ['commuterPass.unitCost', 'rentSubsidy.unitCost', 'socialHousing.unitCost'];
const SHARE_PARAMS: readonly string[] = ['migration.share', 'migration.exitShare', 'housing.renterRate.Taipei'];
const LOWER_FACTORS: readonly string[] = [
  'limit.socialHousing.unitsStarted.lowerFactor', 'limit.commuterPass.subsidy.lowerFactor',
  'limit.rentSubsidy.households.lowerFactor', 'limit.rentSubsidy.amount.lowerFactor',
];
const UPPER_FACTORS: readonly string[] = [
  'limit.socialHousing.unitsStarted.upperFactor', 'limit.rentSubsidy.households.upperFactor',
  'limit.rentSubsidy.amount.upperFactor',
];

function at<T>(list: readonly T[], i: number): T {
  return list[i % list.length] as T;
}

/**
 * Applies one defect to valid inputs and returns the damaged inputs with what the engine should report.
 * The input object is not changed.
 */
export function applyDefect(
  inputs: EngineInputs,
  defect: Defect,
): { readonly inputs: EngineInputs; readonly expectation: DefectExpectation } {
  const qCount = inputs.baseline.quarters.length;
  const q = Math.min(defect.quarter, qCount - 1);
  const quarter = quarterAt(q);
  const code = at(DISTRICT_CODES, defect.district);
  const city = cityOf(code);
  const cityKey: CityName = defect.variant % 2 === 0 ? 'Taipei' : 'New Taipei';

  const params = mutableCopy(inputs.params) as Record<string, Record<string, unknown>>;
  const baseline = mutableCopy(inputs.baseline);
  const player = mutableCopy(inputs.policies);
  const real = mutableCopy(inputs.realTrack);
  const commute = mutableCopy(inputs.commute);
  let events: SimEvent[] = [...inputs.events];
  let target = inputs.target;

  const done = (expectation: DefectExpectation) => ({
    inputs: {
      policies: player,
      events,
      params: params as unknown as ParameterTable,
      baseline,
      realTrack: real,
      commute,
      target,
    } satisfies EngineInputs,
    expectation,
  });
  const paramIssue = (parameterId: string, ...problems: ParameterProblem[]) =>
    done({ codes: ['parameters-invalid'], issues: [{ parameterId, problems }] });

  const cell = (kind: (typeof BASELINE_REQUIRED)[number]) => baseline.indicators[kind]?.[code];
  const indicator = at(BASELINE_REQUIRED, defect.variant);
  const units = player[q]?.tools.socialHousing?.unitsStarted;

  switch (defect.kind) {
    case 'target-malformed':
      target = at(['2015Q5', '2015', '2014Q4', '2026Q1', 'abc'], defect.variant);
      return done({ codes: ['quarter-invalid'] });

    case 'baseline-null': {
      const row = baseline.indicators[indicator]?.[code];
      if (row !== undefined) row[q] = null;
      return done({ codes: ['baseline-missing', 'baseline-invalid'], district: code, quarter });
    }
    case 'baseline-district-missing': {
      const byDistrict = baseline.indicators[indicator];
      if (byDistrict !== undefined) delete byDistrict[code];
      return done({ codes: ['baseline-missing'], district: code });
    }
    case 'baseline-negative':
    case 'baseline-non-finite': {
      const row = cell(indicator);
      if (row !== undefined) row[q] = defect.kind === 'baseline-negative' ? -1 : Number.NaN;
      return done({ codes: ['baseline-invalid'], district: code, quarter });
    }

    case 'track-player-quarter-missing':
      player.splice(q, 1);
      return done({ codes: ['track-missing'], quarter });
    case 'track-real-field-missing': {
      const fields = real[q]?.tools.rentSubsidy;
      if (fields !== undefined) delete fields.amount;
      return done({ codes: ['track-missing'], quarter });
    }

    case 'policy-negative':
    case 'policy-fractional':
    case 'policy-non-finite': {
      if (units !== undefined) {
        units[code] =
          defect.kind === 'policy-negative' ? -1 : defect.kind === 'policy-fractional' ? 1.5 : Number.POSITIVE_INFINITY;
      }
      return done({ codes: ['policy-value-invalid'], district: code, quarter });
    }
    case 'subsidy-above-price': {
      const priceId = `commuterPass.price.${cityKey}.${quarter}`;
      const priceEntry = params[priceId];
      let price = typeof priceEntry?.value === 'number' ? priceEntry.value : 0;
      if (priceEntry !== undefined && price <= 0) {
        price = 1000;
        priceEntry.value = price;
        const sold = real[q]?.tools.commuterPass?.passesSold;
        if (sold !== undefined) sold[cityKey] = 1000;
      }
      const subsidy = player[q]?.tools.commuterPass?.subsidy;
      if (subsidy !== undefined) subsidy[cityKey] = price + 1;
      return done({ codes: ['policy-value-invalid', 'limit-exceeded'], quarter });
    }

    case 'event-reference-unknown':
      events = [...events, { ...makeEvent('defect-event', quarter, quarter), sources: ['no.such.source'] }];
      return done({ codes: ['event-reference-unknown', 'event-invalid'] });

    case 'matrix-negative':
    case 'matrix-non-finite':
    case 'matrix-diagonal': {
      const i = defect.district;
      const j = (i + 1 + (defect.variant % (DISTRICT_CODES.length - 1))) % DISTRICT_CODES.length;
      const row = commute.minutes[i];
      if (row !== undefined) {
        if (defect.kind === 'matrix-diagonal') row[i] = 5;
        else row[j] = defect.kind === 'matrix-negative' ? -1 : Number.NaN;
      }
      return done({ codes: ['commute-matrix-invalid'] });
    }
    case 'matrix-size':
      commute.minutes.pop();
      return done({ codes: ['commute-matrix-invalid'] });

    // ---- Property 20 ----
    case 'param-missing': {
      const id = at(GENERIC_PARAMS, defect.variant);
      delete params[id];
      return paramIssue(id, 'missing');
    }
    case 'param-non-finite': {
      const id = at(GENERIC_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) p.value = Number.NaN;
      return paramIssue(id, 'non-finite', 'value-outside-range', 'out-of-bounds');
    }
    case 'param-unit-blank': {
      const id = at(GENERIC_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) p.unit = '  ';
      return paramIssue(id, 'unit-empty');
    }
    case 'param-source-blank': {
      const id = at(GENERIC_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) p.source = { citation: '', url: '' };
      return paramIssue(id, 'source-empty');
    }
    case 'param-range-inverted': {
      const id = at(RANGED_PARAMS, defect.variant);
      const range = params[id]?.range as { low: number; high: number } | undefined;
      if (range !== undefined) {
        const { low, high } = range;
        range.low = high > low ? high : low + 1;
        range.high = low;
      }
      return paramIssue(id, 'range-invalid', 'value-outside-range');
    }
    case 'param-value-outside-range': {
      const id = at(RANGED_PARAMS, defect.variant);
      const p = params[id];
      const range = p?.range as { high: number } | undefined;
      if (p !== undefined && range !== undefined) p.value = range.high + 1;
      return paramIssue(id, 'value-outside-range', 'out-of-bounds');
    }
    case 'param-lag-out-of-range': {
      const id = at(LAG_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) p.value = at([-1, 44, 1.5, 100], defect.variant);
      return paramIssue(id, 'out-of-bounds');
    }
    case 'param-unit-cost-nonpositive': {
      const id = at(UNIT_COST_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) p.value = defect.variant % 2 === 0 ? 0 : -5;
      return paramIssue(id, 'out-of-bounds', 'value-outside-range');
    }
    case 'param-share-out-of-range': {
      const id = at(SHARE_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) p.value = defect.variant % 2 === 0 ? 1.5 : -0.1;
      return paramIssue(id, 'out-of-bounds');
    }
    case 'param-ghost-size-low': {
      const p = params['ghost.size'];
      if (p !== undefined) p.value = defect.variant % 2 === 0 ? 0 : 0.5;
      return paramIssue('ghost.size', 'out-of-bounds');
    }
    case 'param-schedule-sum': {
      const p = params['socialHousing.costSchedule'];
      const shares = p?.shares as number[] | undefined;
      if (p !== undefined && shares !== undefined) p.shares = shares.map((s) => s * 0.5);
      return paramIssue('socialHousing.costSchedule', 'schedule-invalid');
    }
    case 'param-limit-factor': {
      if (defect.variant % 2 === 0) {
        const id = at(LOWER_FACTORS, defect.variant);
        const p = params[id];
        if (p !== undefined) p.value = 1.5;
        return paramIssue(id, 'limit-invalid', 'out-of-bounds');
      }
      const id = at(UPPER_FACTORS, defect.variant);
      const p = params[id];
      if (p !== undefined) p.value = 0.5;
      return paramIssue(id, 'limit-invalid', 'out-of-bounds');
    }
    case 'param-absolute-limit': {
      // Real units started are at least 1, so an absolute maximum of 0 excludes every real value.
      const id = 'limit.socialHousing.unitsStarted.max';
      params[id] = scalar(0, { unit: 'units' }) as unknown as Record<string, unknown>;
      return paramIssue(id, 'limit-invalid');
    }

    // ---- Metadata (Properties 20 and 26) ----
    case 'nlma-note-missing': {
      const p = params['socialHousing.lag'];
      if (p !== undefined) p.estimated = { method: 'Median of portal projects, whole quarters.' };
      return paramIssue('socialHousing.lag', 'lag-derivation-missing');
    }
    case 'status-missing': {
      const id = at(GENERIC_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) delete p.status;
      return paramIssue(id, 'status-missing');
    }
    case 'status-unknown': {
      const id = at(GENERIC_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) p.status = 'bogus';
      return paramIssue(id, 'status-unknown');
    }
    case 'estimated-missing': {
      const id = at(GENERIC_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) {
        p.status = defect.variant % 2 === 0 ? 'secondary' : 'gap';
        delete p.estimated;
        if (p.status === 'gap') p.assumption = 'Generated assumption.';
      }
      return paramIssue(id, 'estimated-missing');
    }
    case 'estimated-blank': {
      const id = at(GENERIC_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) {
        p.status = 'secondary';
        p.estimated = { method: '   ' };
      }
      return paramIssue(id, 'estimated-method-empty');
    }
    case 'assumption-missing': {
      const id = at(GENERIC_PARAMS, defect.variant);
      const p = params[id];
      if (p !== undefined) {
        p.status = 'gap';
        p.estimated = { method: 'Generated estimate method.' };
        delete p.assumption;
      }
      return paramIssue(id, 'assumption-missing');
    }
  }
}
