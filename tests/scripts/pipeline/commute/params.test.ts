import { describe, expect, it } from 'vitest';
import { COMMUTE_PARAM_IDS, readCommuteParams } from '../../../../scripts/pipeline/commute/params.ts';
import { PipelineError } from '../../../../scripts/pipeline/errors.ts';

const cite = { citation: 'Study (2020)', url: 'https://example.org/a' };
const good = { kind: 'scalar', value: 1, unit: 'ratio', source: cite, status: 'verified' };

function file(over: Record<string, unknown> = {}, drop: string[] = []): () => string {
  const parameters: Record<string, unknown> = {};
  for (const id of COMMUTE_PARAM_IDS) parameters[id] = good;
  Object.assign(parameters, over);
  for (const id of drop) delete parameters[id];
  return () => JSON.stringify({ schemaVersion: 1, parameters });
}

function failure(reader: () => string): PipelineError {
  try {
    readCommuteParams(reader);
  } catch (e) {
    return e as PipelineError;
  }
  throw new Error('expected a failure');
}

describe('readCommuteParams', () => {
  it('reads all eight entries', () => {
    expect(Object.keys(readCommuteParams(file()))).toHaveLength(8);
  });

  it('names an absent id', () => {
    expect(failure(file({}, ['commute.walkSpeed'])).details.join()).toContain('commute.walkSpeed: missing');
  });

  it('names an id with a null value, an empty unit, or no source on a non-gap entry', () => {
    const d = failure(
      file({
        'commute.accessTime': { ...good, value: null },
        'commute.transferWait': { ...good, unit: '' },
        'commute.transferWalk': { ...good, source: { citation: '', url: '' } },
      }),
    ).details.join('\n');
    expect(d).toContain('commute.accessTime: non-finite');
    expect(d).toContain('commute.transferWait: unit-empty');
    expect(d).toContain('commute.transferWalk: source-empty');
  });

  it('does not block a gap entry with an assumption and no source', () => {
    const gap = { ...good, source: { citation: '', url: '' }, status: 'gap', estimated: { method: 'm' }, assumption: 'a' };
    expect(readCommuteParams(file({ 'commute.tripsPerMonth': gap }))['commute.tripsPerMonth']).toBeDefined();
  });
});
