/**
 * Pure conversion of the loaded data files into Engine inputs plus display data (Requirements 2.4, 7.14).
 * Mirrors scripts/backtest/adapt.ts (buildBaseline, buildTrack, buildPassPrices); a parity test compares them.
 * No I/O. Total for files that passed validation.
 */
import type {
  CityName,
  CommuteMatrixFile,
  DistrictCode,
  DistrictEntry,
  DistrictsFile,
  HistoryFile,
  ParamsFile,
  PolicySeries,
  PolicyTrackFile,
  SourceEntry,
} from '../types/data-files.ts';
import type { EventCard, EventsFile } from '../types/events-file.ts';
import type {
  AreaKey,
  CommuteMatrix,
  EngineBaseline,
  ParameterTable,
  PolicySetting,
  PolicyTimeline,
  ScalarParameter,
  SimEvent,
  ToolSetting,
} from '../types/simulation.ts';
import { PASS_PRICE_SERIES, TRACK_FIELDS } from './expected.ts';

export interface LoadedFiles {
  readonly districts: DistrictsFile;
  readonly history: HistoryFile;
  readonly policyTrack: PolicyTrackFile;
  readonly events: EventsFile;
  readonly params: ParamsFile;
  readonly commute: CommuteMatrixFile;
}

export interface EngineInputs {
  readonly baseline: EngineBaseline;
  readonly realTrack: PolicyTimeline;
  /** params.json parameters + commuter pass price parameters. */
  readonly params: ParameterTable;
  readonly commute: CommuteMatrix;
  readonly events: readonly SimEvent[];
}

export interface LoadedData {
  readonly engine: EngineInputs;
  /** params.json `parameters` only. */
  readonly paramsFileTable: ParameterTable;
  /** 41, ascending code. */
  readonly districts: readonly DistrictEntry[];
  readonly history: HistoryFile;
  readonly policyTrack: PolicyTrackFile;
  readonly events: readonly EventCard[];
}

/** Id of the pass price parameter of one city and quarter. */
export function passPriceId(city: string, quarter: string): string {
  return `commuterPass.price.${city}.${quarter}`;
}

function buildBaseline(history: HistoryFile, cityByCode: ReadonlyMap<DistrictCode, CityName>): EngineBaseline {
  const codes = [...cityByCode.keys()].sort();
  const indicators: Record<string, Record<DistrictCode, readonly (number | null)[]>> = {};
  const indicatorSources: Record<string, readonly string[]> = {};
  for (const ind of history.indicators) {
    if (ind.level !== 'district') continue;
    // Periodic low-use indicators carry null (no data) values; they are not baseline indicators for the Engine.
    if (ind.periodic === true) continue;
    const byDistrict: Record<DistrictCode, readonly (number | null)[]> = {};
    for (const code of codes) {
      byDistrict[code] = (ind.series[code] ?? []).map((r) => r.value);
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
  const byId = new Map<string, PolicySeries>();
  for (const s of file.policySeries) if (TRACK_FIELDS[s.id] !== undefined) byId.set(s.id, s);
  return file.quarters.map((quarter, i): PolicySetting => {
    const tools: Record<string, Record<string, Record<AreaKey, number>>> = {};
    for (const [id, target] of Object.entries(TRACK_FIELDS)) {
      const series = byId.get(id);
      const areas: Record<AreaKey, number> = {};
      if (series !== undefined) {
        for (const [area, records] of Object.entries(series.series)) {
          const record = records[i];
          if (record !== undefined) areas[area] = record.value;
        }
      }
      const tool = (tools[target.tool] ??= {});
      tool[target.field] = areas;
    }
    return { quarter, tools: tools as Record<string, ToolSetting> };
  });
}

function citation(source: SourceEntry | undefined, id: string): { citation: string; url: string } {
  return source === undefined
    ? { citation: id, url: '' }
    : { citation: `${source.agency}, ${source.datasetEn ?? source.dataset}`, url: source.url };
}

function buildPassPrices(file: PolicyTrackFile): ParameterTable {
  const series = file.policySeries.find((s) => s.id === PASS_PRICE_SERIES);
  const out: Record<string, ScalarParameter> = {};
  if (series === undefined) return out;
  const sources = new Map(file.sources.map((s) => [s.id, s]));
  for (const [city, records] of Object.entries(series.series)) {
    file.quarters.forEach((quarter, i) => {
      const record = records[i];
      if (record === undefined) return;
      const source = citation(sources.get(record.source), record.source);
      out[passPriceId(city, quarter)] = record.estimated
        ? { kind: 'scalar', value: record.value, unit: series.unit, source, status: 'secondary', estimated: { method: record.method } }
        : { kind: 'scalar', value: record.value, unit: series.unit, source, status: 'verified' };
    });
  }
  return out;
}

function toSimEvent(card: EventCard): SimEvent {
  return {
    id: card.id,
    type: card.type,
    firstQuarter: card.firstQuarter,
    lastQuarter: card.lastQuarter,
    affectedIndicators: [],
    magnitude: { text: '' },
    sources: [],
    modifiers: [],
  };
}

export function convert(files: LoadedFiles): LoadedData {
  const districts = [...files.districts.districts].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const cityByCode = new Map<DistrictCode, CityName>(districts.map((d) => [d.code, d.city]));
  const paramsFileTable = files.params.parameters;
  const passPrices = buildPassPrices(files.policyTrack);
  return {
    engine: {
      baseline: buildBaseline(files.history, cityByCode),
      realTrack: buildTrack(files.policyTrack),
      params: { ...paramsFileTable, ...passPrices },
      commute: { codes: [...files.commute.codes], minutes: files.commute.minutes },
      events: files.events.events.map(toSimEvent),
    },
    paramsFileTable,
    districts,
    history: files.history,
    policyTrack: files.policyTrack,
    events: files.events.events,
  };
}
