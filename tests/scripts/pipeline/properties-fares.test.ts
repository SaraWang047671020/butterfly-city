/**
 * Property 47: The fare slope recovers linear fares and scales with monthly trips.
 * Validates: Requirements 29.3, 29.4, 29.11
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { COMMUTE_COST_ID, commuteCostEntry, fareSlopes, type FarePair } from '../../../scripts/pipeline/commute/fares.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';

const RUNS = 150;
const TIMEOUT = 120_000;

const near = (x: number, y: number, tol = 1e-9): boolean => Math.abs(x - y) <= tol * Math.max(1, Math.abs(x), Math.abs(y));

/** At least `min` distinct integer times, an integer intercept and a slope in quarter steps. */
const line = (min: number) =>
  fc.record({
    times: fc.uniqueArray(fc.integer({ min: 1, max: 80 }), { minLength: min, maxLength: 25 }),
    a: fc.integer({ min: 0, max: 50 }),
    b: fc.integer({ min: 1, max: 20 }).map((q) => q / 4),
    m: fc.integer({ min: 1, max: 100 }),
  });

const pairsOf = (times: readonly number[], fare: (t: number) => number): FarePair[] =>
  times.map((t, i) => ({ from: `A${i}`, to: `B${i}`, minutes: t, fare: fare(t) }));

const rangeHigh = (e: ReturnType<typeof commuteCostEntry>): number => (e.range as { high: number }).high;
const rangeLow = (e: ReturnType<typeof commuteCostEntry>): number => (e.range as { low: number }).low;

describe('Property 47: fare slope recovers linear fares and scales with monthly trips', () => {
  it(
    'all-pairs slope equals b; with no capped pair high = value = m * b',
    () => {
      let bad: string | undefined;
      fc.assert(
        fc.property(line(3), ({ times, a, b, m }) => {
          const pairs = pairsOf(times, (t) => a + b * t);
          const cap = a + b * 1000; // above every fare: no pair is charged the cap
          const s = fareSlopes(pairs, cap);
          const e = commuteCostEntry(pairs, m, { cap });
          const v = e.value as number;
          if (!near(s.allSlope, b)) bad = `slope ${s.allSlope} vs ${b}`;
          else if (s.cappedCount !== 0) bad = `capped ${s.cappedCount}`;
          else if (rangeLow(e) !== 0) bad = `low ${rangeLow(e)}`;
          else if (!near(v, m * b)) bad = `value ${v} vs ${m * b}`;
          else if (rangeHigh(e) !== v) bad = `high ${rangeHigh(e)} vs value ${v}`;
          return bad === undefined;
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'doubling m doubles value and high and leaves low at 0',
    () => {
      let bad: string | undefined;
      fc.assert(
        fc.property(line(4), ({ times, a, b, m }) => {
          const pairs = pairsOf(times, (t) => a + b * t);
          const e1 = commuteCostEntry(pairs, m);
          const e2 = commuteCostEntry(pairs, 2 * m);
          if (!near(e2.value as number, 2 * (e1.value as number))) bad = `value ${e2.value} vs 2*${e1.value}`;
          else if (!near(rangeHigh(e2), 2 * rangeHigh(e1))) bad = `high ${rangeHigh(e2)} vs 2*${rangeHigh(e1)}`;
          else if (rangeLow(e1) !== 0 || rangeLow(e2) !== 0) bad = 'low not 0';
          return bad === undefined;
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'with a capped tail, high = m * Uncapped_Range slope and value = m * all-pairs slope, 0 <= low <= value <= high',
    () => {
      let bad: string | undefined;
      fc.assert(
        fc.property(
          line(4).chain((l) => {
            const n = [...l.times].sort((x, y) => x - y).length;
            return fc.record({ l: fc.constant(l), k: fc.integer({ min: 2, max: n - 1 }) });
          }),
          ({ l: { times, a, b, m }, k }) => {
            const sorted = [...times].sort((x, y) => x - y);
            const cap = a + b * (sorted[k] as number);
            const pairs = pairsOf(times, (t) => Math.min(a + b * t, cap));
            const s = fareSlopes(pairs);
            const e = commuteCostEntry(pairs, m);
            const v = e.value as number;
            const hi = rangeHigh(e);
            if (!near(s.uncappedSlope, b)) bad = `uncapped slope ${s.uncappedSlope} vs ${b}`;
            else if (!near(v, m * s.allSlope)) bad = `value ${v} vs ${m * s.allSlope}`;
            else if (!near(hi, Math.max(v, m * b))) bad = `high ${hi} vs ${Math.max(v, m * b)}`;
            else if (!(rangeLow(e) === 0 && v >= 0 && v <= hi)) bad = `order low ${rangeLow(e)} value ${v} high ${hi}`;
            return bad === undefined;
          },
        ),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});

/**
 * Property 48: Commute cost entries keep their order or stop the build.
 * Validates: Requirements 29.5
 */
describe('Property 48: commute cost entries keep their order or stop the build', () => {
  /** Arbitrary fare tables: repeated times, falling fares, optional cap, 0 to 12 pairs. */
  const table = fc.record({
    pairs: fc.array(fc.record({ minutes: fc.integer({ min: 1, max: 60 }), fare: fc.integer({ min: 0, max: 150 }) }), {
      minLength: 0,
      maxLength: 12,
    }),
    m: fc.integer({ min: 1, max: 80 }),
    capped: fc.boolean(),
  });

  it(
    'returns 0 <= value <= high = max(value, uncapped x trips), or throws a DataError naming the id',
    () => {
      let bad: string | undefined;
      let returned = 0;
      let threw = 0;
      fc.assert(
        fc.property(table, ({ pairs: raw, m, capped }) => {
          const pairs: FarePair[] = raw.map((p, i) => ({ from: `A${i}`, to: `B${i}`, ...p }));
          const cap = capped && pairs.length > 0 ? Math.max(...pairs.map((p) => p.fare)) : undefined;
          // Expected outcome computed from the slopes alone.
          let slopes: ReturnType<typeof fareSlopes> | undefined;
          try {
            slopes = fareSlopes(pairs, cap);
          } catch {
            slopes = undefined;
          }
          const value = slopes === undefined ? NaN : slopes.allSlope * m;
          const unc = slopes === undefined ? NaN : slopes.uncappedSlope * m;
          const mustThrow = slopes === undefined || !(value >= 0) || !Number.isFinite(value) || !Number.isFinite(unc);
          let e: ReturnType<typeof commuteCostEntry> | undefined;
          let err: unknown;
          try {
            e = commuteCostEntry(pairs, m, cap === undefined ? {} : { cap });
          } catch (x) {
            err = x;
          }
          if (mustThrow) {
            threw += 1;
            if (e !== undefined) bad = `expected DataError, got entry for ${JSON.stringify(pairs)} m=${m}`;
            else if (!(err instanceof DataError)) bad = `expected DataError, got ${String(err)}`;
            else if (err.subject !== COMMUTE_COST_ID) bad = `subject ${err.subject}`;
          } else {
            returned += 1;
            if (e === undefined) bad = `unexpected throw ${String(err)} for ${JSON.stringify(pairs)} m=${m}`;
            else {
              const hi = rangeHigh(e);
              const v = e.value as number;
              if (!near(v, value)) bad = `value ${v} vs ${value}`;
              else if (rangeLow(e) !== 0 || !(v >= 0) || !(v <= hi)) bad = `order low ${rangeLow(e)} value ${v} high ${hi}`;
              else if (!near(hi, Math.max(value, unc))) bad = `high ${hi} vs max(${value}, ${unc})`;
            }
          }
          return bad === undefined;
        }),
        { numRuns: RUNS },
      );
      if (returned === 0 || threw === 0) throw new Error(`generator covers one branch only: returned ${returned}, threw ${threw}`);
    },
    TIMEOUT,
  );

  it(
    'a lower Uncapped_Range slope never stops the build',
    () => {
      let bad: string | undefined;
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }), // steep slope on short trips
          fc.integer({ min: 1, max: 5 }), // flatter all-pairs slope is produced by a capped tail
          fc.integer({ min: 1, max: 80 }),
          (steep, extra, m) => {
            // Fares rise by `steep` per minute up to 5 minutes, then stay at the cap: all-pairs slope < uncapped slope.
            const pairs: FarePair[] = [1, 2, 3, 4, 5, 6, 7, 8].map((t, i) => ({
              from: `A${i}`,
              to: `B${i}`,
              minutes: t,
              fare: steep * Math.min(t, 5) + extra,
            }));
            try {
              const e = commuteCostEntry(pairs, m);
              const s = fareSlopes(pairs);
              if (!(s.uncappedSlope > s.allSlope)) bad = 'generator did not lower the all-pairs slope';
              else if (!near(rangeHigh(e), s.uncappedSlope * m)) bad = `high ${rangeHigh(e)} vs ${s.uncappedSlope * m}`;
              else if (!(rangeHigh(e) >= (e.value as number))) bad = 'high < value';
            } catch (x) {
              bad = `build stopped: ${String(x)}`;
            }
            return bad === undefined;
          },
        ),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});
