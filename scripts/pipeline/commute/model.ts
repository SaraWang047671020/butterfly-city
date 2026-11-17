/**
 * Commute_Model (Requirements 24.2 to 24.5, 24.9, 24.10; design "Algorithm (model.ts)").
 *
 *   walk(i, s)   = haversineKm * detourFactor / walkSpeed
 *   access(i, s) = min(walk(i, s), haversineKm * detourFactor / roadSpeed(city of i) * 60 + accessTime)
 *   road(i, j)   = haversineKm(centroid i, centroid j) * detourFactor / roadSpeed(city of i) * 60 + accessTime
 *   rail(i, j)   = access(i, nearest(i)) + path(nearest(i), nearest(j)) + access(j, nearest(j))
 *
 * All distances use the Population_Weighted_Centroids of centroids.ts. Access uses the city of the origin
 * district, egress the city of the destination district.
 *   cell(i, j)  = 0 if i = j, else round1(min(rail, road))
 *
 * `path` is `RailNetwork.pathTime`; it already holds the transfer walk and the transfer wait of every
 * transfer edge (the first boarding has no wait), so nothing is added here for transfers.
 * A district with no rail station in reach of the network uses road time only (never the case in practice).
 * Districts are processed in code order and station ties go to the lower station id, so the result does not
 * depend on input order.
 */
import { readDbf, readShpPoints } from '../../geo/shapefile.ts';
import { tm2ToLonLat } from '../../geo/twd97.ts';
import { readZip } from '../../lib/zip.ts';
import type { DistrictEntry } from '../../../src/types/data-files.ts';
import { DataError } from '../errors.ts';
import { haversineKm } from '../geo.ts';
import { codePointCompare, roundTo } from '../numeric.ts';
import type { RawReader } from '../raw-reader.ts';
import type { RailNetwork } from './network.ts';
import type { CommuteParams } from './params.ts';

export const LRT_STATION_ZIP = 'stations/nlsc-73230-lrt-stations.zip';
export const MATRIX_DECIMALS = 1;

/** Method text: how residents far from a station are assumed to reach it. */
export const ACCESS_METHOD_TEXT = 'Residents far from a station usually reach it by scooter or bus.';

export type LonLat = readonly [number, number];

/** Constants of the model, in the units of the Commute_Config_File. */
export interface ModelConstants {
  readonly detourFactor: number;
  /** Metres per second. */
  readonly walkSpeed: number;
  /** Kilometres per hour, per city. */
  readonly roadSpeedTaipei: number;
  readonly roadSpeedNewTaipei: number;
  /** Minutes. */
  readonly accessTime: number;
}

export function modelConstants(params: CommuteParams): ModelConstants {
  const get = (id: string): number => {
    const p = params[id];
    if (p === undefined) throw new DataError('missing-commute-param', id);
    return p.value;
  };
  return {
    detourFactor: get('commute.detourFactor'),
    walkSpeed: get('commute.walkSpeed'),
    roadSpeedTaipei: get('commute.roadSpeed.taipei'),
    roadSpeedNewTaipei: get('commute.roadSpeed.newTaipei'),
    accessTime: get('commute.accessTime'),
  };
}

/**
 * Coordinates of the LRT stations that have no TDX station file (Ankeng LRT; the Danhai LRT is read too but
 * is not in the network), keyed by station id such as K01. Source: NLSC dataset 73230 (TWD97 TM2 points).
 */
export function loadLrtStationCoords(reader: RawReader): Map<string, LonLat> {
  const entries = readZip(reader.readBytes(LRT_STATION_ZIP));
  const shp = entries.find((e) => /\.shp$/i.test(e.name));
  const dbf = entries.find((e) => /\.dbf$/i.test(e.name));
  if (shp === undefined || dbf === undefined) {
    throw new DataError('lrt-station-zip', reader.display(LRT_STATION_ZIP), ['expected a .shp and a .dbf entry']);
  }
  const points = readShpPoints(shp.read());
  const out = new Map<string, LonLat>();
  readDbf(dbf.read()).forEach((rec, i) => {
    const m = (rec['MARKNAME1'] ?? '').match(/^新北捷運(?:淡海|安坑)輕軌.+?站_([A-Z]+\d+)$/);
    const p = points[i];
    if (m === null || p === undefined) return;
    const [lon, lat] = tm2ToLonLat(p[0], p[1]);
    // The NLSC file writes K1 where the timetable ids write K01.
    const id = (m[1] as string).replace(/^([A-Z]+)(\d)$/, '$10$2');
    out.set(id, [lon, lat]);
  });
  return out;
}

export interface CommuteModelInput {
  readonly districts: readonly Pick<DistrictEntry, 'code' | 'city'>[];
  /** Population-weighted centroid per District_Code (centroids.ts). */
  readonly centroids: ReadonlyMap<string, LonLat>;
  readonly network: RailNetwork;
  readonly constants: ModelConstants;
  /** Coordinates for stations that the network knows without a position (LRT). */
  readonly lrtCoords: ReadonlyMap<string, LonLat>;
}

/** The nearest station of one district and its distance from the district's population-weighted centroid. */
export interface NearestStationInfo {
  readonly stationId: string;
  readonly lineId: string;
  /** Chinese station name from the network. */
  readonly stationName: string;
  /** Kilometres, unrounded. */
  readonly distanceKm: number;
}

/** Looks up the nearest station of a district from a model result (undefined when none is reachable). */
export function nearestStationInfo(
  network: RailNetwork,
  lrtCoords: ReadonlyMap<string, LonLat>,
  centroid: LonLat,
  stationId: string | undefined,
): NearestStationInfo | undefined {
  if (stationId === undefined) return undefined;
  const s = network.stations.find((x) => x.id === stationId);
  if (s === undefined) return undefined;
  const pos: LonLat | undefined = s.lon !== undefined && s.lat !== undefined ? [s.lon, s.lat] : lrtCoords.get(s.id);
  if (pos === undefined) return undefined;
  return { stationId: s.id, lineId: s.lineId, stationName: s.name, distanceKm: haversineKm(centroid, pos) };
}

export interface CommuteMatrixResult {
  readonly codes: readonly string[];
  readonly minutes: readonly (readonly number[])[];
  /** Nearest station id per district code (undefined when no station is reachable). */
  readonly nearest: ReadonlyMap<string, string | undefined>;
}

/** Stations that take part in the model: in the rail network, with a position. Stops on a missing position. */
function activeStations(network: RailNetwork, lrtCoords: ReadonlyMap<string, LonLat>): { id: string; pos: LonLat }[] {
  const out: { id: string; pos: LonLat }[] = [];
  const missing: string[] = [];
  for (const s of network.stations) {
    if (!network.inNetwork(s.id)) continue;
    const pos: LonLat | undefined = s.lon !== undefined && s.lat !== undefined ? [s.lon, s.lat] : lrtCoords.get(s.id);
    if (pos === undefined) missing.push(s.id);
    else out.push({ id: s.id, pos });
  }
  if (missing.length > 0) {
    throw new DataError('station-without-coordinates', missing.join(', '), ['no coordinates in the TDX station files or the NLSC LRT file']);
  }
  return out.sort((a, b) => codePointCompare(a.id, b.id));
}

export function buildCommuteMatrix(input: CommuteModelInput): CommuteMatrixResult {
  const { network, constants: k } = input;
  const districts = [...input.districts].sort((a, b) => codePointCompare(a.code, b.code));
  const pos = new Map<string, LonLat>();
  for (const d of districts) {
    const c = input.centroids.get(d.code) as readonly unknown[] | undefined;
    if (c === undefined || c.length !== 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      throw new DataError('district-without-centroid', d.code);
    }
    pos.set(d.code, c as LonLat);
  }
  const speedOf = (city: string): number => (city === 'Taipei' ? k.roadSpeedTaipei : k.roadSpeedNewTaipei);
  const stations = activeStations(network, input.lrtCoords);
  const walkMinutes = (km: number): number => ((km * k.detourFactor * 1000) / k.walkSpeed) / 60;
  const roadMinutes = (km: number, speedKmh: number): number => (km * k.detourFactor) / speedKmh * 60;

  const nearest = new Map<string, string | undefined>();
  const accessTo = new Map<string, number>();
  for (const d of districts) {
    let best: string | undefined;
    let bestKm = Infinity;
    for (const s of stations) {
      const km = haversineKm(pos.get(d.code) as LonLat, s.pos);
      if (km < bestKm) {
        best = s.id;
        bestKm = km;
      }
    }
    nearest.set(d.code, best);
    if (best !== undefined) {
      accessTo.set(d.code, Math.min(walkMinutes(bestKm), roadMinutes(bestKm, speedOf(d.city)) + k.accessTime));
    }
  }

  const minutes = districts.map((o) =>
    districts.map((w) => {
      if (o.code === w.code) return 0;
      const road = roadMinutes(haversineKm(pos.get(o.code) as LonLat, pos.get(w.code) as LonLat), speedOf(o.city)) + k.accessTime;
      let best = road;
      const so = nearest.get(o.code);
      const sw = nearest.get(w.code);
      if (so !== undefined && sw !== undefined) {
        const path = network.pathTime(so, sw);
        if (path !== undefined) best = Math.min(best, (accessTo.get(o.code) as number) + path + (accessTo.get(w.code) as number));
      }
      return roundTo(best, MATRIX_DECIMALS);
    }),
  );
  return { codes: districts.map((d) => d.code), minutes, nearest };
}
