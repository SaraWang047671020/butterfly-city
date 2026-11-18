import { describe, expect, it } from 'vitest';
import { validateHistoryFile, type LowUseContext } from '../../src/data/validate.ts';
import { DISTRICT_CODES, QUARTERS, validContext, validHistoryFile, type Json } from './helpers.ts';

const NULL_REC = { value: null, estimated: false };
const nulls = (): Json[] => QUARTERS.map(() => ({ ...NULL_REC }));

/** A valid history file plus one periodic district indicator: a 2015H2 value at 2015Q4 (index 3) for every district. */
function fileWithLowUse(): Json {
  const file = validHistoryFile();
  const series: Json = {};
  for (const code of DISTRICT_CODES) {
    const recs = nulls();
    recs[3] = { value: 50, estimated: false, dataPeriod: '2015H2' };
    series[code] = recs;
  }
  file.indicators.push({
    id: 'lowUseHousingCount',
    level: 'district',
    unit: 'dwellings',
    kind: 'count',
    decimals: 0,
    periodic: true,
    description: 'Low-use dwellings in the district.',
    sources: ['test/source-a'],
    series,
  });
  return file;
}

const lowUse = (over: Partial<LowUseContext> = {}): LowUseContext => ({
  dataGaps: [],
  periodsPresent: ['2015H2'],
  missing: [],
  ...over,
});

const run = (file: Json, ctx: LowUseContext | null = lowUse()) =>
  validateHistoryFile(file, {
    ...validContext(),
    indicatorIds: file.indicators.map((i: Json) => i.id),
    ...(ctx === null ? {} : { lowUse: ctx }),
  });
const series = (file: Json): Json => file.indicators[3].series;
const first = DISTRICT_CODES[0] as string;

describe('validator: low-use rules', () => {
  it('accepts a null in a periodic indicator and a Reference_Quarter value with its dataPeriod', () => {
    expect(run(fileWithLowUse())).toEqual([]);
  });

  it('rejects a null with estimated false in a non-periodic indicator (no-data)', () => {
    const file = fileWithLowUse();
    file.indicators[0].series[first][0] = { ...NULL_REC };
    const errors = run(file);
    expect(errors.map((e) => e.rule)).toEqual(['no-data']);
    expect(errors[0]?.path).toContain('.indicators[0]');
  });

  it('rejects a non-null periodic record without dataPeriod (data-period)', () => {
    const file = fileWithLowUse();
    series(file)[first][3] = { value: 50, estimated: false };
    expect(run(file).map((e) => e.rule)).toEqual(['data-period']);
  });

  it('rejects a dataPeriod whose Reference_Quarter differs from the Quarter_Key (data-period)', () => {
    const file = fileWithLowUse();
    series(file)[first][3] = { value: 50, estimated: false, dataPeriod: '2016H2' };
    const errors = run(file);
    expect(errors.map((e) => e.rule)).toEqual(['data-period']);
    expect(errors[0]?.message).toContain('2016Q4');
  });

  it('rejects an entirely null district that is not on the gap list (low-use-gap)', () => {
    const file = fileWithLowUse();
    series(file)[first] = nulls();
    const errors = run(file, lowUse({ periodsPresent: [] }));
    expect(errors.map((e) => e.rule)).toEqual(['low-use-gap']);
    expect(errors[0]?.message).toContain('not on the data gap list');
  });

  it('accepts an entirely null district that is on the gap list', () => {
    const file = fileWithLowUse();
    series(file)[first] = nulls();
    expect(run(file, lowUse({ dataGaps: [first], missing: [{ district: first, period: '2015H2' }] }))).toEqual([]);
  });

  it('rejects a listed district with a non-null value (low-use-gap)', () => {
    const errors = run(fileWithLowUse(), lowUse({ dataGaps: [first] }));
    expect(errors.map((e) => e.rule)).toEqual(['low-use-gap']);
    expect(errors[0]?.message).toContain('non-null');
  });

  it('rejects a null at the Reference_Quarter of a period that has a published value for the district', () => {
    const file = fileWithLowUse();
    series(file)[first][5] = { value: 40, estimated: false, dataPeriod: '2016H1' };
    series(file)[first][3] = { ...NULL_REC };
    const errors = run(file);
    expect(errors.map((e) => e.rule)).toEqual(['low-use-gap']);
    expect(errors[0]?.path).toMatch(/\[3\]$/);
    // The same null is accepted when the builder recorded no value for that district and period.
    expect(run(file, lowUse({ missing: [{ district: first, period: '2015H2' }] }))).toEqual([]);
  });

  it('rejects more than 5 entirely null districts, even when all are on the list', () => {
    const six = DISTRICT_CODES.slice(0, 6);
    const five = DISTRICT_CODES.slice(0, 5);
    const file = fileWithLowUse();
    for (const code of six) series(file)[code] = nulls();
    const errors = run(file, lowUse({ dataGaps: six, periodsPresent: [] }));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.rule).toBe('low-use-gap');
    expect(errors[0]?.message).toContain('6 districts');

    const ok = fileWithLowUse();
    for (const code of five) series(ok)[code] = nulls();
    expect(run(ok, lowUse({ dataGaps: five, periodsPresent: [] }))).toEqual([]);
  });

  it('skips the low-use-gap rule when no lowUse context is passed', () => {
    const file = fileWithLowUse();
    series(file)[first][3] = { ...NULL_REC };
    expect(run(file, null)).toEqual([]);
  });
});
