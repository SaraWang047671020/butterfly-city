// The Policy_Dialog slider under a city-year limit (Decision D6; play-loop task 12.3). The slider of one district
// offered the whole city limit, so a value the city-year check rejects could be chosen (found in the browser: Bali,
// 296 units, "above the upper limit of 392").
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cityYearSliderUpper } from '../../src/game/core/views.ts';

describe('cityYearSliderUpper', () => {
  it('is the city limit less the other values counted in the year', () => {
    // New Taipei: limit 392 a year, 196 already counted elsewhere in the year, Bali 0 now.
    expect(cityYearSliderUpper(0, 392, 196, 0)).toBe(196);
    // The district's own value in the Planning_Quarter is replaced, so it does not use up its own room.
    expect(cityYearSliderUpper(0, 392, 296, 100)).toBe(196);
  });

  it('stays inside the lower and upper limits', () => {
    expect(cityYearSliderUpper(0, 392, 500, 0)).toBe(0);
    expect(cityYearSliderUpper(0, 392, 0, 0)).toBe(392);
  });

  it('every value up to it keeps the running total within the city limit (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (upper, others, own, share) => {
          const top = cityYearSliderUpper(0, upper, others + own, own);
          const chosen = Math.floor(top * share);
          if (others <= upper) expect(others + chosen).toBeLessThanOrEqual(upper);
          expect(top).toBeGreaterThanOrEqual(0);
          expect(top).toBeLessThanOrEqual(upper);
        },
      ),
    );
  });
});
