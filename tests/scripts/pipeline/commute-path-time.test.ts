/**
 * Property 44 (part): RailNetwork.pathTime equals a brute-force shortest path over all simple paths of an
 * independently written graph model with the cost rules documented in network.ts.
 *
 * Cost rules modelled here:
 *  - a train arc costs RunTime/60 of the edge (the smallest over the records of the pair, either direction), plus
 *    dwell(s) of the station s it arrives at when the path goes on from s; dwell(s) is the smallest StopTime of the
 *    records that leave s (0 when none). The last arc of a path does not count the dwell of the destination;
 *  - changing line at a site (stations with the same name, different line) costs walk(site) + headway(line boarded)/2.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildRailNetwork, type RawStation, type S2SRecord } from '../../../scripts/pipeline/commute/network.ts';
import { ANKENG_LINE, DANHAI_LINE, type TimetableModel } from '../../../scripts/pipeline/commute/timetable.ts';

const LINES = ['R', 'G', 'O'] as const;
const SHARED_NAMES = ['a', 'b', 'c'] as const;
const DEFAULT_WAIT = 3;
const TOL = 1e-9;

interface Spec {
  readonly stations: readonly { readonly line: number; readonly name: number }[];
  readonly edges: readonly { readonly a: number; readonly b: number; readonly run: number; readonly stop: number }[];
  readonly headways: readonly (number | undefined)[];
  readonly walks: readonly (number | undefined)[];
}

const specArb: fc.Arbitrary<Spec> = fc.record({
  stations: fc.array(fc.record({ line: fc.integer({ min: 0, max: 2 }), name: fc.integer({ min: 0, max: 3 }) }), { minLength: 3, maxLength: 8 }),
  edges: fc.array(
    fc.record({ a: fc.nat(7), b: fc.nat(7), run: fc.integer({ min: 1, max: 900 }), stop: fc.integer({ min: 0, max: 45 }) }),
    { maxLength: 14 },
  ),
  headways: fc.array(fc.option(fc.integer({ min: 2, max: 12 }), { nil: undefined }), { minLength: 3, maxLength: 3 }),
  walks: fc.array(fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }), { minLength: 3, maxLength: 3 }),
});

interface Built {
  readonly ids: readonly string[];
  readonly names: readonly string[];
  readonly lineOf: readonly string[];
  readonly records: readonly S2SRecord[];
  readonly walkByName: ReadonlyMap<string, number>;
  readonly headwayByLine: ReadonlyMap<string, number>;
}

function materialise(spec: Spec): Built {
  const counters = [0, 0, 0];
  const ids: string[] = [];
  const names: string[] = [];
  const lineOf: string[] = [];
  spec.stations.forEach((s, i) => {
    const line = LINES[s.line] as string;
    counters[s.line] = (counters[s.line] as number) + 1;
    ids.push(`${line}${String(counters[s.line]).padStart(2, '0')}`);
    names.push(s.name < SHARED_NAMES.length ? (SHARED_NAMES[s.name] as string) : `u${i}`);
    lineOf.push(line);
  });
  const n = ids.length;
  const records: S2SRecord[] = [];
  for (const e of spec.edges) {
    const a = e.a % n;
    const b = e.b % n;
    if (a === b || lineOf[a] !== lineOf[b]) continue;
    records.push({
      lineId: lineOf[a] as string,
      routeId: `${lineOf[a] as string}-1`,
      from: ids[a] as string,
      to: ids[b] as string,
      runSeconds: e.run,
      stopSeconds: e.stop,
    });
  }
  const walkByName = new Map<string, number>([['zz', 5]]);
  SHARED_NAMES.forEach((nm, i) => {
    const w = spec.walks[i];
    if (w !== undefined) walkByName.set(nm, w);
  });
  const headwayByLine = new Map<string, number>();
  LINES.forEach((l, i) => {
    const h = spec.headways[i];
    if (h !== undefined) headwayByLine.set(l, h);
  });
  return { ids, names, lineOf, records, walkByName, headwayByLine };
}

function buildReal(b: Built) {
  const stations: RawStation[] = b.ids.map((id, i) => ({ id, name: b.names[i] as string, lon: 121, lat: 25 }));
  const timetable: TimetableModel = {
    interStationTimes: [],
    headways: [...b.headwayByLine].map(([lineId, minutes]) => ({ lineId, section: lineId, minutes, directions: [] })),
    uncoveredHeadways: [],
    uncovered: [],
    runTimeFailures: [],
    // The builder requires the LRT lines to be supplied or excluded; the rail model here has none.
    excluded: [ANKENG_LINE, DANHAI_LINE].map((lineId) => ({ lineId, reason: 'not part of the generated network' })),
  };
  return buildRailNetwork({ stations, s2s: b.records, transferWalk: b.walkByName, timetable }, { defaultTransferWait: DEFAULT_WAIT });
}

/** Independent model: shortest time per (origin, destination) by enumerating every simple path of (station, line) nodes. */
function bruteForce(b: Built): Map<string, number> {
  const dwellSec = new Map<string, number>();
  for (const r of b.records) {
    const cur = dwellSec.get(r.from);
    dwellSec.set(r.from, cur === undefined ? r.stopSeconds : Math.min(cur, r.stopSeconds));
  }
  const dwell = (id: string): number => (dwellSec.get(id) ?? 0) / 60;
  // Undirected run time (smallest over records of the pair).
  const edgeW = new Map<string, number>();
  for (const r of b.records) {
    const k = [r.from, r.to].sort().join('~');
    const w = r.runSeconds / 60;
    const cur = edgeW.get(k);
    if (cur === undefined || w < cur) edgeW.set(k, w);
  }
  const lineOfId = new Map(b.ids.map((id, i) => [id, b.lineOf[i] as string]));
  const nameOfId = new Map(b.ids.map((id, i) => [id, b.names[i] as string]));
  const inNet = new Set<string>();
  const arcs = new Map<string, { to: string; w: number; last: number }[]>();
  const add = (from: string, to: string, w: number, last: number): void => {
    const l = arcs.get(from) ?? [];
    arcs.set(from, l);
    l.push({ to, w, last });
  };
  for (const [k, w] of edgeW) {
    const [x, y] = k.split('~') as [string, string];
    inNet.add(x);
    inNet.add(y);
    add(x, y, w + dwell(y), w);
    add(y, x, w + dwell(x), w);
  }
  const values = [...b.walkByName.values()];
  const meanWalk = values.reduce((s, v) => s + v, 0) / values.length;
  const ids = [...inNet];
  for (const x of ids) {
    for (const y of ids) {
      if (x === y || lineOfId.get(x) === lineOfId.get(y) || nameOfId.get(x) !== nameOfId.get(y)) continue;
      const walk = b.walkByName.get(nameOfId.get(x) as string) ?? meanWalk;
      const wait = (b.headwayByLine.get(lineOfId.get(y) as string) ?? 2 * DEFAULT_WAIT) / 2;
      add(x, y, walk + wait, walk + wait);
    }
  }
  const best = new Map<string, number>();
  for (const origin of ids) {
    const visited = new Set<string>([origin]);
    const dfs = (at: string, cost: number): void => {
      for (const a of arcs.get(at) ?? []) {
        if (visited.has(a.to)) continue;
        const key = `${origin}>${a.to}`;
        const cur = best.get(key);
        if (cur === undefined || cost + a.last < cur) best.set(key, cost + a.last);
        visited.add(a.to);
        dfs(a.to, cost + a.w);
        visited.delete(a.to);
      }
    };
    dfs(origin, 0);
  }
  return best;
}

/** Compares every station pair of one network; returns the mismatches. */
function compare(spec: Spec): { mismatches: string[]; reachable: number; sites: number } {
  const mismatches: string[] = [];
  let reachable = 0;
  const b = materialise(spec);
  const net = buildReal(b);
  const expected = bruteForce(b);
  for (const a of b.ids) {
    for (const z of b.ids) {
      if (a === z) continue;
      const got = net.pathTime(a, z);
      const want = expected.get(`${a}>${z}`);
      if (want !== undefined) reachable += 1;
      const same = got === undefined || want === undefined ? got === want : Math.abs(got - want) <= TOL;
      if (!same) mismatches.push(`${JSON.stringify(spec)} ${a}->${z}: pathTime=${String(got)} brute=${String(want)}`);
    }
  }
  return { mismatches, reachable, sites: net.transferSites.length };
}

// Counterexample found by the property below: dwell of the final station and duplicate/reverse edge records.
const FIXED: Spec = {
  stations: [{ line: 2, name: 0 }, { line: 2, name: 2 }, { line: 0, name: 2 }, { line: 2, name: 2 }, { line: 2, name: 0 }, { line: 1, name: 0 }, { line: 1, name: 0 }],
  edges: [
    { a: 7, b: 0, run: 3, stop: 1 }, { a: 7, b: 0, run: 783, stop: 0 }, { a: 4, b: 4, run: 354, stop: 4 }, { a: 4, b: 1, run: 8, stop: 44 },
    { a: 2, b: 0, run: 1, stop: 3 }, { a: 4, b: 0, run: 9, stop: 40 }, { a: 5, b: 6, run: 220, stop: 1 }, { a: 6, b: 7, run: 3, stop: 2 },
  ],
  headways: [7, 9, 3],
  walks: [4, 4, 7],
};

describe('commute network pathTime vs brute-force simple paths (Property 44)', () => {
  it('matches the brute force on the recorded counterexample', () => {
    expect(compare(FIXED).mismatches).toEqual([]);
  });

  it('equals the exhaustive shortest path for every station pair of small random networks', () => {
    const mismatches: string[] = [];
    let reachable = 0;
    let transfers = 0;
    fc.assert(
      fc.property(specArb, (spec) => {
        const r = compare(spec);
        mismatches.push(...r.mismatches);
        reachable += r.reachable;
        if (r.sites > 0) transfers += 1;
      }),
      { numRuns: 150 },
    );
    expect(mismatches.slice(0, 3)).toEqual([]);
    expect(reachable).toBeGreaterThan(0);
    expect(transfers).toBeGreaterThan(0);
  });
});
