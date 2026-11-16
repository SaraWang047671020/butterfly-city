import { describe, expect, it } from 'vitest';
import {
  BannedTermError,
  DataError,
  MissingInputsError,
  ParseError,
  PipelineError,
  ValidationFailedError,
  WriteError,
} from '../../../scripts/pipeline/errors.ts';

describe('pipeline errors', () => {
  it('all classes extend PipelineError and Error, and carry their own name', () => {
    const all = [
      new ParseError('f', 1, ['a'], ['b']),
      new DataError('rule', 'subject'),
      new MissingInputsError([{ path: 'p', downloadId: 'x' }]),
      new ValidationFailedError([]),
      new BannedTermError([]),
      new WriteError('f', 'r'),
    ];
    for (const e of all) {
      expect(e).toBeInstanceOf(PipelineError);
      expect(e).toBeInstanceOf(Error);
    }
    expect(all.map((e) => e.name)).toEqual([
      'ParseError', 'DataError', 'MissingInputsError', 'ValidationFailedError', 'BannedTermError', 'WriteError',
    ]);
  });

  it('ParseError reports file, row, expected and found columns', () => {
    const e = new ParseError('data/raw/a.zip!b.csv', 7, ['x', 'y'], ['x', 'z']);
    expect(e.message).toBe('data/raw/a.zip!b.csv row 7: unexpected content');
    expect(e.details).toEqual(['expected columns: x, y', 'found columns: x, z']);
    expect(e.row).toBe(7);
  });

  it('ParseError without a row omits it from the message', () => {
    expect(new ParseError('f.csv', undefined, [], [], 'empty file').message).toBe('f.csv: empty file');
  });

  it('MissingInputsError lists one line per file with the download command', () => {
    const e = new MissingInputsError([
      { path: 'data/raw/a.csv', downloadId: 'income' },
      { path: 'data/config/t.csv' },
    ]);
    expect(e.message).toBe('2 required input files are missing');
    expect(e.details[0]).toBe('data/raw/a.csv: node scripts/download.ts income');
    expect(e.details[1]).toContain('data/config/t.csv');
    expect(e.details[1]).not.toContain('download.ts');
  });

  it('ValidationFailedError formats each issue as file path: rule: message', () => {
    const e = new ValidationFailedError([{ file: 'history.json', path: '$.a', rule: 'type', message: 'bad' }]);
    expect(e.details).toEqual(['history.json $.a: type: bad']);
  });

  it('BannedTermError lists term and line', () => {
    const e = new BannedTermError([{ term: 'foo', line: 3 }]);
    expect(e.details).toEqual(['line 3: "foo"']);
  });

  it('DataError and WriteError keep their subject and file', () => {
    expect(new DataError('population is zero', '63000010 2015Q1').subject).toBe('63000010 2015Q1');
    expect(new WriteError('public/data/history.json', 'EBUSY').message).toBe(
      'could not write public/data/history.json: EBUSY',
    );
  });
});
