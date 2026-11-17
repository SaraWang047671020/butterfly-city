import { describe, expect, it } from 'vitest';
import { buildCommuteFile } from '../../../../scripts/pipeline/commute/commute-file.ts';
import { buildCommuteMatrix, type LonLat, type ModelConstants } from '../../../../scripts/pipeline/commute/model.ts';
import type { NetworkStation, RailNetwork } from '../../../../scripts/pipeline/commute/network.ts';
import { serializeJson } from '../../../../scripts/pipeline/serialize.ts';

const CONSTANTS: ModelConstants = { detourFactor: 1, walkSpeed: 1.2, roadSpeedTaipei: 60, roadSpeedNewTaipei: 30, accessTime: 5 };
const station = (id: string, lon: number): NetworkStation => ({ id, lineId: 'X', name: id, lon, lat: 0, opened: '2015-01-01' });
const network = (stations: readonly NetworkStation[]): RailNetwork => ({
  stations,
  edges: [],
  transferSites: [],
  lines: [],
  excluded: [],
  defaultWaitLines: [],
  transferWait: new Map(),
  inNetwork: () => true,
  pathTime: (a, b) => (a === b ? 0 : 12),
});

const DISTRICTS = [
  { code: '63000010', city: 'Taipei' as const },
  { code: '63000020', city: 'Taipei' as const },
  { code: '65000030', city: 'New Taipei' as const },
];
const CENTROID_ENTRIES: [string, LonLat][] = [
  ['63000010', [0.001, 0]],
  ['63000020', [0.1, 0]],
  ['65000030', [0.5, 0]],
];
const STATIONS = [station('S1', 0), station('S2', 0.5)];

function run(districts: typeof DISTRICTS, centroids: [string, LonLat][], stations: NetworkStation[]): string {
  const result = buildCommuteMatrix({ districts, centroids: new Map(centroids), network: network(stations), constants: CONSTANTS, lrtCoords: new Map() });
  return serializeJson(buildCommuteFile(result));
}

describe('buildCommuteFile', () => {
  it('has exactly the keys codes and minutes', () => {
    const file = buildCommuteFile({ codes: ['a', 'b'], minutes: [[0, 1.5], [2, 0]], nearest: new Map() });
    expect(Object.keys(file)).toEqual(['codes', 'minutes']);
    expect(file).toEqual({ codes: ['a', 'b'], minutes: [[0, 1.5], [2, 0]] });
  });

  it('serializes byte-identically for two runs on permuted inputs', () => {
    const first = run(DISTRICTS, CENTROID_ENTRIES, STATIONS);
    const second = run([...DISTRICTS].reverse(), [...CENTROID_ENTRIES].reverse(), [...STATIONS].reverse());
    expect(second).toBe(first);
    expect(first).toContain('"codes"');
    expect(first.endsWith('\n')).toBe(true);
  });
});
