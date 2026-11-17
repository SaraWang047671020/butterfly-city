import { describe, expect, it } from 'vitest';
import {
  buildCommuteMatrix,
  type CommuteModelInput,
  type LonLat,
  type ModelConstants,
} from '../../../../scripts/pipeline/commute/model.ts';
import type { NetworkStation, RailNetwork } from '../../../../scripts/pipeline/commute/network.ts';
import { DataError } from '../../../../scripts/pipeline/errors.ts';

// Constants chosen so every expected value can be computed by hand.
//   walk  = km * 1000 / 1.2 / 60 minutes      road(Taipei) = km minutes (60 km/h)      road(New Taipei) = 2 * km minutes
//   cell  = round1(min(road + 5, access(i) + path + access(j)))
const CONSTANTS: ModelConstants = { detourFactor: 1, walkSpeed: 1.2, roadSpeedTaipei: 60, roadSpeedNewTaipei: 30, accessTime: 5 };

// All points lie on the equator: 1 degree of longitude = 111.195082 km.
const A = '63000010'; // Taipei, lon 0.001 (0.111 km from station S1)
const B = '63000020'; // Taipei, lon 0.100 (11.12 km from S1)
const C = '65000030'; // New Taipei, lon 0.500 (on station S2)

const DISTRICTS = [
  { code: A, city: 'Taipei' as const },
  { code: B, city: 'Taipei' as const },
  { code: C, city: 'New Taipei' as const },
];
const CENTROIDS = new Map<string, LonLat>([
  [A, [0.001, 0]],
  [B, [0.1, 0]],
  [C, [0.5, 0]],
]);

const station = (id: string, lon: number): NetworkStation => ({ id, lineId: 'X', name: id, lon, lat: 0, opened: '2015-01-01' });

/** In-memory network: S1 -> S2 takes 12 minutes (4 in vehicle + 5 transfer walk and wait + 3 in vehicle). */
function fakeNetwork(order: readonly NetworkStation[]): RailNetwork {
  return {
    stations: order,
    edges: [],
    transferSites: [],
    lines: [],
    excluded: [],
    defaultWaitLines: [],
    transferWait: new Map(),
    inNetwork: () => true,
    pathTime: (a, b) => (a === b ? 0 : (a === 'S1' && b === 'S2') || (a === 'S2' && b === 'S1') ? 12 : undefined),
  };
}

const STATIONS = [station('S1', 0), station('S2', 0.5)];

function input(overrides: Partial<CommuteModelInput> = {}): CommuteModelInput {
  return { districts: DISTRICTS, centroids: CENTROIDS, network: fakeNetwork(STATIONS), constants: CONSTANTS, lrtCoords: new Map(), ...overrides };
}

describe('buildCommuteMatrix', () => {
  const result = buildCommuteMatrix(input());
  const cell = (o: string, w: string): number => result.minutes[result.codes.indexOf(o)]![result.codes.indexOf(w)]!;

  it('sorts codes ascending and sets the diagonal to 0', () => {
    expect(result.codes).toEqual([A, B, C]);
    expect([cell(A, A), cell(B, B), cell(C, C)]).toEqual([0, 0, 0]);
  });

  it('takes the rail route with one transfer when it is faster than the road', () => {
    // A -> C rail: walk 1.544 + 12 + 0 = 13.544 (road 55.488 + 5 = 60.488 for Taipei, 115.976 from New Taipei).
    expect(cell(A, C)).toBe(13.5);
    expect(cell(C, A)).toBe(13.5);
  });

  it('uses the road branch with accessTime for a station that is far away', () => {
    // B is 11.12 km from S1: access = min(walk 154.4, road 11.12 + 5) = 16.1195. B -> C rail = 16.1195 + 12 + 0 = 28.1195.
    expect(cell(B, C)).toBe(28.1);
    expect(cell(C, B)).toBe(28.1);
  });

  it('takes the road when it is faster than rail', () => {
    // A -> B road = 11.008 + 5 = 16.008; rail = 1.544 + 0 + 16.1195 = 17.664.
    expect(cell(A, B)).toBe(16);
    expect(cell(B, A)).toBe(16);
  });

  it('records the nearest station per district', () => {
    expect(result.nearest.get(A)).toBe('S1');
    expect(result.nearest.get(B)).toBe('S1');
    expect(result.nearest.get(C)).toBe('S2');
  });

  it('uses road time only when no path exists between the two nearest stations', () => {
    const noPath: RailNetwork = { ...fakeNetwork(STATIONS), pathTime: () => undefined };
    const r = buildCommuteMatrix(input({ network: noPath }));
    // A -> C by road from Taipei: 55.488 + 5 = 60.488; from New Taipei: 2 * 55.488 + 5 = 115.976.
    expect(r.minutes[0]![2]).toBe(60.5);
    expect(r.minutes[2]![0]).toBe(116);
  });

  it('stops the build and names the district when a centroid is missing', () => {
    const missing = new Map(CENTROIDS);
    missing.delete(C);
    let error: unknown;
    try {
      buildCommuteMatrix(input({ centroids: missing }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toBe(`district-without-centroid: ${C}`);
  });

  it('stops the build when a station without TDX coordinates has no LRT coordinates', () => {
    const noPos: NetworkStation = { id: 'K01', lineId: 'K', name: '', lon: undefined, lat: undefined, opened: '2023-02-10' };
    expect(() => buildCommuteMatrix(input({ network: fakeNetwork([...STATIONS, noPos]) }))).toThrow(/station-without-coordinates: K01/);
  });
});
