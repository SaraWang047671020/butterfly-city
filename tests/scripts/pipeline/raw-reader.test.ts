import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createContext, memoryLogger } from '../../../scripts/pipeline/context.ts';
import { FsRawReader, MemoryRawReader, type RawReader } from '../../../scripts/pipeline/raw-reader.ts';

// Big5 bytes for the two characters U+4E2D U+6587 (0xA4 0xA4 0xA4 0xE5).
const BIG5_BYTES = Uint8Array.from([0xa4, 0xa4, 0xa4, 0xe5]);
const BIG5_TEXT = '\u4e2d\u6587';
const BOM_TEXT = '\u540d\u7a31,\u503c';

const FILES: Record<string, string | Uint8Array> = {
  'd/b.csv': 'b',
  'd/a.csv': 'a',
  'd/\u{1F600}.csv': 'emoji', // astral code point: after U+FF21 by code point, before it by UTF-16 unit
  'd/\uff21.csv': 'wide',
  'd/sub/x.csv': 'x',
  'bom.csv': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(BOM_TEXT, 'utf8')]),
  'big5.csv': BIG5_BYTES,
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-reader-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
for (const [rel, content] of Object.entries(FILES)) {
  const abs = path.join(tmp, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const readers: Array<[string, RawReader]> = [
  ['FsRawReader', new FsRawReader(tmp)],
  ['MemoryRawReader', new MemoryRawReader(FILES)],
];

describe.each(readers)('%s', (_name, reader) => {
  it('lists entries sorted by code point', () => {
    expect(reader.list('d')).toEqual(['a.csv', 'b.csv', 'sub', '\uff21.csv', '\u{1F600}.csv']);
  });

  it('returns an empty listing for a missing directory', () => {
    expect(reader.list('nope')).toEqual([]);
  });

  it('exists is true for files and directories, false otherwise', () => {
    expect(reader.exists('d/a.csv')).toBe(true);
    expect(reader.exists('d')).toBe(true);
    expect(reader.exists('d/zzz.csv')).toBe(false);
  });

  it('reads bytes and UTF-8 text, stripping a BOM', () => {
    expect(reader.readBytes('d/a.csv').toString()).toBe('a');
    expect(reader.readText('bom.csv')).toBe(BOM_TEXT);
  });

  it('decodes Big5', () => {
    expect(reader.readText('big5.csv', 'big5')).toBe(BIG5_TEXT);
  });

  it('throws for a missing file and for paths that leave data/raw', () => {
    expect(() => reader.readBytes('missing.csv')).toThrow();
    expect(() => reader.readBytes('../secret')).toThrow(/escapes/);
  });

  it('displays repository-relative paths with forward slashes and zip entries', () => {
    expect(reader.display('lvr/a.csv')).toBe('data/raw/lvr/a.csv');
    expect(reader.display('lvr\\a.csv')).toBe('data/raw/lvr/a.csv');
    expect(reader.display('boundaries/t.zip', 'T.dbf')).toBe('data/raw/boundaries/t.zip!T.dbf');
  });
});

describe('createContext', () => {
  it('holds 41 districts, 44 quarters and the given reader and logger', () => {
    const reader = new MemoryRawReader();
    const logger = memoryLogger();
    const ctx = createContext({ reader, logger });
    expect(ctx.districts).toHaveLength(41);
    expect(ctx.quarters).toHaveLength(44);
    expect(ctx.quarters[0]).toBe('2015Q1');
    expect(ctx.quarters[43]).toBe('2025Q4');
    expect(ctx.reader).toBe(reader);
    ctx.logger.info('hello');
    expect(logger.lines).toEqual(['hello']);
  });
});
