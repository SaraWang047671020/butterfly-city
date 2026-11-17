/**
 * Metro and light-rail stations with coordinates, assigned to districts by point-in-polygon.
 *   - TDX (MOTC Transport Data eXchange) Rail/Metro/Station and S2STravelTime for TRTC (Taipei Metro)
 *     and NTMC (New Taipei Metro: Circular Line, Sanying Line). Anonymous access is rate-limited;
 *     if TDX_CLIENT_ID and TDX_CLIENT_SECRET are set, an access token (kept in memory only) is used instead.
 *   - NLSC 輕軌捷運車站 point shapefile (data.gov.tw 73230, OGDL v1) for the Danhai and Ankeng LRT,
 *     which TDX's metro API does not cover. Coordinates are TWD97 TM2 (EPSG:3826).
 *   - Taipei Metro transfer walking times (data.gov.tw 128417, OGDL v1).
 */
import fs from 'node:fs';
import { parseCsvObjects } from '../lib/csv.ts';
import { datasetMeta } from '../lib/datagov.ts';
import { DISTRICTS, type DistrictRef } from '../lib/districts.ts';
import { downloadFile, notHtml } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { openTdxSession, readTdxCredentials, tdxDownload } from '../lib/tdx.ts';
import { readZip } from '../lib/zip.ts';
import { pointInRing, readDbf, readShpPoints, type Polygon, type Position } from '../geo/shapefile.ts';
import { tm2ToLonLat } from '../geo/twd97.ts';
import { readDistrictShapes } from './boundaries.ts';
import { logResult, type Source } from './types.ts';

const dir = (...p: string[]) => raw('stations', ...p);
const TDX = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro';
const OPERATORS = ['TRTC', 'NTMC'] as const;
/**
 * Danhai LRT and Ankeng LRT: TDX returns HTTP 400 for their S2STravelTime (2026-11-19), so no such request is
 * sent. Their stations come from the NLSC shapefile, so no LRT station list is fetched either.
 */

/** One TDX download of the `stations` source: label, URL and destination file. */
export interface StationRequest {
  readonly label: string;
  readonly url: string;
  readonly dest: string;
}

/** Station and S2STravelTime requests for TRTC and NTMC only. */
export function stationRequests(): StationRequest[] {
  return OPERATORS.flatMap((op) =>
    ([['station', 'Station'], ['s2s-travel-time', 'S2STravelTime']] as const).map(([kind, path]) => ({
      label: `TDX ${path} ${op}`,
      url: `${TDX}/${path}/${op}?%24format=JSON`,
      dest: dir(`tdx-${kind}-${op}.json`),
    })));
}

export interface StationRow {
  readonly system: string;
  readonly ids: string[];
  readonly name: string;
  readonly nameEn: string;
  readonly lon: number;
  readonly lat: number;
}

interface TdxStation {
  StationID: string;
  StationName: { Zh_tw: string; En: string };
  StationPosition: { PositionLon: number; PositionLat: number };
}

/** Merges per-line station records that share a Chinese name (transfer stations) into one station. */
export function mergeByName(rows: readonly StationRow[]): StationRow[] {
  const byName = new Map<string, StationRow>();
  for (const r of rows) {
    const key = r.name.replace(/站$/, '');
    const existing = byName.get(key);
    if (existing) existing.ids.push(...r.ids);
    else byName.set(key, { ...r, ids: [...r.ids] });
  }
  return [...byName.values()];
}

function readStations(): StationRow[] {
  const rows: StationRow[] = [];
  for (const op of OPERATORS) {
    const file = dir(`tdx-station-${op}.json`);
    if (!fs.existsSync(file)) continue;
    for (const s of JSON.parse(fs.readFileSync(file, 'utf8')) as TdxStation[]) {
      rows.push({ system: op, ids: [s.StationID], name: s.StationName.Zh_tw, nameEn: s.StationName.En,
        lon: s.StationPosition.PositionLon, lat: s.StationPosition.PositionLat });
    }
  }
  const zip = dir('nlsc-73230-lrt-stations.zip');
  if (fs.existsSync(zip)) {
    const entries = readZip(fs.readFileSync(zip));
    const shp = entries.find((e) => /\.shp$/i.test(e.name));
    const dbf = entries.find((e) => /\.dbf$/i.test(e.name));
    if (shp && dbf) {
      const points = readShpPoints(shp.read());
      readDbf(dbf.read()).forEach((rec, i) => {
        const name = rec['MARKNAME1'] ?? '';
        const m = name.match(/^新北捷運(淡海|安坑)輕軌(.+?)站_([A-Z]+\d+)$/);
        const p = points[i];
        if (!m || !p) return;
        const [lon, lat] = tm2ToLonLat(p[0], p[1]);
        rows.push({ system: m[1] === '淡海' ? 'Danhai LRT' : 'Ankeng LRT', ids: [m[3]!], name: m[2]!, nameEn: '', lon, lat });
      });
    }
  }
  return mergeByName(rows);
}

function inPolygon(p: Position, poly: Polygon): boolean {
  return pointInRing(p, poly[0]!) && !poly.slice(1).some((hole) => pointInRing(p, hole));
}

/** Assigns each station to the district polygon that contains it, or undefined if outside all 41. */
export function assignDistricts(stations: readonly StationRow[]): { station: StationRow; district: DistrictRef | undefined }[] {
  const { records } = readDistrictShapes();
  return stations.map((station) => {
    const hit = records.find((r) => r.polygons.some((poly) => inPolygon([station.lon, station.lat], poly)));
    return { station, district: DISTRICTS.find((d) => d.code === hit?.attributes['TOWNCODE']) };
  });
}

export const stations: Source = {
  id: 'stations',
  title: 'Metro / LRT station coordinates (TDX, NLSC) and travel times, assigned to districts',
  async download({ force }) {
    const credentials = readTdxCredentials();
    const session = credentials ? await openTdxSession(credentials) : undefined;
    const tdxFile = async (url: string, dest: string) =>
      session
        ? tdxDownload(session, url, dest, force)
        : downloadFile(url, dest, { force, validate: (b) => (b.toString('utf8').trimStart().startsWith('[') ? undefined : b.toString('utf8').slice(0, 120)) });
    for (const r of stationRequests()) logResult(r.label, await tdxFile(r.url, r.dest));
    const lrt = (await datasetMeta(73230)).distribution.find((r) => r.resourceFormat === 'SHP');
    if (lrt) {
      const url = lrt.resourceDownloadUrl.replace(/[^/]+$/, (n) => encodeURIComponent(n));
      logResult('NLSC LRT stations', await downloadFile(url, dir('nlsc-73230-lrt-stations.zip'), { force }));
    }
    const walk = (await datasetMeta(128417)).distribution[0];
    if (walk) logResult('Taipei Metro transfer walking times', await downloadFile(walk.resourceDownloadUrl, dir('trtc-128417-transfer-walk.csv'), { force, validate: notHtml }));
  },
  async check() {
    const assigned = assignDistricts(readStations());
    const bySystem = new Map<string, number>();
    for (const a of assigned) bySystem.set(a.station.system, (bySystem.get(a.station.system) ?? 0) + 1);
    console.log(`stations (transfer stations merged): ${assigned.length}; ${[...bySystem].map(([s, n]) => `${s} ${n}`).join(', ')}`);
    const outside = assigned.filter((a) => !a.district);
    console.log(`outside the 41 districts: ${outside.length} (${outside.map((a) => a.station.name).join(', ')})`);
    const counts = new Map<string, number>();
    for (const a of assigned) if (a.district) counts.set(a.district.code, (counts.get(a.district.code) ?? 0) + 1);
    console.log('district | stations');
    for (const d of DISTRICTS) console.log(`${d.name} | ${counts.get(d.code) ?? 0}`);
    console.log(`districts without a station: ${DISTRICTS.filter((d) => !counts.has(d.code)).map((d) => d.name).join(', ')}`);

    for (const op of OPERATORS) {
      const file = dir(`tdx-s2s-travel-time-${op}.json`);
      if (!fs.existsSync(file)) continue;
      const routes = JSON.parse(fs.readFileSync(file, 'utf8')) as { LineID: string; TravelTimes: unknown[] }[];
      console.log(`TDX travel times ${op}: lines ${[...new Set(routes.map((r) => r.LineID))].join(', ')}, ${routes.reduce((s, r) => s + r.TravelTimes.length, 0)} station-to-station segments`);
    }
    const walk = dir('trtc-128417-transfer-walk.csv');
    if (fs.existsSync(walk)) console.log(`Taipei Metro transfer walking times: ${parseCsvObjects(fs.readFileSync(walk, 'utf8')).length} stations`);

    const csv = ['system,ids,name,name_en,lon,lat,district_code,district']
      .concat(assigned.map(({ station: s, district: d }) =>
        [s.system, s.ids.join(' '), s.name, `"${s.nameEn}"`, s.lon.toFixed(6), s.lat.toFixed(6), d?.code ?? '', `"${d?.name ?? ''}"`].join(',')))
      .join('\n');
    fs.mkdirSync(raw('_check'), { recursive: true });
    fs.writeFileSync(raw('_check', 'station-districts.csv'), `${csv}\n`);
    console.log('wrote data/raw/_check/station-districts.csv');
  },
};
