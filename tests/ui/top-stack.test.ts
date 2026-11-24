import { describe, expect, it } from 'vitest';
import { stackTops } from '../../src/ui/top-stack.ts';

describe('stackTops (narrow-screen top stack, play-loop task 12.3)', () => {
  it('stacks each shown block under the one above it with the gap', () => {
    // City tools end at 156 (three rows at 360 px in English): chip 53 high, metro prompt 77 high, talk prompt 44 high.
    expect(stackTops(164, [53, 77, 44], 8)).toEqual([164, 225, 310]);
  });

  it('skips a hidden block without leaving a hole', () => {
    expect(stackTops(112, [53, null, 44], 8)).toEqual([112, null, 173]);
  });

  it('returns nothing for no blocks', () => {
    expect(stackTops(0, [], 8)).toEqual([]);
  });
});
