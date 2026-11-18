// Demo_Script inputs (game-ui task 10.6, Requirements 14.5, 14.19).
// Reads the 6 files of `public/data/` and `data/config/demo-adjustments.json` with Node `fs`.
// Validation is the Data_Loader's own: the files go through `loadDataFiles` over a disk-backed fetch port.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDataFiles } from '../../src/data/loader.ts';
import type { FetchPort, TimerPort } from '../../src/data/loader.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import type { DemoConfig, DemoInputs } from './run-demo.ts';

export const PARAMS_REQUIRED_MESSAGE = 'The real public/data/params.json is required.';

export type InputsResult =
  | { readonly ok: true; readonly inputs: DemoInputs }
  | { readonly ok: false; readonly message: string; readonly details: readonly string[] };

const timer: TimerPort = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Serves `<base>data/<name>` from `<root>/public/data/<name>`; a missing file is HTTP 404. */
function diskFetch(root: string): FetchPort {
  return (url) => {
    const name = url.slice(url.lastIndexOf('/') + 1);
    try {
      const body = readFileSync(join(root, 'public', 'data', name), 'utf8');
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
    } catch {
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    }
  };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Structural check of demo-adjustments.json; list contents are checked by `checkDemoLists` and `runDemo`. */
function parseConfig(text: string): DemoConfig | string {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return `not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!isObj(json)) return '$: expected an object';
  if (json['schemaVersion'] !== 1) return '$.schemaVersion: expected 1';
  if (typeof json['status'] !== 'string') return '$.status: expected a string';
  for (const key of ['ghostThreshold', 'rentBurdenThreshold'] as const) {
    const v = json[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `$.${key}: expected a finite number of at least 0`;
  }
  for (const key of ['base', 'enlarged'] as const) {
    const list = json[key];
    if (!Array.isArray(list)) return `$.${key}: expected an array`;
    for (let i = 0; i < list.length; i += 1) {
      if (!isObj(list[i] as unknown)) return `$.${key}[${i}]: expected an object`;
    }
  }
  return json as unknown as DemoConfig;
}

/** Reads and validates every input under `root` (the repository root). Never throws. */
export async function readDemoInputs(root: string): Promise<InputsResult> {
  const loaded = await loadDataFiles(diskFetch(root), '/', () => undefined, timer);
  if (!loaded.ok) {
    const details = loaded.failures.map((f) => `${f.file}: ${f.message}`);
    const paramsBad = loaded.failures.some((f) => f.file === 'params.json');
    return { ok: false, message: paramsBad ? PARAMS_REQUIRED_MESSAGE : 'A data file in public/data/ is missing or invalid.', details };
  }
  let text: string;
  try {
    text = readFileSync(join(root, 'data', 'config', 'demo-adjustments.json'), 'utf8');
  } catch (e) {
    return { ok: false, message: 'data/config/demo-adjustments.json could not be read.', details: [e instanceof Error ? e.message : String(e)] };
  }
  const config = parseConfig(text);
  if (typeof config === 'string') {
    return { ok: false, message: 'data/config/demo-adjustments.json is invalid.', details: [config] };
  }
  return { ok: true, inputs: { data: loaded.data, registry: RULE_REGISTRY, config } };
}
