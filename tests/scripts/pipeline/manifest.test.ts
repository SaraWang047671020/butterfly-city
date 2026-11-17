import { describe, expect, it } from 'vitest';
import { MissingInputsError } from '../../../scripts/pipeline/errors.ts';
import {
  COMMITTED_TABLES,
  findMissingInputs,
  isoMonths,
  lvrFiles,
  preflight,
  requiredInputs,
  rocMonths,
} from '../../../scripts/pipeline/manifest.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';

const BOUNDARY_FILES = [
  'boundaries/town-1140318/TOWN_MOI_1140318.shp',
  'boundaries/town-1140318/TOWN_MOI_1140318.dbf',
];
const DASHBOARD_FILE = 'social-housing/nlma-portal-dashboard/00B4DBB9.json';

/** Every raw file the manifest requires, as in-memory fixtures. */
function completeFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const input of requiredInputs(new MemoryRawReader({}))) {
    if (input.committed === true || input.directory === true) continue;
    if (input.path.includes('*')) continue;
    files[input.path] = 'x';
  }
  for (const p of BOUNDARY_FILES) files[p] = 'x';
  files[DASHBOARD_FILE] = '{}';
  return files;
}

const allCommitted = () => true;

describe('manifest helpers', () => {
  it('expands ROC and ISO month ranges', () => {
    expect(rocMonths('10401', '10612')).toHaveLength(36);
    expect(rocMonths('10611', '10702')).toEqual(['10611', '10612', '10701', '10702']);
    expect(isoMonths('2015-01', '2016-12')).toHaveLength(24);
  });

  it('expands the lvr pattern to 188 files', () => {
    const files = lvrFiles();
    expect(files).toHaveLength(188);
    expect(new Set(files).size).toBe(188);
    expect(files[0]).toBe('lvr/104S1_a_lvr_land_a.csv');
    expect(files[files.length - 1]).toBe('lvr/115S3_f_lvr_land_c.csv');
    expect(files).not.toContain('lvr/115S4_a_lvr_land_a.csv');
  });
});

describe('preflight', () => {
  it('passes for a complete fake data/raw directory', () => {
    const reader = new MemoryRawReader(completeFiles());
    expect(findMissingInputs(reader, allCommitted)).toEqual([]);
    expect(() => preflight(reader, allCommitted)).not.toThrow();
  });

  it('lists each removed file once with the right download id', () => {
    const files = completeFiles();
    const removed: Record<string, string> = {
      'population/ris/ODRP005-10401.csv': 'population',
      'population/ris/ODRP014-10703-臺北市.json': 'population',
      'population/ris/ODRP014-11103-新北市.json': 'population',
      'population/ris/ODRP014-11003-新北市.json': 'population',
      'population/ris/ODRP011-11308.csv': 'population',
      'population/ntpc-124872.csv': 'population',
      'income/103_165-9.csv': 'income',
      'income/dgbas-9415-disposable-income-by-region.csv': 'income',
      'lvr/104S1_a_lvr_land_a.csv': 'lvr',
      'lvr/115S3_f_lvr_land_c.csv': 'lvr',
      'rent-stats/1140123全國行政區租金統計-修正.ods': 'rent',
      'macro/dgbas-pr0101a1m-cpi-basic.xml': 'macro',
      'mrt/taipei-133184-annual-station.csv': 'mrt',
      'mrt/daily/taipei-entries-2016-12.csv': 'mrt',
      'stations/tdx-station-NTMC.json': 'stations',
      'stations/tdx-s2s-travel-time-NTMC.json': 'stations',
      'stations/trtc-128417-transfer-walk.csv': 'stations',
      'fares/tdx-metro-od-fare-NTALRT.json': 'fares',
      'timetables/tdx-timetable-TRTC.json': 'timetables',
      'policy/housing/datagov-6742.csv': 'policy',
      'policy/housing/pip-e3010-6_1_3-taipei-newtaipei.json': 'policy',
      'social-housing/nlma-portal-GetScheduleData-A.json': 'social-housing',
      'boundaries/town-1140318/TOWN_MOI_1140318.dbf': 'boundaries',
    };
    for (const p of Object.keys(removed)) delete files[p];

    const missing = findMissingInputs(new MemoryRawReader(files), allCommitted);
    const byPath = new Map(missing.map((m) => [m.path, m.downloadId]));
    expect(missing).toHaveLength(Object.keys(removed).length);
    expect(byPath.size).toBe(missing.length);
    for (const [p, id] of Object.entries(removed)) {
      expect(byPath.get(`data/raw/${p}`)).toBe(id);
    }
  });

  it('puts every missing path and its download command in one MissingInputsError', () => {
    const files = completeFiles();
    delete files['income/104_165-9.csv'];
    delete files['lvr/105S2_f_lvr_land_c.csv'];
    let error: unknown;
    try {
      preflight(new MemoryRawReader(files), allCommitted);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MissingInputsError);
    const err = error as MissingInputsError;
    expect(err.details).toEqual([
      'data/raw/income/104_165-9.csv: node scripts/download.ts income',
      'data/raw/lvr/105S2_f_lvr_land_c.csv: node scripts/download.ts lvr',
    ]);
  });

  it('requires the social housing dashboard directory to be non-empty', () => {
    const files = completeFiles();
    delete files[DASHBOARD_FILE];
    const missing = findMissingInputs(new MemoryRawReader(files), allCommitted);
    expect(missing).toEqual([{ path: 'data/raw/social-housing/nlma-portal-dashboard', downloadId: 'social-housing' }]);
  });

  it('reports a missing committed table without a download command', () => {
    const reader = new MemoryRawReader(completeFiles());
    const absent = 'data/config/sublease-phases.csv';
    const missing = findMissingInputs(reader, (p) => p !== absent);
    expect(missing).toEqual([{ path: absent }]);
    expect(() => preflight(reader, (p) => p !== absent)).toThrow(MissingInputsError);
    try {
      preflight(reader, (p) => p !== absent);
    } catch (e) {
      const details = (e as MissingInputsError).details;
      expect(details).toHaveLength(1);
      expect(details[0]).toContain(absent);
      expect(details[0]).not.toContain('node scripts/download.ts');
    }
  });

  it('checks all three committed tables', () => {
    expect(COMMITTED_TABLES).toEqual([
      'data/config/holding-tax-rates.csv',
      'data/config/commuter-pass-products.csv',
      'data/config/sublease-phases.csv',
      'data/config/commute-params.json',
      'data/config/census-employees-2021.csv',
      'data/config/census-employees-2021-totals.csv',
      'data/config/params-fixed.json',
      'data/config/social-housing-unit-cost-cases.csv',
    ]);
    const missing = findMissingInputs(new MemoryRawReader(completeFiles()), () => false);
    expect(missing.map((m) => m.path)).toEqual([...COMMITTED_TABLES]);
    expect(missing.every((m) => m.downloadId === undefined)).toBe(true);
  });

  it('reports the boundary pattern when no shapefile exists', () => {
    const files = completeFiles();
    for (const p of BOUNDARY_FILES) delete files[p];
    const missing = findMissingInputs(new MemoryRawReader(files), allCommitted);
    expect(missing).toEqual([
      { path: 'data/raw/boundaries/town-*/TOWN_MOI_*.shp', downloadId: 'boundaries' },
      { path: 'data/raw/boundaries/town-*/TOWN_MOI_*.dbf', downloadId: 'boundaries' },
    ]);
  });

  it('uses the latest boundary edition', () => {
    const files = completeFiles();
    files['boundaries/town-1150101/TOWN_MOI_1150101.shp'] = 'x';
    const missing = findMissingInputs(new MemoryRawReader(files), allCommitted);
    expect(missing).toEqual([
      { path: 'data/raw/boundaries/town-1150101/TOWN_MOI_1150101.dbf', downloadId: 'boundaries' },
    ]);
  });

  it('lists the expected number of raw files', () => {
    const raws = requiredInputs(new MemoryRawReader(completeFiles())).filter(
      (i) => i.committed !== true && i.directory !== true,
    );
    // 2 boundaries; population: ODRP005 36, ODRP014 64, ODRP002 25, ODRP011 191, 2 annual;
    // 11 income, 188 lvr, 1 rent, 4 census tables 14 and 34, 2 macro, 25 mrt, 5 stations, 4 fares, 4 timetables, 4 policy, 2 social housing, 5 villages, 34 low-use.
    const population = 36 + 64 + 25 + 191 + 2;
    expect(raws.length).toBe(2 + population + 11 + 188 + 1 + 4 + 2 + 25 + 5 + 4 + 4 + 4 + 2 + 5 + 34);
  });
});
