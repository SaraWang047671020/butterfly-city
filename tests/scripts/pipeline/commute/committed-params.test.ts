import { describe, expect, it } from 'vitest';
import { COMMUTE_PARAMS_FILE, readCommuteParams } from '../../../../scripts/pipeline/commute/params.ts';
import { TIMETABLE_FILES, defaultTransferWait, loadTimetableModel } from '../../../../scripts/pipeline/commute/timetable.ts';
import { defaultWaitStatement } from '../../../../scripts/pipeline/commute/network.ts';
import { MemoryRawReader } from '../../../../scripts/pipeline/raw-reader.ts';
import { fsCommittedReader } from '../../../../scripts/pipeline/policy/step.ts';

const params = readCommuteParams(fsCommittedReader);
const entries = Object.entries(params);

const WEEKDAY = { Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true, Saturday: false, Sunday: false };
const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** One-station line, both directions with the same gap (minutes), five departures from 07:00. */
function line(id: string, gap: number): object[] {
  return [0, 1].map((dir) => ({
    RouteID: `${id}-1`,
    LineID: id,
    StationID: `${id}01`,
    Direction: dir,
    ServiceDay: WEEKDAY,
    Timetables: Array.from({ length: 5 }, (_, i) => ({ DepartureTime: hhmm(420 + i * gap) })),
  }));
}

/** The build's computation of commute.transferWait, read through an injected reader (never data/raw/). */
function transferWaitOf(trtc: object[]): number {
  const reader = new MemoryRawReader({
    [TIMETABLE_FILES.TRTC]: JSON.stringify(trtc),
    [TIMETABLE_FILES.NTMC]: '[]',
    [TIMETABLE_FILES.NTDLRT]: '[]',
    [TIMETABLE_FILES.NTALRT]: '[]',
  });
  return defaultTransferWait(loadTimetableModel(reader));
}

describe('committed data/config/commute-params.json', () => {
  it('has 1 verified, 4 secondary and 3 gap entries', () => {
    const count = (s: string) => entries.filter(([, e]) => e.status === s).length;
    expect(entries).toHaveLength(8);
    expect([count('verified'), count('secondary'), count('gap')]).toEqual([1, 4, 3]);
  });

  it('gives every gap entry a non-blank assumption', () => {
    const gaps = entries.filter(([, e]) => e.status === 'gap');
    expect(gaps.map(([id]) => id).sort()).toEqual(['commute.accessTime', 'commute.roadSpeed.newTaipei', 'commute.tripsPerMonth']);
    for (const [, e] of gaps) expect((e as { assumption?: string }).assumption?.trim()).toBeTruthy();
  });

  it('computes commute.transferWait as the median of the per-line half-headways', () => {
    // Half-headways 2, 10, 3, 4: the median is 3.5 (the mean would be 4.75)
    expect(transferWaitOf([...line('BL', 4), ...line('G', 6), ...line('O', 20), ...line('R', 8)])).toBe(3.5);
  });

  it('has the committed commute.transferWait value that the same computation gives', () => {
    expect(defaultWaitStatement(['BR'])).toBe('BR (Wenhu Line) has no data in the TDX timetables and uses the default value.');
    expect(defaultWaitStatement([])).toBe('');
    expect(params['commute.transferWait']?.estimated?.method).toContain(defaultWaitStatement(['BR']));
    // Fixture whose per-line half-headways are 2, 2.5 and 3
    const computed = transferWaitOf([...line('BL', 4), ...line('G', 5), ...line('R', 6)]);
    expect(computed).toBe(2.5);
    expect(params['commute.transferWait']?.value).toBe(computed);
  });

  it('never names the MOTC survey figure as a reason and never cites Wikipedia', () => {
    const text = fsCommittedReader(COMMUTE_PARAMS_FILE);
    expect(text).not.toMatch(/\bMOTC\b/);
    expect(text).not.toMatch(/\b57\b/);
    expect(text).not.toMatch(/survey figure/i);
    expect(text).not.toMatch(/commute survey/i);
    expect(text).not.toMatch(/wikipedia/i);
  });
});
