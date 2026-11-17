import { describe, expect, it } from 'vitest';
import { readRawTextFiles, readTdxSecrets, scanForCredentials } from '../../../scripts/pipeline/credentials-scan.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';

const SECRET = 'sEcr3t-Value-42';

describe('scanForCredentials', () => {
  it('reports a secret value with its file and 1-based line', () => {
    const f = scanForCredentials([{ path: 'a.json', text: `ok\nline ${SECRET} here\nok` }], [SECRET]);
    expect(f).toEqual([{ path: 'a.json', line: 2, kind: 'secret' }]);
  });

  it('reports an access_token key', () => {
    const f = scanForCredentials([{ path: 'b.json', text: '{\n  "access_token": "abc"\n}' }], []);
    expect(f).toEqual([{ path: 'b.json', line: 2, kind: 'access_token' }]);
  });

  it('reports an Authorization header value but not an empty one', () => {
    const f = scanForCredentials(
      [{ path: 'c.txt', text: 'Authorization: Bearer xyz\n"Authorization": ""' }],
      [],
    );
    expect(f).toEqual([{ path: 'c.txt', line: 1, kind: 'authorization' }]);
  });

  it('never includes the matched text in a finding', () => {
    const f = scanForCredentials([{ path: 'a.json', text: SECRET }], [SECRET]);
    expect(JSON.stringify(f)).not.toContain(SECRET);
  });

  it('gives no finding for a clean file or an empty secret', () => {
    expect(scanForCredentials([{ path: 'd.json', text: '{ "a": 1 }\n' }], [''])).toEqual([]);
  });
});

describe('readTdxSecrets and readRawTextFiles', () => {
  it('skips unset and blank variables', () => {
    expect(readTdxSecrets({ TDX_CLIENT_ID: ' ', TDX_CLIENT_SECRET: 'x' })).toEqual(['x']);
  });

  it('reads nested text files and skips absent directories', () => {
    const reader = new MemoryRawReader({ 'fares/a/b.json': '{}', 'fares/c.bin': 'x', 'other/z.json': '{}' });
    expect(readRawTextFiles(reader).map((f) => f.path)).toEqual(['data/raw/fares/a/b.json']);
  });
});
