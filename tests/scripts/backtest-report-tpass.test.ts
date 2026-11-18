import { describe, expect, it } from 'vitest';
import { renderReport, TPASS_FIRST_RESULT } from '../../scripts/backtest/report.ts';

describe('TPASS report sections', () => {
  const out = renderReport({
    results: [{ status: 'not-computed', id: 'tpass-2023', reason: 'missing input: monthly Taipei Metro station files' }],
    parameterTableSha256: null,
    engineVersion: 'test',
  });

  it('keeps the first result and prints sections 1-4 in order before the new result', () => {
    const order = ['Invalid result', 'Comparison method', 'Confounders', 'Scope', 'New result'].map((h) => out.indexOf(`### ${h}`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain('-797951.00');
    expect(out).toContain(TPASS_FIRST_RESULT.ratio.toFixed(3));
    expect(out).toContain('decided 2026-11-18, before the monthly result was computed');
  });

  it('shows "not computed: missing input" when monthly data is missing', () => {
    expect(out).toContain('not computed: missing input');
  });
});
