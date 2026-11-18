/** Missing-file pre-check of the TPASS backtest (Requirement 27.20). In-memory, no data/raw. */
import { describe, expect, it } from 'vitest';
import { BACKTEST_MONTHS, listMissingMonthFiles } from '../../../scripts/backtest/mrt-monthly.ts';

function fakeReader(present: readonly string[]) {
  const set = new Set(present);
  return {
    exists: (rel: string) => set.has(rel),
    display: (rel: string) => `data/raw/${rel}`,
  };
}

describe('listMissingMonthFiles', () => {
  it('covers 2019-01..2019-12 and 2023-01..2023-12', () => {
    expect(BACKTEST_MONTHS).toHaveLength(24);
    expect(BACKTEST_MONTHS[0]).toBe('2019-01');
    expect(BACKTEST_MONTHS[11]).toBe('2019-12');
    expect(BACKTEST_MONTHS[12]).toBe('2023-01');
    expect(BACKTEST_MONTHS[23]).toBe('2023-12');
  });

  it('lists all 24 with path and command when nothing exists', () => {
    const missing = listMissingMonthFiles(fakeReader([]));
    expect(missing).toHaveLength(24);
    expect(missing[0]).toEqual({
      month: '2019-01',
      path: 'data/raw/mrt/od-station-month/2019-01.json',
      command: 'node scripts/download.ts mrt --od=2019-01',
    });
  });

  it('omits present files and returns empty when all exist', () => {
    const all = BACKTEST_MONTHS.map((m) => `mrt/od-station-month/${m}.json`);
    expect(listMissingMonthFiles(fakeReader(all))).toEqual([]);
    const missing = listMissingMonthFiles(fakeReader(all.filter((p) => !p.includes('2023-05'))));
    expect(missing.map((m) => m.month)).toEqual(['2023-05']);
  });
});
