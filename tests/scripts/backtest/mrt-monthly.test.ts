import { describe, expect, it } from 'vitest';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { defaultAlias, quarterlyByDistrict, readMonthlyEntries } from '../../../scripts/backtest/mrt-monthly.ts';

// Station keys copied from data/raw/mrt/od-station-month/2025-12.json.
const TAIPEI_STATION = '台北車站';
const BANQIAO_KEY = 'BL板橋';

function file(month: string, over: Record<string, unknown> = {}): Uint8Array {
  const doc: Record<string, unknown> = {
    month,
    source: 'test fixture',
    entries: { [TAIPEI_STATION]: 100, [BANQIAO_KEY]: 50, 中山: 20 },
    exits: { [TAIPEI_STATION]: 90, [BANQIAO_KEY]: 55, 中山: 25 },
    rows: 3,
    ...over,
  };
  for (const k of Object.keys(over)) if (over[k] === undefined) delete doc[k];
  return new TextEncoder().encode(JSON.stringify(doc));
}

function reader(files: Record<string, Uint8Array>): MemoryRawReader {
  const mapped: Record<string, Uint8Array> = {};
  for (const [m, bytes] of Object.entries(files)) mapped[`mrt/od-station-month/${m}.json`] = bytes;
  return new MemoryRawReader(mapped);
}

function caught(fn: () => unknown): DataError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    return e as DataError;
  }
  throw new Error('expected DataError');
}

const MONTHS = ['2025-10', '2025-11', '2025-12'];

describe('readMonthlyEntries', () => {
  it('reads a valid file and keeps Chinese station keys intact from UTF-8 bytes', () => {
    const out = readMonthlyEntries(['2025-12'], reader({ '2025-12': file('2025-12') }));
    expect(out).toHaveLength(1);
    expect(out[0]?.month).toBe('2025-12');
    expect(out[0]?.entries.get(TAIPEI_STATION)).toBe(100);
    expect(out[0]?.entries.get(BANQIAO_KEY)).toBe(50);
    expect([...(out[0]?.entries.keys() ?? [])]).toEqual([TAIPEI_STATION, BANQIAO_KEY, '中山']);
  });

  it('stops on a missing field and names month and field', () => {
    const e = caught(() => readMonthlyEntries(['2025-12'], reader({ '2025-12': file('2025-12', { exits: undefined }) })));
    expect(e.subject).toBe('2025-12');
    expect(e.details.join('\n')).toContain('field: exits');
  });

  it('stops on a non-numeric count and names the station', () => {
    const bad = file('2025-12', { entries: { [TAIPEI_STATION]: 'many' } });
    const e = caught(() => readMonthlyEntries(['2025-12'], reader({ '2025-12': bad })));
    expect(e.subject).toBe('2025-12');
    expect(e.details.join('\n')).toContain(`station: ${TAIPEI_STATION}`);
    expect(e.details.join('\n')).toContain('value: many');
  });

  it('stops when the month inside the file differs from the file name', () => {
    const e = caught(() => readMonthlyEntries(['2025-12'], reader({ '2025-12': file('2025-11') })));
    expect(e.subject).toBe('2025-12');
    expect(e.details.join('\n')).toContain('does not match the file name');
  });

  it('stops on a missing month file with the download command', () => {
    const e = caught(() => readMonthlyEntries(['2025-12'], reader({})));
    expect(e.message).toContain('mrt-od-missing');
    expect(e.details.join('\n')).toContain('--od=2025-12');
  });
});

describe('alias resolution', () => {
  const districts = new Map([
    ['台北車站', 'D1'],
    ['板橋', 'D2'],
    ['中山', 'D3'],
  ]);

  it('maps a line-prefixed key to its station and sums per district', () => {
    expect(defaultAlias().get(BANQIAO_KEY)).toBe('板橋');
    const monthly = readMonthlyEntries(MONTHS, reader(Object.fromEntries(MONTHS.map((m) => [m, file(m)]))));
    const result = quarterlyByDistrict(monthly, districts);
    expect(result.all.get('D2')?.get('2025Q4')).toBe(150);
    expect(result.all.get('D1')?.get('2025Q4')).toBe(300);
  });

  it('stops on an unknown station and names station and month', () => {
    const files = Object.fromEntries(MONTHS.map((m) => [m, file(m, m === '2025-11' ? { entries: { 未知站: 5 } } : {})]));
    const monthly = readMonthlyEntries(MONTHS, reader(files));
    const e = caught(() => quarterlyByDistrict(monthly, districts));
    expect(e.subject).toBe('未知站');
    expect(e.details.join('\n')).toContain('month: 2025-11');
  });
});
