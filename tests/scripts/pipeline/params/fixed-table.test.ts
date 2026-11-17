import { describe, expect, it } from 'vitest';
import { PipelineError } from '../../../../scripts/pipeline/errors.ts';
import { FIXED_TYPE1_IDS, readFixedType1Params } from '../../../../scripts/pipeline/params/fixed-table.ts';

const good = (): Record<string, unknown> => ({
  kind: 'scalar',
  value: 0.5,
  unit: 'ratio',
  status: 'verified',
  source: { citation: 'A study', url: 'https://example.org/a' },
});

function table(overrides: Record<string, unknown> = {}, drop: string[] = []): string {
  const parameters: Record<string, unknown> = {};
  for (const id of FIXED_TYPE1_IDS) if (!drop.includes(id)) parameters[id] = good();
  parameters['type3.other'] = { kind: 'scalar' }; // not a type 1 id: ignored
  return JSON.stringify({ schemaVersion: 1, parameters: { ...parameters, ...overrides } });
}

const read = (text: string) => () => readFixedType1Params(() => text);

describe('readFixedType1Params', () => {
  it('returns exactly the eight type 1 ids and ignores other ids', () => {
    const out = readFixedType1Params(() => table());
    expect(Object.keys(out).sort()).toEqual([...FIXED_TYPE1_IDS].sort());
    expect(out['ghost.rentThreshold']?.value).toBe(0.5);
  });

  it('names the id and rule of an empty unit', () => {
    const bad = { ...good(), unit: '  ' };
    expect(read(table({ 'ghost.rentThreshold': bad }))).toThrow(PipelineError);
    try {
      read(table({ 'ghost.rentThreshold': bad }))();
    } catch (e) {
      expect((e as PipelineError).details).toEqual(['ghost.rentThreshold: unit-empty']);
    }
  });

  it('stops on an empty citation', () => {
    const bad = { ...good(), source: { citation: '', url: 'https://example.org/a' } };
    expect(read(table({ 'rentSubsidy.lag': bad }))).toThrow(/1 invalid entry/);
  });

  it('stops on an empty url', () => {
    const bad = { ...good(), source: { citation: 'x', url: '' } };
    expect(read(table({ 'rentSubsidy.lag': bad }))).toThrow(PipelineError);
  });

  it('stops on an unknown status', () => {
    const bad = { ...good(), status: 'guess' };
    try {
      read(table({ 'commuterPass.elasticity': bad }))();
      expect.unreachable();
    } catch (e) {
      expect((e as PipelineError).details).toEqual(['commuterPass.elasticity: status-unknown']);
    }
  });

  it('stops on a range out of order', () => {
    const src = { citation: 'x', url: 'https://example.org/a' };
    const bad = { ...good(), range: { low: 0.9, high: 0.1, lowSource: src, highSource: src } };
    try {
      read(table({ 'socialHousing.rentRatio': bad }))();
      expect.unreachable();
    } catch (e) {
      expect((e as PipelineError).details).toEqual(['socialHousing.rentRatio: range-invalid']);
    }
  });

  it('stops on a missing id and on a schedule entry', () => {
    expect(read(table({}, ['rentSubsidy.nationalBudget']))).toThrow(PipelineError);
    const schedule = { kind: 'schedule', offsets: [0], shares: [1], unit: 'x', status: 'verified', source: { citation: 'x', url: 'https://example.org/a' } };
    try {
      read(table({ 'rentSubsidy.passThrough': schedule }))();
      expect.unreachable();
    } catch (e) {
      expect((e as PipelineError).details[0]).toMatch(/^rentSubsidy\.passThrough: schedule-invalid/);
    }
  });

  it('lists every failing entry', () => {
    const bad = { ...good(), unit: '' };
    try {
      read(table({ 'ghost.rentThreshold': bad, 'rentSubsidy.lag': bad }))();
      expect.unreachable();
    } catch (e) {
      expect((e as PipelineError).message).toMatch(/2 invalid entries/);
      expect((e as PipelineError).details).toHaveLength(2);
    }
  });

  it('stops on text that is not JSON or has no parameters object', () => {
    expect(read('{ nope')).toThrow(/cannot read or parse/);
    expect(read('{"schemaVersion":1}')).toThrow(/expected/);
  });
});
