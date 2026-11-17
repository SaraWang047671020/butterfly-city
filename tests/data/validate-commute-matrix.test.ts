import { describe, expect, it } from 'vitest';
import { validateCommuteMatrix } from '../../src/data/validate.ts';
import { DISTRICT_CODES, validContext, type Json } from './helpers.ts';

/** 41 x 41 file: zero diagonal, one-decimal values elsewhere. */
function validMatrix(): Json {
  return {
    codes: [...DISTRICT_CODES],
    minutes: DISTRICT_CODES.map((_, i) => DISTRICT_CODES.map((_, j) => (i === j ? 0 : 10 + ((i + j) % 7) + 0.5))),
  };
}

describe('validateCommuteMatrix', () => {
  const ctx = validContext();

  it('accepts a valid file', () => {
    expect(validateCommuteMatrix(validMatrix(), ctx)).toEqual([]);
  });

  it('rejects a non-zero diagonal', () => {
    const m = validMatrix();
    m.minutes[3][3] = 1.5;
    const errors = validateCommuteMatrix(m, ctx);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: 'commute-matrix.json', path: '$.minutes[3][3]', rule: 'diagonal' });
  });

  it('rejects a negative cell', () => {
    const m = validMatrix();
    m.minutes[0][1] = -2;
    const errors = validateCommuteMatrix(m, ctx);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: '$.minutes[0][1]', rule: 'range' });
  });

  it('rejects a wrong row count', () => {
    const m = validMatrix();
    m.minutes.pop();
    const errors = validateCommuteMatrix(m, ctx);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: '$.minutes', rule: 'shape' });
  });

  it('rejects a wrong row length', () => {
    const m = validMatrix();
    m.minutes[5].pop();
    expect(validateCommuteMatrix(m, ctx).map((e) => [e.path, e.rule])).toEqual([['$.minutes[5]', 'shape']]);
  });

  it('rejects wrong codes (swapped order)', () => {
    const m = validMatrix();
    [m.codes[0], m.codes[1]] = [m.codes[1], m.codes[0]];
    const errors = validateCommuteMatrix(m, ctx);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: '$.codes', rule: 'codes' });
  });

  it('rejects more than one decimal and an unknown field', () => {
    const m = validMatrix();
    m.minutes[0][1] = 12.25;
    m.extra = 1;
    expect(validateCommuteMatrix(m, ctx).map((e) => e.rule).sort()).toEqual(['decimals', 'unknown-field']);
  });
});
