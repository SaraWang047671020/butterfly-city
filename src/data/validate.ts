// Hand-written validator for public/data/*.json (Decision D2). Pure, erasable TypeScript, no DOM or Node APIs.
// Runs on in-memory objects before serialization and on parsed JSON. Never throws: garbage becomes errors.
// `src/` must not import `scripts/`, so every expected set arrives through ValidationContext.

import { CITY_NAMES, INDICATOR_KINDS, POLICY_TOOL_IDS, SCHEMA_VERSION } from '../types/data-files.ts';
import type { IndicatorKind } from '../types/data-files.ts';

/** Structurally the same as `ValidationIssue` in scripts/pipeline/errors.ts. */
export interface ValidationError {
  readonly file: 'districts.json' | 'history.json' | 'policy-track.json' | 'commute-matrix.json' | 'params.json' | 'events.json';
  readonly path: string; // JSON path, e.g. $.indicators[2].series["65000200"][17].value
  readonly rule: string;
  readonly message: string;
}

export interface ValidationContext {
  readonly districtCodes: readonly string[]; // exactly the 41 codes
  readonly quarters: readonly string[]; // exactly 2015Q1..2025Q4
  readonly indicatorIds: readonly string[]; // exactly these indicator ids, in this order, are expected in history.json; also used for the unique-id check of policy series
  readonly policySeriesIds: readonly string[]; // exactly these policy series ids are expected
  readonly engineIdSet?: readonly string[]; // params.json: exactly these ids (the pipeline passes it)
  readonly sourceTypes?: Readonly<Record<string, 1 | 2 | 3>>; // params.json: Parameter_Source_Type per id
  /** history.json, rule low-use-gap; skipped when absent (the web app loader). */
  readonly lowUse?: LowUseContext;
}

/** The low-use build result the validator compares the periodic indicators against (Requirement 26.13). */
export interface LowUseContext {
  readonly dataGaps: readonly string[]; // District_Codes without a value in any Low_Use_Period
  readonly periodsPresent: readonly string[]; // `YYYYH1` / `YYYYH2` periods with a published district value
  readonly missing: readonly { readonly district: string; readonly period: string }[]; // (district, period) pairs without a value
}

type Obj = Record<string, unknown>;
type FileName = ValidationError['file'];

const METHOD_KINDS: readonly string[] = ['interpolation', 'estimation', 'missing-reason'];
const CREDENTIAL_PARAM = /^(api_?key|key|token|access_token|client_secret|secret)$/i;
const ABSOLUTE_HTTP_URL = /^https?:\/\/[^\s/?#]+\S*$/i;
const HOLDING_TAX_LOWEST = 'holdingTaxRateLowestTier';
const HOLDING_TAX_HIGHEST = 'holdingTaxRateHighestTier';

// ---------------------------------------------------------------------------------------------
// small helpers

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const sub = (p: string, k: string): string => `${p}.${k}`;
const at = (p: string, i: number): string => `${p}[${i}]`;
const keyAt = (p: string, k: string): string => `${p}[${JSON.stringify(k)}]`;

/** `sign(x) * round(|x| * 10^d) / 10^d` with -0 normalised to 0; same as the pipeline's roundTo. */
function roundTo(x: number, d: number): number {
  const factor = 10 ** d;
  const r = (Math.sign(x) * Math.round(Math.abs(x) * factor)) / factor;
  return r === 0 ? 0 : r;
}

/** Shoelace sum; negative for clockwise rings, positive for counterclockwise (x east, y north). */
function signedArea(ring: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j] as readonly [number, number];
    const q = ring[i] as readonly [number, number];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

class Checker {
  readonly file: FileName;
  readonly errors: ValidationError[] = [];

  constructor(file: FileName) {
    this.file = file;
  }

  add(path: string, rule: string, message: string): void {
    this.errors.push({ file: this.file, path, rule, message });
  }

  /** Returns `o[k]` or undefined after reporting `required`. */
  req(o: Obj, p: string, k: string): unknown {
    if (!has(o, k) || o[k] === undefined) {
      this.add(sub(p, k), 'required', `field "${k}" is required`);
      return undefined;
    }
    return o[k];
  }

  str(o: Obj, p: string, k: string, nonEmpty = true): string | undefined {
    const v = this.req(o, p, k);
    if (v === undefined) return undefined;
    if (typeof v !== 'string') {
      this.add(sub(p, k), 'type', `expected a string, found ${describe(v)}`);
      return undefined;
    }
    if (nonEmpty && v.trim() === '') {
      this.add(sub(p, k), 'required', `"${k}" must not be empty`);
      return undefined;
    }
    return v;
  }

  arr(o: Obj, p: string, k: string): unknown[] | undefined {
    const v = this.req(o, p, k);
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) {
      this.add(sub(p, k), 'type', `expected an array, found ${describe(v)}`);
      return undefined;
    }
    return v;
  }

  obj(o: Obj, p: string, k: string): Obj | undefined {
    const v = this.req(o, p, k);
    if (v === undefined) return undefined;
    if (!isObj(v)) {
      this.add(sub(p, k), 'type', `expected an object, found ${describe(v)}`);
      return undefined;
    }
    return v;
  }

  /** A finite number or undefined; NaN and ±Infinity are reported under `finite`. */
  num(o: Obj, p: string, k: string): number | undefined {
    const v = this.req(o, p, k);
    if (v === undefined) return undefined;
    return this.finiteNumber(v, sub(p, k));
  }

  finiteNumber(v: unknown, path: string): number | undefined {
    if (typeof v !== 'number') {
      this.add(path, 'type', `expected a number, found ${describe(v)}`);
      return undefined;
    }
    if (!Number.isFinite(v)) {
      this.add(path, 'finite', `value ${String(v)} is not finite`);
      return undefined;
    }
    return v;
  }

  stringArray(v: unknown, path: string, nonEmptyList: boolean): string[] | undefined {
    if (!Array.isArray(v)) {
      this.add(path, v === undefined ? 'required' : 'type', `expected an array of strings, found ${describe(v)}`);
      return undefined;
    }
    if (nonEmptyList && v.length === 0) this.add(path, 'required', 'at least one entry is required');
    const out: string[] = [];
    v.forEach((s, i) => {
      if (typeof s !== 'string' || s.trim() === '') this.add(at(path, i), 'type', `expected a non-empty string, found ${describe(s)}`);
      else out.push(s);
    });
    return out;
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isFinite(v) ? 'number' : String(v);
  return typeof v;
}

// ---------------------------------------------------------------------------------------------
// shared parts: schemaVersion, quarters, sources, methods

function checkSchemaVersion(c: Checker, root: Obj): void {
  const v = c.req(root, '$', 'schemaVersion');
  if (v !== undefined && v !== SCHEMA_VERSION) {
    c.add('$.schemaVersion', 'type', `expected schemaVersion ${SCHEMA_VERSION}, found ${describe(v)}`);
  }
}

function checkQuarters(c: Checker, root: Obj, ctx: ValidationContext): void {
  const q = c.arr(root, '$', 'quarters');
  if (q === undefined) return;
  if (q.length !== ctx.quarters.length) {
    c.add('$.quarters', 'quarter-span', `expected ${ctx.quarters.length} quarters, found ${q.length}`);
  }
  const seen = new Set<unknown>();
  q.forEach((k, i) => {
    const p = at('$.quarters', i);
    if (typeof k !== 'string') {
      c.add(p, 'type', `expected a quarter key string, found ${describe(k)}`);
      return;
    }
    if (seen.has(k)) c.add(p, 'quarter-span', `duplicate quarter ${k}`);
    seen.add(k);
    const want = ctx.quarters[i];
    if (want !== undefined && k !== want) c.add(p, 'quarter-span', `expected ${want} at position ${i}, found ${k}`);
    if (want === undefined) c.add(p, 'quarter-span', `quarter ${k} is outside the expected span`);
  });
}

function checkUrlCredentials(c: Checker, url: string, path: string): void {
  const q = url.indexOf('?');
  if (q < 0) return;
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash < 0 ? url.length : hash);
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    let name = eq < 0 ? pair : pair.slice(0, eq);
    try {
      name = decodeURIComponent(name);
    } catch {
      // keep the raw name
    }
    if (CREDENTIAL_PARAM.test(name)) {
      const value = eq < 0 ? '' : pair.slice(eq + 1);
      if (value !== 'REDACTED') c.add(path, 'credential', `URL carries credential parameter "${name}" with a value other than REDACTED`);
    }
  }
}

function checkUrl(c: Checker, v: unknown, path: string): void {
  if (typeof v !== 'string') {
    c.add(path, v === undefined ? 'required' : 'type', `expected a URL string, found ${describe(v)}`);
    return;
  }
  if (!ABSOLUTE_HTTP_URL.test(v)) {
    c.add(path, 'source-entry', 'URL must be absolute with the http or https scheme');
    return;
  }
  checkUrlCredentials(c, v, path);
}

/** Returns the set of defined source ids. */
function checkSources(c: Checker, root: Obj): Set<string> {
  const ids = new Set<string>();
  const list = c.arr(root, '$', 'sources');
  if (list === undefined) return ids;
  list.forEach((s, i) => {
    const p = at('$.sources', i);
    if (!isObj(s)) {
      c.add(p, 'type', `expected an object, found ${describe(s)}`);
      return;
    }
    const id = c.str(s, p, 'id');
    if (id !== undefined) {
      if (ids.has(id)) c.add(sub(p, 'id'), 'unique-id', `duplicate source id "${id}"`);
      ids.add(id);
    }
    c.str(s, p, 'agency');
    c.str(s, p, 'dataset');
    c.str(s, p, 'license');
    if (has(s, 'datasetEn') && s['datasetEn'] !== undefined) c.str(s, p, 'datasetEn');
    checkUrl(c, c.req(s, p, 'url'), sub(p, 'url'));
    const years = c.req(s, p, 'years');
    if (years !== undefined) {
      const yp = sub(p, 'years');
      if (!Array.isArray(years) || years.length !== 2) {
        c.add(yp, 'type', 'expected [firstYear, lastYear]');
      } else {
        const ok = years.every((y) => typeof y === 'number' && Number.isInteger(y) && y >= 1000 && y <= 9999);
        if (!ok) c.add(yp, 'source-entry', 'years must be four-digit integers');
        else if ((years[0] as number) > (years[1] as number)) c.add(yp, 'source-entry', 'first year must not exceed last year');
      }
    }
    if (has(s, 'wikipedia') && s['wikipedia'] !== undefined) {
      const w = c.obj(s, p, 'wikipedia');
      if (w) c.str(w, sub(p, 'wikipedia'), 'title');
    }
  });
  return ids;
}

/** Returns method id → kind for every defined method. */
function checkMethods(c: Checker, root: Obj, sourceIds: ReadonlySet<string>): Map<string, string> {
  const methods = new Map<string, string>();
  const list = c.arr(root, '$', 'methods');
  if (list === undefined) return methods;
  list.forEach((m, i) => {
    const p = at('$.methods', i);
    if (!isObj(m)) {
      c.add(p, 'type', `expected an object, found ${describe(m)}`);
      return;
    }
    const id = c.str(m, p, 'id');
    const kind = c.str(m, p, 'kind');
    if (kind !== undefined && !METHOD_KINDS.includes(kind)) {
      c.add(sub(p, 'kind'), 'type', `kind must be one of ${METHOD_KINDS.join(', ')}`);
    }
    if (id !== undefined) {
      if (methods.has(id)) c.add(sub(p, 'id'), 'unique-id', `duplicate method id "${id}"`);
      methods.set(id, kind ?? '');
    }
    c.str(m, p, 'title');
    c.str(m, p, 'quarters');
    const inputs = c.stringArray(c.req(m, p, 'inputs'), sub(p, 'inputs'), false);
    inputs?.forEach((s, j) => {
      if (!sourceIds.has(s)) c.add(at(sub(p, 'inputs'), j), 'source-ref', `source "${s}" is not defined in sources`);
    });
    c.stringArray(c.req(m, p, 'steps'), sub(p, 'steps'), false);
    c.stringArray(c.req(m, p, 'appliesTo'), sub(p, 'appliesTo'), false);
    const sa = c.req(m, p, 'setsEstimated');
    if (sa !== undefined && sa !== true) c.add(sub(p, 'setsEstimated'), 'type', 'setsEstimated must be true');
    if (has(m, 'citations') && m['citations'] !== undefined) {
      const cites = c.arr(m, p, 'citations');
      cites?.forEach((ct, j) => {
        const cp = at(sub(p, 'citations'), j);
        if (!isObj(ct)) {
          c.add(cp, 'type', `expected an object, found ${describe(ct)}`);
          return;
        }
        c.str(ct, cp, 'label');
        checkUrl(c, c.req(ct, cp, 'url'), sub(cp, 'url'));
      });
    }
  });
  return methods;
}

function checkSourceRefs(c: Checker, v: unknown, path: string, sourceIds: ReadonlySet<string>, nonEmptyList: boolean): void {
  const refs = c.stringArray(v, path, nonEmptyList);
  refs?.forEach((s, i) => {
    if (!sourceIds.has(s)) c.add(at(path, i), 'source-ref', `source "${s}" is not defined in sources`);
  });
}

function checkMethodRef(c: Checker, id: unknown, path: string, methods: ReadonlyMap<string, string>): string | undefined {
  if (typeof id !== 'string') {
    c.add(path, 'type', `expected a method id string, found ${describe(id)}`);
    return undefined;
  }
  if (!methods.has(id)) {
    c.add(path, 'method-ref', `method "${id}" is not defined in methods`);
    return undefined;
  }
  return id;
}

// ---------------------------------------------------------------------------------------------
// series (history indicators and policy series)

interface SeriesSpec {
  readonly kind: IndicatorKind | undefined;
  readonly decimals: number | undefined;
  readonly periodic?: boolean;
}

function checkRangeAndDecimals(c: Checker, v: number, path: string, spec: SeriesSpec): void {
  switch (spec.kind) {
    case 'count':
      if (!Number.isInteger(v) || v < 0) c.add(path, 'range', `count must be an integer ≥ 0, found ${v}`);
      break;
    case 'positive':
      if (!(v > 0)) c.add(path, 'range', `value must be > 0, found ${v}`);
      break;
    case 'non-negative':
      if (!(v >= 0)) c.add(path, 'range', `value must be ≥ 0, found ${v}`);
      break;
    case 'percent':
    case 'index-0-100':
      if (!(v >= 0 && v <= 100)) c.add(path, 'range', `value must be within 0..100, found ${v}`);
      break;
    default:
      break;
  }
  if (spec.decimals !== undefined && roundTo(v, spec.decimals) !== v) {
    c.add(path, 'decimals', `value ${v} has more than ${spec.decimals} decimals`);
  }
}

function checkValueRecord(
  c: Checker,
  rec: unknown,
  p: string,
  spec: SeriesSpec,
  methods: ReadonlyMap<string, string>,
  quarter?: string,
): void {
  if (!isObj(rec)) {
    c.add(p, 'type', `expected an object, found ${describe(rec)}`);
    return;
  }
  let isNull = false;
  let value: number | undefined;
  if (!has(rec, 'value') || rec['value'] === undefined) {
    c.add(sub(p, 'value'), 'required', 'field "value" is required');
  } else if (rec['value'] === null) {
    isNull = true;
  } else {
    value = c.finiteNumber(rec['value'], sub(p, 'value'));
  }
  const estimated = rec['estimated'];
  if (!has(rec, 'estimated') || estimated === undefined) c.add(sub(p, 'estimated'), 'required', 'field "estimated" is required');
  else if (typeof estimated !== 'boolean') c.add(sub(p, 'estimated'), 'type', `expected a boolean, found ${describe(estimated)}`);

  const hasMethod = has(rec, 'method') && rec['method'] !== undefined;
  const methodId = hasMethod ? checkMethodRef(c, rec['method'], sub(p, 'method'), methods) : undefined;

  if (estimated === true) {
    if (!hasMethod) c.add(sub(p, 'method'), 'estimate', 'an estimated record needs exactly one method');
    else if (isNull && methodId !== undefined && methods.get(methodId) !== 'missing-reason') {
      c.add(sub(p, 'method'), 'estimate', 'a null value needs a method of kind missing-reason');
    }
  } else if (estimated === false) {
    if (isNull && spec.periodic !== true) {
      c.add(sub(p, 'value'), 'no-data', 'a null value with estimated false is allowed only in a periodic indicator');
    }
    if (hasMethod) c.add(sub(p, 'method'), 'estimate', 'a record with estimated false must not have a method');
  }
  checkDataPeriod(c, rec, p, spec, isNull, estimated, quarter);
  if (value !== undefined) checkRangeAndDecimals(c, value, sub(p, 'value'), spec);
}

/** Reference_Quarter of a Low_Use_Period label: `2023H1` → `2023Q2`, `2023H2` → `2023Q4`. */
function referenceQuarter(period: string): string | undefined {
  const m = /^(\d{4})H([12])$/.exec(period);
  return m === null ? undefined : `${m[1]}Q${m[2] === '1' ? 2 : 4}`;
}

function checkDataPeriod(
  c: Checker,
  rec: Obj,
  p: string,
  spec: SeriesSpec,
  isNull: boolean,
  estimated: unknown,
  quarter: string | undefined,
): void {
  const dp = has(rec, 'dataPeriod') ? rec['dataPeriod'] : undefined;
  const path = sub(p, 'dataPeriod');
  if (dp !== undefined) {
    if (spec.periodic !== true) {
      c.add(path, 'data-period', 'dataPeriod is allowed only in a periodic indicator');
    } else if (isNull || estimated !== false) {
      c.add(path, 'data-period', 'dataPeriod is allowed only on a non-null record with estimated false');
    } else if (typeof dp !== 'string' || referenceQuarter(dp) === undefined) {
      c.add(path, 'data-period', 'dataPeriod must have the form YYYYH1 or YYYYH2');
    } else if (quarter !== undefined && referenceQuarter(dp) !== quarter) {
      c.add(path, 'data-period', `Reference_Quarter ${String(referenceQuarter(dp))} of ${dp} differs from the record quarter ${quarter}`);
    }
  } else if (spec.periodic === true && !isNull && estimated === false) {
    c.add(path, 'data-period', 'a non-null record of a periodic indicator needs a dataPeriod');
  }
}

function checkTrackRecord(
  c: Checker,
  rec: unknown,
  p: string,
  spec: SeriesSpec,
  methods: ReadonlyMap<string, string>,
  sourceIds: ReadonlySet<string>,
): void {
  if (!isObj(rec)) {
    c.add(p, 'type', `expected an object, found ${describe(rec)}`);
    return;
  }
  let value: number | undefined;
  if (!has(rec, 'value') || rec['value'] === undefined) c.add(sub(p, 'value'), 'required', 'field "value" is required');
  else if (rec['value'] === null) c.add(sub(p, 'value'), 'type', 'a Track_Record value is never null');
  else value = c.finiteNumber(rec['value'], sub(p, 'value'));

  const src = c.str(rec, p, 'source');
  if (src !== undefined && !sourceIds.has(src)) c.add(sub(p, 'source'), 'track-source', `source "${src}" is not defined in sources`);

  const estimated = rec['estimated'];
  if (!has(rec, 'estimated') || estimated === undefined) c.add(sub(p, 'estimated'), 'required', 'field "estimated" is required');
  else if (typeof estimated !== 'boolean') c.add(sub(p, 'estimated'), 'type', `expected a boolean, found ${describe(estimated)}`);

  const hasMethod = has(rec, 'method') && rec['method'] !== undefined;
  if (hasMethod) checkMethodRef(c, rec['method'], sub(p, 'method'), methods);
  if (estimated === true && !hasMethod) c.add(sub(p, 'method'), 'estimate', 'an estimated record needs exactly one method');
  if (estimated === false && hasMethod) c.add(sub(p, 'method'), 'estimate', 'a record with estimated false must not have a method');

  if (value !== undefined) checkRangeAndDecimals(c, value, sub(p, 'value'), spec);
}

/** Checks the key set of a series object and the length of every record array; calls `each` per record. */
function checkSeriesMap(
  c: Checker,
  series: unknown,
  path: string,
  level: string,
  ctx: ValidationContext,
  each: (rec: unknown, recPath: string, index: number) => void,
): void {
  if (series === undefined) {
    c.add(path, 'required', 'field "series" is required');
    return;
  }
  if (!isObj(series)) {
    c.add(path, 'type', `expected an object, found ${describe(series)}`);
    return;
  }
  const expected: readonly string[] = level === 'city' ? CITY_NAMES : ctx.districtCodes;
  const expectedSet = new Set(expected);
  for (const k of Object.keys(series)) {
    if (!expectedSet.has(k)) c.add(keyAt(path, k), 'district-code', `unexpected ${level === 'city' ? 'city' : 'district code'} "${k}"`);
  }
  for (const k of expected) {
    if (!has(series, k)) c.add(path, 'district-code', `missing ${level === 'city' ? 'city' : 'district code'} "${k}"`);
  }
  for (const k of Object.keys(series)) {
    if (!expectedSet.has(k)) continue;
    const kp = keyAt(path, k);
    const records = series[k];
    if (!Array.isArray(records)) {
      c.add(kp, 'type', `expected an array, found ${describe(records)}`);
      continue;
    }
    if (records.length !== ctx.quarters.length) {
      c.add(kp, 'quarter-span', `expected ${ctx.quarters.length} records, found ${records.length}`);
    }
    records.forEach((rec, i) => each(rec, at(kp, i), i));
  }
}

interface SeriesListResult {
  readonly ids: string[];
}

/** Shared by history `indicators` and policy-track `policySeries`. */
function checkSeriesList(
  c: Checker,
  root: Obj,
  listKey: 'indicators' | 'policySeries',
  ctx: ValidationContext,
  sourceIds: ReadonlySet<string>,
  methods: ReadonlyMap<string, string>,
): SeriesListResult {
  const track = listKey === 'policySeries';
  const result: SeriesListResult = { ids: [] };
  const list = c.arr(root, '$', listKey);
  if (list === undefined) return result;
  const seenIds = new Set<string>();
  const historyIds = new Set(ctx.indicatorIds);
  list.forEach((item, i) => {
    const p = at(`$.${listKey}`, i);
    if (!isObj(item)) {
      c.add(p, 'type', `expected an object, found ${describe(item)}`);
      return;
    }
    const id = c.str(item, p, 'id');
    if (id !== undefined) {
      result.ids.push(id);
      if (seenIds.has(id)) c.add(sub(p, 'id'), 'unique-id', `duplicate id "${id}"`);
      seenIds.add(id);
      if (track && historyIds.has(id)) c.add(sub(p, 'id'), 'unique-id', `id "${id}" is already an indicator id in history.json`);
    }
    if (track) {
      const tool = c.str(item, p, 'tool');
      if (tool !== undefined && !(POLICY_TOOL_IDS as readonly string[]).includes(tool)) {
        c.add(sub(p, 'tool'), 'tool', `tool must be one of ${POLICY_TOOL_IDS.join(', ')}`);
      }
    }
    c.str(item, p, 'unit');
    const kindRaw = c.str(item, p, 'kind');
    let kind: IndicatorKind | undefined;
    if (kindRaw !== undefined) {
      if ((INDICATOR_KINDS as readonly string[]).includes(kindRaw)) kind = kindRaw as IndicatorKind;
      else c.add(sub(p, 'kind'), 'type', `kind must be one of ${INDICATOR_KINDS.join(', ')}`);
    }
    let decimals: number | undefined;
    const dec = c.num(item, p, 'decimals');
    if (dec !== undefined) {
      if (Number.isInteger(dec) && dec >= 0 && dec <= 6) decimals = dec;
      else c.add(sub(p, 'decimals'), 'decimals', `decimals must be an integer in 0..6, found ${dec}`);
    }
    const desc = c.str(item, p, 'description', false);
    if (desc !== undefined && (desc.length < 1 || desc.length > 200)) {
      c.add(sub(p, 'description'), 'description', `description must be 1..200 characters, found ${desc.length}`);
    }
    checkSourceRefs(c, c.req(item, p, 'sources'), sub(p, 'sources'), sourceIds, true);

    const level = c.str(item, p, 'level');
    if (level !== undefined && level !== 'district' && level !== 'city') {
      c.add(sub(p, 'level'), 'type', 'level must be "district" or "city"');
      return;
    }
    if (level === undefined) return;
    const spec: SeriesSpec = { kind, decimals, periodic: !track && has(item, 'periodic') && item['periodic'] === true };
    const seriesPath = sub(p, 'series');
    const seriesValue = has(item, 'series') ? item['series'] : undefined;
    checkSeriesMap(c, seriesValue, seriesPath, level, ctx, (rec, rp, index) => {
      if (track) checkTrackRecord(c, rec, rp, spec, methods, sourceIds);
      else checkValueRecord(c, rec, rp, spec, methods, ctx.quarters[index]);
    });
    if (spec.periodic === true && level === 'district' && ctx.lowUse !== undefined && isObj(seriesValue)) {
      checkLowUseGaps(c, seriesValue, seriesPath, ctx, ctx.lowUse);
    }
  });
  return result;
}

/** Rule `low-use-gap` (Requirement 26 criterion 13) for one periodic district indicator. */
function checkLowUseGaps(c: Checker, series: Obj, path: string, ctx: ValidationContext, lowUse: LowUseContext): void {
  const gaps = new Set(lowUse.dataGaps);
  const present = new Set(lowUse.periodsPresent);
  const missing = new Set(lowUse.missing.map((m) => `${m.district}|${m.period}`));
  const allNull: string[] = [];
  for (const code of ctx.districtCodes) {
    const records = series[code];
    if (!Array.isArray(records) || records.length !== ctx.quarters.length) continue;
    const nullAt = records.map((r) => isObj(r) && r['value'] === null);
    const kp = keyAt(path, code);
    const entirely = nullAt.every((n) => n);
    if (entirely) allNull.push(code);
    if (entirely && !gaps.has(code)) c.add(kp, 'low-use-gap', `district ${code} has only null records but is not on the data gap list`);
    if (!entirely && gaps.has(code)) c.add(kp, 'low-use-gap', `district ${code} is on the data gap list but has a non-null record`);
    records.forEach((_, i) => {
      if (!nullAt[i]) return;
      const q = ctx.quarters[i] as string;
      const m = /^(\d{4})Q([1-4])$/.exec(q);
      if (m === null || m[2] === '1' || m[2] === '3') return;
      const year = Number(m[1]);
      if (m[2] === '2' && year <= 2019) return;
      const period = `${m[1]}H${m[2] === '2' ? 1 : 2}`;
      if (!present.has(period) || missing.has(`${code}|${period}`)) return;
      c.add(at(kp, i), 'low-use-gap', `null at ${q}, but period ${period} has a published value for district ${code}`);
    });
  }
  if (allNull.length > 5) {
    c.add(path, 'low-use-gap', `${allNull.length} districts have only null records (more than 5): ${allNull.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------------------------
// public validators

export function validateHistoryFile(x: unknown, ctx: ValidationContext): ValidationError[] {
  const c = new Checker('history.json');
  try {
    if (!isObj(x)) {
      c.add('$', 'type', `expected an object, found ${describe(x)}`);
      return c.errors;
    }
    checkSchemaVersion(c, x);
    checkQuarters(c, x, ctx);
    const sourceIds = checkSources(c, x);
    const methods = checkMethods(c, x, sourceIds);
    const { ids } = checkSeriesList(c, x, 'indicators', ctx, sourceIds, methods);

    // indicator-set: exactly ctx.indicatorIds, in the same order
    const got = new Set(ids);
    const want = new Set(ctx.indicatorIds);
    for (const id of ctx.indicatorIds) {
      if (!got.has(id)) c.add('$.indicators', 'indicator-set', `missing indicator "${id}"`);
    }
    ids.forEach((id, i) => {
      if (!want.has(id)) {
        c.add(sub(at('$.indicators', i), 'id'), 'indicator-set', `unexpected indicator "${id}"`);
      } else if (ctx.indicatorIds[i] !== id) {
        c.add(
          sub(at('$.indicators', i), 'id'),
          'indicator-set',
          `indicator "${id}" is at the wrong position; expected "${ctx.indicatorIds[i] ?? 'none'}" here`,
        );
      }
    });
  } catch (e) {
    c.add('$', 'type', `validator could not read the file: ${e instanceof Error ? e.message : String(e)}`);
  }
  return c.errors;
}

export function validateCommuteMatrix(x: unknown, ctx: ValidationContext): ValidationError[] {
  const c = new Checker('commute-matrix.json');
  try {
    if (!isObj(x)) {
      c.add('$', 'type', `expected an object, found ${describe(x)}`);
      return c.errors;
    }
    for (const k of Object.keys(x)) {
      if (k !== 'codes' && k !== 'minutes') c.add(sub('$', k), 'unknown-field', `unexpected field "${k}"`);
    }
    const codes = c.arr(x, '$', 'codes');
    const rows = c.arr(x, '$', 'minutes');
    if (codes !== undefined) {
      const expected = [...ctx.districtCodes].sort();
      const ok = codes.length === expected.length && codes.every((v, i) => v === expected[i]);
      if (!ok) c.add('$.codes', 'codes', `expected the ${expected.length} district codes in ascending order`);
    }
    if (rows !== undefined) {
      const n = ctx.districtCodes.length;
      if (rows.length !== n) c.add('$.minutes', 'shape', `expected ${n} rows, found ${rows.length}`);
      rows.forEach((row, i) => {
        const rp = at('$.minutes', i);
        if (!Array.isArray(row)) {
          c.add(rp, 'type', `expected an array, found ${describe(row)}`);
          return;
        }
        if (row.length !== n) c.add(rp, 'shape', `expected ${n} values, found ${row.length}`);
        row.forEach((v, j) => {
          const p = at(rp, j);
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            c.add(p, 'type', `expected a finite number, found ${describe(v)}`);
          } else if (v < 0) {
            c.add(p, 'range', `value ${v} is negative`);
          } else if (i === j && v !== 0) {
            c.add(p, 'diagonal', `diagonal value must be 0, found ${v}`);
          } else if (roundTo(v, 1) !== v) {
            c.add(p, 'decimals', `value ${v} has more than 1 decimal`);
          }
        });
      });
    }
  } catch (e) {
    c.add('$', 'type', `validator could not read the file: ${e instanceof Error ? e.message : String(e)}`);
  }
  return c.errors;
}

export function validatePolicyTrackFile(x: unknown, ctx: ValidationContext): ValidationError[] {
  const c = new Checker('policy-track.json');
  try {
    if (!isObj(x)) {
      c.add('$', 'type', `expected an object, found ${describe(x)}`);
      return c.errors;
    }
    checkSchemaVersion(c, x);
    checkQuarters(c, x, ctx);
    const sourceIds = checkSources(c, x);
    const methods = checkMethods(c, x, sourceIds);
    const { ids } = checkSeriesList(c, x, 'policySeries', ctx, sourceIds, methods);

    // policy-series-set
    const want = new Set(ctx.policySeriesIds);
    const got = new Set(ids);
    for (const id of ctx.policySeriesIds) {
      if (!got.has(id)) c.add('$.policySeries', 'policy-series-set', `missing policy series "${id}"`);
    }
    ids.forEach((id, i) => {
      if (!want.has(id)) c.add(sub(at('$.policySeries', i), 'id'), 'policy-series-set', `unexpected policy series "${id}"`);
    });

    checkRateOrder(c, x);
  } catch (e) {
    c.add('$', 'type', `validator could not read the file: ${e instanceof Error ? e.message : String(e)}`);
  }
  return c.errors;
}

function checkRateOrder(c: Checker, root: Obj): void {
  const list = root['policySeries'];
  if (!Array.isArray(list)) return;
  let lowest: { obj: Obj; index: number } | undefined;
  let highest: Obj | undefined;
  list.forEach((s, index) => {
    if (!isObj(s) || s['level'] !== 'city' || !isObj(s['series'])) return;
    if (s['id'] === HOLDING_TAX_LOWEST && lowest === undefined) lowest = { obj: s, index };
    if (s['id'] === HOLDING_TAX_HIGHEST && highest === undefined) highest = s;
  });
  if (lowest === undefined || highest === undefined) return;
  const lo = lowest.obj['series'] as Obj;
  const hi = highest['series'] as Obj;
  for (const city of CITY_NAMES) {
    const a = lo[city];
    const b = hi[city];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const n = Math.min(a.length, b.length);
    for (let q = 0; q < n; q++) {
      const va = isObj(a[q]) ? (a[q] as Obj)['value'] : undefined;
      const vb = isObj(b[q]) ? (b[q] as Obj)['value'] : undefined;
      if (typeof va === 'number' && typeof vb === 'number' && Number.isFinite(va) && Number.isFinite(vb) && va > vb) {
        c.add(
          sub(at(keyAt(sub(at('$.policySeries', lowest.index), 'series'), city), q), 'value'),
          'rate-order',
          `lowest-tier rate ${va} exceeds highest-tier rate ${vb} for ${city}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// districts.json

type Pos = readonly [number, number];

function checkRing(c: Checker, ring: unknown, p: string, exterior: boolean, pts: Pos[]): void {
  if (!Array.isArray(ring)) {
    c.add(p, 'type', `expected a ring array, found ${describe(ring)}`);
    return;
  }
  if (ring.length < 4) c.add(p, 'ring', `a ring needs at least 4 positions, found ${ring.length}`);
  const valid: Pos[] = [];
  let allValid = true;
  ring.forEach((q, i) => {
    const qp = at(p, i);
    if (!Array.isArray(q) || q.length !== 2) {
      c.add(qp, 'type', 'expected a [lon, lat] position');
      allValid = false;
      return;
    }
    let ok = true;
    for (let j = 0; j < 2; j++) {
      const v = c.finiteNumber(q[j], at(qp, j));
      if (v === undefined) ok = false;
      else if (roundTo(v, 5) !== v) c.add(at(qp, j), 'decimals', `coordinate ${v} has more than 5 decimals`);
    }
    if (ok) {
      valid.push([q[0] as number, q[1] as number]);
      pts.push([q[0] as number, q[1] as number]);
    } else allValid = false;
  });
  if (!allValid || ring.length < 4) return;
  const first = valid[0] as Pos;
  const last = valid[valid.length - 1] as Pos;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    c.add(p, 'ring', 'ring is not closed (first and last positions differ)');
    return;
  }
  const area = signedArea(valid);
  if (exterior && !(area < 0)) c.add(p, 'winding', 'exterior ring must be clockwise');
  if (!exterior && !(area > 0)) c.add(p, 'winding', 'hole must be counterclockwise');
}

function checkGeometry(c: Checker, g: unknown, p: string, pts: Pos[]): void {
  if (!isObj(g)) {
    c.add(p, g === undefined ? 'required' : 'type', `expected an object, found ${describe(g)}`);
    return;
  }
  const type = g['type'];
  const coords = g['coordinates'];
  if (type !== 'Polygon' && type !== 'MultiPolygon') {
    c.add(sub(p, 'type'), 'type', 'geometry type must be Polygon or MultiPolygon');
    return;
  }
  const cp = sub(p, 'coordinates');
  if (!Array.isArray(coords)) {
    c.add(cp, coords === undefined ? 'required' : 'type', `expected an array, found ${describe(coords)}`);
    return;
  }
  const polygon = (rings: unknown, rp: string): void => {
    if (!Array.isArray(rings)) {
      c.add(rp, 'type', `expected an array of rings, found ${describe(rings)}`);
      return;
    }
    if (rings.length === 0) c.add(rp, 'ring', 'a polygon needs an exterior ring');
    rings.forEach((r, i) => checkRing(c, r, at(rp, i), i === 0, pts));
  };
  if (type === 'Polygon') polygon(coords, cp);
  else {
    if (coords.length === 0) c.add(cp, 'ring', 'a MultiPolygon needs at least one polygon');
    coords.forEach((poly, i) => polygon(poly, at(cp, i)));
  }
}

function checkProvenance(c: Checker, root: Obj, sourceIds: ReadonlySet<string>, methods: ReadonlyMap<string, string>): void {
  const prov = c.obj(root, '$', 'provenance');
  if (prov === undefined) return;
  for (const field of ['code', 'city', 'name', 'areaKm2', 'centroid', 'geometry']) {
    const fp = sub('$.provenance', field);
    const f = c.obj(prov, '$.provenance', field);
    if (f === undefined) continue;
    checkSourceRefs(c, c.req(f, fp, 'sources'), sub(fp, 'sources'), sourceIds, false);
    if (has(f, 'method') && f['method'] !== undefined) checkMethodRef(c, f['method'], sub(fp, 'method'), methods);
  }
}

export function validateDistrictsFile(x: unknown, ctx: ValidationContext): ValidationError[] {
  const c = new Checker('districts.json');
  try {
    if (!isObj(x)) {
      c.add('$', 'type', `expected an object, found ${describe(x)}`);
      return c.errors;
    }
    checkSchemaVersion(c, x);
    const sourceIds = checkSources(c, x);
    const methods = checkMethods(c, x, sourceIds);
    checkProvenance(c, x, sourceIds, methods);

    const list = c.arr(x, '$', 'districts');
    if (list === undefined) return c.errors;
    const expected = [...ctx.districtCodes].sort();
    const expectedSet = new Set(expected);
    if (list.length !== expected.length) {
      c.add('$.districts', 'district-code', `expected ${expected.length} districts, found ${list.length}`);
    }
    const seen = new Set<string>();
    let prev: string | undefined;
    let orderReported = false;
    list.forEach((d, i) => {
      const p = at('$.districts', i);
      if (!isObj(d)) {
        c.add(p, 'type', `expected an object, found ${describe(d)}`);
        return;
      }
      const code = c.str(d, p, 'code');
      if (code !== undefined) {
        if (!expectedSet.has(code)) c.add(sub(p, 'code'), 'district-code', `unknown district code "${code}"`);
        else {
          if (seen.has(code)) c.add(sub(p, 'code'), 'district-code', `duplicate district code "${code}"`);
          else if (prev !== undefined && code < prev && !orderReported) {
            c.add(sub(p, 'code'), 'district-code', 'districts must be in ascending code order');
            orderReported = true;
          }
          prev = code;
        }
        seen.add(code);
      }
      const city = c.str(d, p, 'city');
      if (city !== undefined && !(CITY_NAMES as readonly string[]).includes(city)) {
        c.add(sub(p, 'city'), 'type', `city must be one of ${CITY_NAMES.join(', ')}`);
      }
      c.str(d, p, 'name');
      const area = c.num(d, p, 'areaKm2');
      if (area !== undefined) {
        if (!(area > 0)) c.add(sub(p, 'areaKm2'), 'range', `areaKm2 must be > 0, found ${area}`);
        if (roundTo(area, 2) !== area) c.add(sub(p, 'areaKm2'), 'decimals', `areaKm2 ${area} has more than 2 decimals`);
      }
      const pts: Pos[] = [];
      checkGeometry(c, has(d, 'geometry') ? d['geometry'] : undefined, sub(p, 'geometry'), pts);
      const cen = c.arr(d, p, 'centroid');
      if (cen !== undefined) {
        const cp = sub(p, 'centroid');
        if (cen.length !== 2) c.add(cp, 'type', 'expected [lon, lat]');
        else {
          const lon = c.finiteNumber(cen[0], at(cp, 0));
          const lat = c.finiteNumber(cen[1], at(cp, 1));
          if (lon !== undefined && roundTo(lon, 5) !== lon) c.add(at(cp, 0), 'decimals', `centroid longitude ${lon} has more than 5 decimals`);
          if (lat !== undefined && roundTo(lat, 5) !== lat) c.add(at(cp, 1), 'decimals', `centroid latitude ${lat} has more than 5 decimals`);
          if (lon !== undefined && lat !== undefined && pts.length > 0) {
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            for (const q of pts) {
              if (q[0] < minX) minX = q[0];
              if (q[0] > maxX) maxX = q[0];
              if (q[1] < minY) minY = q[1];
              if (q[1] > maxY) maxY = q[1];
            }
            const inside = lon >= minX && lon <= maxX && lat >= minY && lat <= maxY;
            if (!inside) c.add(cp, 'centroid', 'centroid lies outside the bounding box of the geometry');
          }
        }
      }
    });
    const missing = expected.filter((k) => !seen.has(k));
    if (missing.length > 0) c.add('$.districts', 'district-code', `missing district codes: ${missing.join(', ')}`);
  } catch (e) {
    c.add('$', 'type', `validator could not read the file: ${e instanceof Error ? e.message : String(e)}`);
  }
  return c.errors;
}
