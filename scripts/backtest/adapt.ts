/**
 * Converts the data files into engine inputs for the backtest (Requirements 20.3, 20.7, 20.9).
 *
 * Reads public/data/history.json, policy-track.json, params.json, districts.json and the commute matrix
 * (public/data/commute-matrix.json, or a `commuteMatrix` field of districts.json) and builds
 * EngineBaseline, PolicyTimeline, ParameterTable and CommuteMatrix. The commuter pass price series becomes
 * the parameters `commuterPass.price.<city>.<quarter>`. A missing file is reported as
 * `missing input: <file>`; the adapter never invents a value.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_DATA } from '../lib/paths.ts';
import type {
  CityName,
  DistrictCode,
  HistoryFile,
  PolicySeries,
  PolicyTrackFile,
  QuarterKey,
  SourceEntry,
} from '../../src/types/data-files.ts';
import type {
  AreaKey,
  CommuteMatrix,
  EngineBaseline,
  ParameterTable,
  PolicySetting,
  PolicyTimeline,
  ScalarParameter,
  ScheduleParameter,
  ToolSetting,
} from '../../src/types/simulation.ts';

export interface BacktestInputs {
  readonly baseline: EngineBaseline;
  /** The real settings of the supported tools, by quarter. */
  readonly track: PolicyTimeline;
  /** params.json plus the commuter pass price parameters. */
  readonly params: ParameterTable;
  readonly commute: CommuteMatrix;
  /** The commuter pass price parameters alone, so a caller can replace them for a counterfactual. */
  readonly passPrices: ParameterTable;
}

export type AdaptResult =
  | { readonly ok: true; readonly inputs: BacktestInputs }
  | { readonly ok: false; readonly reason: string };

export const HISTORY_FILE = 'history.json';
export const POLICY_TRACK_FILE = 'policy-track.json';
export const PARAMS_FILE = 'params.json';
export const DISTRICTS_FILE = 'districts.json';
export const COMMUTE_MATRIX_FILE = 'commute-matrix.json';

/** Track series that become fields of the supported tools: series id -> tool, field. */
export const TRACK_FIELDS: Readonly<Record<string, { readonly tool: string; readonly field: string }>> = {
  socialHousingUnitsStarted: { tool: 'socialHousing', field: 'unitsStarted' },
  commuterPassSubsidy: { tool: 'commuterPass', field: 'subsidy' },
  commuterPassesSold: { tool: 'commuterPass', field: 'passesSold' },
  rentSubsidyHouseholds: { tool: 'rentSubsidy', field: 'households' },
  rentSubsidyAmountPerHousehold: { tool: 'rentSubsidy', field: 'amount' },
  subleaseUnitsMatched: { tool: 'sublease', field: 'unitsMatched' },
};

export const PASS_PRICE_SERIES = 'commuterPassPrice';

/** Id of the pass price parameter of one city and quarter. */
export function passPriceId(city: string, quarter: string): string {
  return `commuterPass.price.${city}.${quarter}`;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class MissingInput extends Error {}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(path.join(PUBLIC_DATA, file), 'utf8');
  } catch {
    throw new MissingInput(`missing input: ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MissingInput(`invalid input: ${file} is not valid JSON`);
  }
}

function bad(file: string, what: string): never {
  throw new MissingInput(`invalid input: ${file} ${what}`);
}

function buildBaseline(history: HistoryFile, cityByCode: ReadonlyMap<DistrictCode, CityName>): EngineBaseline {
  const codes = [...cityByCode.keys()].sort();
  const indicators: Record<string, Record<DistrictCode, readonly (number | null)[]>> = {};
  const indicatorSources: Record<string, readonly string[]> = {};
  for (const ind of history.indicators) {
    if (ind.level !== 'district') continue;
    const byDistrict: Record<DistrictCode, readonly (number | null)[]> = {};
    for (const code of codes) {
      const records = ind.series[code];
      if (records === undefined) bad(HISTORY_FILE, `indicator ${ind.id} has no series for district ${code}`);
      byDistrict[code] = records.map((r) => r.value);
    }
    indicators[ind.id] = byDistrict;
    indicatorSources[ind.id] = [...ind.sources];
  }
  return {
    quarters: [...history.quarters],
    districts: codes.map((code) => ({ code, city: cityByCode.get(code) as CityName })),
    indicators,
    indicatorSources,
    sourceIds: history.sources.map((s) => s.id),
  };
}

function buildTrack(file: PolicyTrackFile): PolicyTimeline {
  const settings: PolicySetting[] = [];
  const byField = new Map<string, PolicySeries>();
  for (const s of file.policySeries) if (TRACK_FIELDS[s.id] !== undefined) byField.set(s.id, s);
  for (const id of Object.keys(TRACK_FIELDS)) {
    if (!byField.has(id)) bad(POLICY_TRACK_FILE, `has no series ${id}`);
  }
  file.quarters.forEach((quarter, i) => {
    const tools: Record<string, Record<string, Record<AreaKey, number>>> = {};
    for (const [id, target] of Object.entries(TRACK_FIELDS)) {
      const series = byField.get(id) as PolicySeries;
      const areas: Record<AreaKey, number> = {};
      for (const [area, records] of Object.entries(series.series)) {
        const record = records[i];
        if (record === undefined) bad(POLICY_TRACK_FILE, `series ${id} has no value for ${area} ${quarter}`);
        areas[area] = record.value;
      }
      const tool = (tools[target.tool] ??= {});
      tool[target.field] = areas;
    }
    settings.push({ quarter, tools: tools as Record<string, ToolSetting> });
  });
  return settings;
}

function citation(source: SourceEntry | undefined, id: string): { citation: string; url: string } {
  return source === undefined
    ? { citation: id, url: '' }
    : { citation: `${source.agency}, ${source.datasetEn ?? source.dataset}`, url: source.url };
}

function buildPassPrices(file: PolicyTrackFile): ParameterTable {
  const series = file.policySeries.find((s) => s.id === PASS_PRICE_SERIES);
  if (series === undefined) bad(POLICY_TRACK_FILE, `has no series ${PASS_PRICE_SERIES}`);
  const sources = new Map(file.sources.map((s) => [s.id, s]));
  const out: Record<string, ScalarParameter> = {};
  for (const [city, records] of Object.entries(series.series)) {
    file.quarters.forEach((quarter, i) => {
      const record = records[i];
      if (record === undefined) bad(POLICY_TRACK_FILE, `series ${series.id} has no value for ${city} ${quarter}`);
      const source = citation(sources.get(record.source), record.source);
      out[passPriceId(city, quarter)] = record.estimated
        ? { kind: 'scalar', value: record.value, unit: series.unit, source, status: 'secondary', estimated: { method: record.method } }
        : { kind: 'scalar', value: record.value, unit: series.unit, source, status: 'verified' };
    });
  }
  return out;
}

function readParams(): Readonly<Record<string, ScalarParameter | ScheduleParameter>> {
  const raw = readJson(PARAMS_FILE);
  if (!isObj(raw)) bad(PARAMS_FILE, 'is not an object');
  const table = isObj(raw.parameters) ? raw.parameters : raw;
  return table as Readonly<Record<string, ScalarParameter | ScheduleParameter>>;
}

function readMatrix(districtsRaw: unknown): CommuteMatrix {
  let raw: unknown;
  try {
    raw = readJson(COMMUTE_MATRIX_FILE);
  } catch (e) {
    if (!(e instanceof MissingInput) || !e.message.startsWith('missing input')) throw e;
    raw = isObj(districtsRaw) ? districtsRaw.commuteMatrix : undefined;
    if (raw === undefined) throw e;
  }
  if (!isObj(raw) || !Array.isArray(raw.codes) || !Array.isArray(raw.minutes)) {
    bad(COMMUTE_MATRIX_FILE, 'needs "codes" and "minutes"');
  }
  return { codes: raw.codes as string[], minutes: raw.minutes as number[][] };
}

/** Reads every input file and builds the engine inputs, or reports the first missing or unreadable one. */
export function adaptInputs(): AdaptResult {
  try {
    const history = readJson(HISTORY_FILE) as HistoryFile;
    const trackFile = readJson(POLICY_TRACK_FILE) as PolicyTrackFile;
    const districtsRaw = readJson(DISTRICTS_FILE);
    if (!isObj(districtsRaw) || !Array.isArray(districtsRaw.districts)) bad(DISTRICTS_FILE, 'has no "districts" list');
    const parameters = readParams();
    const commute = readMatrix(districtsRaw);

    const cityByCode = new Map<DistrictCode, CityName>();
    for (const d of districtsRaw.districts as { code: DistrictCode; city: CityName }[]) {
      cityByCode.set(d.code, d.city);
    }
    if (!Array.isArray(history.quarters) || !Array.isArray(history.indicators)) bad(HISTORY_FILE, 'has no quarters or indicators');
    if (!Array.isArray(trackFile.quarters) || !Array.isArray(trackFile.policySeries)) bad(POLICY_TRACK_FILE, 'has no quarters or policySeries');

    const passPrices = buildPassPrices(trackFile);
    return {
      ok: true,
      inputs: {
        baseline: buildBaseline(history, cityByCode),
        track: buildTrack(trackFile),
        params: { ...parameters, ...passPrices },
        commute,
        passPrices,
      },
    };
  } catch (e) {
    if (e instanceof MissingInput) return { ok: false, reason: e.message };
    throw e;
  }
}

/** A pass price parameter table with one city's price held at `price` from `firstQuarter` on. */
export function withPassPrice(
  prices: ParameterTable,
  cities: readonly string[],
  firstQuarter: QuarterKey,
  quarters: readonly QuarterKey[],
  price: number,
): ParameterTable {
  const out: Record<string, ScalarParameter | ScheduleParameter> = { ...prices };
  for (const city of cities) {
    for (const quarter of quarters) {
      if (quarter < firstQuarter) continue;
      const id = passPriceId(city, quarter);
      const old = out[id];
      if (old !== undefined && old.kind === 'scalar') out[id] = { ...old, value: price };
    }
  }
  return out;
}
