import { describe, expect, it } from 'vitest';
import { createContext, memoryLogger } from '../../../scripts/pipeline/context.ts';
import { summarizeHistory } from '../../../scripts/pipeline/history-file.ts';
import { summarizePolicyTrack } from '../../../scripts/pipeline/policy-file.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { createDefaultSteps, runPipeline, type Step } from '../../../scripts/pipeline/run.ts';
import { serializeJson } from '../../../scripts/pipeline/serialize.ts';
import type { DistrictsFile, HistoryFile, PolicyTrackFile } from '../../../src/types/data-files.ts';
import { validContext, validDistrictsFile, validHistoryFile, validPolicyTrackFile } from '../../data/helpers.ts';
import { FakeWriteFs } from './helpers-write.ts';

const NAMES = [
  'preflight', 'districts', 'population', 'migration', 'income', 'sale-price', 'price-to-income', 'rent',
  'mrt', 'social-housing', 'policy-track', 'history-file', 'policy-file', 'validate', 'sources-doc', 'banned-terms', 'write',
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
function setup(files: { districts: unknown; history: unknown; policy: unknown }, extra: Step[] = []) {
  const fake = new FakeWriteFs();
  const all = createDefaultSteps({ writeFs: fake, validationContext: validContext() });
  const fill: Step = {
    name: 'fill',
    run(_ctx, state) {
      state.districtsFile = files.districts as DistrictsFile;
      state.historyFile = files.history as HistoryFile;
      state.policyTrackFile = files.policy as PolicyTrackFile;
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
    expect(ran).toEqual(['preflight', 'districts', 'population', 'migration']);
    expect(logger.lines[0]).toBe('warning: step income failed: income broke');
    expect(allCalls(fake)).toBe(0);
  });
});

describe('validate and write', () => {
  it('prints one summary line per indicator and policy series, then the notes once, and writes the three files', () => {
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
    expect(logger.lines.length).toBe(3 + 10 + 2);
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
