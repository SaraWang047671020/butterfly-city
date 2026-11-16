import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createContext, memoryLogger } from '../../../scripts/pipeline/context.ts';
import { DataError, MissingInputsError } from '../../../scripts/pipeline/errors.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import {
  DEFAULT_STEPS,
  deleteStaleTempFiles,
  formatSummaryLine,
  runPipeline,
  type Step,
} from '../../../scripts/pipeline/run.ts';

function setup(steps: readonly Step[]) {
  const logger = memoryLogger();
  const ctx = createContext({ reader: new MemoryRawReader(), logger });
  const calls: string[] = [];
  const code = runPipeline({ steps, ctx, logger, cleanStale: () => void calls.push('clean') });
  return { logger, code, calls };
}

describe('runPipeline', () => {
  it('cleans stale files first, runs steps in order, prints summaries and notes, returns 0', () => {
    const order: string[] = [];
    const steps: Step[] = [
      { name: 'a', run: (_c, s) => { order.push('a'); s.summaries.push({ id: 'population', values: 44, estimated: 3 }); } },
      { name: 'b', run: (_c, s) => { order.push('b'); s.notes.push('note one'); } },
    ];
    const { logger, code, calls } = setup(steps);
    expect(code).toBe(0);
    expect(calls).toEqual(['clean']);
    expect(order).toEqual(['a', 'b']);
    expect(logger.lines).toEqual(['population: 44 values, 3 estimated', 'note one']);
  });

  it('stops at the first PipelineError, prints message and details, returns 1', () => {
    const ran: string[] = [];
    const steps: Step[] = [
      { name: 'one', run: () => void ran.push('one') },
      { name: 'two', run: () => { throw new DataError('rule', 'subject', ['detail A', 'detail B']); } },
      { name: 'three', run: () => void ran.push('three') },
    ];
    const { logger, code } = setup(steps);
    expect(code).toBe(1);
    expect(ran).toEqual(['one']);
    expect(logger.lines).toEqual(['warning: step two failed: rule: subject', 'warning:   detail A', 'warning:   detail B']);
  });

  it('prints the stack of an unexpected error and returns 1', () => {
    const { logger, code } = setup([{ name: 'boom', run: () => { throw new TypeError('bad thing'); } }]);
    expect(code).toBe(1);
    expect(logger.lines[0]).toBe('warning: step boom failed: bad thing');
    expect(logger.lines[1]).toContain('TypeError: bad thing');
    expect(logger.lines[1]).toContain('at ');
  });

  it('prints no summary lines when a step fails', () => {
    const steps: Step[] = [
      { name: 'a', run: (_c, s) => void s.summaries.push({ id: 'x', values: 1, estimated: 0 }) },
      { name: 'b', run: () => { throw new Error('nope'); } },
    ];
    const { logger } = setup(steps);
    expect(logger.lines.some((l) => l.includes('values'))).toBe(false);
  });

  it('reports a failing clean-up as a failed step', () => {
    const logger = memoryLogger();
    const ctx = createContext({ reader: new MemoryRawReader(), logger });
    const code = runPipeline({ steps: [], ctx, logger, cleanStale: () => { throw new Error('locked'); } });
    expect(code).toBe(1);
    expect(logger.lines[0]).toBe('warning: step clean-stale-temp-files failed: locked');
  });

  it('default list wires every step in build-flow order; preflight lists every missing input', () => {
    expect(DEFAULT_STEPS.map((s) => s.name)).toEqual([
      'preflight', 'districts', 'population', 'migration', 'income', 'sale-price', 'price-to-income', 'rent',
      'mrt', 'social-housing', 'policy-track', 'history-file', 'policy-file', 'validate', 'sources-doc', 'banned-terms', 'write',
    ]);
    const ctx = createContext({ reader: new MemoryRawReader(), logger: memoryLogger() });
    expect(() => DEFAULT_STEPS[0]!.run(ctx, { summaries: [], notes: [] })).toThrow(MissingInputsError);
  });
});

describe('formatSummaryLine', () => {
  it('formats id, value count and estimated count', () => {
    expect(formatSummaryLine({ id: 'rentMedian', values: 1804, estimated: 12 })).toBe(
      'rentMedian: 1804 values, 12 estimated',
    );
  });
});

describe('deleteStaleTempFiles', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-stale-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('deletes only *.pipeline-tmp files and ignores missing directories', () => {
    fs.writeFileSync(path.join(tmp, 'history.json.pipeline-tmp'), 'x');
    fs.writeFileSync(path.join(tmp, 'history.json'), 'keep');
    const deleted = deleteStaleTempFiles([tmp, path.join(tmp, 'absent')]);
    expect(deleted.map((p) => path.basename(p))).toEqual(['history.json.pipeline-tmp']);
    expect(fs.readdirSync(tmp)).toEqual(['history.json']);
  });
});
