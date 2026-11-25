// buildGameView: composes the view models of the Game_Screen from a session and the Data_Files.
// Pure: no formatting, no Scenario id in any returned value (Requirement 5.3), no simulation formulas.
// Display-only arithmetic is limited to conversions.ts (Price_To_Income, Population_Change) and rounding for `same`.

import { briefItems, type BriefCandidate } from '../brief.ts';
import { TRACK_FIELDS } from '../../data/expected.ts';
import { passPriceId } from '../../data/convert.ts';
import type { LoadedData } from '../../data/convert.ts';
import { CITY_NAMES, POLICY_TOOL_IDS } from '../../types/data-files.ts';
import { INDICATOR_CLASSES } from '../../types/indicator-classes.ts';
import type {
  CityName,
  DistrictCode,
  DistrictEntry,
  HistoryFile,
  PolicyToolId,
  QuarterKey,
  TrackRecord,
  ValueRecord,
} from '../../types/data-files.ts';
import type {
  BudgetBarView,
  Announcement,
  BriefItemView,
  BriefView,
  CarriedProblemView,
  ConstructionRowView,
  DialogView,
  DistrictListView,
  DistrictPanelView,
  EditCheckView,
  FieldKey,
  FieldView,
  GameView,
  LegendView,
  CityStaticView,
  MapDistrictView,
  MapViewModel,
  MethodRefView,
  PanelRowId,
  PanelRowView,
  ParameterRefView,
  PolicyPanelView,
  RangeSourceView,
  SimulatedValueView,
  ToolView,
  TurnBarView,
  ValueRange,
  ValueRef,
} from '../../types/view.ts';
import type {
  AreaKey,
  BudgetLedger,
  EngineError,
  EngineBaseline,
  ParameterTable,
  PolicyTimeline,
  QuarterRanges,
  RuleContext,
  RuleRegistry,
  ScenarioName,
  SimState,
  ToolField,
  ToolRule,
} from '../../types/simulation.ts';
import { commitQuarter, emptyLedger, checkLimit, planBudget } from '../../simulation/budget.ts';
import { LAST_QUARTER, QUARTER_COUNT } from '../../simulation/constants.ts';
import { run } from '../../simulation/engine.ts';
import { roundHalfUp } from '../../simulation/numeric.ts';
import { scalar } from '../../simulation/params.ts';
import { quarterAt, quarterIndex, quarterYear } from '../../simulation/quarter.ts';
import { affordableValue, refOf } from './checks.ts';
import { constructionEntries } from './construction.ts';
import { populationChange, priceToIncome } from './conversions.ts';
import { followsRealTrack, playerTimeline, playerValue } from './policy.ts';
import { assumptionsFor, scenarioOfMax, scenarioOfMin } from './range-sources.ts';
import type { GameSession } from './session.ts';
import { timelineItems } from './timeline.ts';
import { TOOL_DOMAINS, fieldUnit, toolStatus, unitCostParameterId } from './tools.ts';
import type { CarriedProblem } from './turns.ts';

// ---------------------------------------------------------------------------
// Controller-held state the view needs
// ---------------------------------------------------------------------------

export interface ControllerUiState {
  readonly busy: boolean;
  readonly storageWarning: boolean;
  readonly versionNotice: { readonly saved: string; readonly current: string } | null;
  readonly engineError: { readonly quarter: QuarterKey; readonly error: EngineError } | null;
  /** The carried-value problem of the last blocked Computation_Run (Requirement 9.8). */
  readonly carried: CarriedProblem | null;
  readonly drafts: ReadonlyMap<FieldKey, { readonly text: string; readonly check: EditCheckView }>;
  readonly dialog: DialogView | null;
  readonly announcement: Announcement | null;
  readonly focusRequest: { readonly id: number; readonly key: FieldKey } | null;
  /** The Quarter_Brief is open (play-loop Requirement 4). Optional for callers that predate it. */
  readonly briefOpen?: boolean;
}

// ---------------------------------------------------------------------------
// Tables (design: DISPLAY_DECIMALS, ESTIMATE_INPUTS)
// ---------------------------------------------------------------------------

/** Decimals of every panel row (Requirement 6.10). Copied into each row view. */
export const DISPLAY_DECIMALS: Readonly<Record<PanelRowId, number>> = {
  rentBurden: 1,
  priceToIncome: 2,
  commuteTime: 1,
  populationChange: 1,
  rent: 1,
  population: 0,
  socialHousingStock: 0,
  mrtEntries: 0,
  ghostCount: 0,
};

/** `history.json` indicators each row is computed from (estimate flag and source names). */
export const ESTIMATE_INPUTS: Readonly<Record<PanelRowId, readonly string[]>> = {
  rentBurden: ['rent', 'householdIncome'],
  priceToIncome: ['medianTotalPrice', 'householdIncome'],
  commuteTime: [],
  populationChange: ['population'],
  rent: ['rent'],
  population: ['population'],
  socialHousingStock: ['socialHousingStock'],
  mrtEntries: ['mrtEntries'],
  ghostCount: ['population', 'rent', 'householdIncome'],
};

interface RowSpec {
  readonly id: PanelRowId;
  /** Engine indicator id, or null (Price_To_Income). */
  readonly engineId: string | null;
  /** `history.json` indicator whose unit and real values the row shows, or null. */
  readonly historyId: string | null;
  /** Unit when the row has no history indicator of its own. */
  readonly unit: string;
  readonly percentRow: boolean;
  readonly derivedBaseline: boolean;
}

/** The 9 rows in the order of Requirement 6.1. */
const ROWS: readonly RowSpec[] = [
  { id: 'rentBurden', engineId: 'rentBurden', historyId: null, unit: 'percent of household income', percentRow: true, derivedBaseline: true },
  { id: 'priceToIncome', engineId: null, historyId: null, unit: 'years of income', percentRow: false, derivedBaseline: false },
  { id: 'commuteTime', engineId: 'meanCommuteTime', historyId: null, unit: 'minutes', percentRow: false, derivedBaseline: true },
  { id: 'populationChange', engineId: 'population', historyId: null, unit: 'percent since 2015Q1', percentRow: true, derivedBaseline: false },
  { id: 'rent', engineId: 'rent', historyId: 'rent', unit: '', percentRow: false, derivedBaseline: false },
  { id: 'population', engineId: 'population', historyId: 'population', unit: '', percentRow: false, derivedBaseline: false },
  { id: 'socialHousingStock', engineId: 'socialHousingStock', historyId: 'socialHousingStock', unit: '', percentRow: false, derivedBaseline: false },
  { id: 'mrtEntries', engineId: 'mrtEntries', historyId: 'mrtEntries', unit: '', percentRow: false, derivedBaseline: false },
  { id: 'ghostCount', engineId: 'ghostCount', historyId: null, unit: 'ghosts', percentRow: false, derivedBaseline: true },
];

function specOf(id: PanelRowId): RowSpec {
  const s = ROWS.find((r) => r.id === id);
  if (s === undefined) throw new Error(`Unknown panel row ${id}`);
  return s;
}

const FIRST_QUARTER_KEY: QuarterKey = '2015Q1';
const GHOST_SIZE_ID = 'ghost.size';

// ---------------------------------------------------------------------------
// History access. A null record value stays null: it is never turned into 0 (game-ui 3.11).
// ---------------------------------------------------------------------------

function historyRecord(h: HistoryFile, id: string, code: DistrictCode, qi: number): ValueRecord | null {
  const ind = h.indicators.find((i) => i.id === id);
  if (ind === undefined || ind.level !== 'district') return null;
  return ind.series[code]?.[qi] ?? null;
}

/** Value of a record, or null for "no value". Periodic low-use records without data give null. */
function historyValue(h: HistoryFile, id: string, code: DistrictCode, qi: number): number | null {
  const r = historyRecord(h, id, code, qi);
  return r === null ? null : r.value;
}

function historyUnit(h: HistoryFile, id: string): string {
  return h.indicators.find((i) => i.id === id)?.unit ?? '';
}

function methodViews(h: HistoryFile, ids: readonly string[]): readonly MethodRefView[] {
  const out: MethodRefView[] = [];
  for (const id of ids) {
    const m = h.methods.find((x) => x.id === id);
    out.push(m === undefined ? { id, title: id, steps: [] } : { id: m.id, title: m.title, steps: m.steps });
  }
  return out;
}

function sourceNames(h: HistoryFile, spec: RowSpec): readonly string[] {
  const ids: string[] = [];
  for (const indId of ESTIMATE_INPUTS[spec.id]) {
    const ind = h.indicators.find((i) => i.id === indId);
    for (const s of ind?.sources ?? []) if (!ids.includes(s)) ids.push(s);
  }
  const names: string[] = [];
  for (const id of ids) {
    const s = h.sources.find((x) => x.id === id);
    if (s === undefined) continue;
    const name = `${s.agency}, ${s.datasetEn ?? s.dataset}`;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Context of one build
// ---------------------------------------------------------------------------

interface Baseline {
  readonly states: readonly SimState[] | null;
}

const BASELINE_CACHE = new WeakMap<
  EngineBaseline,
  { readonly registry: RuleRegistry; readonly params: ParameterTable; readonly result: Baseline }
>();

/**
 * Central Sim_States of the real (zero-difference) timeline: the Derived_Baseline of rent burden,
 * commute time and ghost count. By the zero-delta identity these equal the Derived_Baseline values.
 * Computed once per data set through the Engine; null when the run fails.
 */
function baselineOf(s: GameSession): Baseline {
  const hit = BASELINE_CACHE.get(s.baseline);
  if (hit !== undefined && hit.registry === s.registry && hit.params === s.params) return hit.result;
  const r = run(playerTimeline(s.realTrack, []), s.events, s.params, s.baseline, s.realTrack, s.commute, LAST_QUARTER, {
    registry: s.registry,
  });
  const result: Baseline = { states: r.ok ? r.states : null };
  BASELINE_CACHE.set(s.baseline, { registry: s.registry, params: s.params, result });
  return result;
}

interface Ctx {
  readonly data: LoadedData;
  readonly session: GameSession;
  readonly names: ReadonlyMap<DistrictCode, string>;
  /** Displayed_Quarter, or 2015Q1 while nothing is computed. */
  readonly quarter: QuarterKey;
  readonly qi: number;
  readonly computed: boolean;
  readonly ranges: QuarterRanges['ranges'] | null;
  baseline: Baseline | null;
}

function baselineValue(c: Ctx, engineId: string, code: DistrictCode): number | null {
  c.baseline ??= baselineOf(c.session);
  const v = c.baseline.states?.[c.qi]?.values[engineId]?.[code];
  return typeof v === 'number' ? v : null;
}

interface CellData {
  readonly range: ValueRange | null; // null: not simulated (no quarter computed, or Price_To_Income)
  readonly central: number | null;
  readonly comparison: { readonly value: number | null; readonly label: 'real' | 'derived-baseline' };
  readonly estimatedMethods: readonly MethodRefView[] | null;
}

function toChange(range: ValueRange, base: number): ValueRange {
  return {
    min: populationChange(range.min, base),
    central: populationChange(range.central, base),
    max: populationChange(range.max, base),
  };
}

function estimatedOf(c: Ctx, spec: RowSpec, code: DistrictCode): readonly MethodRefView[] | null {
  const h = c.data.history;
  if (spec.id === 'priceToIncome') {
    const p = priceToIncome(h, code, c.quarter);
    return p.value === null ? null : methodViews(h, p.methodIds);
  }
  const ids: string[] = [];
  let any = false;
  for (const indId of ESTIMATE_INPUTS[spec.id]) {
    const r = historyRecord(h, indId, code, c.qi);
    if (r !== null && r.estimated) {
      any = true;
      if ('method' in r && !ids.includes(r.method)) ids.push(r.method);
    }
  }
  return any ? methodViews(h, ids) : null;
}

function cellOf(c: Ctx, spec: RowSpec, code: DistrictCode): CellData {
  const h = c.data.history;
  const estimatedMethods = estimatedOf(c, spec, code);

  if (spec.id === 'priceToIncome') {
    const v = priceToIncome(h, code, c.quarter).value;
    return { range: null, central: v, comparison: { value: v, label: 'real' }, estimatedMethods };
  }

  let comparison: number | null;
  let label: 'real' | 'derived-baseline' = 'real';
  if (spec.id === 'populationChange') {
    const base = historyValue(h, 'population', code, 0);
    const now = historyValue(h, 'population', code, c.qi);
    comparison = base === null || now === null || base === 0 ? null : populationChange(now, base);
  } else if (spec.historyId !== null) {
    comparison = historyValue(h, spec.historyId, code, c.qi);
  } else {
    label = 'derived-baseline';
    comparison = spec.engineId === null ? null : baselineValue(c, spec.engineId, code);
  }

  let range: ValueRange | null = null;
  if (c.computed && spec.engineId !== null) {
    const r = c.ranges?.[spec.engineId]?.[code];
    if (r !== undefined) {
      range = { min: r.min, central: r.central, max: r.max };
      if (spec.id === 'populationChange') {
        const base = historyValue(h, 'population', code, 0);
        range = base === null || base === 0 ? null : toChange(range, base);
      }
    }
  }
  return {
    range,
    central: range !== null ? range.central : comparison,
    comparison: { value: comparison, label },
    estimatedMethods,
  };
}

function ghostSize(c: Ctx): number {
  return scalar(c.session.params, GHOST_SIZE_ID);
}

// ---------------------------------------------------------------------------
// Rows, panel, map
// ---------------------------------------------------------------------------

function unitOf(c: Ctx, spec: RowSpec): string {
  return spec.historyId === null ? spec.unit : historyUnit(c.data.history, spec.historyId);
}

function rowView(c: Ctx, spec: RowSpec, code: DistrictCode): PanelRowView {
  const cell = cellOf(c, spec, code);
  const unit = unitOf(c, spec);
  const decimals = DISPLAY_DECIMALS[spec.id];
  let simulated: SimulatedValueView | null = null;
  let realOnly: PanelRowView['realOnly'] = null;
  if (cell.range !== null) {
    const ref: ValueRef = { indicator: spec.id, district: code, quarter: c.quarter };
    simulated = {
      ref,
      range: cell.range,
      unit,
      decimals,
      comparison: cell.comparison,
      estimated: cell.estimatedMethods === null ? null : { methods: cell.estimatedMethods },
    };
  } else {
    realOnly = { value: cell.comparison.value, label: cell.comparison.label };
  }
  return {
    id: spec.id,
    unit,
    decimals,
    simulated,
    realOnly,
    percentRow: spec.percentRow,
    sourceNames: sourceNames(c.data.history, spec),
    modelEstimate: spec.id === 'commuteTime',
  };
}

function districtPanel(c: Ctx, selected: DistrictCode | null): DistrictPanelView {
  const entry = selected === null ? undefined : c.data.districts.find((d) => d.code === selected);
  if (entry === undefined) {
    return { mode: 'prompt', district: null, quarter: null, rows: [], ghostSize: ghostSize(c) };
  }
  return {
    mode: c.computed ? 'quarter' : 'real-2015Q1',
    district: { code: entry.code, name: entry.name, city: entry.city },
    quarter: c.quarter,
    rows: ROWS.map((spec) => rowView(c, spec, entry.code)),
    ghostSize: ghostSize(c),
  };
}

/** Central Ghost count of the Displayed_Quarter, or null before any quarter is computed (city-3d 2.2). */
/**
 * Persons above a ghost line minus real history, central Scenario, Displayed_Quarter (city-3d Requirement 6).
 * The Ghost count Causes are in ghost units and not floored; every Cause other than the Baseline (the real track)
 * and the floor adjustment ('bound') is a difference from real history. Read from the Engine output, no formula.
 */
function ghostDiffOf(c: Ctx, code: DistrictCode): number | null {
  if (!c.computed) return null;
  const state = c.session.computed?.central[c.qi];
  const breakdown = state?.causes['ghostCount']?.[code];
  const size = c.session.params['ghost.size'];
  if (breakdown === undefined || size === undefined || size.kind !== 'scalar') return null;
  let ghosts = 0;
  for (const cause of breakdown.causes) if (cause.id !== 'baseline' && cause.id !== 'bound') ghosts += cause.contribution;
  return ghosts * size.value;
}

function ghostsOf(c: Ctx, code: DistrictCode): number | null {
  if (!c.computed) return null;
  const r = c.ranges?.['ghostCount']?.[code];
  return r === undefined ? null : r.central;
}

/** salePrice of quarter qi ÷ salePrice of 2015Q1 (city-3d 2.2). Display data for building heights only. */
export function priceIndexOf(h: HistoryFile, code: DistrictCode, qi: number): number | null {
  const base = historyValue(h, 'salePrice', code, 0);
  const now = historyValue(h, 'salePrice', code, qi);
  return base === null || now === null || base === 0 ? null : now / base;
}

/** Static district data for the City_View (city-3d 2.1). */
export function buildCityStatic(data: LoadedData): CityStaticView {
  return {
    districts: data.districts.map((d) => ({
      code: d.code,
      city: d.city,
      name: d.name,
      areaKm2: d.areaKm2,
      centroid: d.centroid,
      polygons: d.geometry.type === 'Polygon' ? [d.geometry.coordinates] : d.geometry.coordinates,
      population2015: historyValue(data.history, 'population', d.code, 0) ?? 0,
    })),
  };
}

function periodOf(h: HistoryFile, code: DistrictCode, qi: number): string | null {
  const r = historyRecord(h, 'lowUseHousingRate', code, qi);
  if (r === null || r.value === null) return null;
  const p = (r as { readonly dataPeriod?: unknown }).dataPeriod;
  return typeof p === 'string' ? p : null;
}

function mapView(c: Ctx): MapViewModel {
  const indicator = c.session.mapIndicator;
  const lowUse = indicator === 'lowUseHousingRate';
  const spec = lowUse ? null : specOf(indicator);
  const districts: MapDistrictView[] = c.data.districts.map((d) => {
    // lowUseHousingRate is a baseline indicator: history value only, no range, same in all Scenarios.
    const cell = spec === null ? null : cellOf(c, spec, d.code);
    return {
      code: d.code,
      name: d.name,
      city: d.city,
      central: cell === null ? historyValue(c.data.history, 'lowUseHousingRate', d.code, c.qi) : cell.central,
      range: cell === null ? null : cell.range,
      estimated: cell !== null && cell.estimatedMethods !== null,
      classIndex: null,
      dataPeriod: lowUse ? periodOf(c.data.history, d.code, c.qi) : null,
      selected: c.session.selectedDistrict === d.code,
      ghosts: ghostsOf(c, d.code),
      ghostDiffPersons: ghostDiffOf(c, d.code),
      difference: cell !== null && cell.range !== null && cell.comparison.value !== null ? cell.range.central - cell.comparison.value : null,
      priceIndex: priceIndexOf(c.data.history, d.code, c.qi),
    };
  });
  const classes = INDICATOR_CLASSES[indicator];
  const legend: LegendView = {
    indicator,
    unit: spec === null ? historyUnit(c.data.history, 'lowUseHousingRate') : unitOf(c, spec),
    decimals: classes.decimals,
    bounds: classes.bounds,
  };

  return {
    indicator,
    labelMode: c.computed ? 'quarter' : 'real-2015Q1',
    quarter: c.computed ? c.quarter : null,
    districts,
    legend,
  };
}

function districtList(data: LoadedData, selected: DistrictCode | null): DistrictListView {
  const groups = CITY_NAMES.map((city) => ({
    city,
    districts: data.districts
      .filter((d) => d.city === city)
      .map((d) => ({ code: d.code, name: d.name }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  }));
  return { groups, selected };
}

// ---------------------------------------------------------------------------
// Policy panel
// ---------------------------------------------------------------------------

function fieldKey(tool: string, field: string, area: string): FieldKey {
  return `${tool}|${field}|${area}`;
}

function paramRef(params: ParameterTable, id: string, value: number): ParameterRefView {
  return (
    refOf(params, id, value) ?? {
      parameterId: id,
      value,
      unit: '',
      citation: null,
      url: null,
      status: 'gap',
      estimatedMethod: null,
      assumption: null,
    }
  );
}

function lagRef(params: ParameterTable, id: string): ParameterRefView {
  const p = Object.hasOwn(params, id) ? params[id] : undefined;
  return paramRef(params, id, p !== undefined && p.kind === 'scalar' ? p.value : 0);
}

function seriesIdOf(tool: string, field: string): string | null {
  for (const [id, t] of Object.entries(TRACK_FIELDS)) if (t.tool === tool && t.field === field) return id;
  return null;
}

function trackRecord(data: LoadedData, tool: string, field: string, area: AreaKey, qi: number): TrackRecord | null {
  const id = seriesIdOf(tool, field);
  const series = id === null ? undefined : data.policyTrack.policySeries.find((s) => s.id === id);
  if (series === undefined) return null;
  return (series.series as Readonly<Record<string, readonly TrackRecord[]>>)[area]?.[qi] ?? null;
}

interface PanelCtx {
  readonly c: Ctx;
  readonly ui: ControllerUiState;
  readonly planning: QuarterKey;
  readonly complete: boolean;
  readonly ledger: BudgetLedger;
  readonly rctx: RuleContext;
  readonly timeline: ReturnType<typeof playerTimeline>;
}

function fieldView(p: PanelCtx, rule: ToolRule, field: ToolField, area: AreaKey, needsDistrict: boolean): FieldView {
  const { c, ui } = p;
  const s = c.session;
  const params = s.params;
  const key = fieldKey(rule.id, field.id, area);
  const target = { tool: rule.id, field: field.id, area };
  const qi = quarterIndex(p.planning);
  const unitCostId = unitCostParameterId(rule);
  const unitCostParam = unitCostId === null ? undefined : params[unitCostId];
  const unitCost =
    unitCostId === null ? null : paramRef(params, unitCostId, unitCostParam?.kind === 'scalar' ? unitCostParam.value : 0);

  const base = {
    key,
    tool: rule.id,
    field: field.id,
    area,
    countField: field.integer === true,
    unit: fieldUnit(s.units, rule.id, field.id) ?? '',
    unitCost,
    lag: lagRef(params, rule.lagParameterId),
  };

  const districtEntry = c.data.districts.find((d) => d.code === area);
  const city: string = districtEntry?.city ?? area;
  const limitArea = field.limitScope === 'city-year' ? city : area;
  const firstCode = c.data.districts[0]?.code ?? area;
  const info = checkLimit(rule.id, field.id, needsDistrict ? firstCode : limitArea, p.planning, p.ledger, params, s.registry.tools, p.rctx);

  if (needsDistrict) {
    return {
      ...base,
      editable: 'select-district',
      real: null,
      player: null,
      limits: { lower: 0, upper: 0, scope: info.scope, lowerRef: null, upperRef: null },
      cityYearTotal: null,
      sliderUpper: 0,
      remainingCeiling: info.remainingCeiling,
      draft: null,
      applyEnabled: false,
      setToRealEnabled: false,
    };
  }

  const record = trackRecord(c.data, rule.id, field.id, area, qi);
  const real = record === null ? null : { value: record.value, estimated: record.estimated };
  const player = playerValue(s.realTrack, s.diffs, target, p.planning);

  let editable: FieldView['editable'] = 'yes';
  if (rule.id === 'commuterPass') {
    const price = params[passPriceId(area, p.planning)];
    if (price === undefined || price.kind !== 'scalar' || price.value === 0) editable = 'no-pass-product';
  }

  let cityYearTotal: number | null = null;
  let sliderUpper = info.upper;
  if (field.limitScope === 'city-year') {
    const codes = c.data.districts.filter((d) => d.city === city).map((d) => d.code);
    const year = quarterYear(p.planning);
    let total = 0;
    for (let i = 1; i <= 4; i += 1) {
      const setting = p.timeline.find((x) => x.quarter === (`${year}Q${i}` as QuarterKey));
      const values = setting?.tools[rule.id]?.[field.id];
      if (values === undefined) continue;
      for (const code of codes) total += values[code] ?? 0;
    }
    cityYearTotal = total;
    // The same running total as the city-year check (`checks.ts`): the quarters of the year through the Planning_Quarter.
    let through = 0;
    for (let i = 1; i <= 4; i += 1) {
      const q = `${year}Q${i}` as QuarterKey;
      if (q > p.planning) break;
      const values = p.timeline.find((x) => x.quarter === q)?.tools[rule.id]?.[field.id];
      if (values === undefined) continue;
      for (const code of codes) through += values[code] ?? 0;
    }
    const own = p.timeline.find((x) => x.quarter === p.planning)?.tools[rule.id]?.[field.id]?.[area] ?? 0;
    sliderUpper = cityYearSliderUpper(info.lower, info.upper, through, own);
  }
  // No Documented_Limit: the slider ends where the budget of the year runs out (housing-tools Requirement 2.2).
  if (!Number.isFinite(sliderUpper) && editable === 'yes' && !p.complete) {
    sliderUpper = Math.max(info.lower, affordableValue(s, target, field.integer === true));
  }

  const draft = ui.drafts.get(key) ?? null;
  const usable = editable === 'yes' && !ui.busy && !p.complete;
  return {
    ...base,
    editable,
    real,
    player,
    limits: {
      lower: info.lower,
      upper: info.upper,
      scope: info.scope,
      lowerRef: info.lowerParameterId === null ? null : refOf(params, info.lowerParameterId, info.lower),
      upperRef: info.upperParameterId === null ? null : refOf(params, info.upperParameterId, info.upper),
    },
    cityYearTotal,
    sliderUpper,
    remainingCeiling: info.remainingCeiling,
    draft,
    applyEnabled: usable && draft !== null && draft.check.status === 'ok',
    setToRealEnabled: usable && real !== null && !followsRealTrack(s.diffs, target, p.planning),
  };
}

function toolView(p: PanelCtx, id: PolicyToolId): ToolView {
  const { c } = p;
  const s = c.session;
  if (toolStatus(s.registry, id) === 'coming-soon') {
    const qi = quarterIndex(p.planning);
    const realValues: Extract<ToolView, { kind: 'coming-soon' }>['realValues'][number][] = [];
    for (const series of c.data.policyTrack.policySeries) {
      if (series.tool !== id) continue;
      const byArea = series.series as Readonly<Record<string, readonly TrackRecord[]>>;
      const areas =
        series.level === 'city'
          ? Object.keys(byArea)
          : s.selectedDistrict === null
            ? []
            : [s.selectedDistrict];
      for (const area of areas) {
        const r = byArea[area]?.[qi];
        if (r === undefined) continue;
        realValues.push({
          seriesId: series.id,
          area,
          value: r.value,
          unit: series.unit,
          decimals: series.decimals,
          estimated: r.estimated,
        });
      }
    }
    return { kind: 'coming-soon', id, realValues };
  }

  const rule = s.registry.tools.find((r) => r.id === id) as ToolRule;
  const fields: FieldView[] = [];
  for (const field of rule.fields) {
    if (field.area === 'district') {
      const sel = s.selectedDistrict;
      fields.push(fieldView(p, rule, field, sel ?? '', sel === null));
    } else {
      for (const city of CITY_NAMES) fields.push(fieldView(p, rule, field, city, false));
    }
  }
  return { kind: 'active', id, fields };
}

function carriedView(carried: CarriedProblem | null): CarriedProblemView | null {
  if (carried === null) return null;
  return {
    key: fieldKey(carried.target.tool, carried.target.field, carried.target.area),
    quarter: carried.quarter,
    value: carried.value,
    problem: carried.problem,
  };
}

function sumYear(slots: readonly number[], yearIndex: number): number {
  let sum = 0;
  for (let i = yearIndex * 4; i < yearIndex * 4 + 4; i += 1) sum += slots[i] ?? 0;
  return sum;
}

/**
 * The Budget_Bar of the Planning_Quarter's year (housing-tools Requirement 3.1), with the player's values kept to the
 * end of the year, as the year-end check of an edit counts: per tool, the charges of the year in quarters already
 * computed (`spent`) and in its other quarters (`later`). The Annual_Budget is the real spending of the year, so on
 * the real track nothing is left at the end of the year: spending more on one tool means spending less on another.
 */
export function budgetBarView(
  ledger: BudgetLedger,
  planning: QuarterKey,
  tools: readonly ToolRule[],
  timeline: PolicyTimeline,
  params: ParameterTable,
  ctx: RuleContext,
): BudgetBarView {
  const year = quarterYear(planning);
  const yearIndex = year - quarterYear(FIRST_QUARTER_KEY);
  const annualBudget = ledger.plan.annualBudget[yearIndex] ?? 0;
  const through = ledger.through === null ? -1 : quarterIndex(ledger.through);
  let led = ledger;
  for (let q = quarterIndex(planning); q < QUARTER_COUNT && quarterYear(quarterAt(q)) === year; q += 1) {
    const setting = timeline.find((x) => x.quarter === quarterAt(q));
    if (setting === undefined) break;
    const c = commitQuarter(led, quarterAt(q), setting, tools, params, { budgetMode: 'record' }, ctx);
    if (!c.ok) break;
    led = c.value;
  }
  let committed = 0;
  const rows = tools.map((t) => {
    const slots = led.committed[t.id] ?? [];
    let spent = 0;
    let later = 0;
    for (let i = yearIndex * 4; i < yearIndex * 4 + 4; i += 1) {
      if (i <= through) spent += slots[i] ?? 0;
      else later += slots[i] ?? 0;
    }
    committed += spent + later;
    return { tool: t.id, spent, later };
  });
  return { year, annualBudget, remaining: annualBudget - committed, tools: rows };
}

function policyPanel(c: Ctx, ui: ControllerUiState): PolicyPanelView {
  const s = c.session;
  const complete = s.next === 'complete';
  const planning: QuarterKey = s.next === 'complete' ? LAST_QUARTER : s.next;
  const rctx: RuleContext = { params: s.params, baseline: s.baseline, realTrack: s.realTrack, commute: s.commute };
  const tools = s.registry.tools;
  const ledger = s.ledger ?? emptyLedger(planBudget(s.realTrack, s.params, tools, rctx));
  const p: PanelCtx = { c, ui, planning, complete, ledger, rctx, timeline: playerTimeline(s.realTrack, s.diffs) };

  const domains = (['housing', 'transit'] as const).map((domain) => ({
    domain,
    tools: POLICY_TOOL_IDS.filter((id) => TOOL_DOMAINS[id] === domain).map((id) => toolView(p, id)),
  }));

  let budget: PolicyPanelView['budget'] = null;
  if (!complete) {
    const yearIndex = quarterYear(planning) - quarterYear(FIRST_QUARTER_KEY);
    const annualBudget = ledger.plan.annualBudget[yearIndex] ?? 0;
    let committed = 0;
    for (const slots of Object.values(ledger.committed)) committed += sumYear(slots, yearIndex);
    budget = { year: quarterYear(planning), annualBudget, committed, remaining: annualBudget - committed };
  }

  const displayed = s.computed?.central[s.computed.central.length - 1];
  const construction: readonly ConstructionRowView[] =
    displayed === undefined ? [] : constructionEntries(displayed, c.names);

  const budgetBar = complete ? null : budgetBarView(ledger, planning, tools, p.timeline, s.params, rctx);
  return { domains, budget, budgetBar, construction, carried: carriedView(ui.carried) };
}

// ---------------------------------------------------------------------------
// Range_Source_View (Requirement 20)
// ---------------------------------------------------------------------------

function roundTo(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return roundHalfUp(Math.abs(x) * f) * Math.sign(x) / f + 0;
}

/**
 * Range_Source_View of one displayed value, or null when the value is not simulated or `ref` is not the
 * Displayed_Quarter. `same` is true when min, central and max agree after rounding to the row's decimals.
 */
export function buildRangeSourceView(session: GameSession, data: LoadedData, ref: ValueRef): RangeSourceView | null {
  const computed = session.computed;
  const last = computed?.central[computed.central.length - 1];
  if (computed === null || last === undefined || last.quarter !== ref.quarter) return null;
  const ctx = makeCtx(data, session);
  const spec = specOf(ref.indicator);
  const cell = cellOf(ctx, spec, ref.district);
  if (cell.range === null || spec.engineId === null) return null;
  const i = computed.central.length - 1;
  const valueOf = (states: readonly SimState[]): number => states[i]?.values[spec.engineId as string]?.[ref.district] ?? Number.NaN;
  let scenarios: Record<ScenarioName, number> = {
    central: valueOf(computed.central),
    low: valueOf(computed.low),
    high: valueOf(computed.high),
  };
  if (spec.id === 'populationChange') {
    const base = historyValue(data.history, 'population', ref.district, 0);
    if (base === null || base === 0) return null;
    scenarios = {
      central: populationChange(scenarios.central, base),
      low: populationChange(scenarios.low, base),
      high: populationChange(scenarios.high, base),
    };
  }
  const decimals = DISPLAY_DECIMALS[spec.id];
  const same =
    roundTo(cell.range.min, decimals) === roundTo(cell.range.central, decimals) &&
    roundTo(cell.range.max, decimals) === roundTo(cell.range.central, decimals);
  const value: SimulatedValueView = {
    ref,
    range: cell.range,
    unit: unitOf(ctx, spec),
    decimals,
    comparison: cell.comparison,
    estimated: cell.estimatedMethods === null ? null : { methods: cell.estimatedMethods },
  };
  if (same) return { value, same: true, lowest: null, highest: null };
  const params = session.params;
  return {
    value,
    same: false,
    lowest: { value: cell.range.min, assumptions: assumptionsFor(params, scenarioOfMin(scenarios)) },
    highest: { value: cell.range.max, assumptions: assumptionsFor(params, scenarioOfMax(scenarios)) },
  };
}

// ---------------------------------------------------------------------------
// buildGameView
// ---------------------------------------------------------------------------

function makeCtx(data: LoadedData, session: GameSession): Ctx {
  const states = session.computed?.central ?? [];
  const lastState = states[states.length - 1];
  const lastRanges = session.computed?.ranges[session.computed.ranges.length - 1];
  const names = new Map<DistrictCode, string>(data.districts.map((d: DistrictEntry) => [d.code, d.name]));
  const quarter = lastState === undefined ? FIRST_QUARTER_KEY : lastState.quarter;
  return {
    data,
    session,
    names,
    quarter,
    qi: quarterIndex(quarter),
    computed: lastState !== undefined,
    ranges: lastRanges?.ranges ?? null,
    baseline: null,
  };
}

function turnBar(session: GameSession | null, ui: ControllerUiState): TurnBarView {
  const complete = session !== null && session.next === 'complete';
  const planning = session === null || session.next === 'complete' ? null : session.next;
  const states = session?.computed?.central ?? [];
  const last = states[states.length - 1];
  const idle = session === null || complete || ui.busy;
  return {
    planning,
    displayed: last === undefined ? null : last.quarter,
    turn: complete ? QUARTER_COUNT : planning === null ? 1 : quarterIndex(planning) + 1,
    complete,
    busy: ui.busy,
    demo: session?.demo ?? false,
    storageWarning: ui.storageWarning,
    versionNotice: ui.versionNotice,
    engineError: ui.engineError,
    nextEnabled: !idle,
    fastForwardEnabled: !idle,
    budget: session === null || planning === null ? null : budgetBarOf(session, planning),
  };
}

function budgetBarOf(s: GameSession, planning: QuarterKey): BudgetBarView {
  const rctx: RuleContext = { params: s.params, baseline: s.baseline, realTrack: s.realTrack, commute: s.commute };
  const ledger = s.ledger ?? emptyLedger(planBudget(s.realTrack, s.params, s.registry.tools, rctx));
  return budgetBarView(ledger, planning, s.registry.tools, playerTimeline(s.realTrack, s.diffs), s.params, rctx);
}

export function buildGameView(session: GameSession | null, ui: ControllerUiState, data: LoadedData): GameView {
  const common = {
    dialog: ui.dialog,
    announcement: ui.announcement,
    focusRequest: ui.focusRequest,
  };
  if (session === null) {
    const indicator = 'rentBurden';
    return {
      turnBar: turnBar(null, ui),
      map: {
        indicator,
        labelMode: 'real-2015Q1',
        quarter: null,
        districts: data.districts.map((d) => ({
          code: d.code,
          name: d.name,
          city: d.city as CityName,
          central: null,
          range: null,
          estimated: false,
          classIndex: null,
          dataPeriod: null,
          selected: false,
          ghosts: null,
          ghostDiffPersons: null,
          difference: null,
          priceIndex: priceIndexOf(data.history, d.code, 0),
        })),
        legend: {
          indicator,
          unit: specOf(indicator).unit,
          decimals: INDICATOR_CLASSES[indicator].decimals,
          bounds: INDICATOR_CLASSES[indicator].bounds,
        },
      },
      districtList: districtList(data, null),
      districtPanel: { mode: 'prompt', district: null, quarter: null, rows: [], ghostSize: 0 },
      policyPanel: {
        domains: [
          { domain: 'housing', tools: [] },
          { domain: 'transit', tools: [] },
        ],
        budget: null,
        budgetBar: null,
        construction: [],
        carried: null,
      },
      timeline: [],
      brief: null,
      ...common,
    };
  }
  const c = makeCtx(data, session);
  return {
    turnBar: turnBar(session, ui),
    map: mapView(c),
    districtList: districtList(data, session.selectedDistrict),
    districtPanel: districtPanel(c, session.selectedDistrict),
    policyPanel: policyPanel(c, ui),
    timeline: timelineItems(session, c.names),
    brief: ui.briefOpen === true ? briefOf(data, session) : null,
    ...common,
  };
}

// ---------------------------------------------------------------------------
// Quarter_Brief (play-loop Requirement 6)
// ---------------------------------------------------------------------------

/** Map_Indicators the Engine simulates; their difference from real history can change from quarter to quarter. */
const BRIEF_INDICATORS = ['rentBurden', 'commuteTime', 'populationChange'] as const;

/** Context of an earlier computed quarter (index into the computed arrays). */
function ctxAt(data: LoadedData, session: GameSession, k: number): Ctx | null {
  const state = session.computed?.central[k];
  const ranges = session.computed?.ranges[k];
  if (state === undefined || ranges === undefined) return null;
  return { ...makeCtx(data, session), quarter: state.quarter, qi: quarterIndex(state.quarter), computed: true, ranges: ranges.ranges };
}

const roundShown = (x: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(x * f) / f + 0;
};

/** The Brief_Items of the Displayed_Quarter, or null before any quarter is computed. */
export function briefOf(data: LoadedData, session: GameSession): BriefView | null {
  const n = session.computed?.central.length ?? 0;
  const now = ctxAt(data, session, n - 1);
  if (now === null) return null;
  const before = ctxAt(data, session, n - 2);
  const candidates: BriefCandidate[] = [];
  const quarterItems = timelineItems(session, now.names).find((q) => q.quarter === now.quarter)?.items ?? [];
  for (const it of quarterItems) {
    if (it.kind === 'completion' && it.item.difference > 0) {
      candidates.push({ kind: 'completion', district: it.item.district, districtName: it.item.districtName, units: it.item.difference });
    }
  }
  for (const card of session.cards) {
    if (card.firstQuarter === now.quarter && card.major) candidates.push({ kind: 'major-event', id: card.id, title: card.title, firstQuarter: card.firstQuarter });
  }
  for (const id of BRIEF_INDICATORS) {
    const spec = specOf(id);
    const decimals = DISPLAY_DECIMALS[spec.id];
    for (const d of data.districts) {
      const cell = cellOf(now, spec, d.code);
      if (cell.range === null || cell.comparison.value === null) continue;
      const diff = roundShown(cell.range.central - cell.comparison.value, decimals);
      let prevDiff = 0;
      if (before !== null) {
        const prev = cellOf(before, spec, d.code);
        prevDiff = prev.range === null || prev.comparison.value === null ? 0 : roundShown(prev.range.central - prev.comparison.value, decimals);
      }
      candidates.push({ kind: 'change', district: d.code, districtName: d.name, indicator: id, prevDiff, diff, value: roundShown(cell.range.central, decimals) });
    }
  }
  for (const d of data.districts) {
    const nowPersons = ghostDiffOf(now, d.code);
    if (nowPersons === null) continue;
    const prevPersons = before === null ? 0 : (ghostDiffOf(before, d.code) ?? 0);
    candidates.push({ kind: 'people', district: d.code, districtName: d.name, prev: Math.round(prevPersons), now: Math.round(nowPersons) });
  }
  const items: BriefItemView[] = briefItems(candidates).map((c): BriefItemView => {
    if (c.kind === 'completion') return { kind: 'completion', district: c.district, districtName: c.districtName, units: c.units };
    if (c.kind === 'major-event') return { kind: 'major-event', id: c.id, title: c.title };
    if (c.kind === 'people') return { kind: 'people', district: c.district, districtName: c.districtName, persons: c.now, change: c.now - c.prev };
    const spec = specOf(c.indicator as PanelRowId);
    return {
      kind: 'change',
      district: c.district,
      districtName: c.districtName,
      indicator: c.indicator,
      value: c.value,
      diff: c.diff,
      change: roundShown(c.diff - c.prevDiff, DISPLAY_DECIMALS[spec.id]),
      unit: unitOf(now, spec),
      percentPoints: spec.percentRow,
      decimals: DISPLAY_DECIMALS[spec.id],
    };
  });
  return { quarter: now.quarter, items };
}

/**
 * Pure: the largest value one district can take in the Planning_Quarter under a city-year limit (Decision D6): the
 * city's upper limit less every other value counted in the year's running total through the Planning_Quarter. Never
 * below the lower limit or above the upper limit. Used as the Policy_Dialog slider's upper end (play-loop task 12.3:
 * the slider offered the whole city limit to one district, so values the check rejects could be chosen).
 */
export function cityYearSliderUpper(lower: number, upper: number, totalThroughPlanning: number, ownAtPlanning: number): number {
  return Math.max(lower, Math.min(upper, upper - (totalThroughPlanning - ownAtPlanning)));
}
