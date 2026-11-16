/** Tests for tables/mrt-stations.ts on the committed table only (never reads data/raw/). */
import { describe, expect, it } from 'vitest';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { BORDER_STATIONS, MRT_ROWS, NON_STATION_ROWS, checkRowNames } from '../../../scripts/pipeline/tables/mrt-stations.ts';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';

describe('MRT row table', () => {
  it('has 131 unique station rows and the 3 non-station rows are separate', () => {
    expect(MRT_ROWS).toHaveLength(131);
    expect(new Set(MRT_ROWS.map((r) => r.name)).size).toBe(131);
    expect(NON_STATION_ROWS).toEqual(['一日票', '團體票', '其他']);
    expect(MRT_ROWS.some((r) => NON_STATION_ROWS.includes(r.name))).toBe(false);
  });

  it('gives line-suffixed transfer rows the station name without the suffix', () => {
    const byName = new Map(MRT_ROWS.map((r) => [r.name, r]));
    expect(byName.get('板橋Y')).toMatchObject({ station: '板橋', opened: '2020-01-31', comparable: '板橋' });
    expect(byName.get('板橋')).toMatchObject({ station: '板橋', dailyName: '板橋', opened: 'before-2015' });
    expect(byName.get('南京復興BR')).toMatchObject({ station: '南京復興', dailyName: '南京復興' });
    expect(byName.get('南京復興G')).toMatchObject({ station: '南京復興', dailyName: '南京復興' });
    expect(byName.get('頂埔')).toMatchObject({ opened: '2015-07-06', dailyName: '頂埔' });
    expect(byName.get('頂埔')?.comparable).toBeUndefined();
  });

  it('gives every row not open for a full year in 2015-2016 a comparable that is open both years', () => {
    const open = new Set(MRT_ROWS.filter((r) => r.opened === 'before-2015' && r.dailyName !== undefined).map((r) => r.dailyName));
    const circular = MRT_ROWS.filter((r) => r.opened === '2020-01-31');
    expect(circular).toHaveLength(14);
    for (const r of circular) {
      expect(r.dailyName).toBeUndefined();
      expect(open.has(r.comparable)).toBe(true);
    }
    for (const r of MRT_ROWS.filter((x) => x.opened === 'before-2015')) expect(r.comparable).toBeUndefined();
  });

  it('uses only ISO dates or "before-2015" as opening values', () => {
    for (const r of MRT_ROWS) expect(r.opened === 'before-2015' || /^\d{4}-\d{2}-\d{2}$/.test(r.opened)).toBe(true);
  });
});

describe('BORDER_STATIONS', () => {
  it('lists the 7 border stations with differing point and address districts that exist in the district table', () => {
    expect(BORDER_STATIONS).toHaveLength(7);
    const stations = new Set(MRT_ROWS.map((r) => r.station));
    const names = new Set(DISTRICTS.map((d) => d.name));
    for (const b of BORDER_STATIONS) {
      expect(stations.has(b.station)).toBe(true);
      expect(b.pointDistrict).not.toBe(b.addressDistrict);
      expect(names.has(b.pointDistrict)).toBe(true);
      expect(names.has(b.addressDistrict)).toBe(true);
    }
  });
});

describe('checkRowNames', () => {
  it('accepts known station rows and non-station rows', () => {
    expect(() => checkRowNames([{ name: '板橋Y', year: 2020 }, { name: '一日票', year: 2015 }, { name: '其他', year: 2016 }])).not.toThrow();
  });

  it('throws a DataError naming the unknown row and year', () => {
    try {
      checkRowNames([{ name: '板橋Y', year: 2020 }, { name: '新站', year: 2024 }]);
      throw new Error('expected DataError');
    } catch (e) {
      expect(e).toBeInstanceOf(DataError);
      expect((e as DataError).subject).toBe('新站 2024');
      expect((e as DataError).details.join('\n')).toContain('2024');
    }
  });
});
