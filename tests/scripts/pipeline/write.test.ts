import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WriteError } from '../../../scripts/pipeline/errors.ts';
import { createState } from '../../../scripts/pipeline/run.ts';
import { planWrites, writeAll, writeStep, type PlannedWrite } from '../../../scripts/pipeline/write.ts';
import { FakeWriteFs } from './helpers-write.ts';

const D = path.resolve('/virtual/out');
const P = (name: string): string => path.join(D, name);
const writes: PlannedWrite[] = [
  { path: P('districts.json'), text: 'new-districts\n' },
  { path: P('history.json'), text: 'new-history ?n' },
  { path: P('policy-track.json'), text: 'new-policy\n' },
  { path: P('commute-matrix.json'), text: 'new-commute\n' },
  { path: P('SOURCES.md'), text: 'new-sources\r\n' },
];
const old = { [P('districts.json')]: 'old-d', [P('policy-track.json')]: 'old-p' };

describe('writeAll', () => {
  it('writes every text exactly and leaves no temp file', () => {
    const fake = new FakeWriteFs(old);
    writeAll(writes, fake);
    for (const w of writes) expect(fake.text(w.path)).toBe(w.text);
    expect(fake.tempFiles()).toEqual([]);
    const bytes = fake.files.get(P('history.json')) as Uint8Array;
    expect(bytes[0]).not.toBe(0xef);
    expect(fake.text(P('SOURCES.md'))).toContain('\r\n');
  });

  it('restores everything when staging the 2nd file fails', () => {
    const fake = new FakeWriteFs(old, [{ op: 'writeFile', nth: 2 }]);
    expect(() => writeAll(writes, fake)).toThrow(WriteError);
    expect(fake.text(P('districts.json'))).toBe('old-d');
    expect(fake.text(P('policy-track.json'))).toBe('old-p');
    expect(fake.files.has(P('history.json'))).toBe(false);
    expect(fake.tempFiles()).toEqual([]);
  });

  it('restores and removes new files when the 3rd commit fails, naming that file', () => {
    const fake = new FakeWriteFs(old, [{ op: 'rename', nth: 3 }]);
    let caught: unknown;
    try {
      writeAll(writes, fake);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WriteError);
    expect((caught as WriteError).file).toContain('policy-track.json');
    expect(fake.text(P('districts.json'))).toBe('old-d');
    expect(fake.text(P('policy-track.json'))).toBe('old-p');
    expect(fake.files.has(P('history.json'))).toBe(false);
    expect(fake.files.has(P('SOURCES.md'))).toBe(false);
    expect(fake.tempFiles()).toEqual([]);
  });

  it('still reports the failure when rollback itself fails', () => {
    const fake = new FakeWriteFs(old, [
      { op: 'rename', nth: 3 },
      { op: 'writeFile', nth: 5, afterFirstFailure: true },
      { op: 'remove', nth: 1, afterFirstFailure: true },
    ]);
    // First rollback remove/write calls fail; the error is still a WriteError for the commit failure.
    let caught: unknown;
    try {
      writeAll(writes, fake);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WriteError);
    expect((caught as WriteError).message).toContain('rollback of');
    expect((caught as WriteError).message).toContain('policy-track.json');
  });
});

describe('writeStep', () => {
  it('requires the four JSON files and plans five writes in order', () => {
    const state = createState();
    expect(() => planWrites(state)).toThrow(/districts/);
    state.districtsFile = { a: 1 } as never;
    state.historyFile = { b: 2 } as never;
    state.policyTrackFile = { c: 3 } as never;
    expect(() => planWrites(state)).toThrow(/commute-matrix/);
    state.commuteMatrix = { d: 4 } as never;
    expect(planWrites(state).map((w) => path.basename(w.path))).toEqual([
      'districts.json',
      'history.json',
      'policy-track.json',
      'commute-matrix.json',
    ]);
    state.sourcesDoc = '# S\n';
    const planned = planWrites(state);
    expect(planned.map((w) => path.basename(w.path))).toEqual([
      'districts.json',
      'history.json',
      'policy-track.json',
      'commute-matrix.json',
      'SOURCES.md',
    ]);
    const fake = new FakeWriteFs();
    writeStep(fake).run({} as never, state);
    expect(fake.text(planned[4]?.path as string)).toBe('# S\n');
  });
});
