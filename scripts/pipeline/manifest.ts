/**
 * Preflight manifest: every raw input the pipeline reads, with the download id that produces it, plus the
 * committed tables in data/config/. `preflight` checks all of them and throws one MissingInputsError that
 * lists every missing path (Requirement 2.3).
 *
 * Raw paths are relative to data/raw/. Committed paths are relative to the repository root. Committed paths
 * are checked through an injected `exists` function, so tests never touch the file system.
 *
 * Per-project social housing detail files are not required here; Requirement 13.5 handles them as exclusions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths.ts';
import { MissingInputsError, type MissingInput } from './errors.ts';
import type { RawReader } from './raw-reader.ts';

export interface RequiredInput {
  /** Path relative to data/raw/ (raw inputs) or to the repository root (committed inputs). */
  readonly path: string;
  /** Download id of a raw input. */
  readonly downloadId?: string;
  /** True for a committed repository file; such a file has no download id. */
  readonly committed?: true;
  /** True when `path` is a directory that must hold at least one entry. */
  readonly directory?: true;
}

/** The committed tables checked by the preflight (Requirements 12.8, 12.9, 12.12). */
export const COMMITTED_TABLES: readonly string[] = [
  'data/config/holding-tax-rates.csv',
  'data/config/commuter-pass-products.csv',
  'data/config/sublease-phases.csv',
  'data/config/commute-params.json',
  'data/config/census-employees-2021.csv',
  'data/config/census-employees-2021-totals.csv',
];

const CITY_NAMES = ['臺北市', '新北市'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** ROC year-month strings (`yyymm`, e.g. `10401`) from `first` to `last` inclusive. */
export function rocMonths(first: string, last: string): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, -2));
  let m = Number(first.slice(-2));
  const endY = Number(last.slice(0, -2));
  const endM = Number(last.slice(-2));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}${pad2(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Gregorian year-month strings (`YYYY-MM`) from `first` to `last` inclusive. */
export function isoMonths(first: string, last: string): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5));
  const endY = Number(last.slice(0, 4));
  const endM = Number(last.slice(5));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${pad2(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Months whose migration table exists only as a CSV (the API did not return them). */
const ODRP011_CSV_MONTHS: ReadonlySet<string> = new Set(['11308']);

/** Real-price registration season labels `104S1` .. `115S3`. */
export function lvrSeasons(): string[] {
  const out: string[] = [];
  for (let y = 104; y <= 115; y++) {
    for (let s = 1; s <= 4; s++) {
      if (y === 115 && s > 3) break;
      out.push(`${y}S${s}`);
    }
  }
  return out;
}

/** The 188 real-price registration files: 47 seasons × {a, f} × {a, c}. */
export function lvrFiles(): string[] {
  const out: string[] = [];
  for (const season of lvrSeasons()) {
    for (const city of ['a', 'f']) {
      for (const kind of ['a', 'c']) out.push(`lvr/${season}_${city}_lvr_land_${kind}.csv`);
    }
  }
  return out;
}

function raw(downloadId: string, ...paths: string[]): RequiredInput[] {
  return paths.map((p) => ({ path: p, downloadId }));
}

function populationInputs(): RequiredInput[] {
  const ris = (name: string) => `population/ris/${name}`;
  const files: string[] = [];
  for (const m of rocMonths('10401', '10612')) files.push(ris(`ODRP005-${m}.csv`));
  // ODRP014 (village population with district code): last month of each quarter, 10703..11412.
  for (const m of rocMonths('10701', '11412')) {
    if (Number(m.slice(3)) % 3 !== 0) continue;
    for (const c of CITY_NAMES) files.push(ris(`ODRP014-${m}-${c}.json`));
  }
  for (const m of rocMonths('10412', '10612')) files.push(ris(`ODRP002-${m}.csv`));
  for (const m of rocMonths('10701', '11412')) {
    if (ODRP011_CSV_MONTHS.has(m)) files.push(ris(`ODRP011-${m}.csv`));
    else for (const c of CITY_NAMES) files.push(ris(`ODRP011-${m}-${c}.json`));
  }
  files.push('population/taipei-a05002802-cycle4.csv', 'population/ntpc-124872.csv');
  return raw('population', ...files);
}

function incomeInputs(): RequiredInput[] {
  const files: string[] = [];
  for (let y = 103; y <= 112; y++) files.push(`income/${y}_165-9.csv`);
  files.push('income/dgbas-9415-disposable-income-by-region.csv');
  return raw('income', ...files);
}

/**
 * Required raw inputs outside the boundary shapefile, which depends on the editions on disk.
 * Entries are in manifest-table order, so messages are stable.
 */
export function staticInputs(): RequiredInput[] {
  return [
    ...populationInputs(),
    ...incomeInputs(),
    ...raw('lvr', ...lvrFiles()),
    ...raw('rent', 'rent-stats/1140123全國行政區租金統計-修正.ods'),
    ...raw('macro', 'macro/taipei-A21000102-cpi-monthly.csv', 'macro/dgbas-pr0101a1m-cpi-basic.xml'),
    ...raw(
      'mrt',
      'mrt/taipei-133184-annual-station.csv',
      ...isoMonths('2015-01', '2016-12').map((m) => `mrt/daily/taipei-entries-${m}.csv`),
    ),
    ...raw(
      'stations',
      'stations/tdx-station-TRTC.json',
      'stations/tdx-station-NTMC.json',
      'stations/tdx-s2s-travel-time-TRTC.json',
      'stations/tdx-s2s-travel-time-NTMC.json',
      'stations/trtc-128417-transfer-walk.csv',
    ),
    ...raw(
      'fares',
      'fares/tdx-metro-od-fare-TRTC.json',
      'fares/tdx-metro-od-fare-NTMC.json',
      'fares/tdx-metro-od-fare-NTDLRT.json',
      'fares/tdx-metro-od-fare-NTALRT.json',
    ),
    ...raw(
      'villages',
      ...[1, 2, 3, 4].map((n) => `villages/moi-odrp019-114-page${n}.json`),
      'villages/village-boundaries-114.zip',
    ),
    ...raw(
      'timetables',
      'timetables/tdx-timetable-TRTC.json',
      'timetables/tdx-timetable-NTMC.json',
      'timetables/tdx-timetable-NTDLRT.json',
      'timetables/tdx-timetable-NTALRT.json',
    ),
    ...raw(
      'policy',
      'policy/housing/pip-e3010-6_1_3-taipei-newtaipei.json',
      'policy/housing/pip-e3010-6_3_1-taipei-newtaipei.json',
      'policy/housing/datagov-169800.csv',
      'policy/housing/datagov-6742.csv',
    ),
    ...raw(
      'social-housing',
      'social-housing/nlma-portal-GetScheduleData-A.json',
      'social-housing/nlma-portal-GetScheduleData-F.json',
    ),
    { path: 'social-housing/nlma-portal-dashboard', downloadId: 'social-housing', directory: true },
    ...COMMITTED_TABLES.map((p): RequiredInput => ({ path: p, committed: true })),
  ];
}

/**
 * Boundary files of the latest edition on disk: `boundaries/town-<edition>/TOWN_MOI_<edition>.shp` and `.dbf`,
 * or the same files directly in `boundaries/`. Editions are compared as numbers (ROC date `yyyMMdd`).
 * With no `.shp` present, the pattern itself is reported as missing.
 */
export function boundaryInputs(reader: RawReader): RequiredInput[] {
  const names = reader.list('boundaries');
  let best: { edition: number; dir: string; stem: string } | undefined;
  const consider = (dir: string, stem: string, edition: number) => {
    if (best === undefined || edition > best.edition) best = { edition, dir, stem };
  };
  for (const name of names) {
    const direct = /^(TOWN_MOI_(\d+))\.shp$/i.exec(name);
    if (direct !== null) consider('boundaries', direct[1] ?? '', Number(direct[2]));
    if (/^town-\d+$/.test(name)) {
      for (const inner of reader.list(`boundaries/${name}`)) {
        const m = /^(TOWN_MOI_(\d+))\.shp$/i.exec(inner);
        if (m !== null) consider(`boundaries/${name}`, m[1] ?? '', Number(m[2]));
      }
    }
  }
  if (best === undefined) {
    return raw('boundaries', 'boundaries/town-*/TOWN_MOI_*.shp', 'boundaries/town-*/TOWN_MOI_*.dbf');
  }
  const { dir, stem } = best as { dir: string; stem: string };
  // The extension case follows the file on disk; the .dbf is looked up in either case.
  const dbfName = reader.list(dir).find((n) => n.toLowerCase() === `${stem.toLowerCase()}.dbf`) ?? `${stem}.dbf`;
  const shpName = reader.list(dir).find((n) => n.toLowerCase() === `${stem.toLowerCase()}.shp`) ?? `${stem}.shp`;
  return raw('boundaries', `${dir}/${shpName}`, `${dir}/${dbfName}`);
}

/** Every required input, boundaries first (table order). */
export function requiredInputs(reader: RawReader): RequiredInput[] {
  return [...boundaryInputs(reader), ...staticInputs()];
}

/** Existence check for a committed repository file, by repository-relative path. */
export type CommittedExists = (repoRelPath: string) => boolean;

export const fsCommittedExists: CommittedExists = (repoRelPath) =>
  fs.existsSync(path.join(ROOT, ...repoRelPath.split('/')));

/** Returns every missing input, in manifest order. Never throws for missing files. */
export function findMissingInputs(
  reader: RawReader,
  committedExists: CommittedExists = fsCommittedExists,
): MissingInput[] {
  const missing: MissingInput[] = [];
  const seen = new Set<string>();
  for (const input of requiredInputs(reader)) {
    let present: boolean;
    if (input.committed === true) present = committedExists(input.path);
    else if (input.directory === true) present = reader.list(input.path).length > 0;
    else present = reader.exists(input.path);
    if (present) continue;
    const shown = input.committed === true ? input.path : reader.display(input.path);
    if (seen.has(shown)) continue;
    seen.add(shown);
    missing.push(input.downloadId === undefined ? { path: shown } : { path: shown, downloadId: input.downloadId });
  }
  return missing;
}

/** Throws one MissingInputsError listing every missing input. Returns normally when all are present. */
export function preflight(reader: RawReader, committedExists: CommittedExists = fsCommittedExists): void {
  const missing = findMissingInputs(reader, committedExists);
  if (missing.length > 0) throw new MissingInputsError(missing);
}
