/**
 * Selection of the comparable station of an MRT row (Requirement 11.8). Pure; the result is entered into
 * `MRT_ROWS` (mrt-stations.ts) and checked against the TDX station files by a test.
 *
 * Rule:
 *  1. Prefer an ADJACENT station on the SAME line (previous or next station in line order) that has its own
 *     seasonal shares. If both neighbours qualify, take the one with the smaller distance by TDX coordinates
 *     (ties: lower station code).
 *  2. Only when no adjacent same-line station has shares, take the nearest station by TDX coordinates that has shares
 *     (ties: lower station code).
 *
 * "Has its own shares" means a row with `opened: 'before-2015'` and a `dailyName` (open in all 24 daily files).
 *
 * Line adjacency comes from TDX station IDs (line prefix + sequence): same prefix and consecutive numbers, plus the
 * branch links in `BRANCH_LINKS`. A row belongs to one line: its suffix letters (`BR`, `BL`, `R`, `G`, `O`, `Y`) or,
 * without a suffix, the line of its station (Circular Line rows: `Y`). A neighbour counts only through a row of the
 * same line, so a transfer station's row on another line is never "adjacent same line".
 */
import type { MrtRowEntry } from './mrt-stations.ts';

/** One TDX station record (one line's platform of a station). */
export interface TdxStationRef {
  /** TDX StationID, e.g. "Y16", "BL07", "G03A". */
  readonly id: string;
  /** Chinese name. */
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
}

export type ComparableRule = 'adjacent-line' | 'nearest';

export interface ComparableChoice {
  /** `dailyName` of the chosen row. */
  readonly station: string;
  readonly rule: ComparableRule;
  /** Distance by TDX coordinates, km. */
  readonly distanceKm: number;
}

/** Links between a branch's first station and the junction station of its line (no consecutive numbers). */
export const BRANCH_LINKS: readonly (readonly [string, string])[] = [
  ['G03', 'G03A'], // Xiaobitan branch: Qizhang
  ['R22', 'R22A'], // Xinbeitou branch: Beitou
  ['O12', 'O50'], // Luzhou branch: Daqiaotou
];

const ID_PATTERN = /^([A-Z]+)(\d+)([A-Z]?)$/;
const LINE_SUFFIXES = ['BR', 'BL', 'R', 'G', 'O', 'Y'];

/** Great-circle distance in km (haversine, mean Earth radius 6371 km). */
export function distanceKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** TDX IDs on the line next to `id`: consecutive sequence number and branch links. */
export function adjacentIds(id: string): string[] {
  const m = ID_PATTERN.exec(id);
  if (m === null) return [];
  const [, prefix, digits, letter] = m as unknown as [string, string, string, string];
  const out: string[] = [];
  if (letter === '') {
    const n = Number(digits);
    const width = digits.length;
    for (const k of [n - 1, n + 1]) if (k > 0) out.push(`${prefix}${String(k).padStart(width, '0')}`);
  }
  for (const [a, b] of BRANCH_LINKS) {
    if (a === id) out.push(b);
    if (b === id) out.push(a);
  }
  return out;
}

/** Line prefix of a row ("BL", "Y" ...), or undefined when the TDX files give no unique line. */
export function rowLine(row: MrtRowEntry, stations: readonly TdxStationRef[]): string | undefined {
  const suffix = LINE_SUFFIXES.find((s) => row.name === `${row.station}${s}`);
  if (suffix !== undefined) return suffix;
  const prefixes = new Set<string>();
  for (const s of stations) {
    if (s.name !== row.station) continue;
    const m = ID_PATTERN.exec(s.id);
    if (m !== null) prefixes.add(m[1]!);
  }
  if (prefixes.size === 1) return [...prefixes][0];
  // Several lines and no suffix: the row is the oldest line of the station (Circular Line rows have no suffix only
  // when the station has no other line, so they never get here).
  if (row.opened === 'before-2015') {
    const old = [...prefixes].filter((p) => p !== 'Y' && p !== 'LB');
    if (old.length === 1) return old[0];
  }
  return undefined;
}

const hasShares = (r: MrtRowEntry): boolean => r.opened === 'before-2015' && r.dailyName !== undefined;

function idOf(row: MrtRowEntry, line: string, stations: readonly TdxStationRef[]): TdxStationRef | undefined {
  return stations.find((s) => s.name === row.station && ID_PATTERN.exec(s.id)?.[1] === line);
}

const byCode = (a: TdxStationRef, b: TdxStationRef): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Chooses the comparable station of `row` among `rows` (the whole table) using TDX `stations`.
 * Distances use the TDX point of the row's own line platform (any platform of the station when the row's line has none).
 * Returns undefined when no row has shares.
 */
export function chooseComparable(
  row: MrtRowEntry,
  rows: readonly MrtRowEntry[],
  stations: readonly TdxStationRef[],
): ComparableChoice | undefined {
  const line = rowLine(row, stations);
  const own = line === undefined ? undefined : idOf(row, line, stations);
  const origin = own ?? stations.find((s) => s.name === row.station);
  if (origin === undefined) return undefined;

  // Candidates: platform of a row with shares, tied to the line of that row.
  interface Candidate { readonly ref: TdxStationRef; readonly dailyName: string; readonly line: string }
  const candidates: Candidate[] = [];
  for (const r of rows) {
    if (!hasShares(r) || r.name === row.name) continue;
    const l = rowLine(r, stations);
    if (l === undefined) continue;
    const ref = idOf(r, l, stations);
    if (ref !== undefined) candidates.push({ ref, dailyName: r.dailyName!, line: l });
  }
  const rank = (a: { d: number; ref: TdxStationRef }, b: { d: number; ref: TdxStationRef }): number =>
    a.d - b.d || byCode(a.ref, b.ref);
  const measured = candidates.map((c) => ({ ...c, d: distanceKm(origin, c.ref) }));

  if (own !== undefined && line !== undefined) {
    const next = new Set(adjacentIds(own.id));
    const adjacent = measured.filter((c) => c.line === line && next.has(c.ref.id)).sort(rank);
    if (adjacent.length > 0) {
      return { station: adjacent[0]!.dailyName, rule: 'adjacent-line', distanceKm: adjacent[0]!.d };
    }
  }
  const nearest = [...measured].sort(rank)[0];
  return nearest === undefined ? undefined : { station: nearest.dailyName, rule: 'nearest', distanceKm: nearest.d };
}
