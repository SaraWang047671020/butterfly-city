import { describe, expect, it } from 'vitest';
import type { Quarter } from '../../../scripts/lib/time.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import type { DistrictShape } from '../../../scripts/pipeline/geo.ts';
import {
  buildMrtEntries,
  mergeStationPoints,
  mrtDailyFiles,
  type MrtInput,
} from '../../../scripts/pipeline/indicators/mrt.ts';
import type { MrtAnnualRow, MrtDailyRow } from '../../../scripts/pipeline/parsers/mrt.ts';
import type { BorderStation, MrtRowEntry } from '../../../scripts/pipeline/tables/mrt-stations.ts';

const square = (code: string, x: number): DistrictShape => ({
  code,
  polygons: [[[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]]],
});
const shapes = [square('A', 0), square('B', 1), square('C', 2)];
const districts = [{ code: 'A' }, { code: 'B' }, { code: 'C' }];
const quarters: Quarter[] = [
  '2015Q1', '2015Q2', '2015Q3', '2015Q4', '2016Q1', '2016Q2', '2016Q3', '2016Q4',
  '2020Q1', '2020Q2', '2020Q3', '2020Q4',
];
const stationPoints = [
  { name: 'S1', lon: 0.5, lat: 0.5 },
  { name: 'S2', lon: 1.5, lat: 0.5 },
  { name: 'S3', lon: 2.5, lat: 0.5 },
];
const rows: MrtRowEntry[] = [
  { name: 'R1', station: 'S1', dailyName: 'S1', opened: 'before-2015' },
  { name: 'R2', station: 'S2', dailyName: 'S2', opened: '2015-07-06' },
  { name: 'R3', station: 'S3', opened: '2020-01-31', comparable: 'S1' },
];

/** One daily row per quarter (day 2 of the middle month), entries per column. */
function daily(year: number, perQuarter: readonly number[], column: string): MrtDailyRow[] {
  return perQuarter.map((n, k) => ({
    date: `${year}-${String(k * 3 + 2).padStart(2, '0')}-02`,
    entries: new Map([[column, n]]),
  }));
}
// S1: shares 1/6, 1/6, 1/3, 1/3 in both years. S2: the same shares, 2016 only is a full year.
const dailyRows: MrtDailyRow[] = [
  ...daily(2015, [100, 100, 200, 200], 'S1'),
  ...daily(2016, [200, 200, 400, 400], 'S1'),
  ...daily(2016, [100, 100, 200, 200], 'S2'),
];
const annual = (year: number, name: string, entries: number): MrtAnnualRow => ({ year, name, entries });
const annualRows: MrtAnnualRow[] = [
  annual(2015, 'R1', 1200),
  annual(2016, 'R1', 1200),
  annual(2020, 'R1', 600),
  annual(2015, 'R2', 900),
  annual(2016, 'R2', 600),
  annual(2020, 'R2', 600),
  annual(2020, 'R3', 1200),
  annual(2015, '一日票', 99999),
];

const base: MrtInput = { annualRows, daily: dailyRows, stationPoints, shapes, districts, quarters, rows };
const values = (r: ReturnType<typeof buildMrtEntries>, code: string): number[] => r.series[code]!.map((v) => v.value!);

describe('buildMrtEntries', () => {
  const result = buildMrtEntries(base);

  it('splits a full year by the seasonal shares', () => {
    expect(values(result, 'A').slice(0, 4)).toEqual([200, 200, 400, 400]);
    expect(result.series.A![0]).toEqual({ value: 200, estimated: true, method: 'mrt-seasonal-split' });
  });

  it('rescales the shares over the active quarters in the opening year', () => {
    // R2 opens 2015-07-06: Q3 and Q4 get 900 * (1/3)/(2/3) each; Q1 and Q2 are not active.
    expect(values(result, 'B').slice(0, 4)).toEqual([0, 0, 450, 450]);
    expect(values(result, 'B').slice(4, 8)).toEqual([100, 100, 200, 200]);
  });

  it('gives a district without an active row 0 and not estimated', () => {
    expect(result.series.B![0]).toEqual({ value: 0, estimated: false });
    expect(result.series.B![2]).toEqual({ value: 450, estimated: true, method: 'mrt-seasonal-split' });
    expect(result.series.C![0]).toEqual({ value: 0, estimated: false });
    expect(result.series.C![7]).toEqual({ value: 0, estimated: false });
  });

  it('borrows the comparable station shares and notes it', () => {
    expect(values(result, 'C').slice(8)).toEqual([200, 200, 400, 400]);
    expect(result.comparableNotes).toEqual(['R3 (S3): seasonal shares of S1']);
  });

  it('keeps the quarterly sum equal to the annual entries and excludes non-station rows', () => {
    expect(values(result, 'A').slice(0, 4).reduce((a, b) => a + b, 0)).toBe(1200);
    const total = Object.values(result.series).flatMap((s) => s.map((v) => v.value!)).reduce((a, b) => a + b, 0);
    expect(total).toBe(1200 + 1200 + 600 + 900 + 600 + 600 + 1200);
  });

  it('adds rows of the same station together', () => {
    const twin: MrtRowEntry = { name: 'R1b', station: 'S1', dailyName: 'S1', opened: 'before-2015' };
    const r = buildMrtEntries({
      ...base,
      rows: [...rows, twin],
      annualRows: [...annualRows, annual(2015, 'R1b', 600), annual(2016, 'R1b', 600), annual(2020, 'R1b', 600)],
    });
    expect(values(r, 'A').slice(0, 4)).toEqual([300, 300, 600, 600]);
  });

  it('lists the border stations in use', () => {
    const border: BorderStation[] = [{ station: 'S2', nameEn: 'Second', pointDistrict: 'B', addressDistrict: 'A' }];
    const r = buildMrtEntries({ ...base, borderStations: border });
    expect(r.borderNotes).toEqual(['Second: station point in B, address in A']);
  });

  it('stops on an unknown row name, naming row and year', () => {
    const bad = [...annualRows, annual(2016, 'ZZZ', 5)];
    expect(() => buildMrtEntries({ ...base, annualRows: bad })).toThrow(DataError);
    expect(() => buildMrtEntries({ ...base, annualRows: bad })).toThrow(/ZZZ 2016/);
  });

  it('stops when an active row has no annual value for a year', () => {
    const bad = annualRows.filter((r) => !(r.name === 'R2' && r.year === 2016));
    expect(() => buildMrtEntries({ ...base, annualRows: bad })).toThrow(/R2 2016/);
  });

  it('stops when a station point lies in no district', () => {
    const far = [{ name: 'S1', lon: 9, lat: 9 }, ...stationPoints.slice(1)];
    expect(() => buildMrtEntries({ ...base, stationPoints: far })).toThrow(/S1/);
  });
});

describe('mergeStationPoints', () => {
  const station = (name: string, lon: number, lat: number) => ({
    StationName: { Zh_tw: name },
    StationPosition: { PositionLon: lon, PositionLat: lat },
  });
  it('merges stations with the same name, first record wins', () => {
    const a = JSON.stringify([station('頂埔', 121.1, 24.1), station('永寧', 121.2, 24.2)]);
    const b = JSON.stringify([station('頂埔站', 121.9, 24.9)]);
    expect(
      mergeStationPoints([
        { text: a, file: 'a.json' },
        { text: b, file: 'b.json' },
      ]),
    ).toEqual([
      { name: '頂埔', lon: 121.1, lat: 24.1 },
      { name: '永寧', lon: 121.2, lat: 24.2 },
    ]);
  });
});

describe('mrtDailyFiles', () => {
  it('lists 24 monthly files of 2015 and 2016', () => {
    const files = mrtDailyFiles();
    expect(files).toHaveLength(24);
    expect(files[0]).toBe('mrt/daily/taipei-entries-2015-01.csv');
    expect(files[23]).toBe('mrt/daily/taipei-entries-2016-12.csv');
  });
});
