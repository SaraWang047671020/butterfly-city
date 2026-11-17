import fc from 'fast-check';
import { describe, it } from 'vitest';
import { buildCommuteMatrix, type LonLat, type ModelConstants } from '../../../scripts/pipeline/commute/model.ts';
import type { NetworkStation, RailNetwork } from '../../../scripts/pipeline/commute/network.ts';
import { haversineKm } from '../../../scripts/pipeline/geo.ts';

// Feature: data-pipeline, Property 44: The commute model takes the faster mode and is order independent
// **Validates: Requirements 24.2, 24.3, 24.4, 24.5, 24.10, 24.13, 25.1**

const RUNS = 120;
const TOL = 0.05 + 1e-9;

interface Scenario {
  districts: { code: string; city: 'Taipei' | 'New Taipei' }[];
  centroids: [number, number][];
  stations: { id: string; lon: number; lat: number }[];
  edges: { a: number; b: number; w: number }[];
  constants: ModelConstants;
  keys: number[]; // shuffle keys
}

const lonArb = fc.double({ min: 121.3, max: 122, noNaN: true });
const latArb = fc.double({ min: 24.9, max: 25.3, noNaN: true });

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    nD: fc.integer({ min: 1, max: 12 }),
    nS: fc.integer({ min: 1, max: 8 }),
  })
  .chain(({ nD, nS }) =>
    fc.record({
      districts: fc.array(fc.constantFrom('Taipei' as const, 'New Taipei' as const), { minLength: nD, maxLength: nD }).map((cities) =>
        cities.map((city, i) => ({ code: `6300${String(i).padStart(4, '0')}`, city })),
      ),
      centroids: fc.array(fc.tuple(lonArb, latArb), { minLength: nD, maxLength: nD }),
      stations: fc
        .array(fc.tuple(lonArb, latArb), { minLength: nS, maxLength: nS })
        .map((ps) => ps.map(([lon, lat], i) => ({ id: `S${String(i).padStart(2, '0')}`, lon, lat }))),
      // Chain keeps the graph connected; extra edges are random.
      chainW: fc.array(fc.double({ min: 1, max: 30, noNaN: true }), { minLength: nS, maxLength: nS }),
      extra: fc.array(fc.record({ a: fc.nat(nS - 1), b: fc.nat(nS - 1), w: fc.double({ min: 1, max: 30, noNaN: true }) }), { maxLength: 10 }),
      constants: fc.record({
        detourFactor: fc.double({ min: 1, max: 2, noNaN: true }),
        walkSpeed: fc.double({ min: 0.8, max: 2, noNaN: true }),
        roadSpeedTaipei: fc.double({ min: 10, max: 60, noNaN: true }),
        roadSpeedNewTaipei: fc.double({ min: 10, max: 60, noNaN: true }),
        accessTime: fc.double({ min: 0, max: 15, noNaN: true }),
      }),
      keys: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 30, maxLength: 30 }),
    }),
  )
  .map((r): Scenario => {
    const edges = r.chainW.slice(1).map((w, i) => ({ a: i, b: i + 1, w }));
    return { districts: r.districts, centroids: r.centroids, stations: r.stations, edges: [...edges, ...r.extra], constants: r.constants, keys: r.keys };
  });

/** All-pairs shortest path over station ids (Floyd-Warshall on the edge list). */
function shortestPaths(ids: readonly string[], edges: readonly { a: string; b: string; w: number }[]): Map<string, number> {
  const d = new Map<string, number>();
  const key = (a: string, b: string): string => `${a}|${b}`;
  for (const a of ids) for (const b of ids) d.set(key(a, b), a === b ? 0 : Infinity);
  for (const e of edges) {
    if (e.a === e.b) continue;
    d.set(key(e.a, e.b), Math.min(d.get(key(e.a, e.b)) as number, e.w));
    d.set(key(e.b, e.a), Math.min(d.get(key(e.b, e.a)) as number, e.w));
  }
  for (const m of ids) for (const a of ids) for (const b of ids) {
    const via = (d.get(key(a, m)) as number) + (d.get(key(m, b)) as number);
    if (via < (d.get(key(a, b)) as number)) d.set(key(a, b), via);
  }
  return d;
}

function network(stations: readonly NetworkStation[], edges: readonly { a: string; b: string; w: number }[]): RailNetwork {
  const sp = shortestPaths(stations.map((s) => s.id), edges);
  return {
    stations,
    edges: [],
    transferSites: [],
    lines: [],
    excluded: [],
    defaultWaitLines: [],
    transferWait: new Map(),
    inNetwork: () => true,
    pathTime: (a, b) => {
      const v = sp.get(`${a}|${b}`);
      return v === undefined || !Number.isFinite(v) ? undefined : v;
    },
  };
}

const permute = <T>(xs: readonly T[], keys: readonly number[], offset: number): T[] =>
  xs.map((x, i) => ({ x, k: keys[(i + offset) % keys.length] as number })).sort((p, q) => p.k - q.k).map((p) => p.x);

function build(s: Scenario, permuted: boolean, constants: ModelConstants = s.constants) {
  const ids = s.stations.map((st) => st.id);
  let stations: NetworkStation[] = s.stations.map((st) => ({ id: st.id, lineId: 'X', name: st.id, lon: st.lon, lat: st.lat, opened: '2015-01-01' }));
  let edges = s.edges.map((e) => ({ a: ids[e.a] as string, b: ids[e.b] as string, w: e.w }));
  let districts = s.districts.map((d, i) => ({ ...d, c: s.centroids[i] as [number, number] }));
  if (permuted) {
    stations = permute(stations, s.keys, 3);
    edges = permute(edges, s.keys, 11).map((e, i) => (i % 2 === 0 ? { a: e.b, b: e.a, w: e.w } : e));
    districts = permute(districts, s.keys, 7);
  }
  const result = buildCommuteMatrix({
    districts: districts.map(({ code, city }) => ({ code, city })),
    centroids: new Map<string, LonLat>(districts.map((d) => [d.code, d.c])),
    network: network(stations, edges),
    constants,
    lrtCoords: new Map(),
  });
  return { result, stations, edges };
}

describe('Property 44: commute model', () => {
  it('has a zero diagonal, takes the faster mode, and ignores input order', { timeout: 120_000 }, () => {
    fc.assert(fc.property(scenarioArb, (s) => {
      const { result } = build(s, false);
      const k = s.constants;
      const cityOf = new Map(s.districts.map((d) => [d.code, d.city]));
      const posOf = new Map(s.districts.map((d, i) => [d.code, s.centroids[i] as LonLat]));
      const stPos = new Map(s.stations.map((st) => [st.id, [st.lon, st.lat] as LonLat]));
      const ids = s.stations.map((st) => st.id);
      const sp = shortestPaths(ids, s.edges.map((e) => ({ a: ids[e.a] as string, b: ids[e.b] as string, w: e.w })));
      const speed = (c: string): number => (c === 'Taipei' ? k.roadSpeedTaipei : k.roadSpeedNewTaipei);
      const access = (code: string): number => {
        const km = haversineKm(posOf.get(code) as LonLat, stPos.get(result.nearest.get(code) as string) as LonLat);
        const walk = (km * k.detourFactor * 1000) / k.walkSpeed / 60;
        const road = ((km * k.detourFactor) / speed(cityOf.get(code) as string)) * 60 + k.accessTime;
        return Math.min(walk, road);
      };
      let bad: string | undefined;
      const n = result.codes.length;
      for (let i = 0; i < n && bad === undefined; i++) {
        for (let j = 0; j < n; j++) {
          const v = result.minutes[i]![j] as number;
          const o = result.codes[i] as string;
          const w = result.codes[j] as string;
          if (i === j) {
            if (v !== 0) bad = `diagonal ${o}=${v}`;
          } else {
            const road = ((haversineKm(posOf.get(o) as LonLat, posOf.get(w) as LonLat) * k.detourFactor) / speed(cityOf.get(o) as string)) * 60 + k.accessTime;
            const p = sp.get(`${result.nearest.get(o)}|${result.nearest.get(w)}`) as number;
            const rail = access(o) + p + access(w);
            if (!Number.isFinite(v) || v < 0) bad = `invalid ${o}->${w}=${v}`;
            else if (v > road + TOL) bad = `above road ${o}->${w}: ${v} > ${road}`;
            else if (Number.isFinite(p) && v > rail + TOL) bad = `above rail ${o}->${w}: ${v} > ${rail}`;
            else if (v < Math.min(road, Number.isFinite(p) ? rail : Infinity) - TOL) bad = `below both ${o}->${w}: ${v}`;
          }
          if (bad !== undefined) break;
        }
      }
      if (bad !== undefined) throw new Error(bad);
      const permuted = build(s, true).result;
      if (JSON.stringify(permuted.codes) !== JSON.stringify(result.codes)) throw new Error('permuted codes differ');
      if (JSON.stringify(permuted.minutes) !== JSON.stringify(result.minutes)) throw new Error('permuted matrix differs');
      const slow = build(s, false, { ...k, roadSpeedTaipei: k.roadSpeedTaipei / 2, roadSpeedNewTaipei: k.roadSpeedNewTaipei / 2 }).result;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((slow.minutes[i]![j] as number) < (result.minutes[i]![j] as number)) throw new Error('slower road decreased a cell');
    }), { numRuns: RUNS });
  });
});

