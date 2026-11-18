/**
 * Data_Loader: fetches the 6 static data files, validates each one, checks the district code sets and
 * converts them (Requirements 2.1 to 2.9, 18.12). Keeps no state; "Retry" is a second call.
 * This is the only module that builds a URL under `data/`.
 */
import type { DistrictCode, HistoryFile } from '../types/data-files.ts';
import { quarterAt } from '../simulation/quarter.ts';
import { convert } from './convert.ts';
import type { LoadedData, LoadedFiles } from './convert.ts';
import { DATA_FILE_NAMES, EXPECTED_POLICY_SERIES_IDS, REQUIRED_HISTORY_INDICATORS } from './expected.ts';
import type { DataFileName } from './expected.ts';
import { validateParamsFile } from './validate-params.ts';
import { validateCommuteMatrix, validateDistrictsFile, validateHistoryFile, validatePolicyTrackFile } from './validate.ts';
import type { ValidationContext, ValidationError } from './validate.ts';

export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
export type FetchPort = (url: string, init: { readonly signal: AbortSignal }) => Promise<FetchResponse>;
export interface TimerPort {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface LoadFailure {
  readonly file: DataFileName;
  readonly message: string;
}
export type LoadResult =
  | { readonly ok: true; readonly data: LoadedData }
  | { readonly ok: false; readonly failures: readonly LoadFailure[] };

export const DEFAULT_TIMEOUT_MS = 15_000;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

type Fetched = { readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly message: string };

const TIMEOUT = Symbol('timeout');

async function fetchOne(
  fetchPort: FetchPort,
  url: string,
  timer: TimerPort,
  timeoutMs: number,
  onComplete: () => void,
): Promise<Fetched> {
  const controller = new AbortController();
  let timedOut = false;
  let handle: unknown;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    handle = timer.set(() => {
      timedOut = true;
      controller.abort();
      resolve(TIMEOUT);
    }, timeoutMs);
  });
  const timeoutMessage = `no complete response within ${Math.round(timeoutMs / 1000)} seconds`;
  const work = (async (): Promise<Fetched> => {
    const response = await fetchPort(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
    const body = await response.text();
    onComplete();
    try {
      return { ok: true, json: JSON.parse(body) as unknown };
    } catch (e) {
      return { ok: false, message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  })();
  try {
    const result = await Promise.race([work, timeout]);
    if (result === TIMEOUT) {
      work.catch(() => undefined);
      return { ok: false, message: timeoutMessage };
    }
    return result;
  } catch (e) {
    if (timedOut) return { ok: false, message: timeoutMessage };
    return { ok: false, message: `request failed: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    timer.clear(handle);
  }
}

function firstError(errors: readonly ValidationError[]): string | undefined {
  const e = errors[0];
  return e === undefined ? undefined : `${e.path}: ${e.message}`;
}

/**
 * Structural check of events.json.
 * TODO(event-library task 1.3): replace with `validateEventsFile` from `./validate-events.ts` once it exists.
 */
function checkEventsFile(x: unknown): string | undefined {
  if (!isObj(x)) return '$: expected an object';
  if (x['schemaVersion'] !== 1) return '$.schemaVersion: expected 1';
  const list = x['events'];
  if (!Array.isArray(list)) return '$.events: expected an array';
  for (let i = 0; i < list.length; i++) {
    const card = list[i] as unknown;
    if (!isObj(card)) return `$.events[${i}]: expected an object`;
    for (const key of ['id', 'date', 'firstQuarter', 'lastQuarter', 'title'] as const) {
      if (typeof card[key] !== 'string') return `$.events[${i}].${key}: expected a string`;
    }
  }
  return undefined;
}

function districtCodesOf(districts: unknown): string[] {
  if (!isObj(districts) || !Array.isArray(districts['districts'])) return [];
  const codes: string[] = [];
  for (const d of districts['districts'] as unknown[]) {
    if (isObj(d) && typeof d['code'] === 'string') codes.push(d['code']);
  }
  return codes;
}

function historyIndicatorIds(history: unknown): string[] {
  if (!isObj(history) || !Array.isArray(history['indicators'])) return [];
  const ids: string[] = [];
  for (const ind of history['indicators'] as unknown[]) {
    if (isObj(ind) && typeof ind['id'] === 'string') ids.push(ind['id']);
  }
  return ids;
}

/** First missing, then first extra code of `actual` against `expected`; undefined when the sets are equal. */
function firstCodeMismatch(expected: readonly string[], actual: readonly string[]): string | undefined {
  const have = new Set(actual);
  const want = new Set(expected);
  for (const code of expected) if (!have.has(code)) return `district code ${code} is missing; districts.json has it`;
  for (const code of actual) if (!want.has(code)) return `district code ${code} is not in districts.json`;
  return undefined;
}

export async function loadDataFiles(
  fetchPort: FetchPort,
  baseUrl: string,
  onProgress: (loaded: number) => void,
  timer: TimerPort,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<LoadResult> {
  let loaded = 0;
  const fetched = await Promise.all(
    DATA_FILE_NAMES.map((name) =>
      fetchOne(fetchPort, `${baseUrl}data/${name}`, timer, timeoutMs, () => {
        loaded += 1;
        onProgress(loaded);
      }),
    ),
  );

  const byName = new Map<DataFileName, Fetched>(DATA_FILE_NAMES.map((n, i) => [n, fetched[i] as Fetched]));
  const jsonOf = (name: DataFileName): unknown => {
    const f = byName.get(name);
    return f !== undefined && f.ok ? f.json : undefined;
  };

  const ctx: ValidationContext = {
    districtCodes: districtCodesOf(jsonOf('districts.json')),
    quarters: Array.from({ length: 44 }, (_, i) => quarterAt(i)),
    indicatorIds: historyIndicatorIds(jsonOf('history.json')),
    policySeriesIds: EXPECTED_POLICY_SERIES_IDS,
  };

  const problems = new Map<DataFileName, string>();
  for (const name of DATA_FILE_NAMES) {
    const f = byName.get(name) as Fetched;
    if (!f.ok) {
      problems.set(name, f.message);
      continue;
    }
    let message: string | undefined;
    try {
      switch (name) {
        case 'districts.json':
          message = firstError(validateDistrictsFile(f.json, ctx));
          break;
        case 'history.json': {
          message = firstError(validateHistoryFile(f.json, ctx));
          if (message === undefined) {
            const have = new Set(ctx.indicatorIds);
            const missing = REQUIRED_HISTORY_INDICATORS.find((id) => !have.has(id));
            if (missing !== undefined) message = `lacks the indicator ${missing}`;
          }
          break;
        }
        case 'policy-track.json':
          message = firstError(validatePolicyTrackFile(f.json, ctx));
          break;
        case 'events.json':
          message = checkEventsFile(f.json);
          break;
        case 'params.json':
          message = firstError(validateParamsFile(f.json, ctx));
          break;
        case 'commute-matrix.json':
          message = firstError(validateCommuteMatrix(f.json, ctx));
          break;
      }
    } catch (e) {
      message = `could not be checked: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (message !== undefined) problems.set(name, message);
  }

  if (problems.size === 0) {
    const expected = ctx.districtCodes;
    const history = jsonOf('history.json') as HistoryFile;
    for (const ind of history.indicators) {
      if (ind.level !== 'district') continue;
      const m = firstCodeMismatch(expected, Object.keys(ind.series) as DistrictCode[]);
      if (m !== undefined) {
        problems.set('history.json', `indicator ${ind.id}: ${m}`);
        break;
      }
    }
    const commute = jsonOf('commute-matrix.json') as { codes: readonly string[] };
    const m = firstCodeMismatch(expected, commute.codes);
    if (m !== undefined) problems.set('commute-matrix.json', m);
  }

  if (problems.size > 0) {
    const failures: LoadFailure[] = [];
    for (const name of DATA_FILE_NAMES) {
      const message = problems.get(name);
      if (message !== undefined) failures.push({ file: name, message });
    }
    return { ok: false, failures };
  }

  try {
    const files: LoadedFiles = {
      districts: jsonOf('districts.json'),
      history: jsonOf('history.json'),
      policyTrack: jsonOf('policy-track.json'),
      events: jsonOf('events.json'),
      params: jsonOf('params.json'),
      commute: jsonOf('commute-matrix.json'),
    } as LoadedFiles;
    return { ok: true, data: convert(files) };
  } catch (e) {
    return {
      ok: false,
      failures: [{ file: 'params.json', message: `could not be converted: ${e instanceof Error ? e.message : String(e)}` }],
    };
  }
}
