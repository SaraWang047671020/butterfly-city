/**
 * Metro stations and line segments for the City_View (city-3d Requirement 8.5, task 9.1).
 * Inputs: the TDX Rail/Metro Station and S2STravelTime files of Taipei Metro (TRTC) and New Taipei Metro (NTMC)
 * that the data pipeline already downloads (data/raw/stations/), and public/data/districts.json.
 * Light rail (Danhai, Ankeng) is not included: its NLSC station file has no English names and TDX gives no
 * S2S times for it. The Sanying Line (LB) opened after 2025 and is left out, as in the commute network.
 * Stations of the same English name on several lines (transfer stations) become one station with several lines.
 */
import { OPENING_DATES, parseS2S, SANYING_LINE } from '../pipeline/commute/network.ts';

export const METRO_LINE_NAMES: Readonly<Record<string, string>> = {
  BL: 'Bannan Line',
  BR: 'Wenhu Line',
  R: 'Tamsui-Xinyi Line',
  G: 'Songshan-Xindian Line',
  O: 'Zhonghe-Xinlu Line',
  Y: 'Circular Line',
};

/** Chinese line names as used by Taipei Rapid Transit Corporation (https://www.metro.taipei/). */
export const METRO_LINE_NAMES_ZH: Readonly<Record<string, string>> = {
  BL: '板南線',
  BR: '文湖線',
  R: '淡水信義線',
  G: '松山新店線',
  O: '中和新蘆線',
  Y: '環狀線',
};

export interface MetroStation {
  readonly key: string; // lower-case English name without spaces; unique
  readonly name: string; // English name
  readonly zh: string; // Chinese name (TDX StationName.Zh_tw)
  readonly ids: readonly string[]; // TDX station ids, ascending
  readonly lines: readonly string[]; // line ids, in METRO_LINE_NAMES order
  readonly lon: number;
  readonly lat: number;
  readonly district: string; // District_Code
  readonly opened: string | null; // YYYY-MM-DD when the station opened after 2014, else null
}

export interface MetroSegment {
  readonly line: string;
  readonly from: string; // station key
  readonly to: string;
  readonly opened: string | null; // YYYY-MM-DD when the segment opened after 2014, else null
}

export interface MetroData {
  readonly lines: readonly { readonly id: string; readonly name: string; readonly zh: string }[];
  readonly stations: readonly MetroStation[];
  readonly segments: readonly MetroSegment[];
}

interface RawRow {
  readonly id: string;
  readonly en: string;
  readonly zh: string;
  readonly lon: number;
  readonly lat: number;
}

type Ring = readonly (readonly [number, number])[];
interface DistrictGeo {
  readonly code: string;
  readonly geometry: { readonly type: 'Polygon'; readonly coordinates: readonly Ring[] } | { readonly type: 'MultiPolygon'; readonly coordinates: readonly (readonly Ring[])[] };
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function districtOf(lon: number, lat: number, districts: readonly DistrictGeo[]): string | null {
  for (const d of districts) {
    const polys = d.geometry.type === 'Polygon' ? [d.geometry.coordinates] : d.geometry.coordinates;
    for (const poly of polys) {
      if (poly[0] !== undefined && inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h))) return d.code;
    }
  }
  return null;
}

export function parseStationRows(file: string, text: string): RawRow[] {
  const doc = JSON.parse(text) as unknown;
  if (!Array.isArray(doc)) throw new Error(`${file}: expected a JSON array`);
  return doc.map((r: unknown, i) => {
    const row = r as { StationID?: unknown; StationName?: { En?: unknown; Zh_tw?: unknown }; StationPosition?: { PositionLon?: unknown; PositionLat?: unknown } };
    const id = row.StationID;
    const en = row.StationName?.En;
    const lon = row.StationPosition?.PositionLon;
    const lat = row.StationPosition?.PositionLat;
    if (typeof id !== 'string' || typeof en !== 'string' || typeof lon !== 'number' || typeof lat !== 'number') {
      throw new Error(`${file}: row ${i + 1} has no StationID, StationName.En or StationPosition`);
    }
    const zh = row.StationName?.Zh_tw;
    if (typeof zh !== 'string' || zh.trim() === '') throw new Error(`${file}: row ${i + 1} has no StationName.Zh_tw`);
    return { id, en: en.trim(), zh: zh.trim(), lon, lat };
  });
}

const lineOf = (id: string): string => /^[A-Z]+/.exec(id)?.[0] ?? '';
const keyOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function openedOf(id: string): string | null {
  for (const o of OPENING_DATES) {
    if (!id.startsWith(o.prefix) || lineOf(id) !== o.prefix) continue;
    if (o.stations === undefined || o.stations.includes(id)) return o.opened;
  }
  return null;
}

/** Builds the station list and segments. Throws when a station lies in no district or a segment names an unknown station. */
export function buildMetroData(
  stationFiles: readonly { readonly file: string; readonly text: string }[],
  s2sFiles: readonly { readonly file: string; readonly text: string }[],
  districts: readonly DistrictGeo[],
): MetroData {
  const lineOrder = Object.keys(METRO_LINE_NAMES);
  const rows = stationFiles
    .flatMap((f) => parseStationRows(f.file, f.text))
    .filter((r) => lineOf(r.id) !== SANYING_LINE && lineOrder.includes(lineOf(r.id)));
  const byId = new Map<string, RawRow>();
  for (const r of rows) byId.set(r.id, r);

  const groups = new Map<string, RawRow[]>();
  for (const r of byId.values()) {
    const k = keyOf(r.en);
    const list = groups.get(k);
    if (list === undefined) groups.set(k, [r]);
    else list.push(r);
  }
  const stationKeyOfId = new Map<string, string>();
  const stations: MetroStation[] = [...groups.entries()]
    .map(([key, list]) => {
      const ids = list.map((r) => r.id).sort();
      for (const id of ids) stationKeyOfId.set(id, key);
      const lon = Math.round((list.reduce((s, r) => s + r.lon, 0) / list.length) * 1e5) / 1e5;
      const lat = Math.round((list.reduce((s, r) => s + r.lat, 0) / list.length) * 1e5) / 1e5;
      const district = districtOf(lon, lat, districts) ?? districtOf(list[0]!.lon, list[0]!.lat, districts);
      if (district === null) throw new Error(`station ${list[0]!.en} (${ids.join(', ')}) lies in no district of districts.json`);
      const lines = lineOrder.filter((l) => ids.some((id) => lineOf(id) === l));
      // A transfer station opened when its first line opened there.
      const dates = ids.map(openedOf);
      const opened = dates.includes(null) ? null : [...(dates as string[])].sort()[0]!;
      return { key, name: list[0]!.en, zh: list[0]!.zh, ids, lines, lon, lat, district, opened };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const seen = new Set<string>();
  const segments: MetroSegment[] = [];
  for (const f of s2sFiles) {
    for (const r of parseS2S(f.file, f.text)) {
      const line = r.lineId;
      if (!lineOrder.includes(line)) continue;
      const a = stationKeyOfId.get(r.from);
      const b = stationKeyOfId.get(r.to);
      if (a === undefined || b === undefined) throw new Error(`${f.file}: segment ${r.from}–${r.to} names a station that is not in the station files`);
      if (a === b) continue;
      const [from, to] = a < b ? [a, b] : [b, a];
      const k = `${line}|${from}|${to}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const dates = [openedOf(r.from), openedOf(r.to)].filter((d): d is string => d !== null).sort();
      segments.push({ line, from, to, opened: dates[dates.length - 1] ?? null });
    }
  }
  segments.sort((x, y) => (x.line + x.from + x.to < y.line + y.from + y.to ? -1 : 1));
  // A station with no segment is not open in the 2025Q4 network (for example a station listed before it opened).
  const linked = new Set(segments.flatMap((g) => [g.from, g.to]));
  return { lines: lineOrder.map((id) => ({ id, name: METRO_LINE_NAMES[id]!, zh: METRO_LINE_NAMES_ZH[id]! })), stations: stations.filter((st) => linked.has(st.key)), segments };
}

/** The generated TypeScript module text (deterministic). */
export function renderStationModule(data: MetroData): string {
  const header = [
    '// Generated by `npm run stations` (scripts/build-stations.ts). Do not edit by hand.',
    '// Source: MOTC Transport Data eXchange (TDX), Rail/Metro/Station and S2STravelTime, TRTC and NTMC',
    '// (https://tdx.transportdata.tw/), downloaded by the data pipeline to data/raw/stations/. District codes from public/data/districts.json.',
    '// Light rail and the Sanying Line are not included (see scripts/metro/build.ts).',
    '',
    "import type { MetroData } from './types.ts';",
    '',
  ].join('\n');
  return `${header}export const METRO_DATA: MetroData = ${JSON.stringify(data, null, 2)};\n`;
}
