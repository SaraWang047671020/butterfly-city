/** Backtest_Derived_File: round trip, schema check, raw-vs-derived modes (Requirements 27.24 to 27.27). Fixtures only. */
import { describe, expect, it } from 'vitest';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import type { BacktestCase } from '../../../scripts/backtest/cases.ts';
import { computeObserved } from '../../../scripts/backtest/compute.ts';
import {
  buildDerived,
  diffDerived,
  mrtInputFromDerived,
  parseDerived,
  resolveDerived,
  serializeDerived,
} from '../../../scripts/backtest/derived.ts';
import { BACKTEST_MONTHS, type MonthlyEntries } from '../../../scripts/backtest/mrt-monthly.ts';
import type { EngineBaseline } from '../../../src/types/simulation.ts';

const A1 = '台北車站';
const A2 = '中山'; // no entries in 2023-05
const B1 = '板橋';

const monthly: MonthlyEntries[] = BACKTEST_MONTHS.map((month) => {
  const second = Number(month.slice(5, 7)) > 6;
  const entries = new Map<string, number>([[A1, month.startsWith('2019') ? 100 : second ? 130 : 110], [B1, 40]]);
  if (month !== '2023-05') entries.set(A2, 10);
  return { month, entries, source: `https://example.test/${month}` };
});
const stationDistrict = new Map([[A1, 'A'], [A2, 'A'], [B1, 'B']]);

const CASE: BacktestCase = {
  id: 'fixture',
  title: 'fixture',
  tool: 'commuterPass',
  change: { field: 'commuterPassPrice', cities: ['Taipei', 'New Taipei'], firstQuarter: '2023Q3', before: 1280, after: 1200 },
  indicator: 'mrtEntries',
  areas: ['Taipei', 'New Taipei'],
  evaluationQuarters: ['2023Q3', '2023Q4'],
  observed: {
    source: 'mrt-od-monthly',
    indicator: 'mrtEntries',
    cities: ['Taipei', 'New Taipei'],
    comparisonYear: 2019,
    changeYear: 2023,
    postQuarters: ['Q3', 'Q4'],
    preQuarters: ['Q1', 'Q2'],
    method: 'fixture',
    confounders: ['fixture'],
    secondaryContext: [],
  },
  tolerances: { ratioLow: 0.5, ratioHigh: 2 },
  parametersChangedAfterOutcome: [],
};
const BASELINE = {
  districts: [{ code: 'A', city: 'Taipei' }, { code: 'B', city: 'New Taipei' }],
} as unknown as EngineBaseline;

const build = () => buildDerived(monthly, stationDistrict, [CASE], BASELINE);

describe('Backtest_Derived_File', () => {
  it('holds literal sums, month info, station lists and the exclusion reason', () => {
    const d = build();
    expect(d.months).toHaveLength(24);
    expect(d.months[0]).toEqual({ month: '2019-01', source: 'https://example.test/2019-01', stationCount: 3 });
    expect(d.months[16]).toEqual({ month: '2023-05', source: 'https://example.test/2023-05', stationCount: 2 });
    expect(d.mainStations).toEqual([B1, A1].sort());
    expect(d.excludedStations).toEqual([{ station: A2, reason: 'no entries in 2023-05' }]);
    expect(d.quarterly.main['A']?.['2023Q3']).toBe(390);
    expect(d.quarterly.all['A']?.['2023Q2']).toBe(350); // 330 + 10 + 0 + 10
    // main: ((1020 - 840) - (900 - 840))
    expect(d.observed['fixture']?.main.effect).toBe(120);
  });

  it('round-trips through the serializer and the schema check', () => {
    const d = build();
    const text = serializeDerived(d);
    const back = parseDerived(text, 'f.json');
    expect(back).toEqual(d);
    expect(serializeDerived(back)).toBe(text);
    expect(diffDerived(d, back)).toEqual([]);
  });

  it('gives the same observed effect from the derived data as from the stored one', () => {
    const d = build();
    const r = computeObserved(CASE, BASELINE, mrtInputFromDerived(parseDerived(serializeDerived(d), 'f.json')));
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.effect).toBe(d.observed['fixture']?.main.effect);
    expect(r.value.allStations.effect).toBe(d.observed['fixture']?.all.effect);
  });

  it('stops on a malformed file and names the field', () => {
    const d = JSON.parse(serializeDerived(build())) as { months: unknown[] };
    d.months.pop();
    expect(() => parseDerived(JSON.stringify(d), 'f.json')).toThrow(DataError);
    expect(() => parseDerived('{', 'f.json')).toThrow(DataError);
  });
});

describe('resolveDerived modes', () => {
  it('creates the file when raw files exist and it is absent', () => {
    expect(resolveDerived(true, null, build).kind).toBe('create');
  });

  it('accepts an equal committed file without a rewrite', () => {
    expect(resolveDerived(true, build(), build).kind).toBe('verified');
  });

  it('stops with the path, committed and recomputed value when a value differs', () => {
    const committed = JSON.parse(serializeDerived(build())) as { quarterly: { main: { A: Record<string, number> } } };
    committed.quarterly.main.A['2023Q3'] = 391;
    const r = resolveDerived(true, parseDerived(JSON.stringify(committed), 'f.json'), build);
    expect(r.kind).toBe('differs');
    if (r.kind === 'differs') {
      expect(r.differences).toContainEqual({ path: 'quarterly.main.A.2023Q3', committed: '391', recomputed: '390' });
    }
  });

  it('uses the committed file when raw files are absent, and does not recompute', () => {
    const r = resolveDerived(false, build(), () => {
      throw new Error('must not recompute');
    });
    expect(r.kind).toBe('derived-only');
  });

  it('stops when both are absent', () => {
    expect(resolveDerived(false, null, build).kind).toBe('missing');
  });
});
