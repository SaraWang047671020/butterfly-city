import { describe, expect, it } from 'vitest';
import { checkParameterEntry } from '../../src/data/validate-params.ts';

const cite = { citation: 'Study (2020)', url: 'https://example.org/a' };
const base = { kind: 'scalar', value: 2, unit: 'ratio', source: cite, status: 'verified' };
const problems = (e: unknown) => checkParameterEntry('x', e).map((i) => i.problem);

describe('checkParameterEntry', () => {
  it('accepts a valid scalar with range', () => {
    const e = { ...base, range: { low: 1, high: 3, lowSource: cite, highSource: cite } };
    expect(problems(e)).toEqual([]);
  });

  it('accepts a valid schedule', () => {
    expect(problems({ kind: 'schedule', offsets: [0, 1], shares: [0.5, 0.5], unit: 'share', source: cite, status: 'check' })).toEqual([]);
  });

  it('reports absent, non-finite, empty unit, unknown status', () => {
    expect(problems(undefined)).toEqual(['missing']);
    expect(problems({ ...base, value: NaN })).toEqual(['non-finite']);
    expect(problems({ ...base, unit: ' ' })).toEqual(['unit-empty']);
    expect(problems({ ...base, status: 'x' })).toEqual(['status-unknown']);
  });

  it('requires estimated.method for secondary and an assumption for gap', () => {
    expect(problems({ ...base, status: 'secondary' })).toEqual(['estimated-missing']);
    expect(problems({ ...base, status: 'secondary', estimated: { method: '' } })).toEqual(['estimated-method-empty']);
    expect(problems({ ...base, status: 'gap', estimated: { method: 'm' }, assumption: ' ' })).toEqual(['assumption-missing']);
  });

  it('checks range order, value inside range and range sources', () => {
    const r = { low: 1, high: 3, lowSource: cite, highSource: cite };
    expect(problems({ ...base, range: { ...r, low: 4 } })).toContain('range-invalid');
    expect(problems({ ...base, value: 5, range: r })).toEqual(['value-outside-range']);
    expect(problems({ ...base, range: { ...r, highSource: { citation: 'a', url: '' } } })).toEqual(['source-empty']);
  });

  it('allows a gap entry without source only when the option is set', () => {
    const gap = { ...base, source: { citation: '', url: '' }, status: 'gap', estimated: { method: 'm' }, assumption: 'a' };
    expect(problems(gap)).toEqual(['source-empty']);
    expect(checkParameterEntry('x', gap, { sourceOptionalForGap: true })).toEqual([]);
  });
});
