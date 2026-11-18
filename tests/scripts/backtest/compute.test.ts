import { describe, expect, it } from 'vitest';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { adaptInputs } from '../../../scripts/backtest/adapt.ts';
import type { BacktestCase } from '../../../scripts/backtest/cases.ts';
import { computeCase, computeObserved, type MrtObservedInput } from '../../../scripts/backtest/compute.ts';
import { filterStations, quarterlyByDistrict, type MonthlyEntries } from '../../../scripts/backtest/mrt-monthly.ts';
import type { EngineBaseline } from '../../../src/types/simulation.ts';

// Station names of the station table (MRT_ROWS), so the default alias resolves them.
const TAIPEI_MAIN = '台北車站'; // district A
const ZHONGSHAN = '中山'; // district A, no entries in 2023-05
const MINQUAN = '民權西路'; // the table puts it in Zhongshan; the stationDistrict map puts it in B (border station)
const BANQIAO = '板橋'; // district B

const MONTHS = [2019, 2023].flatMap((y) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`));

/** 2019: constant. 2023: Q1/Q2 level, then Q3/Q4 level after the price change. 中山 is absent in 2023-05. */
function monthly(extra?: { month: string; key: string; value: number }): MonthlyEntries[] {
  return MONTHS.map((month) => {
    const year = Number(month.slice(0, 4));
    const second = Number(month.slice(5, 7)) > 6;
    const entries = new Map<string, number>();
    if (year === 2019) {
      entries.set(TAIPEI_MAIN, 100).set(ZHONGSHAN, 10).set(MINQUAN, 20).set(BANQIAO, 40);
    } else {
      entries.set(TAIPEI_MAIN, second ? 130 : 110).set(MINQUAN, second ? 30 : 20).set(BANQIAO, second ? 50 : 40);
      if (month !== '2023-05') entries.set(ZHONGSHAN, 12);
    }
    if (extra !== undefined && extra.month === month) entries.set(extra.key, extra.value);
    return { month, entries };
  });
}

const STATION_DISTRICT = new Map([
  [TAIPEI_MAIN, 'A'],
  [ZHONGSHAN, 'A'],
  [MINQUAN, 'B'],
  [BANQIAO, 'B'],
]);

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

// Baseline with three districts; C has no station and must stay out of the scope.
const BASELINE = {
  quarters: [],
  districts: [
    { code: 'A', city: 'Taipei' },
    { code: 'B', city: 'New Taipei' },
    { code: 'C', city: 'Taipei' },
  ],
  indicators: {},
  indicatorSources: {},
  sourceIds: [],
} as unknown as EngineBaseline;

const MRT: MrtObservedInput = { monthly: monthly(), stationDistrict: STATION_DISTRICT };

describe('quarterlyByDistrict and filterStations on the fixture', () => {
  it('gives literal quarterly sums for the main and the all-stations result', () => {
    const q = quarterlyByDistrict(MRT.monthly, STATION_DISTRICT);
    const row = (m: typeof q.main, d: string) => ['2019Q1', '2019Q3', '2023Q1', '2023Q2', '2023Q3', '2023Q4'].map((k) => m.get(d)?.get(k));
    expect(row(q.main, 'A')).toEqual([300, 300, 330, 330, 390, 390]);
    expect(row(q.all, 'A')).toEqual([330, 330, 366, 354, 426, 426]);
    expect(row(q.main, 'B')).toEqual([180, 180, 180, 180, 240, 240]);
    expect(row(q.all, 'B')).toEqual(row(q.main, 'B'));
  });

  it('excludes the station missing in one month and reports its 2023 share', () => {
    const f = filterStations(MRT.monthly);
    expect(f.included).toEqual([BANQIAO, MINQUAN, TAIPEI_MAIN].sort());
    expect(f.excluded).toEqual([ZHONGSHAN]);
    // 2023 total 2412, excluded station 11 x 12 = 132.
    expect(f.excludedShare2023).toBeCloseTo(132 / 2412, 12);
  });

  it('maps a border station by the stationDistrict map, not by the station table', () => {
    const q = quarterlyByDistrict(MRT.monthly, STATION_DISTRICT);
    expect(q.all.get('B')?.get('2019Q1')).toBe(180); // 民權西路 60 + 板橋 120
    expect(q.all.get('A')?.get('2019Q1')).toBe(330); // not 民權西路
  });

  it('stops on an unknown station and names station and month', () => {
    let error: unknown;
    try {
      quarterlyByDistrict(monthly({ month: '2023-02', key: '未知站', value: 5 }), STATION_DISTRICT);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).subject).toBe('未知站');
    expect((error as DataError).details.join('\n')).toContain('month: 2023-02');
  });
});

describe('computeObserved on the fixture', () => {
  it('matches the literal quarterly sums and the literal effect', () => {
    const r = computeObserved(CASE, BASELINE, MRT);
    if (!r.ok) throw new Error(r.reason);
    const o = r.value;
    // Main: post 1260 - 960, pre 1020 - 960.
    expect(o.postChangeYear).toBe(1260);
    expect(o.postComparisonYear).toBe(960);
    expect(o.preChangeYear).toBe(1020);
    expect(o.preComparisonYear).toBe(960);
    expect(o.effect).toBe(1260 - 960 - (1020 - 960));
    expect(o.effect).toBe(240);
    // All stations: 中山 is kept: post 1332 - 1020, pre 1080 - 1020.
    expect(o.allStations).toEqual({ postChangeYear: 1332, postComparisonYear: 1020, preChangeYear: 1080, preComparisonYear: 1020, effect: 252 });
    expect(o.includedStationCount).toBe(3);
    expect(o.excludedStations).toEqual([ZHONGSHAN]);
    expect(o.excludedShare2023).toBeCloseTo(132 / 2412, 12);
  });

  it('uses only the districts with a station (C is out of scope)', () => {
    const r = computeObserved(CASE, BASELINE, MRT);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.districtCodes).toEqual(['A', 'B']);
    expect(r.value.districtCount).toBe(2);
  });

  it('throws a DataError naming the unknown station and the month', () => {
    const bad: MrtObservedInput = { monthly: monthly({ month: '2023-02', key: '未知站', value: 5 }), stationDistrict: STATION_DISTRICT };
    expect(() => computeObserved(CASE, BASELINE, bad)).toThrow(DataError);
    try {
      computeObserved(CASE, BASELINE, bad);
    } catch (e) {
      expect((e as DataError).subject).toBe('未知站');
      expect((e as DataError).details.join('\n')).toContain('2023-02');
    }
  });
});

describe('computeCase', () => {
  it('returns "not computed" naming the unknown station and month, before the engine runs', () => {
    const bad: MrtObservedInput = { monthly: monthly({ month: '2023-02', key: '未知站', value: 5 }), stationDistrict: STATION_DISTRICT };
    const r = computeCase(CASE, { baseline: BASELINE } as never, bad);
    expect(r.status).toBe('not-computed');
    if (r.status === 'not-computed') {
      expect(r.reason).toContain('未知站');
      expect(r.reason).toContain('2023-02');
    }
  });

  it('sums the simulated effect over the same districts as the observed one; the all-41 reference is separate', () => {
    const adapted = adaptInputs();
    if (!adapted.ok) throw new Error(adapted.reason);
    const taipei = adapted.inputs.baseline.districts.find((d) => d.city === 'Taipei')?.code as string;
    const newTaipei = adapted.inputs.baseline.districts.find((d) => d.city === 'New Taipei')?.code as string;
    const scoped = (map: Record<string, string>): MrtObservedInput => ({
      monthly: MRT.monthly,
      stationDistrict: new Map(Object.entries(map)),
    });
    const both = computeCase(CASE, adapted.inputs, scoped({ [TAIPEI_MAIN]: taipei, [ZHONGSHAN]: taipei, [MINQUAN]: newTaipei, [BANQIAO]: newTaipei }));
    const onlyT = computeCase(CASE, adapted.inputs, scoped({ [TAIPEI_MAIN]: taipei, [ZHONGSHAN]: taipei, [MINQUAN]: taipei, [BANQIAO]: taipei }));
    const onlyN = computeCase(CASE, adapted.inputs, scoped({ [TAIPEI_MAIN]: newTaipei, [ZHONGSHAN]: newTaipei, [MINQUAN]: newTaipei, [BANQIAO]: newTaipei }));
    if (both.status !== 'computed' || onlyT.status !== 'computed' || onlyN.status !== 'computed') {
      throw new Error(JSON.stringify([both, onlyT, onlyN].map((r) => (r.status === 'computed' ? 'ok' : r.reason))));
    }
    expect(both.observed.districtCodes).toEqual([taipei, newTaipei].sort());
    expect(both.observed.effect).toBe(240);
    expect(onlyT.observed.districtCodes).toEqual([taipei]);
    // The simulated sum is over the observed district set: scope {T, N} = scope {T} + scope {N}.
    expect(both.simulated.central).toBeCloseTo(onlyT.simulated.central + onlyN.simulated.central, 6);
    expect(both.simulated.min).toBeCloseTo(onlyT.simulated.min + onlyN.simulated.min, 6);
    expect(both.simulated.max).toBeCloseTo(onlyT.simulated.max + onlyN.simulated.max, 6);
    // The all-districts reference does not depend on the observed scope.
    expect(onlyT.simulatedAllDistricts).toEqual(both.simulatedAllDistricts);
    expect(onlyN.simulatedAllDistricts).toEqual(both.simulatedAllDistricts);
    // The error uses the scoped simulated sum, not the reference.
    expect(both.absoluteError).toBeCloseTo(both.simulated.central - 240, 6);
  }, 120_000);
});
