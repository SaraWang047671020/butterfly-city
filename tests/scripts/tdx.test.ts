import { describe, expect, it } from 'vitest';
import { TDX_CREDENTIALS_MESSAGE, readTdxCredentials, redact, requireTdxCredentials } from '../../scripts/lib/tdx.ts';
import { fareRequests, fares, timetableRequests, timetables } from '../../scripts/sources/tdx-rail.ts';

describe('TDX credentials', () => {
  it('rejects absent or blank variables with one message naming both', () => {
    for (const env of [{}, { TDX_CLIENT_ID: 'a' }, { TDX_CLIENT_ID: 'a', TDX_CLIENT_SECRET: '  ' }]) {
      expect(readTdxCredentials(env)).toBeUndefined();
      expect(() => requireTdxCredentials(env)).toThrow(TDX_CREDENTIALS_MESSAGE);
    }
    expect(TDX_CREDENTIALS_MESSAGE).toContain('TDX_CLIENT_ID');
    expect(TDX_CREDENTIALS_MESSAGE).toContain('TDX_CLIENT_SECRET');
  });

  it('fares and timetables fail before any network call and write no file', async () => {
    const saved = { id: process.env['TDX_CLIENT_ID'], secret: process.env['TDX_CLIENT_SECRET'] };
    delete process.env['TDX_CLIENT_ID'];
    delete process.env['TDX_CLIENT_SECRET'];
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      throw new Error('network used');
    }) as typeof fetch;
    try {
      for (const s of [fares, timetables]) {
        await expect(s.download({ force: true, flags: {} })).rejects.toThrow(TDX_CREDENTIALS_MESSAGE);
      }
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      if (saved.id !== undefined) process.env['TDX_CLIENT_ID'] = saved.id;
      if (saved.secret !== undefined) process.env['TDX_CLIENT_SECRET'] = saved.secret;
    }
  });
});

describe('redact', () => {
  it('removes secrets, bearer values, access_token and Authorization values', () => {
    const text = 'id=ID123 secret=SEC456 Authorization: Bearer tok.en-1 {"access_token":"tok.en-1"} access_token=zzz';
    const out = redact(text, ['ID123', 'SEC456', 'tok.en-1']);
    for (const s of ['ID123', 'SEC456', 'tok.en-1', 'zzz']) expect(out).not.toContain(s);
  });
});

describe('request tables', () => {
  it('cover the four operators with fixed file names', () => {
    expect(fareRequests().map((r) => r.dest.join('/'))).toEqual([
      'fares/tdx-metro-od-fare-TRTC.json',
      'fares/tdx-metro-od-fare-NTMC.json',
      'fares/tdx-metro-od-fare-NTDLRT.json',
      'fares/tdx-metro-od-fare-NTALRT.json',
    ]);
    expect(timetableRequests()).toHaveLength(6);
  });
});
