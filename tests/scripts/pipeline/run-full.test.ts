import { describe, expect, it } from 'vitest';
import { createContext, memoryLogger } from '../../../scripts/pipeline/context.ts';
import { summarizeHistory } from '../../../scripts/pipeline/history-file.ts';
import { summarizePolicyTrack } from '../../../scripts/pipeline/policy-file.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { createDefaultSteps, runPipeline, type Step } from '../../../scripts/pipeline/run.ts';
import fs from 'node:fs';
import { FIXED_TYPE1_IDS, FIXED_TYPE3_IDS } from '../../../scripts/pipeline/params/fixed-table.ts';
import { MIGRATION_EXIT_SHARE_ID, MIGRATION_SHARE_ID, MIGRATION_THRESHOLD_ID } from '../../../scripts/pipeline/params/migration-anchors.ts';
import { COST_SCHEDULE_ID, SHARE_BOTH_ID } from '../../../scripts/pipeline/params/derived.ts';
import { serializeJson } from '../../../scripts/pipeline/serialize.ts';
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import type { CommuteMatrixFile, DistrictsFile, HistoryFile, ParamsFile, PolicyTrackFile } from '../../../src/types/data-files.ts';
import { DISTRICT_CODES, validContext, validDistrictsFile, validHistoryFile, validPolicyTrackFile } from '../../data/helpers.ts';
import { FakeWriteFs } from './helpers-write.ts';

const NAMES = [
  'preflight', 'census-check', 'districts', 'population', 'migration', 'income', 'sale-price', 'price-to-income', 'rent',
  'mrt', 'social-housing', 'policy-track', 'low-use', 'history-file', 'policy-file', 'network', 'fare-slope', 'commute-matrix', 'params-part1', 'params', 'validate', 'sources-doc', 'banned-terms', 'write',
];

/** Text of the written file whose path ends with the given name. */
function written(fake: FakeWriteFs, name: string): string | undefined {
  const file = [...fake.files.keys()].find((k) => k.split('\\').join('/').endsWith('/public/data/' + name));
  return file === undefined ? undefined : fake.text(file);
}

function allCalls(fake: FakeWriteFs): number {
  return Object.values(fake.calls).reduce((a, b) => a + b, 0);
}

/** A stub that fills the three files in the state, then the real validate and write steps follow. */
function validCommuteFile(): CommuteMatrixFile {
  const codes = [...DISTRICT_CODES].sort();
  return { codes, minutes: codes.map((_, i) => codes.map((__, j) => (i === j ? 0 : 10))) };
}

/** The real params.json shape with the job shares re-keyed to the fixture district codes. */
function validParams(): { file: ParamsFile; sourceTypes: Map<string, 1 | 2 | 3> } {
  const real = JSON.parse(fs.readFileSync('public/data/params.json', 'utf8')) as ParamsFile;
  const parameters: Record<string, unknown> = {};
  let template: ScalarParameter | undefined;
  for (const [id, e] of Object.entries(real.parameters)) {
    if (id.startsWith('commute.jobShare.')) template ??= e as ScalarParameter;
    else parameters[id] = e;
  }
  for (const code of DISTRICT_CODES) parameters[`commute.jobShare.${code}`] = { ...template, value: 1 / DISTRICT_CODES.length };
  const sorted = Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const type3 = new Set([...FIXED_TYPE3_IDS, MIGRATION_EXIT_SHARE_ID, MIGRATION_SHARE_ID, MIGRATION_THRESHOLD_ID, SHARE_BOTH_ID, COST_SCHEDULE_ID]);
  const sourceTypes = new Map<string, 1 | 2 | 3>();
  for (const id of Object.keys(sorted)) sourceTypes.set(id, FIXED_TYPE1_IDS.includes(id) ? 1 : type3.has(id) ? 3 : 2);
  return { file: { schemaVersion: 1, parameters: sorted } as ParamsFile, sourceTypes };
}

function setup(files: { districts: unknown; history: unknown; policy: unknown; commute?: unknown }, extra: Step[] = []) {
  const fake = new FakeWriteFs();
  const params = validParams();
  const all = createDefaultSteps({
    writeFs: fake,
    validationContext: { ...validContext(), engineIdSet: Object.keys(params.file.parameters), sourceTypes: Object.fromEntries(params.sourceTypes) },
  });
  const fill: Step = {
    name: 'fill',
    run(_ctx, state) {
      state.districtsFile = files.districts as DistrictsFile;
      state.historyFile = files.history as HistoryFile;
      state.policyTrackFile = files.policy as PolicyTrackFile;
      state.commuteMatrix = (files.commute ?? validCommuteFile()) as CommuteMatrixFile;
      state.params = params;
      state.summaries.push(...summarizeHistory(state.historyFile), ...summarizePolicyTrack(state.policyTrackFile));
      state.notes.push('note A', 'note B', 'note A');
    },
  };
  const logger = memoryLogger();
  const ctx = createContext({ reader: new MemoryRawReader(), logger });
  const steps = [fill, ...extra, ...all.slice(-4)];
  const code = runPipeline({ steps, ctx, logger, cleanStale: () => {} });
  return { fake, logger, code };
}

describe('default steps', () => {
  it('lists the steps in build-flow order', () => {
    expect(createDefaultSteps().map((s) => s.name)).toEqual(NAMES);
  });

  it('stops at a failing step, prints its name and runs no later step', () => {
    const fake = new FakeWriteFs();
    const all = createDefaultSteps({ writeFs: fake });
    const ran: string[] = [];
    const steps = all.map((s): Step => (s.name === 'income'
      ? { name: 'income', run: () => { throw new Error('income broke'); } }
      : { name: s.name, run: () => void ran.push(s.name) }));
    const logger = memoryLogger();
    const ctx = createContext({ reader: new MemoryRawReader(), logger });
    expect(runPipeline({ steps, ctx, logger, cleanStale: () => {} })).toBe(1);
    expect(ran).toEqual(['preflight', 'census-check', 'districts', 'population', 'migration']);
    expect(logger.lines[0]).toBe('warning: step income failed: income broke');
    expect(allCalls(fake)).toBe(0);
  });
});

describe('validate and write', () => {
  it('prints one summary line per indicator and policy series, then the notes once, and writes the four files', () => {
    const districts = validDistrictsFile();
    const history = validHistoryFile();
    const policy = validPolicyTrackFile();
    const { fake, logger, code } = setup({ districts, history, policy });
    expect(code).toBe(0);
    expect(logger.lines.slice(0, 3)).toEqual([
      'population: 1804 values, 0 estimated',
      'rent: 1804 values, 0 estimated',
      'priceToIncomeRatio: 88 values, 0 estimated',
    ]);
    expect(logger.lines).toContain('socialHousingUnitsStarted: 1804 values, 0 estimated');
    expect(logger.lines).toContain('commuterPassesSold: 88 values, 0 estimated');
    expect(logger.lines.slice(-2)).toEqual(['note A', 'note B']);
    expect(logger.lines.length).toBe(3 + 10 + 3 + 2);
    expect(written(fake, 'commute-matrix.json')).toBe(serializeJson(validCommuteFile()));
    expect(written(fake, 'districts.json')).toBe(serializeJson(districts));
    expect(written(fake, 'history.json')).toBe(serializeJson(history));
    expect(written(fake, 'policy-track.json')).toBe(serializeJson(policy));
    expect(fake.tempFiles()).toEqual([]);
  });

  it('collects the errors of every file, names the step and never calls the WriteFs', () => {
    const history = validHistoryFile();
    history.schemaVersion = 99;
    const policy = validPolicyTrackFile();
    policy.schemaVersion = 99;
    const { fake, logger, code } = setup({ districts: validDistrictsFile(), history, policy });
    expect(code).toBe(1);
    expect(logger.lines[0]).toMatch(/^warning: step validate failed: validation failed with \d+ errors?$/);
    const detail = logger.lines.join('\n');
    expect(detail).toContain('history.json $');
    expect(detail).toContain('policy-track.json $');
    expect(allCalls(fake)).toBe(0);
  });
});
