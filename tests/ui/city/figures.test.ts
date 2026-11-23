// Ghost and butterfly figures from the persons difference to real history (city-3d Requirement 6, changed 2026-11-23).
import { describe, expect, it } from 'vitest';
import { figuresOf, MAX_GHOSTS_PER_DISTRICT, PERSONS_PER_FIGURE } from '../../../src/ui/city/ghosts.ts';

describe('figuresOf', () => {
  it('draws ghosts for more people above a line, butterflies for fewer, none without a difference', () => {
    expect(figuresOf(null)).toEqual({ ghosts: 0, butterflies: 0 });
    expect(figuresOf(0)).toEqual({ ghosts: 0, butterflies: 0 });
    expect(figuresOf(4)).toEqual({ ghosts: 0, butterflies: 0 });
    expect(figuresOf(34)).toEqual({ ghosts: 3, butterflies: 0 });
    expect(figuresOf(-26)).toEqual({ ghosts: 0, butterflies: 3 });
    expect(figuresOf(10 * PERSONS_PER_FIGURE * MAX_GHOSTS_PER_DISTRICT)).toEqual({ ghosts: MAX_GHOSTS_PER_DISTRICT, butterflies: 0 });
    expect(figuresOf(Number.NaN)).toEqual({ ghosts: 0, butterflies: 0 });
  });
});
