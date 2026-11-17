import { describe, expect, it } from 'vitest';
import { buildLowUse, referenceQuarter } from '../../../scripts/pipeline/low-use.ts';
import type { LowUseRow } from '../../../scripts/pipeline/parsers/low-use.ts';
import { summarizeHistory } from '../../../scripts/pipeline/history-file.ts';

const quarters = ['2019Q1', '2019Q2', '2019Q3', '2019Q4', '2020Q1', '2020Q2'];
const row = (districtCode: string, period: string, count: number): LowUseRow => ({ period, districtCode, count, ratePercent: count / 10 });

describe('buildLowUse', () => {
  it('places values at the Reference_Quarter and leaves every other record null', () => {
    const rows = [row('A', '2019H2', 50), row('A', '2020H1', 60), row('B', '2019H2', 5)];
    const r = buildLowUse(rows, [{ code: 'A' }, { code: 'B' }], quarters as never);
    expect(r.count['A']).toEqual([
      { value: null, estimated: false }, { value: null, estimated: false },
      { value: null, estimated: false }, { value: 50, estimated: false, dataPeriod: '2019H2' },
      { value: null, estimated: false }, { value: 60, estimated: false, dataPeriod: '2020H1' },
    ]);
    expect(r.rate['B']?.[3]).toEqual({ value: 0.5, estimated: false, dataPeriod: '2019H2' });
    expect(r.periodsPresent).toEqual(['2019H2', '2020H1']);
    expect(r.missing).toEqual([{ district: 'B', period: '2020H1' }]);
    expect(r.dataGaps).toEqual([]);
  });

  it('lists entirely null districts and throws above 5', () => {
    const r = buildLowUse([row('A', '2019H2', 1)], [{ code: 'A' }, { code: 'B' }], quarters as never);
    expect(r.dataGaps).toEqual(['B']);
    const codes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((code) => ({ code }));
    let error: unknown;
    try {
      buildLowUse([row('A', '2019H2', 1)], codes, quarters as never);
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toMatch(/low-use-too-many-gaps/);
    expect((error as { details: string[] }).details.join()).toContain('B, C, D, E, F, G');
  });

  it('maps periods to reference quarters; null records are not counted as estimated', () => {
    expect(referenceQuarter('2021H1')).toBe('2021Q2');
    expect(referenceQuarter('2021H2')).toBe('2021Q4');
    const file = { indicators: [{ id: 'x', series: { A: [{ value: null, estimated: false }] } }] } as never;
    expect(summarizeHistory(file)[0]?.estimated).toBe(0);
  });
});
