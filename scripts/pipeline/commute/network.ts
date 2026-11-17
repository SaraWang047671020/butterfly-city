/**
 * Rail network of the commute model (Requirements 24.4, 24.6, 24.10, 24.11, 25.1, 25.2; design "Network").
 *
 * Stations: TDX station files of the Taipei Metro (TRTC) and the New Taipei Metro (NTMC), kept when the line
 * section opened on or before 2025-12-31 (the Sanying Line LB opened 2026-06-30 and is dropped). The Taoyuan
 * Airport MRT is not in the files and is excluded by user decision (2026-11-18).
 * Edges: TDX S2S records (`RunTime` plus the dwell of the station the train stops at); the Ankeng LRT from the
 * StationTimeTable run times of `timetable.ts`. The Danhai LRT is excluded when `timetable.ts` cannot supply it.
 * Transfers: stations that share a site are joined by `transferWalk(site) + transferWait(line boarded)`.
 *
 * A node is (station id, line key). The line key is the TDX line id, or the branch route id (G-3, R-3) for the
 * Xiaobitan and Xinbeitou shuttles, so that changing between a shuttle and its main line is a transfer.
 * The module has no I/O except through the `RawReader`.
 */
import { DataError, ParseError, PipelineError } from '../errors.ts';
import type { RawReader } from '../raw-reader.ts';
import { codePointCompare } from '../numeric.ts';
import {
  ANKENG_LINE,
  DANHAI_LINE,
  type ExcludedLine,
  type TimetableModel,
  lineHeadway,
} from './timetable.ts';

export const STATION_FILES = { TRTC: 'stations/tdx-station-TRTC.json', NTMC: 'stations/tdx-station-NTMC.json' } as const;
export const S2S_FILES = {
  TRTC: 'stations/tdx-s2s-travel-time-TRTC.json',
  NTMC: 'stations/tdx-s2s-travel-time-NTMC.json',
} as const;
export const TRANSFER_WALK_FILE = 'stations/trtc-128417-transfer-walk.csv';

/** Last day of the 2025Q4 network (Requirement 24.6). */
export const NETWORK_CUTOFF = '2025-12-31';

/**
 * Opening dates of line sections that opened after 2014 (Requirement 11 criterion 4 and the design's LRT
 * extension). Every station not listed here opened before 2015. A station matches by id prefix.
 */
export const OPENING_DATES: readonly { readonly prefix: string; readonly stations?: readonly string[]; readonly opened: string; readonly note: string }[] = [
  { prefix: 'BL', stations: ['BL01'], opened: '2015-07-06', note: 'Bannan line extension to Dingpu' },
  { prefix: 'Y', opened: '2020-01-31', note: 'Circular Line phase 1' },
  { prefix: 'LB', opened: '2026-06-30', note: 'Sanying Line' },
  { prefix: 'K', opened: '2023-02-10', note: 'Ankeng LRT' },
];

/** Danhai LRT sections (design: 2018-12-24 and 2020-11-15); not used while the line is excluded. */
export const DANHAI_OPENING_DATES: readonly string[] = ['2018-12-24', '2020-11-15'];

export const SANYING_LINE = 'LB';
export const SANYING_REASON = 'The Sanying Line (LB) opened on 2026-06-30, after the 2025-12-31 cut-off of the 2025Q4 network.';
export const AIRPORT_MRT = 'AIRPORT';
export const AIRPORT_REASON =
  'The Taoyuan Airport MRT is not in the TDX files and is excluded from the rail graph (user decision 2026-11-18).';

/** Branch routes that are their own line key (shuttles; each has its own headway). */
const BRANCH_ROUTES: readonly string[] = ['G-3', 'R-3'];

/**
 * Sites that share a physical interchange although the station names differ, as station names.
 * 新埔 (BL08) and 新埔民生 (Y17) are two rows of dataset 128417.
 */
const NAME_LINKS: readonly (readonly [string, string])[] = [['新埔', '新埔民生']];
/** Ankeng LRT K09 (Shisizhang) is the interchange with the Circular Line station of the same name. */
const LRT_LINKS: readonly (readonly [string, string])[] = [['K09', '十四張']];

export type RunTimeSource = 'tdx-s2s' | 'timetable' | 'excluded';

export interface NetworkStation {
  readonly id: string;
  readonly lineId: string;
  /** Chinese name; empty for LRT stations that have no station file. */
  readonly name: string;
  readonly lon: number | undefined;
  readonly lat: number | undefined;
  readonly opened: string;
}

export interface NetworkEdge {
  readonly lineId: string;
  /** Line key: the line id or a branch route id. */
  readonly lineKey: string;
  readonly from: string;
  readonly to: string;
  /** In-vehicle minutes of the pair: RunTime/60 plus the dwell of the station the train stops at (smaller direction). */
  readonly minutes: number;
}

export interface TransferSite {
  readonly site: string;
  readonly stations: readonly string[];
  readonly walkMinutes: number;
  /** True when the dataset has no row for the site and the mean is used. */
  readonly estimated: boolean;
}

export interface LineInput {
  readonly lineId: string;
  readonly source: RunTimeSource;
  readonly reason?: string;
  readonly stations: number;
  readonly edges: number;
}

export interface NetworkOptions {
  /** Wait (minutes) for a line key with no headway; the `commute.transferWait` value. */
  readonly defaultTransferWait: number;
  /** Walk (minutes) for a site with no row; default is the mean of the file. */
  readonly defaultTransferWalk?: number;
  /** Half-headway (minutes) per line key from the operator page, used when the timetable has no headway. */
  readonly waitOverrides?: ReadonlyMap<string, number>;
}

export interface RailNetwork {
  readonly stations: readonly NetworkStation[];
  readonly edges: readonly NetworkEdge[];
  readonly transferSites: readonly TransferSite[];
  readonly lines: readonly LineInput[];
  readonly excluded: readonly ExcludedLine[];
  /** Line keys whose transfer wait is the default (no headway, no override). */
  readonly defaultWaitLines: readonly string[];
  /** Transfer wait in minutes per line key. */
  readonly transferWait: ReadonlyMap<string, number>;
  /** True when the station has at least one edge (it appears in the S2S or StationTimeTable run times). */
  inNetwork(id: string): boolean;
  /** Shortest in-vehicle path time in minutes between two station ids; undefined when unknown or unreachable. */
  pathTime(a: string, b: string): number | undefined;
}

// ---------------------------------------------------------------------------------------------------
// Parsing

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface RawStation {
  readonly id: string;
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
}

const STATION_COLUMNS = ['StationID', 'StationName.Zh_tw', 'StationPosition.PositionLon', 'StationPosition.PositionLat'];

export function parseStations(file: string, text: string): RawStation[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new ParseError(file, undefined, STATION_COLUMNS, ['(invalid JSON)'], (e as Error).message);
  }
  if (!Array.isArray(doc)) throw new ParseError(file, undefined, STATION_COLUMNS, [typeof doc], 'expected a JSON array');
  return (doc as unknown[]).map((row, i) => {
    const r = isRecord(row) ? row : {};
    const name = isRecord(r['StationName']) ? r['StationName']['Zh_tw'] : undefined;
    const pos = isRecord(r['StationPosition']) ? r['StationPosition'] : {};
    const lon = pos['PositionLon'];
    const lat = pos['PositionLat'];
    if (
      typeof r['StationID'] !== 'string' ||
      typeof name !== 'string' ||
      typeof lon !== 'number' ||
      typeof lat !== 'number'
    ) {
      throw new ParseError(file, i + 1, STATION_COLUMNS, isRecord(row) ? Object.keys(row) : [typeof row], 'missing or mistyped column');
    }
    return { id: r['StationID'], name, lon, lat };
  });
}

export interface S2SRecord {
  readonly lineId: string;
  readonly routeId: string;
  readonly from: string;
  readonly to: string;
  readonly runSeconds: number;
  readonly stopSeconds: number;
}

const S2S_COLUMNS = ['LineID', 'RouteID', 'TravelTimes[].FromStationID', 'TravelTimes[].ToStationID', 'TravelTimes[].RunTime', 'TravelTimes[].StopTime'];

export function parseS2S(file: string, text: string): S2SRecord[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new ParseError(file, undefined, S2S_COLUMNS, ['(invalid JSON)'], (e as Error).message);
  }
  if (!Array.isArray(doc)) throw new ParseError(file, undefined, S2S_COLUMNS, [typeof doc], 'expected a JSON array');
  const out: S2SRecord[] = [];
  (doc as unknown[]).forEach((route, i) => {
    if (!isRecord(route) || typeof route['LineID'] !== 'string' || typeof route['RouteID'] !== 'string' || !Array.isArray(route['TravelTimes'])) {
      throw new ParseError(file, i + 1, S2S_COLUMNS, isRecord(route) ? Object.keys(route) : [typeof route], 'missing or mistyped column');
    }
    for (const t of route['TravelTimes'] as unknown[]) {
      if (
        !isRecord(t) ||
        typeof t['FromStationID'] !== 'string' ||
        typeof t['ToStationID'] !== 'string' ||
        typeof t['RunTime'] !== 'number' ||
        typeof t['StopTime'] !== 'number' ||
        !(t['RunTime'] > 0) ||
        !(t['StopTime'] >= 0)
      ) {
        throw new ParseError(file, i + 1, S2S_COLUMNS, isRecord(t) ? Object.keys(t) : [typeof t], 'missing, mistyped or non-positive RunTime');
      }
      out.push({
        lineId: route['LineID'],
        routeId: route['RouteID'],
        from: t['FromStationID'],
        to: t['ToStationID'],
        runSeconds: t['RunTime'],
        stopSeconds: t['StopTime'],
      });
    }
  });
  return out;
}

const WALK_COLUMNS = ['sno', 'station', 'Time'];

/** Rows of dataset 128417: station name as written without the 捷運 prefix (some rows end in 站, some do not) and minutes. */
export function parseTransferWalk(file: string, text: string): Map<string, number> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = (lines[0] ?? '').split(',').map((c) => c.trim());
  const iName = header.indexOf('station');
  const iTime = header.indexOf('Time');
  if (iName < 0 || iTime < 0) throw new ParseError(file, 1, WALK_COLUMNS, header, 'missing column');
  const out = new Map<string, number>();
  lines.slice(1).forEach((line, k) => {
    const cells = line.split(',').map((c) => c.trim());
    const minutes = Number(cells[iTime]);
    const name = (cells[iName] ?? '').replace(/^捷運/, '');
    if (name === '' || !Number.isFinite(minutes) || minutes <= 0) {
      throw new ParseError(file, k + 2, WALK_COLUMNS, cells, 'unreadable station or Time');
    }
    out.set(name, minutes);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Network build

export interface NetworkInputs {
  readonly stations: readonly RawStation[];
  readonly s2s: readonly S2SRecord[];
  readonly transferWalk: ReadonlyMap<string, number>;
  readonly timetable: TimetableModel;
}

function lineOfStation(id: string): string {
  return id.replace(/\d.*$/, '');
}

function openedOf(id: string): string {
  const line = lineOfStation(id);
  for (const o of OPENING_DATES) {
    if (o.prefix === line && (o.stations === undefined || o.stations.includes(id))) return o.opened;
  }
  return 'before-2015';
}

function isOpen(opened: string): boolean {
  return opened === 'before-2015' || opened <= NETWORK_CUTOFF;
}

function lineKeyOf(lineId: string, routeId: string): string {
  return BRANCH_ROUTES.includes(routeId) ? routeId : lineId;
}

const nodeId = (station: string, key: string): string => `${station}|${key}`;

interface Arc {
  readonly to: string;
  readonly minutes: number;
  readonly train: boolean;
}

export function buildRailNetwork(input: NetworkInputs, options: NetworkOptions): RailNetwork {
  const excluded: ExcludedLine[] = [];
  const tt = input.timetable;
  for (const e of tt.excluded) excluded.push(e);

  // Stations that are open by the cut-off.
  const stations = new Map<string, NetworkStation>();
  const droppedLines = new Set<string>();
  for (const s of input.stations) {
    const opened = openedOf(s.id);
    if (!isOpen(opened)) {
      droppedLines.add(lineOfStation(s.id));
      continue;
    }
    stations.set(s.id, { id: s.id, lineId: lineOfStation(s.id), name: s.name, lon: s.lon, lat: s.lat, opened });
  }
  if (droppedLines.has(SANYING_LINE)) excluded.push({ lineId: SANYING_LINE, reason: SANYING_REASON });
  excluded.push({ lineId: AIRPORT_MRT, reason: AIRPORT_REASON });

  // Dwell of a station: StopTime of the record that leaves it (smallest when several; 0 when none).
  const dwellSeconds = new Map<string, number>();
  for (const r of input.s2s) {
    const cur = dwellSeconds.get(r.from);
    if (cur === undefined || r.stopSeconds < cur) dwellSeconds.set(r.from, r.stopSeconds);
  }
  const dwell = (id: string): number => (dwellSeconds.get(id) ?? 0) / 60;

  // Directed arcs keyed by `${key}|${a}|${b}`; the undirected edge keeps the smaller weight.
  const edgeMap = new Map<string, NetworkEdge>();
  const addEdge = (lineId: string, lineKey: string, from: string, to: string, minutes: number): void => {
    const [a, b] = codePointCompare(from, to) <= 0 ? [from, to] : [to, from];
    const k = `${lineKey}|${a}|${b}`;
    const cur = edgeMap.get(k);
    if (cur === undefined || minutes < cur.minutes) edgeMap.set(k, { lineId, lineKey, from: a, to: b, minutes });
  };
  for (const r of input.s2s) {
    if (!stations.has(r.from) || !stations.has(r.to)) {
      if (droppedLines.has(r.lineId)) continue;
      throw new DataError('S2S record names a station that is not in the station file', `${r.routeId} ${r.from} -> ${r.to}`);
    }
    addEdge(r.lineId, lineKeyOf(r.lineId, r.routeId), r.from, r.to, r.runSeconds / 60 + dwell(r.to));
  }

  // LRT lines from the StationTimeTable.
  const lrtStations = new Set<string>();
  for (const lineId of [ANKENG_LINE, DANHAI_LINE]) {
    const times = tt.interStationTimes.filter((t) => t.lineId === lineId);
    if (tt.excluded.some((e) => e.lineId === lineId)) continue;
    if (times.length === 0 || tt.uncovered.includes(lineId)) {
      throw new DataError('The StationTimeTable cannot supply the run times of an LRT line and no fallback table exists', lineId, [
        ...tt.runTimeFailures.filter((f) => f.lineId === lineId).map((f) => `${f.pair}: ${f.reason}`),
      ]);
    }
    if (lineId === DANHAI_LINE) {
      throw new PipelineError('Danhai LRT run times are available but no interchange with the Red Line is defined in network.ts');
    }
    for (const t of times) {
      for (const id of [t.from, t.to]) {
        if (!stations.has(id)) {
          stations.set(id, { id, lineId, name: '', lon: undefined, lat: undefined, opened: '2023-02-10' });
          lrtStations.add(id);
        }
      }
      addEdge(lineId, lineId, t.from, t.to, t.minutes);
    }
  }
  const edges = [...edgeMap.values()].sort(
    (x, y) => codePointCompare(x.lineKey, y.lineKey) || codePointCompare(x.from, y.from) || codePointCompare(x.to, y.to),
  );

  // Nodes: (station, key) pairs touched by an edge.
  const nodeKeys = new Map<string, Set<string>>();
  const touch = (s: string, k: string): void => {
    const set = nodeKeys.get(s) ?? new Set<string>();
    nodeKeys.set(s, set);
    set.add(k);
  };
  for (const e of edges) {
    touch(e.from, e.lineKey);
    touch(e.to, e.lineKey);
  }

  // Sites: group by name, plus the explicit links.
  const siteOf = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const s of [...stations.values()].sort((x, y) => codePointCompare(x.id, y.id))) {
    if (s.name === '') continue;
    const list = byName.get(s.name) ?? [];
    byName.set(s.name, list);
    list.push(s.id);
  }
  const siteMembers = new Map<string, string[]>();
  for (const [name, ids] of byName) siteMembers.set(name, [...ids]);
  for (const [a, b] of NAME_LINKS) {
    const ma = siteMembers.get(a);
    const mb = siteMembers.get(b);
    if (ma !== undefined && mb !== undefined) {
      ma.push(...mb);
      siteMembers.delete(b);
    }
  }
  for (const [lrt, name] of LRT_LINKS) {
    const m = siteMembers.get(name);
    if (m !== undefined && stations.has(lrt)) m.push(lrt);
  }
  for (const [site, ids] of siteMembers) for (const id of ids) siteOf.set(id, site);
  // A station with no name (LRT) and no link is its own site.
  for (const id of stations.keys()) if (!siteOf.has(id)) siteOf.set(id, id);
  const sites = new Map<string, string[]>();
  for (const [id, site] of siteOf) {
    const list = sites.get(site) ?? [];
    sites.set(site, list);
    list.push(id);
  }

  // Transfer walk and wait.
  const walkValues = [...input.transferWalk.values()];
  const meanWalk = options.defaultTransferWalk ?? walkValues.reduce((a, b) => a + b, 0) / walkValues.length;
  const transferSites: TransferSite[] = [];
  const walkOf = new Map<string, number>();
  for (const site of [...sites.keys()].sort(codePointCompare)) {
    const ids = (sites.get(site) as string[]).sort(codePointCompare);
    const keys = new Set<string>();
    for (const id of ids) {
      for (const k of nodeKeys.get(id) ?? []) {
        keys.add(k);
      }
    }
    if (keys.size < 2) continue;
    // The row of the dataset is matched by any station name of the site (新埔民生 has its own row).
    const names = ids.map((id) => stations.get(id)?.name ?? '').filter((n) => n !== '');
    const row = [site, ...names].flatMap((n) => [n, `${n}站`]).find((n) => input.transferWalk.has(n));
    const estimated = row === undefined;
    const walk = row === undefined ? meanWalk : (input.transferWalk.get(row) as number);
    walkOf.set(site, walk);
    transferSites.push({ site, stations: ids, walkMinutes: walk, estimated });
  }
  const waits = new Map<string, number>();
  const defaultWaitLines: string[] = [];
  const allKeys = [...new Set(edges.map((e) => e.lineKey))].sort(codePointCompare);
  for (const k of allKeys) {
    let w: number | undefined;
    try {
      w = lineHeadway(tt, k) / 2;
    } catch {
      w = options.waitOverrides?.get(k);
    }
    if (w === undefined) {
      w = options.defaultTransferWait;
      defaultWaitLines.push(k);
    }
    waits.set(k, w);
  }

  // Graph arcs between nodes.
  const arcs = new Map<string, Arc[]>();
  const nodeDwell = new Map<string, number>();
  const push = (from: string, arc: Arc): void => {
    const list = arcs.get(from) ?? [];
    arcs.set(from, list);
    list.push(arc);
  };
  for (const e of edges) {
    const a = nodeId(e.from, e.lineKey);
    const b = nodeId(e.to, e.lineKey);
    push(a, { to: b, minutes: e.minutes, train: true });
    push(b, { to: a, minutes: e.minutes, train: true });
  }
  for (const [station, keys] of nodeKeys) {
    for (const k of keys) nodeDwell.set(nodeId(station, k), dwell(station));
  }
  for (const ts of transferSites) {
    const members: { station: string; key: string }[] = [];
    for (const id of ts.stations) for (const k of nodeKeys.get(id) ?? []) members.push({ station: id, key: k });
    for (const x of members) {
      for (const y of members) {
        if (x.key === y.key) continue;
        push(nodeId(x.station, x.key), { to: nodeId(y.station, y.key), minutes: ts.walkMinutes + (waits.get(y.key) as number), train: false });
      }
    }
  }
  for (const list of arcs.values()) list.sort((p, q) => codePointCompare(p.to, q.to));

  // Per-line inputs.
  const lineIds = [...new Set([...stations.values()].map((s) => s.lineId))].sort(codePointCompare);
  const lines: LineInput[] = lineIds.map((lineId) => ({
    lineId,
    source: lrtStations.size > 0 && lineId === ANKENG_LINE ? 'timetable' : 'tdx-s2s',
    stations: [...stations.values()].filter((s) => s.lineId === lineId).length,
    edges: edges.filter((e) => e.lineId === lineId).length,
  }));
  for (const e of excluded) lines.push({ lineId: e.lineId, source: 'excluded', reason: e.reason, stations: 0, edges: 0 });

  const cache = new Map<string, Map<string, number>>();
  const startNodes = (station: string): string[] => [...(nodeKeys.get(station) ?? [])].map((k) => nodeId(station, k)).sort(codePointCompare);

  function run(origin: string): Map<string, number> {
    const cached = cache.get(origin);
    if (cached !== undefined) return cached;
    const dist = new Map<string, number>();
    const viaTrain = new Map<string, boolean>();
    const prev = new Map<string, string>();
    const done = new Set<string>();
    for (const n of startNodes(origin)) dist.set(n, 0);
    for (;;) {
      let best: string | undefined;
      for (const [n, d] of dist) {
        if (done.has(n)) continue;
        const bd = best === undefined ? Infinity : (dist.get(best) as number);
        if (best === undefined || d < bd || (d === bd && codePointCompare(n, best) < 0)) best = n;
      }
      if (best === undefined) break;
      done.add(best);
      const d0 = dist.get(best) as number;
      for (const arc of arcs.get(best) ?? []) {
        if (done.has(arc.to)) continue;
        const nd = d0 + arc.minutes;
        const cur = dist.get(arc.to);
        if (cur === undefined || nd < cur || (nd === cur && codePointCompare(best, prev.get(arc.to) as string) < 0)) {
          dist.set(arc.to, nd);
          viaTrain.set(arc.to, arc.train);
          prev.set(arc.to, best);
        }
      }
    }
    // Per station: the best arrival minus the dwell of the destination when it was reached by a train.
    const result = new Map<string, number>();
    for (const [n, d] of dist) {
      const station = n.slice(0, n.indexOf('|'));
      const t = d - (viaTrain.get(n) === true ? (nodeDwell.get(n) as number) : 0);
      const cur = result.get(station);
      if (cur === undefined || t < cur) result.set(station, t);
    }
    cache.set(origin, result);
    return result;
  }

  return {
    stations: [...stations.values()].sort((x, y) => codePointCompare(x.id, y.id)),
    edges,
    transferSites,
    lines,
    excluded,
    defaultWaitLines,
    transferWait: waits,
    inNetwork: (id: string) => nodeKeys.has(id),
    pathTime(a: string, b: string): number | undefined {
      if (!nodeKeys.has(a) || !nodeKeys.has(b)) return undefined;
      if (a === b) return 0;
      const t = run(a).get(b);
      return t === undefined ? undefined : Math.max(0, t);
    },
  };
}

const LINE_NAMES: Readonly<Record<string, string>> = { BR: 'Wenhu Line' };

/** The statement about lines that have no headway and use the default wait; '' when there are none. */
export function defaultWaitStatement(lines: readonly string[]): string {
  if (lines.length === 0) return '';
  const names = lines.map((k) => (LINE_NAMES[k] === undefined ? k : `${k} (${LINE_NAMES[k]})`));
  const list = names.length === 1 ? (names[0] as string) : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] as string}`;
  return `${list} ${lines.length === 1 ? 'has' : 'have'} no data in the TDX timetables and ${lines.length === 1 ? 'uses' : 'use'} the default value.`;
}

/** Reads the station, S2S and transfer-walk files and the timetable model, and builds the network. */
export function loadRailNetwork(reader: RawReader, timetable: TimetableModel, options: NetworkOptions): RailNetwork {
  const stations: RawStation[] = [];
  const s2s: S2SRecord[] = [];
  for (const rel of Object.values(STATION_FILES)) stations.push(...parseStations(reader.display(rel), reader.readText(rel)));
  for (const rel of Object.values(S2S_FILES)) s2s.push(...parseS2S(reader.display(rel), reader.readText(rel)));
  const transferWalk = parseTransferWalk(reader.display(TRANSFER_WALK_FILE), reader.readText(TRANSFER_WALK_FILE, 'big5'));
  return buildRailNetwork({ stations, s2s, transferWalk, timetable }, options);
}
