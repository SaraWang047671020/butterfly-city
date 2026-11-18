// Validates: Requirements 19.8, 3.9
import { describe, expect, it } from 'vitest';
import { classColorToken, classify, classIndexOf } from '../../src/ui/map/indicator-classes.ts';
import type { ClassIndicatorId } from '../../src/ui/map/indicator-classes.ts';

const BOUNDS: Record<ClassIndicatorId, number[]> = {
  rentBurden: [10, 15, 20, 25, 30, 35],
  priceToIncome: [4, 7, 9, 11, 13, 16],
  commuteTime: [30, 40, 50, 60, 75, 90],
  populationChange: [-10, -5, -1, 1, 5, 10],
  lowUseHousingRate: [5, 7.5, 10, 15, 20, 25],
};

describe('classify', () => {
  for (const [id, bounds] of Object.entries(BOUNDS) as [ClassIndicatorId, number[]][]) {
    it(`${id}: a value on each bound goes to the class above`, () => {
      bounds.forEach((b, i) => {
        expect(classify(id, b)).toBe(i + 1);
      });
    });
    it(`${id}: below the first bound is 0, above the last is 6`, () => {
      expect(classify(id, bounds[0]! - 0.001)).toBe(0);
      expect(classify(id, bounds[5]! - 0.001)).toBe(5);
      expect(classify(id, bounds[5]! + 0.001)).toBe(6);
      expect(classify(id, bounds[5]! + 1000)).toBe(6);
    });
  }

  it('returns null for null and non-finite values, never class 0', () => {
    for (const id of Object.keys(BOUNDS) as ClassIndicatorId[]) {
      expect(classify(id, null)).toBeNull();
      expect(classify(id, Number.NaN)).toBeNull();
      expect(classify(id, Infinity)).toBeNull();
      expect(classify(id, -Infinity)).toBeNull();
    }
  });

  it('literal examples', () => {
    expect(classify('rentBurden', 22)).toBe(3);
    expect(classify('populationChange', 0)).toBe(3);
    expect(classify('populationChange', -1)).toBe(3);
    expect(classify('populationChange', 1)).toBe(4);
    expect(classify('lowUseHousingRate', 7.5)).toBe(2);
    expect(classify('commuteTime', 29.99)).toBe(0);
  });
});

describe('classIndexOf', () => {
  it('counts bounds at or below the value', () => {
    expect(classIndexOf(5, [5, 10])).toBe(1);
    expect(classIndexOf(4.9, [5, 10])).toBe(0);
    expect(classIndexOf(10, [5, 10])).toBe(2);
  });
});

describe('classColorToken', () => {
  it('uses seq for sequential, div for diverging, nodata for null', () => {
    expect(classColorToken('rentBurden', 3)).toBe('--color-seq-3');
    expect(classColorToken('populationChange', 2)).toBe('--color-div-2');
    expect(classColorToken('lowUseHousingRate', null)).toBe('--color-nodata-fill');
  });
});
