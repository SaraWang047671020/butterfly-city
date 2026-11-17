import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TDX_CREDENTIALS_MESSAGE, openTdxSession, readTdxCredentials, tdxDownload } from '../../scripts/lib/tdx.ts';
import { fares, timetables } from '../../scripts/sources/tdx-rail.ts';

const ID = 'test-client-id-7f3a';
const SECRET = 'test-client-secret-9c1d';
const TOKEN = 'test-token-b8e2.payload';

type FetchFn = typeof fetch;
const realFetch = globalThis.fetch;
const saved = { id: process.env['TDX_CLIENT_ID'], secret: process.env['TDX_CLIENT_SECRET'] };
let tmp = '';
let calls: string[] = [];

function restoreEnv(): void {
  for (const [key, value] of [['TDX_CLIENT_ID', saved.id], ['TDX_CLIENT_SECRET', saved.secret]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Installs a fake fetch that records the URL of each call and answers with `handler`. */
function mockFetch(handler: (url: string) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as FetchFn;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-test-'));
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  restoreEnv();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('TDX sources without credentials', () => {
  it.each([
    ['both absent', {}],
    ['id blank', { TDX_CLIENT_ID: '   ', TDX_CLIENT_SECRET: SECRET }],
    ['secret absent', { TDX_CLIENT_ID: ID }],
  ])('%s: stops before any request, names both variables and prints no value', async (_label, env) => {
    delete process.env['TDX_CLIENT_ID'];
    delete process.env['TDX_CLIENT_SECRET'];
    Object.assign(process.env, env);
    mockFetch(() => {
      throw new Error('network used');
    });
    for (const source of [fares, timetables]) {
      const error = await source.download({ force: true, flags: {} }).then(
        () => undefined,
        (e: unknown) => e as Error,
      );
      expect(error?.message).toBe(TDX_CREDENTIALS_MESSAGE);
      expect(error?.message).toContain('TDX_CLIENT_ID');
      expect(error?.message).toContain('TDX_CLIENT_SECRET');
      for (const value of [ID, SECRET]) expect(error?.message).not.toContain(value);
    }
    expect(calls).toEqual([]);
  });

  it('reads credentials from an injected environment', () => {
    expect(readTdxCredentials({ TDX_CLIENT_ID: ` ${ID} `, TDX_CLIENT_SECRET: SECRET })).toEqual({ id: ID, secret: SECRET });
  });
});

describe('TDX error redaction', () => {
  it('redacts the credentials from a failed token request', async () => {
    mockFetch(() => {
      throw new Error(`connect failed for client_id=${ID} client_secret=${SECRET}`);
    });
    const error = await openTdxSession({ id: ID, secret: SECRET }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain('TDX token request failed');
    for (const value of [ID, SECRET]) expect(error?.message).not.toContain(value);
  });

  it('redacts the access token from a failed data request and writes no file', async () => {
    mockFetch((url) =>
      url.includes('openid-connect/token')
        ? json({ access_token: TOKEN })
        : (() => {
            throw new Error(`socket closed, Authorization: Bearer ${TOKEN}`);
          })(),
    );
    const session = await openTdxSession({ id: ID, secret: SECRET });
    const dest = path.join(tmp, 'fares', 'a.json');
    const result = await tdxDownload(session, 'https://example.test/data', dest, true);
    expect(result.status).toBe('failed');
    const message = result.status === 'failed' ? result.error : '';
    expect(message).not.toContain(TOKEN);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('reports only the status code for an HTTP error response whose body holds the secret', async () => {
    mockFetch((url) =>
      url.includes('openid-connect/token')
        ? json({ access_token: TOKEN })
        : new Response(`denied for ${SECRET} with token ${TOKEN}`, { status: 403 }),
    );
    const session = await openTdxSession({ id: ID, secret: SECRET });
    const result = await tdxDownload(session, 'https://example.test/data', path.join(tmp, 'x.json'), true);
    expect(result).toEqual({ status: 'failed', error: 'HTTP 403' });
  });
});

describe('TDX downloaded files', () => {
  it('contain the data but never the token, the id or the secret', async () => {
    mockFetch((url) => (url.includes('openid-connect/token') ? json({ access_token: TOKEN }) : json([{ OriginStationID: 'BL01' }])));
    const session = await openTdxSession({ id: ID, secret: SECRET });
    const dest = path.join(tmp, 'fares', 'tdx-metro-od-fare-TRTC.json');
    const result = await tdxDownload(session, 'https://example.test/ODFare/TRTC', dest, true);
    expect(result.status).toBe('downloaded');
    const files = fs.readdirSync(tmp, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    expect(files).toHaveLength(1);
    const text = fs.readFileSync(dest, 'utf8');
    expect(text).toContain('BL01');
    for (const value of [TOKEN, ID, SECRET]) expect(text).not.toContain(value);
  });
});
