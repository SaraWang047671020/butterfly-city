/** Tests for tables/mrt-comparable.ts on a small TDX-like fixture (never reads data/raw/). */
import { describe, expect, it } from 'vitest';
import {
  adjacentIds,
  chooseComparable,
  distanceKm,
  rowLine,
  type TdxStationRef,
} from '../../../scripts/pipeline/tables/mrt-comparable.ts';
import type { MrtRowEntry } from '../../../scripts/pipeline/tables/mrt-stations.ts';
import { MRT_ROWS } from '../../../scripts/pipeline/tables/mrt-stations.ts';

const st = (id: string, name: string, lon: number, lat = 25): TdxStationRef => ({ id, name, lon, lat });
const old = (name: string, station: string): MrtRowEntry => ({ name, station, dailyName: station, opened: 'before-2015' });
const newRow = (name: string, station: string): MrtRowEntry => ({ name, station, opened: '2020-01-31', comparable: '?' });

// Line G: G01 A, G02 B, G03 C (missing shares), G03A Branch, G04 D. Line Y: Y01 New1, Y02 New2.
const stations: TdxStationRef[] = [
  st('G01', 'A', 121.0),
  st('G02', 'B', 121.01),
  st('G03', 'C', 121.03),
  st('G03A', 'Branch', 121.031),
  st('G04', 'D', 121.05),
  st('R01', 'E', 121.0305), // near the branch, other line
  st('Y01', 'New1', 121.2),
  st('Y02', 'New2', 121.22),
  st('G05', 'New3', 121.06),
  st('G06', 'F', 121.075),
];
const rows: MrtRowEntry[] = [
  old('A', 'A'), old('B', 'B'), old('D', 'D'), old('E', 'E'), old('F', 'F'),
  newRow('C', 'C'), newRow('Branch', 'Branch'), newRow('New1', 'New1'), newRow('New2', 'New2'), newRow('New3', 'New3'),
];
const byName = (n: string): MrtRowEntry => rows.find((r) => r.name === n)!;

describe('adjacentIds', () => {
  it('gives consecutive numbers and branch links', () => {
    expect(adjacentIds('Y16')).toEqual(['Y15', 'Y17']);
    expect(adjacentIds('BL01')).toEqual(['BL02']);
    expect(adjacentIds('G03')).toEqual(['G02', 'G04', 'G03A']);
    expect(adjacentIds('G03A')).toEqual(['G03']);
    expect(adjacentIds('R22A')).toEqual(['R22']);
    expect(adjacentIds('R22')).toEqual(['R21', 'R23', 'R22A']);
    expect(adjacentIds('O50')).toEqual(['O49', 'O51', 'O12']);
  });
});

describe('rowLine', () => {
  it('uses the row suffix, else the line of the station', () => {
    const tdx = [st('BL07', '板橋', 0), st('Y16', '板橋', 0), st('Y08', '十四張', 0)];
    expect(rowLine({ name: '板橋Y', station: '板橋', opened: 'x' }, tdx)).toBe('Y');
    expect(rowLine({ name: '板橋', station: '板橋', opened: 'before-2015' }, tdx)).toBe('BL');
    expect(rowLine({ name: '十四張', station: '十四張', opened: 'x' }, tdx)).toBe('Y');
  });
});

describe('chooseComparable', () => {
  it('picks the nearer neighbour when both adjacent stations have shares (rule 1)', () => {
    // C (G03): G02 B is 0.02 deg away, G04 D is 0.02 deg away; make the tie explicit through the code order.
    const c = chooseComparable(byName('C'), rows, stations)!;
    expect(c.rule).toBe('adjacent-line');
    expect(c.station).toBe('B');
    expect(c.distanceKm).toBeCloseTo(distanceKm(stations[2]!, stations[1]!), 9);
  });

  it('chooses the smaller distance, not the lower code, when the distances differ', () => {
    const moved = stations.map((s) => (s.id === 'G04' ? { ...s, lon: 121.035 } : s));
    expect(chooseComparable(byName('C'), rows, moved)!.station).toBe('D');
  });

  it('ties go to the lower station code', () => {
    const tie = stations.map((s) => (s.id === 'G04' ? { ...s, lon: 121.05 } : s.id === 'G02' ? { ...s, lon: 121.01 } : s));
    expect(chooseComparable(byName('C'), rows, tie)!.station).toBe('B');
  });

  it('links a branch station to its junction and ignores a nearer station of another line', () => {
    // Branch (G03A) adjoins only G03 = C, which has no shares, so rule 2 applies: nearest with shares is E (other line).
    const c = chooseComparable(byName('Branch'), rows, stations)!;
    expect(c).toMatchObject({ rule: 'nearest', station: 'E' });
  });

  it('uses the nearest station with shares when every adjacent station lacks shares (rule 2)', () => {
    const c = chooseComparable(byName('New1'), rows, stations)!;
    expect(c.rule).toBe('nearest');
    expect(c.station).toBe('F');
  });

  it('applies rule 1 across a station that has shares on the next number', () => {
    // New3 (G05) neighbours: G04 D (shares) and G06 F (shares). D is nearer.
    const c = chooseComparable(byName('New3'), rows, stations)!;
    expect(c).toMatchObject({ rule: 'adjacent-line', station: 'D' });
  });

  it('does not count a transfer-station row of another line as adjacent on the same line', () => {
    const tdx = [st('BL07', 'X', 121.0), st('Y16', 'X', 121.0), st('Y15', 'Y15n', 121.1), st('BL06', 'Z', 121.5)];
    const table: MrtRowEntry[] = [
      old('X', 'X'),
      { name: 'XY', station: 'X', opened: '2020-01-31', comparable: '?' },
      { name: 'Y15n', station: 'Y15n', opened: '2020-01-31', comparable: '?' },
      old('Z', 'Z'),
    ];
    expect(chooseComparable(table[1]!, table, tdx)).toMatchObject({ rule: 'nearest', station: 'X', distanceKm: 0 });
  });

  it('returns undefined when no row has shares', () => {
    expect(chooseComparable(byName('New1'), [byName('New1')], stations)).toBeUndefined();
  });
});

describe('MRT_ROWS comparables', () => {
  it('references a row with shares and records the rule and distance', () => {
    const shares = new Set(MRT_ROWS.filter((r) => r.opened === 'before-2015' && r.dailyName !== undefined).map((r) => r.dailyName));
    const borrowing = MRT_ROWS.filter((r) => r.comparable !== undefined);
    expect(borrowing).toHaveLength(14);
    for (const r of borrowing) {
      expect(shares.has(r.comparable!)).toBe(true);
      expect(['adjacent-line', 'nearest']).toContain(r.comparableRule);
      expect(r.comparableKm).toBeGreaterThanOrEqual(0);
    }
  });
});
