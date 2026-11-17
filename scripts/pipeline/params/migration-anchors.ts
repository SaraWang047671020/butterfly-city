/**
 * Migration anchors (Requirement 23.6): `migration.share` and `migration.exitShare`, both Parameter_Status `gap`.
 * The data anchor does not measure what the parameter means, so the entries state why in `assumption`.
 *
 *   migration.share     = mean of moveOut(d, q) / population(d, q) over the 41 districts and quarters 2016Q1..2025Q4
 *   migration.exitShare = sum over villages and months 2016-01..2025-12 of the moves out to places outside Taipei
 *                         and New Taipei, divided by the sum of all registered move-outs
 *                         outside = out_total - out_ntp - out_tp - out_other_town
 *                         (a village row has 0 in the column of its own city, so the two city columns together count
 *                         the moves between the two cities; out_other_town counts moves to another district of the
 *                         same city; every other destination, including abroad, is outside the metro area)
 *
 * Destination columns are read from ODRP002 (2016-01..2017-12) and ODRP011 (2018-01..2025-12), the files that
 * `indicators/migration.ts` lists in `migrationFiles`. The CSV of 2024-08 has Chinese headers.
 */
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { Citation, ScalarParameter } from '../../../src/types/simulation.ts';
import { parseCsv } from '../../lib/csv.ts';
import type { Quarter } from '../../lib/time.ts';
import { DataError } from '../errors.ts';
import { migrationFiles } from '../indicators/migration.ts';
import { quarterMonths, type DistrictSeries } from '../indicators/series.ts';
import { roundTo, stableSum } from '../numeric.ts';
import type { RawReader } from '../raw-reader.ts';

export const MIGRATION_SHARE_ID = 'migration.share';
export const MIGRATION_EXIT_SHARE_ID = 'migration.exitShare';
export const MIGRATION_SHARE_UNIT = 'share of residents per quarter';
export const MIGRATION_EXIT_SHARE_UNIT = 'share of registered move-outs';

export const ANCHOR_FIRST_QUARTER: Quarter = '2016Q1';
export const ANCHOR_LAST_QUARTER: Quarter = '2025Q4';

export const MIGRATION_CITATION: Citation = {
  citation: 'Ministry of the Interior, Department of Household Registration, registered move-in and move-out by village (ODRP002 for 2016 to 2017, ODRP011 from 2018) and population by village; Open Government Data License 1.0',
  url: 'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP011',
};

/** Destination counts of one village and month (persons, both sexes). */
export interface DestinationRow {
  readonly total: number;
  readonly toOtherCity: number;
  readonly toOtherTownSameCity: number;
}

// ---------------------------------------------------------------------------------------------
// migration.share
// ---------------------------------------------------------------------------------------------

/** Mean of moveOut / population over all districts and the quarters from `first` to `last`. */
export function meanMoveOutRate(
  moveOut: DistrictSeries,
  population: DistrictSeries,
  quarters: readonly Quarter[],
  first: Quarter = ANCHOR_FIRST_QUARTER,
  last: Quarter = ANCHOR_LAST_QUARTER,
): { readonly mean: number; readonly count: number } {
  const rates: number[] = [];
  quarters.forEach((q, i) => {
    if (q < first || q > last) return;
    for (const [code, series] of Object.entries(moveOut)) {
      const out = series[i]?.value;
      const pop = population[code]?.[i]?.value;
      if (out == null || pop == null || !(pop > 0)) {
        throw new DataError('migration-share-input', `district ${code} ${q}`, [`moveOut ${out}, population ${pop}; need both present and population above 0`]);
      }
      rates.push(out / pop);
    }
  });
  if (rates.length === 0) throw new DataError('migration-share-empty', 'migration.share', [`no district-quarter between ${first} and ${last}`]);
  return { mean: stableSum(rates) / rates.length, count: rates.length };
}

// ---------------------------------------------------------------------------------------------
// migration.threshold
// ---------------------------------------------------------------------------------------------

export const MIGRATION_THRESHOLD_ID = 'migration.threshold';
export const MIGRATION_THRESHOLD_UNIT = 'percentage points of rent burden';

/**
 * Population standard deviation (over districts and quarters `first`..`last`) of the 4-quarter change of the
 * baseline rent burden, in percentage points. burden = rent * dwellingSize / (householdIncome / 12) * 100, with rent in
 * TWD per m2 per month and householdIncome in TWD per household per year.
 */
export function rentBurdenChangeSd(
  rent: DistrictSeries,
  householdIncome: DistrictSeries,
  quarters: readonly Quarter[],
  dwellingSize: number,
  first: Quarter = ANCHOR_FIRST_QUARTER,
  last: Quarter = ANCHOR_LAST_QUARTER,
): { readonly sd: number; readonly count: number } {
  if (!(dwellingSize > 0)) throw new DataError('migration-threshold-input', 'housing.dwellingSize', [`got ${dwellingSize}; need above 0`]);
  const burden = (code: string, i: number): number => {
    const r = rent[code]?.[i]?.value;
    const inc = householdIncome[code]?.[i]?.value;
    if (r == null || inc == null || !(inc > 0)) {
      throw new DataError('migration-threshold-input', `district ${code} ${quarters[i]}`, [`rent ${r}, householdIncome ${inc}; need both present and income above 0`]);
    }
    return ((r * dwellingSize) / (inc / 12)) * 100;
  };
  const changes: number[] = [];
  quarters.forEach((q, i) => {
    if (q < first || q > last) return;
    if (i < 4) throw new DataError('migration-threshold-input', q, ['no quarter four steps earlier']);
    for (const code of Object.keys(rent)) changes.push(burden(code, i) - burden(code, i - 4));
  });
  if (changes.length === 0) throw new DataError('migration-threshold-empty', MIGRATION_THRESHOLD_ID, [`no district-quarter between ${first} and ${last}`]);
  const m = stableSum(changes) / changes.length;
  const variance = stableSum(changes.map((c) => (c - m) ** 2)) / changes.length;
  return { sd: Math.sqrt(variance), count: changes.length };
}

export function migrationThresholdParam(
  rent: DistrictSeries,
  householdIncome: DistrictSeries,
  quarters: readonly Quarter[],
  dwellingSize: number,
): ScalarParameter {
  const { sd, count: n } = rentBurdenChangeSd(rent, householdIncome, quarters, dwellingSize);
  const entry: ScalarParameter = {
    kind: 'scalar',
    value: roundTo(sd, 1),
    unit: MIGRATION_THRESHOLD_UNIT,
    status: 'gap',
    source: {
      citation: 'Computed from the baseline rent indicator (Ministry of the Interior actual-price registration rental records), the householdIncome indicator (DGBAS Survey of Family Income and Expenditure with the 2021 Industry, Commerce and Services Census), and housing.dwellingSize; Open Government Data License 1.0',
      url: 'https://plvr.land.moi.gov.tw/DownloadOpenData',
    },
    estimated: {
      method: `migration.threshold = population standard deviation, over ${n} district-quarters (41 districts, ${ANCHOR_FIRST_QUARTER} to ${ANCHOR_LAST_QUARTER}), of the 4-quarter change of baseline rent burden in percentage points, rounded to 0.1. Burden = rent * housing.dwellingSize (${dwellingSize} m2) / (householdIncome / 12) * 100. Each quarter is compared with the same quarter one year earlier, so consecutive changes overlap.`,
    },
    assumption: 'A rent-burden rise is assumed to move people only when it exceeds the ordinary year-to-year variation of the burden across districts. This is only an approximation: the spread of the baseline measures how much burden varied in the past for any reason, including income estimates that are interpolated, and not the rise at which households decide to move. No study of the rent-burden rise that triggers a move in Taipei or New Taipei was found. A household survey or panel study of rent burden before and after moves in the two cities would replace it. This value is an assumption and not a research result.',
  };
  const issues = checkParameterEntry(MIGRATION_THRESHOLD_ID, entry);
  if (issues.length > 0) throw new DataError('migration-anchor-entry-invalid', MIGRATION_THRESHOLD_ID, issues.map((i) => i.problem));
  return entry;
}

// ---------------------------------------------------------------------------------------------
// migration.exitShare
// ---------------------------------------------------------------------------------------------

const EN = { total: ['out_total_m', 'out_total_f'], ntp: ['out_ntp_m', 'out_ntp_f'], tp: ['out_tp_m', 'out_tp_f'], town: ['out_other_town_m', 'out_other_town_f'] };
const ZH = {
  total: ['遷出人數_合計_男', '遷出人數_合計_女'],
  ntp: ['遷出人數_往他省（市）_新北市_男', '遷出人數_往他省（市）_新北市_女'],
  tp: ['遷出人數_往他省（市）_臺北市_男', '遷出人數_往他省（市）_臺北市_女'],
  town: ['遷出人數_往本縣（市）他鄉（鎮市區）_男', '遷出人數_往本縣（市）他鄉（鎮市區）_女'],
};

type Cells = Readonly<Record<string, string | undefined>>;

function count(cells: Cells, names: readonly string[], file: string, row: number): number {
  let sum = 0;
  for (const n of names) {
    const v = (cells[n] ?? '').trim();
    if (!/^\d+$/.test(v)) throw new DataError('exit-share-column', `${file} row ${row}`, [`column ${n}: ${JSON.stringify(cells[n] ?? null)} is not a non-negative integer`]);
    sum += Number(v);
  }
  return sum;
}

function rowFrom(cells: Cells, file: string, row: number): DestinationRow | undefined {
  const site = (cells['site_id'] ?? cells['區域別'] ?? '').trim().replaceAll('台', '臺');
  if (!site.startsWith('臺北市') && !site.startsWith('新北市')) return undefined;
  const names = cells['out_total_m'] !== undefined ? EN : ZH;
  const total = count(cells, names.total, file, row);
  const toOtherCity = count(cells, names.ntp, file, row) + count(cells, names.tp, file, row);
  const toOtherTownSameCity = count(cells, names.town, file, row);
  if (toOtherCity + toOtherTownSameCity > total) {
    throw new DataError('exit-share-row', `${file} row ${row}`, [`total ${total} is below within-metro moves ${toOtherCity + toOtherTownSameCity}`]);
  }
  return { total, toOtherCity, toOtherTownSameCity };
}

/** Destination rows of the two cities from one ODRP002 CSV, ODRP011 CSV or ODRP011 JSON file. */
export function parseDestinationRows(text: string, file: string, format: 'csv' | 'json'): DestinationRow[] {
  const out: DestinationRow[] = [];
  if (format === 'json') {
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) throw new DataError('exit-share-file', file, ['expected a JSON array of records']);
    data.forEach((r: Record<string, unknown>, i) => {
      const cells = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replaceAll('\uFEFF', ''), v == null ? undefined : String(v)]));
      const row = rowFrom(cells, file, i + 1);
      if (row) out.push(row);
    });
    return out;
  }
  const [rawHeader, ...rows] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.replaceAll('\uFEFF', '').trim());
  if (!header.includes('out_total_m') && !header.includes('遷出人數_合計_男')) {
    throw new DataError('exit-share-file', file, ['no move-out total column in the header']);
  }
  rows.forEach((r, i) => {
    if (r.length < 2) return;
    const row = rowFrom(Object.fromEntries(header.map((h, k) => [h, r[k]])), file, i + 2);
    if (row) out.push(row);
  });
  return out;
}

export interface ExitTotals {
  readonly total: number;
  readonly withinMetro: number;
  readonly months: number;
}

/** Sums the destination rows of every month of the quarters from `first` to `last`. */
export function readExitTotals(
  reader: RawReader,
  quarters: readonly Quarter[],
  first: Quarter = ANCHOR_FIRST_QUARTER,
  last: Quarter = ANCHOR_LAST_QUARTER,
): ExitTotals {
  const months = quarters.filter((q) => q >= first && q <= last).flatMap((q) => quarterMonths(q));
  let total = 0;
  let within = 0;
  for (const m of months) {
    let rows = 0;
    for (const f of migrationFiles(m)) {
      for (const r of parseDestinationRows(reader.readText(f.path), reader.display(f.path), f.format)) {
        total += r.total;
        within += r.toOtherCity + r.toOtherTownSameCity;
        rows++;
      }
    }
    if (rows === 0) throw new DataError('exit-share-empty-month', `migration ${m}`, ['no village rows for this month']);
  }
  return { total, withinMetro: within, months: months.length };
}

// ---------------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------------

export interface MigrationAnchorResult {
  readonly share: ScalarParameter;
  readonly exitShare: ScalarParameter;
}

export function migrationAnchorParams(
  moveOut: DistrictSeries,
  population: DistrictSeries,
  quarters: readonly Quarter[],
  exits: ExitTotals,
): MigrationAnchorResult {
  const { mean, count: n } = meanMoveOutRate(moveOut, population, quarters);
  if (!(exits.total > 0)) throw new DataError('exit-share-empty', 'migration.exitShare', ['the move-out total is 0']);
  const exitValue = (exits.total - exits.withinMetro) / exits.total;

  const share: ScalarParameter = {
    kind: 'scalar',
    value: mean,
    unit: MIGRATION_SHARE_UNIT,
    status: 'gap',
    source: MIGRATION_CITATION,
    estimated: {
      method: `migration.share = mean of moveOut / population over ${n} district-quarters (41 districts, ${ANCHOR_FIRST_QUARTER} to ${ANCHOR_LAST_QUARTER}); moveOut is the registered move-out count of the quarter (all destinations, including moves between districts of the same city) and population is the end-of-quarter population.`,
    },
    assumption: 'The share of residents who leave when the burden excess passes the threshold is assumed equal to the ordinary quarterly move-out rate. This is only an approximation: the registered rate measures all moves, made for any reason (work, family, housing), not moves caused by a rise in rent burden, and the baseline already contains this ordinary movement, so the simulated movement partly counts it again. No study of the share of residents who leave because of a rent-burden rise in Taipei or New Taipei was found. A published measure of rent-driven displacement for the two cities, for example from a household survey of reasons for moving, would replace it. This value is an assumption and not a research result.',
  };

  const exitShare: ScalarParameter = {
    kind: 'scalar',
    value: exitValue,
    unit: MIGRATION_EXIT_SHARE_UNIT,
    status: 'gap',
    source: MIGRATION_CITATION,
    estimated: {
      method: `migration.exitShare = (total registered move-outs - moves to the other city - moves to another district of the same city) / total registered move-outs, summed over all villages and the ${exits.months} months of ${ANCHOR_FIRST_QUARTER} to ${ANCHOR_LAST_QUARTER} (${exits.total} move-outs, ${exits.withinMetro} of them within the two cities). Destinations outside the two cities include abroad, Taoyuan, other counties and cities, and cancelled registrations.`,
    },
    assumption: 'The share of residents who leave their district under rent pressure and also leave the two cities is assumed equal to the share of all registered move-outs that go outside the two cities. This is only an approximation: the files give the destination at the level of city or county and not district to district, they hold all moves and not only moves driven by rent burden, and the registered total includes cancelled registrations and "other" cases whose destination is unknown, which count as exits. Residents who leave because of rent may go to Taoyuan or Keelung more often or less often than other movers. A published measure of the destinations of rent-driven movers would replace it. This value is an assumption and not a research result.',
  };

  for (const [id, entry] of [[MIGRATION_SHARE_ID, share], [MIGRATION_EXIT_SHARE_ID, exitShare]] as const) {
    const issues = checkParameterEntry(id, entry);
    if (issues.length > 0) throw new DataError('migration-anchor-entry-invalid', id, issues.map((i) => i.problem));
  }
  return { share, exitShare };
}
