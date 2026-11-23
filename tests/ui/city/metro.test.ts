// Metro data and network queries (city-3d Requirements 8.5 to 8.7, task 9).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildMetroData, renderStationModule } from '../../../scripts/metro/build.ts';
import { inAnyPolygon, type PolygonXZ } from '../../../src/ui/city/geometry.ts';
import { openNetwork, quarterEnd, stationNear, stationsByLine } from '../../../src/ui/city/metro/network.ts';
import { METRO_DATA } from '../../../src/ui/city/metro/station-data.ts';
import { project } from '../../../src/ui/city/projection.ts';

const districtsFile = JSON.parse(fs.readFileSync('public/data/districts.json', 'utf8')) as {
  districts: { code: string; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } }[];
};
const polygonsOf = (code: string): PolygonXZ[] => {
  const d = districtsFile.districts.find((x) => x.code === code)!;
  return ((d.geometry.type === 'Polygon' ? [d.geometry.coordinates] : d.geometry.coordinates) as [number, number][][][]).map((poly) =>
    poly.map((ring) => ring.map(project)),
  );
};

describe('generated station data (src/ui/city/metro/station-data.ts)', () => {
  it('every station lies in its district, every segment names known stations, no Sanying Line', () => {
    const keys = new Set(METRO_DATA.stations.map((s) => s.key));
    expect(keys.size).toBe(METRO_DATA.stations.length);
    for (const s of METRO_DATA.stations) {
      const [x, z] = project([s.lon, s.lat]);
      expect(inAnyPolygon(x, z, polygonsOf(s.district)), s.name).toBe(true);
      expect(s.ids.some((id) => id.startsWith('LB'))).toBe(false);
    }
    for (const g of METRO_DATA.segments) {
      expect(keys.has(g.from) && keys.has(g.to)).toBe(true);
      expect(METRO_DATA.lines.some((l) => l.id === g.line)).toBe(true);
    }
    expect(METRO_DATA.lines.map((l) => l.id)).toEqual(['BL', 'BR', 'R', 'G', 'O', 'Y']);
  });

  it('transfer stations are one station with several lines', () => {
    const main = METRO_DATA.stations.find((s) => s.name === 'Taipei Main Station');
    expect(main?.lines).toEqual(['BL', 'R']);
  });
});

describe('open network by quarter (city-3d 8.6, 8.7)', () => {
  it('has no Circular Line before 2020Q1 and has it from 2020Q1; Dingpu opens in 2015Q3', () => {
    const before = openNetwork(METRO_DATA, '2019Q4');
    const after = openNetwork(METRO_DATA, '2020Q1');
    expect(before.segments.some((g) => g.line === 'Y')).toBe(false);
    expect(after.segments.some((g) => g.line === 'Y')).toBe(true);
    expect(before.linesAt.get('banqiao')).toEqual(['BL']);
    expect(after.linesAt.get('banqiao')).toEqual(['BL', 'Y']);
    expect(openNetwork(METRO_DATA, '2015Q2').stations.some((s) => s.key === 'dingpu')).toBe(false);
    expect(openNetwork(METRO_DATA, '2015Q3').stations.some((s) => s.key === 'dingpu')).toBe(true);
  });

  it('lists stations of a line in line order, including branch stations', () => {
    const groups = stationsByLine(METRO_DATA, openNetwork(METRO_DATA, '2025Q4'));
    const bl = groups.find((g) => g.line === 'BL')!.stations.map((s) => s.name);
    expect(bl[0]).toBe('Dingpu');
    expect(bl[bl.length - 1]).toBe('Taipei Nangang Exhibition Center');
    const g = groups.find((x) => x.line === 'G')!.stations.map((s) => s.name);
    expect(g.indexOf('Xiaobitan')).toBe(g.indexOf('Qizhang') + 1);
  });

  it('finds the nearest open station within a distance', () => {
    const net = openNetwork(METRO_DATA, '2025Q4');
    const pos = (s: { lon: number; lat: number }) => project([s.lon, s.lat]);
    const main = METRO_DATA.stations.find((s) => s.key === 'taipeimainstation')!;
    const [x, z] = pos(main);
    expect(stationNear(net, pos, x + 1, z, 5)?.key).toBe('taipeimainstation');
    expect(stationNear(net, pos, x + 500, z, 5)).toBeNull();
    expect(quarterEnd('2019Q2')).toBe('2019-06-30');
  });
});

describe('build script on a small input', () => {
  const stations = JSON.stringify([
    { StationID: 'BL01', StationName: { En: 'Dingpu', Zh_tw: '頂埔' }, StationPosition: { PositionLon: 121.418744, PositionLat: 24.959351 } },
    { StationID: 'BL02', StationName: { En: 'Yongning', Zh_tw: '永寧' }, StationPosition: { PositionLon: 121.43613, PositionLat: 24.96682 } },
    { StationID: 'LB01', StationName: { En: 'Sanying X', Zh_tw: '三鶯' }, StationPosition: { PositionLon: 121.43613, PositionLat: 24.96682 } },
  ]);
  const s2s = JSON.stringify([{ LineID: 'BL', RouteID: 'BL-1', TravelTimes: [{ FromStationID: 'BL01', ToStationID: 'BL02', RunTime: 120, StopTime: 30 }] }]);

  it('builds deterministic output, drops the Sanying Line and dates the Dingpu segment', () => {
    const data = buildMetroData([{ file: 's', text: stations }], [{ file: 't', text: s2s }], districtsFile.districts as never);
    expect(data.stations.map((s) => s.name)).toEqual(['Dingpu', 'Yongning']);
    expect(data.segments).toEqual([{ line: 'BL', from: 'dingpu', to: 'yongning', opened: '2015-07-06' }]);
    expect(renderStationModule(data)).toBe(renderStationModule(buildMetroData([{ file: 's', text: stations }], [{ file: 't', text: s2s }], districtsFile.districts as never)));
  });

  it('stops on a segment that names an unknown station', () => {
    const bad = JSON.stringify([{ LineID: 'BL', RouteID: 'BL-1', TravelTimes: [{ FromStationID: 'BL01', ToStationID: 'BL99', RunTime: 120, StopTime: 30 }] }]);
    expect(() => buildMetroData([{ file: 's', text: stations }], [{ file: 't', text: bad }], districtsFile.districts as never)).toThrow(/BL99/);
  });
});
