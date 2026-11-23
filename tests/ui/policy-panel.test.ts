import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ConstructionRowView } from '../../src/types/view.ts';
import { checkMessage, constructionLabels, limitProblemText } from '../../src/ui/panels/policy-text.ts';

const PANELS = resolve(import.meta.dirname, '..', '..', 'src', 'ui', 'panels');
const row = (difference: number, progress: number, lag: number): ConstructionRowView => ({
  district: '63000010',
  districtName: 'Xinyi',
  committed: '2018Q1',
  effect: '2020Q1',
  difference,
  lag,
  progress,
  afterEnd: false,
});

describe('construction labels (Requirement 10.4 to 10.6)', () => {
  it('words more and fewer units', () => {
    expect(constructionLabels(row(120, 2, 8)).units).toBe('120 more units than real');
    expect(constructionLabels(row(-5, 2, 8)).units).toBe('5 fewer units than real');
    expect(constructionLabels(row(5, 2, 8)).progress).toBe('2 of 8 quarters');
  });

  it('fills the bar to progress divided by lag, inside 0 to 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 0, max: 39 }), (lag, n) => {
        const f = constructionLabels(row(1, Math.min(n, lag - 1), lag)).fraction;
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(1);
      }),
    );
  });
});

describe('rejection messages (Requirements 9.2, 9.7, 9.11)', () => {
  it('names the broken side, limit, unit and reason', () => {
    const text = limitProblemText({ side: 'upper', limit: 1000, unit: 'units', period: '2018Q1', ref: null });
    expect(text).toContain('upper limit of 1,000 units');
    expect(text).toContain('No source recorded');
  });

  it('shows the fixed-quarter and format messages and none for ok', () => {
    expect(checkMessage({ status: 'fixed-quarter', planning: '2018Q2' }, 'x')).toBe(
      'Computed quarters are fixed. Changes apply from 2018 Q2.',
    );
    expect(checkMessage({ status: 'invalid-format', expected: 'integer' }, 'Units')).toContain('Units');
    expect(checkMessage({ status: 'unchanged', budget: null }, 'x')).toBeNull();
  });
});

describe('panel source files', () => {
  const files = ['policy-panel.ts', 'policy-text.ts', 'construction-rows.ts'].map((f) =>
    readFileSync(join(PANELS, f), 'utf8'),
  );
  it('hold no colour, pixel size or hard-coded tool unit', () => {
    for (const src of files) {
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src).not.toMatch(/\d\s?px\b/);
      expect(src).not.toMatch(/TWD per/);
    }
  });
  it('import neither simulation, save, data nor three', () => {
    for (const src of files) expect(src).not.toMatch(/from '[^']*\/(simulation|save|data)\/|from 'three'/);
  });
});
