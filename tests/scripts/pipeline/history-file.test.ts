import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { quartersBetween } from '../../../scripts/lib/time.ts';
import { createContext, memoryLogger } from '../../../scripts/pipeline/context.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { buildHistoryFile, historyFileStep, type HistoryInput } from '../../../scripts/pipeline/history-file.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { INDICATOR_SPECS } from '../../../scripts/pipeline/registry/indicators.ts';
import { METHOD_REGISTRY } from '../../../scripts/pipeline/registry/methods.ts';
import { SOURCE_REGISTRY } from '../../../scripts/pipeline/registry/sources.ts';
import { createState } from '../../../scripts/pipeline/run.ts';
import type { ValueRecord } from '../../../src/types/data-files.ts';
import { validateHistoryFile } from '../../../src/data/validate.ts';
import { POLICY_SERIES_IDS } from '../../data/helpers.ts';

const quarters = quartersBetween();
const RAW = 1234.56789;

function records(estimatedFrom = 99): ValueRecord[] {
  return quarters.map((_, i) =>
    i >= estimatedFrom
      ? { value: RAW, estimated: true, method: 'interp-annual-quarterly' }
      : { value: RAW, estimated: false },
  );
}

function fixture(estimatedFrom = 99): Record<string, Record<string, ValueRecord[]>> {
  const out: Record<string, Record<string, ValueRecord[]>> = {};
  for (const spec of INDICATOR_SPECS) {
    const keys = spec.level === 'district' ? DISTRICTS.map((d) => d.code) : ['Taipei', 'New Taipei'];
    out[spec.id] = Object.fromEntries(keys.map((k) => [k, records(estimatedFrom)]));
  }
  return out;
}

describe('buildHistoryFile', () => {
  const file = buildHistoryFile(fixture(40), quarters, DISTRICTS);

  it('lists the indicators in the fixed order, district first', () => {
    expect(file.indicators.map((i) => i.id)).toEqual(INDICATOR_SPECS.map((s) => s.id));
    expect(file.indicators.map((i) => i.level)).toEqual([...Array(10).fill('district'), 'city', 'city']);
    expect(file.schemaVersion).toBe(1);
    expect(file.quarters).toEqual(quarters);
  });

  it('rounds each value to the indicator decimals', () => {
    for (const ind of file.indicators) {
      const first = Object.values(ind.series)[0] as ValueRecord[];
      expect(first[0]?.value).toBe(Number(RAW.toFixed(ind.decimals)));
    }
  });

  it('is idempotent: rounding already-rounded input changes nothing', () => {
    const again = buildHistoryFile(
      Object.fromEntries(file.indicators.map((i) => [i.id, i.series as Record<string, ValueRecord[]>])),
      quarters,
      DISTRICTS,
    );
    expect(again).toEqual(file);
  });

  it('embeds referenced sources and methods in registry order, including method inputs', () => {
    const sourceIds = file.sources.map((s) => s.id);
    const registryIds = SOURCE_REGISTRY.map((s) => s.id);
    expect(sourceIds).toEqual(registryIds.filter((id) => sourceIds.includes(id)));
    for (const ind of file.indicators) for (const s of ind.sources) expect(sourceIds).toContain(s);
    expect(file.methods.map((m) => m.id)).toEqual(['interp-annual-quarterly']);
    expect(METHOD_REGISTRY.map((m) => m.id)).toContain('interp-annual-quarterly');
    for (const m of file.methods) for (const s of m.inputs) expect(sourceIds).toContain(s);
  });

  it('embeds no methods when no record is estimated', () => {
    expect(buildHistoryFile(fixture(), quarters, DISTRICTS).methods).toEqual([]);
  });

  it('validates with zero errors', () => {
    const ctx = {
      districtCodes: DISTRICTS.map((d) => d.code),
      quarters: [...quarters],
      indicatorIds: INDICATOR_SPECS.map((s) => s.id),
      policySeriesIds: [...POLICY_SERIES_IDS],
    };
    expect(validateHistoryFile(JSON.parse(JSON.stringify(file)), ctx)).toEqual([]);
  });

  it('reports every problem in one DataError', () => {
    const input: Record<string, Record<string, ValueRecord[]> | undefined> = fixture();
    input.population = undefined;
    const rent = { ...input.rent } as Record<string, ValueRecord[]>;
    delete rent[DISTRICTS[0]!.code];
    rent[DISTRICTS[1]!.code] = records().slice(0, 43);
    input.rent = rent;
    let error: unknown;
    try {
      buildHistoryFile(input as HistoryInput, quarters, DISTRICTS);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DataError);
    const details = (error as DataError).details.join('\n');
    expect(details).toContain('population: series is missing');
    expect(details).toContain(`rent: missing series for ${DISTRICTS[0]!.code}`);
    expect(details).toContain('43 records, expected 44');
  });
});

describe('historyFileStep', () => {
  const ctx = createContext({ reader: new MemoryRawReader({}), logger: memoryLogger() });

  it('sets state.historyFile and one summary per indicator', () => {
    const state = createState();
    Object.assign(state, fixture(40));
    historyFileStep().run(ctx, state);
    expect(state.historyFile?.indicators.length).toBe(12);
    expect(state.summaries.length).toBe(12);
    expect(state.summaries[0]).toEqual({ id: 'population', values: 41 * 44, estimated: 41 * 4 });
  });

  it('fails when an indicator series is missing', () => {
    expect(() => historyFileStep().run(ctx, createState())).toThrow(DataError);
  });
});
