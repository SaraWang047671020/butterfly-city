import { describe, expect, it } from 'vitest';
import {
  AIRPORT_REASON,
  SANYING_REASON,
  buildRailNetwork,
  parseS2S,
  parseStations,
  parseTransferWalk,
  type RawStation,
  type S2SRecord,
} from '../../../../scripts/pipeline/commute/network.ts';
import { DANHAI_EXCLUDED_REASON, type TimetableModel } from '../../../../scripts/pipeline/commute/timetable.ts';
import { DataError, ParseError } from '../../../../scripts/pipeline/errors.ts';

const st = (id: string, name: string): RawStation => ({ id, name, lon: 121.5, lat: 25.0 });
const rec = (lineId: string, routeId: string, from: string, to: string, runSeconds: number, stopSeconds: number): S2SRecord => ({
  lineId,
  routeId,
  from,
  to,
  runSeconds,
  stopSeconds,
});

const STATIONS: RawStation[] = [
  st('BL01', 'Dingpu'),
  st('BL02', 'Alpha'),
  st('BL03', 'Beta'),
  st('BL04', 'Gamma'),
  st('BL05', 'Delta'),
  st('R10', 'Beta'),
  st('R11', 'Delta'),
  st('Y17', 'Epsilon'),
  st('LB01', 'Sanying1'),
  st('LB02', 'Sanying2'),
];

// Edge minutes = RunTime / 60 + dwell of the arrival station (its own leaving StopTime).
const S2S: S2SRecord[] = [
  rec('BL', 'BL-1', 'BL02', 'BL03', 120, 30), // 2 + dwell(BL03) 0.5 = 2.5
  rec('BL', 'BL-1', 'BL03', 'BL04', 180, 30), // 3 + dwell(BL04) 0 = 3
  rec('BL', 'BL-1', 'BL04', 'BL05', 600, 0), // 10
  rec('R', 'R-1', 'R10', 'R11', 240, 30), // 4
  rec('LB', 'LB-1', 'LB01', 'LB02', 100, 0), // dropped line
];

const WALK = new Map([
  ['Beta', 4],
  ['Zeta', 2],
]);

const TIMETABLE: TimetableModel = {
  interStationTimes: [{ lineId: 'K', from: 'K08', to: 'K09', minutes: 3, samples: 3 }],
  headways: [
    { lineId: 'BL', section: 'BL all routes', minutes: 8, directions: [] },
    { lineId: 'R', section: 'R all routes', minutes: 6, directions: [] },
  ],
  uncoveredHeadways: [],
  uncovered: [],
  runTimeFailures: [],
  excluded: [{ lineId: 'V', reason: DANHAI_EXCLUDED_REASON }],
};

const OPTIONS = { defaultTransferWait: 2.5 };
const build = (stations = STATIONS, s2s = S2S) => buildRailNetwork({ stations, s2s, transferWalk: WALK, timetable: TIMETABLE }, OPTIONS);

describe('rail network', () => {
  const net = build();

  it('keeps stations open by 2025-12-31 and drops the Sanying Line (LB)', () => {
    const ids = net.stations.map((s) => s.id);
    expect(ids).toEqual(['BL01', 'BL02', 'BL03', 'BL04', 'BL05', 'K08', 'K09', 'R10', 'R11', 'Y17']);
    expect(net.stations.find((s) => s.id === 'BL01')?.opened).toBe('2015-07-06');
    expect(net.stations.find((s) => s.id === 'Y17')?.opened).toBe('2020-01-31');
    expect(net.stations.find((s) => s.id === 'BL02')?.opened).toBe('before-2015');
  });

  it('lists LB, the Taoyuan Airport MRT and the Danhai LRT as excluded, and the Ankeng LRT as timetable-supplied', () => {
    expect(net.excluded).toEqual([
      { lineId: 'V', reason: DANHAI_EXCLUDED_REASON },
      { lineId: 'LB', reason: SANYING_REASON },
      { lineId: 'AIRPORT', reason: AIRPORT_REASON },
    ]);
    const source = (id: string) => net.lines.find((l) => l.lineId === id)?.source;
    expect(source('BL')).toBe('tdx-s2s');
    expect(source('K')).toBe('timetable');
    expect(source('LB')).toBe('excluded');
    expect(source('AIRPORT')).toBe('excluded');
    expect(source('V')).toBe('excluded');
  });

  it('builds edges from RunTime plus the dwell of the arrival station', () => {
    expect(net.edges.map((e) => [e.lineKey, e.from, e.to, e.minutes])).toEqual([
      ['BL', 'BL02', 'BL03', 2.5],
      ['BL', 'BL03', 'BL04', 3],
      ['BL', 'BL04', 'BL05', 10],
      ['K', 'K08', 'K09', 3],
      ['R', 'R10', 'R11', 4],
    ]);
  });

  it('computes shortest in-vehicle times with the transfer walk and the half-headway wait', () => {
    expect(net.pathTime('BL02', 'BL03')).toBe(2);
    expect(net.pathTime('BL02', 'BL04')).toBe(5.5);
    // BL02 -> BL03 (2.5) + walk 4 + wait R 3 = 9.5 at R10; + 4 to R11
    expect(net.pathTime('BL02', 'R10')).toBe(9.5);
    expect(net.pathTime('BL02', 'R11')).toBe(13.5);
    expect(net.pathTime('K08', 'K09')).toBe(3);
    expect(net.pathTime('BL02', 'BL02')).toBe(0);
  });

  it('returns undefined for an unreachable or unknown station', () => {
    expect(net.pathTime('BL02', 'K08')).toBeUndefined();
    expect(net.pathTime('BL02', 'ZZ99')).toBeUndefined();
  });

  it('uses the mean walk for an interchange the dataset lacks and lists it as estimated', () => {
    expect(net.transferSites.map((t) => [t.site, t.walkMinutes, t.estimated])).toEqual([
      ['Beta', 4, false],
      ['Delta', 3, true],
    ]);
  });

  it('uses the default wait for a line without a headway and lists it', () => {
    expect(net.transferWait.get('BL')).toBe(4);
    expect(net.transferWait.get('R')).toBe(3);
    expect(net.transferWait.get('K')).toBe(2.5);
    expect(net.defaultWaitLines).toEqual(['K']);
  });

  it('gives the same edges and path times for any input order (ties broken by station id)', () => {
    const other = build([...STATIONS].reverse(), [...S2S].reverse());
    expect(other.edges).toEqual(net.edges);
    expect(other.transferSites).toEqual(net.transferSites);
    for (const [a, b] of [
      ['BL02', 'R11'],
      ['BL05', 'R10'],
      ['R11', 'BL02'],
    ] as const) {
      expect(other.pathTime(a, b)).toBe(net.pathTime(a, b));
    }
  });

  it('keeps the smaller minutes when two records describe the same pair', () => {
    const dup = build(STATIONS, [...S2S, rec('BL', 'BL-1', 'BL03', 'BL02', 60, 0)]);
    expect(dup.edges.find((e) => e.from === 'BL02' && e.to === 'BL03')?.minutes).toBe(1.5); // 60 s + dwell(BL02) 0.5 min, against 2.5 or 2 for the other record
  });

  it('stops on a record that names a station missing from the station file', () => {
    expect(() => build(STATIONS, [...S2S, rec('BL', 'BL-1', 'BL02', 'ZZ99', 60, 0)])).toThrow(DataError);
  });

  it('stops when an LRT line is neither supplied nor excluded', () => {
    const tt: TimetableModel = { ...TIMETABLE, interStationTimes: [], uncovered: ['K'], excluded: [] };
    expect(() => buildRailNetwork({ stations: STATIONS, s2s: S2S, transferWalk: WALK, timetable: tt }, OPTIONS)).toThrow(DataError);
  });
});

describe('network file parsers', () => {
  it('parses the transfer walk file and strips the 捷運 prefix', () => {
    const map = parseTransferWalk('walk.csv', 'sno,station,Time\n1,捷運Alpha站,3\n2,Beta,4.5\n');
    expect([...map]).toEqual([
      ['Alpha站', 3],
      ['Beta', 4.5],
    ]);
  });

  it('stops on a missing Time column', () => {
    expect(() => parseTransferWalk('walk.csv', 'sno,station\n1,Alpha\n')).toThrow(ParseError);
  });

  it('parses stations and S2S records, and stops on a missing column', () => {
    const stations = parseStations(
      's.json',
      JSON.stringify([{ StationID: 'BL01', StationName: { Zh_tw: 'Dingpu' }, StationPosition: { PositionLon: 121.1, PositionLat: 25.2 } }]),
    );
    expect(stations).toEqual([{ id: 'BL01', name: 'Dingpu', lon: 121.1, lat: 25.2 }]);
    expect(() => parseStations('s.json', JSON.stringify([{ StationID: 'BL01' }]))).toThrow(ParseError);

    const s2s = parseS2S(
      't.json',
      JSON.stringify([{ LineID: 'BL', RouteID: 'BL-1', TravelTimes: [{ FromStationID: 'BL01', ToStationID: 'BL02', RunTime: 90, StopTime: 20 }] }]),
    );
    expect(s2s).toEqual([{ lineId: 'BL', routeId: 'BL-1', from: 'BL01', to: 'BL02', runSeconds: 90, stopSeconds: 20 }]);
    expect(() =>
      parseS2S('t.json', JSON.stringify([{ LineID: 'BL', RouteID: 'BL-1', TravelTimes: [{ FromStationID: 'BL01', ToStationID: 'BL02', StopTime: 20 }] }])),
    ).toThrow(ParseError);
  });
});
