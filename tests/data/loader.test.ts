import { describe, expect, it } from 'vitest';
import { DATA_FILE_NAMES } from '../../src/data/expected.ts';
import { loadDataFiles } from '../../src/data/loader.ts';
import type { FetchPort, FetchResponse, TimerPort } from '../../src/data/loader.ts';
import { readFixture } from './fixtures/index.ts';

const BASE = '/butterfly-city/';

type Body = string | { status: number } | 'hang';

function respond(body: Body): Promise<FetchResponse> {
  if (typeof body === 'object') return Promise.resolve({ ok: false, status: body.status, text: () => Promise.resolve('') });
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
}

function makePort(overrides: Partial<Record<string, Body>> = {}) {
  const urls: string[] = [];
  const port: FetchPort = (url, init) => {
    urls.push(url);
    const name = url.slice(`${BASE}data/`.length);
    const body = overrides[name] ?? JSON.stringify(readFixture(name as (typeof DATA_FILE_NAMES)[number]));
    if (body === 'hang') {
      return new Promise<FetchResponse>((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return respond(body);
  };
  return { port, urls };
}

/** Fake timer: records callbacks and fires them only when the test says so. */
function makeTimer() {
  const pending = new Map<number, () => void>();
  let next = 1;
  const timer: TimerPort = {
    set(fn) {
      pending.set(next, fn);
      return next++;
    },
    clear(h) {
      pending.delete(h as number);
    },
  };
  return { timer, fireAll: () => [...pending.values()].forEach((f) => f()), pending };
}

async function load(overrides: Partial<Record<string, Body>> = {}) {
  const { port, urls } = makePort(overrides);
  const { timer } = makeTimer();
  const progress: number[] = [];
  const result = await loadDataFiles(port, BASE, (n) => progress.push(n), timer);
  return { result, urls, progress };
}

function failuresOf(result: Awaited<ReturnType<typeof load>>['result']) {
  if (result.ok) throw new Error('expected failure');
  return result.failures;
}

describe('Data_Loader', () => {
  it('loads the 6 fixture files, fetching exactly the 6 URLs and reporting progress 1 to 6', async () => {
    const { result, urls, progress } = await load();
    expect(result.ok).toBe(true);
    expect([...urls].sort()).toEqual(DATA_FILE_NAMES.map((n) => `${BASE}data/${n}`).sort());
    expect(urls).toHaveLength(6);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reports HTTP 404 for a missing file and counts only completed files', async () => {
    const { result, progress } = await load({ 'params.json': { status: 404 } });
    expect(failuresOf(result)).toEqual([{ file: 'params.json', message: 'HTTP 404' }]);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it('reports an unparsable file', async () => {
    const f = failuresOf((await load({ 'events.json': '{ not json' })).result);
    expect(f).toHaveLength(1);
    expect(f[0]?.file).toBe('events.json');
    expect(f[0]?.message).toMatch(/^not valid JSON/);
  });

  it('reports an invalid file with a path and reason', async () => {
    const districts = readFixture('districts.json');
    districts.schemaVersion = 99;
    const f = failuresOf((await load({ 'districts.json': JSON.stringify(districts) })).result);
    expect(f.some((x) => x.file === 'districts.json' && x.message.length > 0)).toBe(true);
  });

  it('reports an invalid events.json', async () => {
    const f = failuresOf((await load({ 'events.json': '{"schemaVersion":1,"events":"x"}' })).result);
    expect(f).toEqual([{ file: 'events.json', message: '$.events: expected an array' }]);
  });

  it('rejects history.json without medianTotalPrice', async () => {
    const history = readFixture('history.json');
    history.indicators = history.indicators.filter((i: { id: string }) => i.id !== 'medianTotalPrice');
    const f = failuresOf((await load({ 'history.json': JSON.stringify(history) })).result);
    expect(f.some((x) => x.file === 'history.json')).toBe(true);
  });

  it('reports a timeout with a fake TimerPort and aborts the request', async () => {
    const { port } = makePort({ 'commute-matrix.json': 'hang' });
    const { timer, fireAll, pending } = makeTimer();
    const progress: number[] = [];
    const promise = loadDataFiles(port, BASE, (n) => progress.push(n), timer, 15_000);
    await Promise.resolve();
    // Only the hanging file keeps its timer once the others finished; fire all of them.
    await new Promise((r) => setTimeout(r, 0));
    fireAll();
    const result = await promise;
    const f = failuresOf(result);
    expect(f.find((x) => x.file === 'commute-matrix.json')?.message).toBe('no complete response within 15 seconds');
    expect(pending.size).toBe(0);
  });

  it('reports a district code-set mismatch', async () => {
    const commute = readFixture('commute-matrix.json');
    commute.codes[0] = '99999999';
    const f = failuresOf((await load({ 'commute-matrix.json': JSON.stringify(commute) })).result);
    expect(f.some((x) => x.file === 'commute-matrix.json')).toBe(true);
  });

  it('succeeds on a Retry (second call) after a failure', async () => {
    const first = await load({ 'params.json': { status: 404 } });
    expect(first.result.ok).toBe(false);
    const second = await load();
    expect(second.result.ok).toBe(true);
    expect(second.progress).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
