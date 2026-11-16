import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { migrate, type MigrationDistrict } from '../../../src/simulation/migration.ts';
import { buildCommuteMatrix, buildParams, DISTRICT_CODES } from '../fixtures/index.ts';

const params = buildParams();
const commute = buildCommuteMatrix();

const arbDistrict = (code: string): fc.Arbitrary<MigrationDistrict> =>
  fc.record({
    code: fc.constant(code),
    population: fc.integer({ min: 0, max: 600_000 }),
    baselineRentBurden: fc.double({ min: 10, max: 40, noNaN: true }),
    // A wide spread so that some origins exceed the threshold and some do not.
    rentBurden: fc.double({ min: 5, max: 60, noNaN: true }),
    commuteCostOffset: fc.option(fc.integer({ min: -2000, max: 3000 }), { nil: undefined }),
  });

/** A subset of the 41 districts (2 to 41), in ascending code order, with random values. */
const arbInput = fc
  .shuffledSubarray([...DISTRICT_CODES], { minLength: 2, maxLength: DISTRICT_CODES.length })
  .chain((codes) => {
    const sorted = [...codes].sort();
    return fc.tuple(
      fc.tuple(...sorted.map(arbDistrict)),
      fc.shuffledSubarray(
        sorted.map((_, i) => i),
        { minLength: sorted.length, maxLength: sorted.length },
      ),
    );
  });

describe('Property 11: Migration is independent of processing order', () => {
  it('returns identical in, out, net, displaced and exits for any presentation order', () => {
    // **Validates: Requirements 9.6**
    fc.assert(
      fc.property(arbInput, ([districts, order]) => {
        const reference = migrate(districts, commute, params);
        const permuted = order.map((i) => districts[i] as MigrationDistrict);
        const result = migrate(permuted, commute, params);
        expect(result.in).toEqual(reference.in);
        expect(result.out).toEqual(reference.out);
        expect(result.net).toEqual(reference.net);
        expect(result.displaced).toEqual(reference.displaced);
        expect(result.exits).toBe(reference.exits);
      }),
      { numRuns: 100 },
    );
  });
});
