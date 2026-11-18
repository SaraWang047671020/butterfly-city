// Metro network queries for the City_View (city-3d Requirement 8.6, 8.7). Pure; no three import.
import type { MetroData, MetroSegment, MetroStation } from './types.ts';

/** Last day of a quarter key such as 2019Q2 → 2019-06-30. */
export function quarterEnd(quarter: string): string {
  const m = /^(\d{4})Q([1-4])$/.exec(quarter);
  if (m === null) throw new Error(`not a quarter key: ${quarter}`);
  return `${m[1]}-${['03-31', '06-30', '09-30', '12-31'][Number(m[2]) - 1]}`;
}

const openBy = (opened: string | null, day: string) => opened === null || opened <= day;

export interface OpenNetwork {
  readonly stations: readonly MetroStation[];
  readonly segments: readonly MetroSegment[];
  /** Line ids of a station that have an open segment at that station. */
  readonly linesAt: ReadonlyMap<string, readonly string[]>;
}

/** The stations and segments open at the end of `quarter`. A station is open when one of its segments is open. */
export function openNetwork(data: MetroData, quarter: string): OpenNetwork {
  const day = quarterEnd(quarter);
  const segments = data.segments.filter((g) => openBy(g.opened, day));
  const lines = new Map<string, Set<string>>();
  for (const g of segments) {
    for (const k of [g.from, g.to]) {
      const set = lines.get(k) ?? new Set<string>();
      set.add(g.line);
      lines.set(k, set);
    }
  }
  const order = data.lines.map((l) => l.id);
  const stations = data.stations.filter((s) => lines.has(s.key) && openBy(s.opened, day));
  const linesAt = new Map(stations.map((s) => [s.key, order.filter((l) => lines.get(s.key)?.has(l))]));
  return { stations, segments, linesAt };
}

/** Sort key of a station on one line: its TDX id on that line (BL01 < BL02, G03 < G03A < G04). */
function idOnLine(s: MetroStation, line: string): string {
  const id = s.ids.find((x) => /^[A-Z]+/.exec(x)?.[0] === line) ?? '';
  const m = /^([A-Z]+)(\d+)([A-Z]?)$/.exec(id);
  return m === null ? id : `${m[1]}${m[2]!.padStart(3, '0')}${m[3]}`;
}

/** Open stations of each open line, in line order, for the station dialog. */
export function stationsByLine(data: MetroData, net: OpenNetwork): { readonly line: string; readonly name: string; readonly stations: readonly MetroStation[] }[] {
  return data.lines
    .map((l) => ({
      line: l.id,
      name: l.name,
      stations: net.stations.filter((s) => net.linesAt.get(s.key)?.includes(l.id)).sort((a, b) => (idOnLine(a, l.id) < idOnLine(b, l.id) ? -1 : 1)),
    }))
    .filter((g) => g.stations.length > 0);
}

/** The open station nearest to (x, z) within `max` world units, using `position` to place stations. */
export function stationNear(
  net: OpenNetwork,
  position: (s: MetroStation) => readonly [number, number],
  x: number,
  z: number,
  max: number,
): MetroStation | null {
  let best: MetroStation | null = null;
  let bestD = max;
  for (const s of net.stations) {
    const [sx, sz] = position(s);
    const d = Math.hypot(sx - x, sz - z);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
