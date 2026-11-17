import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../../scripts/lib/districts.ts';
import { COMMUTE_COST_ID } from '../../../../scripts/pipeline/commute/fares.ts';
import { DataError } from '../../../../scripts/pipeline/errors.ts';
import { commuteCostParam } from '../../../../scripts/pipeline/params/commute-cost.ts';
import type { CensusEmployeeRow } from '../../../../scripts/pipeline/params/census-employees.ts';
import { jobShareEntries, jobShares } from '../../../../scripts/pipeline/params/job-share.ts';
import { formatParamLine, paramsPart1Step } from '../../../../scripts/pipeline/params/part1.ts';
import type { ScalarParameter } from '../../../../src/types/simulation.ts';

const employees = (weights: Record<string, number>): CensusEmployeeRow[] =>
  DISTRICTS.map((d, i) => ({
    row: i + 2, districtCode: d.code, employees: weights[d.code] ?? 0,
    sourceUrl: 'https://example.org/census.pdf', tableId: '10', page: 140,
  }));

describe('job shares', () => {
  it('gives 0.75 and 0.25 for weights 300 and 100 and 0 elsewhere', () => {
    const shares = jobShares(employees({ '63000010': 300, '63000020': 100 }));
    expect(shares.size).toBe(41);
    expect(shares.get('63000010')).toBe(0.75);
    expect(shares.get('63000020')).toBe(0.25);
    expect(shares.get('65000010')).toBe(0);
  });

  it('shares of equal weights sum to 1 within one part in a million', () => {
    const shares = jobShares(employees(Object.fromEntries(DISTRICTS.map((d) => [d.code, 7]))));
    const sum = [...shares.values()].reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
  });

  it('builds 41 secondary entries with the table source and one method note', () => {
    const r = jobShareEntries(employees({ '63000010': 1 }));
    expect(r.entries.size).toBe(41);
    const e = r.entries.get('commute.jobShare.63000010') as ScalarParameter;
    expect(e).toMatchObject({ value: 1, status: 'secondary', source: { url: 'https://example.org/census.pdf' } });
    expect(e.source.citation).toContain('table 10, page 140');
    expect(r.methods.map((m) => m.ids)).toEqual([['commute.jobShare.<code>']]);
  });

  it('stops when a district has no row', () => {
    expect(() => jobShares(employees({}).slice(1))).toThrow(/no employee row for district 63000010/);
  });
});

describe('commuteCostParam', () => {
  const entry = (unit: string): ScalarParameter => ({
    kind: 'scalar', value: 3.2, unit, status: 'secondary',
    source: { citation: 'Fares', url: 'https://example.org/f' }, estimated: { method: 'Slope of fare on minutes.' },
  });

  it('returns the entry with its method text', () => {
    const r = commuteCostParam({ entry: entry('TWD per minute') } as never);
    expect(r.id).toBe(COMMUTE_COST_ID);
    expect(r.methods).toEqual([{ ids: [COMMUTE_COST_ID], method: 'Slope of fare on minutes.' }]);
  });

  it('stops without the fare slope step and on an invalid entry', () => {
    expect(() => commuteCostParam(undefined)).toThrow(/missing-step-output/);
    expect(() => commuteCostParam({ entry: entry('') } as never)).toThrow(/commute-cost-entry-invalid/);
  });
});

describe('part 1 step', () => {
  const e = (value: number, range?: { low: number; high: number }): ScalarParameter => ({
    kind: 'scalar', value, unit: 'u', status: 'secondary', source: { citation: 'c', url: 'https://example.org' },
    estimated: { method: 'm' },
    ...(range ? { range: { ...range, lowSource: { citation: 'c', url: 'https://example.org' }, highSource: { citation: 'c', url: 'https://example.org' } } } : {}),
  });

  it('formats one line per entry with six significant digits and n/a without a range', () => {
    expect(formatParamLine('a.b', e(0.123456789))).toBe('a.b: low n/a, value 0.123457, high n/a, status secondary');
    expect(formatParamLine('a.c', e(2, { low: 1, high: 3.5 }))).toBe('a.c: low 1, value 2, high 3.5, status secondary');
  });

  it('stops when a step it depends on has not run', () => {
    const step = paramsPart1Step(() => '');
    expect(step.name).toBe('params-part1');
    expect(() => step.run({} as never, {} as never)).toThrow(/missing-step-output/);
    expect(() => step.run({} as never, {} as never)).toThrow(DataError);
  });
});

describe('Parameter_Entry modules do not use the backtest, BACKTEST.md or a save file', () => {
  const root = path.resolve(import.meta.dirname, '../../../..');
  const dirs = ['scripts/pipeline/params'];
  const extra = ['scripts/pipeline/parsers/census-tenure.ts', 'scripts/pipeline/parsers/lvr-rental-extra.ts', 'scripts/pipeline/parsers/income.ts'];
  const files = [
    ...dirs.flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.ts')).map((f) => `${d}/${f}`)),
    ...extra,
  ];

  it('covers the part 1 modules', () => {
    expect(files).toEqual(expect.arrayContaining(['scripts/pipeline/params/part1.ts', 'scripts/pipeline/params/housing.ts', 'scripts/pipeline/parsers/income.ts']));
  });

  it.each(files)('%s', (file) => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    expect(text).not.toMatch(/from\s+['"][^'"]*\/backtest\//);
    expect(text).not.toMatch(/import\(\s*['"][^'"]*\/backtest\//);
    expect(text).not.toMatch(/BACKTEST\.md/);
    expect(text).not.toMatch(/localStorage|src\/save\/|from\s+['"][^'"]*\/save\//);
    expect(text).not.toMatch(/\.save['"`]|save-?code|save file/i);
  });
});
