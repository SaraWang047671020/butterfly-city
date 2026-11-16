import { describe, expect, it } from 'vitest';
import { quartersBetween, type Quarter } from '../../../scripts/lib/time.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import type { SubleasePhaseRow } from '../../../scripts/pipeline/parsers/policy-tables.ts';
import { buildSubleaseUnits } from '../../../scripts/pipeline/policy/sublease.ts';

const quarters: Quarter[] = ['2017Q1', '2017Q2'];

let n = 1;
function row(city: 'Taipei' | 'New Taipei', channel: 'city' | 'central', phase: number, startDate: string, totalUnits: number, asOf: string): SubleasePhaseRow {
  return { row: n++, city, channel, phase, startDate, totalUnits, asOf, source: 'policy/moi-b5010', url: '' };
}

// Window 2017Q1..2017Q2 ends on 2017-06-30, so days after it are not counted.
const rows: SubleasePhaseRow[] = [
  // city channel phase 1: 2017-03-01 .. 2017-05-01 = 31 + 30 = 61 days, all counted; 122 units;
  //   2017Q1 has 31 days and 2017Q2 has 30: 122 · 31/61 = 62 and 122 · 30/61 = 60.
  row('Taipei', 'city', 1, '2017-03-01', 122, '2017-10-31'),
  // city channel phase 2: 2017-05-01 .. 2017-09-01 = 31 + 30 + 31 + 31 = 123 days, 61 counted (May, June);
  //   units = round(246 · 61/123) = 122, all in 2017Q2.
  row('Taipei', 'city', 2, '2017-05-01', 246, '2017-09-01'),
  // central channel phase 1: 2017-06-01 .. 2017-08-01 = 61 days, 30 counted; units = round(61 · 30/61) = 30.
  row('Taipei', 'central', 1, '2017-06-01', 61, '2017-08-01'),
  // New Taipei phase 1: 61 days, 10 units over weights 31 and 30: 5.08 and 4.92 → largest remainder gives 5 and 5.
  row('New Taipei', 'city', 1, '2017-03-01', 10, '2017-05-01'),
  // New Taipei central phase 1 starts after the window: nothing is counted.
  row('New Taipei', 'central', 1, '2017-08-01', 999, '2017-09-01'),
];

describe('buildSubleaseUnits', () => {
  const t = buildSubleaseUnits(rows, quarters);

  it('spreads each phase by day to the next phase of the same channel and counts only days up to the window end', () => {
    expect(t.Taipei.map((r) => r.value)).toEqual([62, 60 + 122 + 30]);
  });

  it('gives whole units that sum exactly to the rounded counted total', () => {
    expect(t['New Taipei'].map((r) => r.value)).toEqual([5, 5]);
  });

  it('marks every record estimated with the phase-spread method and the MOI source', () => {
    for (const r of [...t.Taipei, ...t['New Taipei']]) {
      expect(r).toMatchObject({ source: 'policy/moi-b5010', estimated: true, method: 'sublease-phase-spread' });
    }
  });

  it('is 0 before the first phase start', () => {
    const full = buildSubleaseUnits(rows, quartersBetween(2016, 2017));
    expect(full.Taipei.slice(0, 5).map((r) => r.value)).toEqual([0, 0, 0, 0, 62]);
  });

  it('stops naming the series, city and first quarter when a city has no row or a phase has no span', () => {
    expect(() => buildSubleaseUnits(rows.filter((r) => r.city === 'Taipei'), quarters)).toThrow(DataError);
    expect(() => buildSubleaseUnits(rows.filter((r) => r.city === 'Taipei'), quarters)).toThrow('subleaseUnitsMatched New Taipei 2017Q1');
    const empty = [row('Taipei', 'city', 1, '2017-03-01', 5, '2017-03-01'), ...rows.filter((r) => r.city === 'New Taipei')];
    expect(() => buildSubleaseUnits(empty, quarters)).toThrow(/empty-phase-span: subleaseUnitsMatched Taipei 2017Q1/);
  });
});
