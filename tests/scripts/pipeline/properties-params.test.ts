import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deriveCostSchedule, deriveShareBoth } from '../../../scripts/pipeline/params/derived.ts';
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import { idSetDiff, OMITTED_OPTIONAL_IDS } from '../../../scripts/pipeline/params/engine-ids.ts';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isSortedUnique = (xs: readonly string[]): boolean => xs.every((x, i) => i === 0 || cmp(xs[i - 1]!, x) < 0);

const ordinaryId = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9.]{0,12}$/)
  .filter((s) => !OMITTED_OPTIONAL_IDS.includes(s) && !s.startsWith('budget.ceiling.') && !s.startsWith('commuterPass.price.'));
const priceId = fc
  .tuple(fc.constantFrom('taipei', 'newTaipei'), fc.integer({ min: 0, max: 43 }))
  .map(([c, q]) => `commuterPass.price.${c}.${q}`);
const omittedId = fc.oneof(
  fc.constantFrom(...OMITTED_OPTIONAL_IDS),
  fc.stringMatching(/^[a-z0-9]{1,6}$/).map((s) => `budget.ceiling.${s}`),
);

describe('Property 37: Id-set difference is the symmetric difference', () => {
  it('matches set algebra, sorted lists, price ids and omitted ids', { timeout: 120_000 }, () => {
    const prop = fc.property(
      fc.array(ordinaryId, { maxLength: 30 }),
      fc.array(ordinaryId, { maxLength: 30 }),
      fc.array(priceId, { maxLength: 5 }),
      fc.array(omittedId, { maxLength: 5 }),
      (builtList, engineList, prices, omitted) => {
        const engine = new Set(engineList);
        const built = new Set([...builtList, ...prices, ...omitted]);
        const { missing, extra } = idSetDiff(built, engine);
        const expMissing = [...engine].filter((x) => !built.has(x)).sort(cmp);
        const expExtra = [...built].filter((x) => !engine.has(x)).sort(cmp);
        const equal = built.size === engine.size && [...built].every((x) => engine.has(x));
        const extraSet = new Set(extra);
        return (
          JSON.stringify(missing) === JSON.stringify(expMissing) &&
          JSON.stringify(extra) === JSON.stringify(expExtra) &&
          isSortedUnique(missing) &&
          isSortedUnique(extra) &&
          (missing.length === 0 && extra.length === 0) === equal &&
          prices.every((p) => extraSet.has(p)) &&
          omitted.every((o) => extraSet.has(o) && !missing.includes(o))
        );
      },
    );
    fc.assert(prop, { numRuns: 200 });
  });

  it('returns empty lists for identical sets', () => {
    const r = idSetDiff(['b', 'a'], new Set(['a', 'b']));
    expect(r).toEqual({ missing: [], extra: [] });
  });
});

const src = { citation: 'Test source', url: 'https://example.org/source' };
const scalarEntry = (value: number, range?: { low: number; high: number }): ScalarParameter => ({
  kind: 'scalar',
  value,
  unit: 'share',
  status: 'verified',
  source: src,
  ...(range ? { range: { ...range, lowSource: src, highSource: src } } : {}),
});

describe('Property 43: Derived gap parameters meet the engine constraints', () => {
  it('shareBoth stays within min(shareRent, 1 - high) and the cost schedule is valid', { timeout: 120_000 }, () => {
    const unit = fc.double({ min: 0, max: 1, noNaN: true });
    const prop = fc.property(unit, unit, unit, (rent, value, low) => {
      const entries = new Map<string, ScalarParameter>([
        ['ghost.shareRent', scalarEntry(rent)],
        ['ghost.shareCommuteWithin', scalarEntry(value, { low: Math.min(low, value), high: value })],
      ]);
      let both: ScalarParameter;
      try {
        both = deriveShareBoth(entries);
      } catch {
        return false;
      }
      return both.value >= 0 && both.value <= Math.min(rent, 1 - value) + 1e-12;
    });
    fc.assert(prop, { numRuns: 300 });
  });

  it('cost schedule has offsets 0..L-1, non-negative shares and sum 1', { timeout: 120_000 }, () => {
    const prop = fc.property(fc.integer({ min: 1, max: 43 }), (lag) => {
      const sched = deriveCostSchedule(new Map([['socialHousing.lag', scalarEntry(lag)]]));
      return (
        sched.offsets.length === lag &&
        sched.offsets.every((o, i) => o === i) &&
        sched.shares.length === lag &&
        sched.shares.every((s) => s >= 0) &&
        Math.abs(sched.shares.reduce((a, b) => a + b, 0) - 1) <= 1e-9
      );
    });
    fc.assert(prop, { numRuns: 100 });
  });
});
