import { describe, expect, it } from 'vitest';
import { ParseError, PipelineError } from '../../../../scripts/pipeline/errors.ts';
import { MemoryRawReader } from '../../../../scripts/pipeline/raw-reader.ts';
import {
  DANHAI_EXCLUDED_REASON,
  RUN_TIME_METHOD,
  TIMETABLE_FILES,
  anyLineUsesDefaultWait,
  buildTimetableModel,
  defaultTransferWait,
  halfHeadways,
  lineHeadway,
  loadTimetableModel,
  parseStationTimetable,
  transferWaitFor,
} from '../../../../scripts/pipeline/commute/timetable.ts';

const WEEKDAY = { Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true, Saturday: false, Sunday: false };
const SATURDAY = { Monday: false, Tuesday: false, Wednesday: false, Thursday: false, Friday: false, Saturday: true, Sunday: false };

const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** n departures from 07:00, `gap` minutes apart. */
const every = (gap: number, n = 5): number[] => Array.from({ length: n }, (_, i) => 420 + i * gap);

interface Rec {
  line: string;
  route: string;
  station: string;
  dir: number;
  arr?: number[];
  dep?: number[];
  service?: object;
}

function rec(r: Rec): object {
  const n = Math.max(r.arr?.length ?? 0, r.dep?.length ?? 0);
  return {
    RouteID: r.route,
    LineID: r.line,
    StationID: r.station,
    Direction: r.dir,
    ServiceDay: r.service ?? WEEKDAY,
    Timetables: Array.from({ length: n }, (_, i) => ({
      ...(r.arr?.[i] === undefined ? {} : { ArrivalTime: hhmm(r.arr[i] as number) }),
      ...(r.dep?.[i] === undefined ? {} : { DepartureTime: hhmm(r.dep[i] as number) }),
    })),
  };
}

/** One-station line with the given direction gaps. */
function simpleLine(line: string, gap0: number, gap1: number): object[] {
  return [
    rec({ line, route: `${line}-1`, station: `${line}01`, dir: 0, dep: every(gap0) }),
    rec({ line, route: `${line}-1`, station: `${line}01`, dir: 1, dep: every(gap1) }),
  ];
}

const parse = (rows: object[]) => parseStationTimetable('trtc.json', JSON.stringify(rows));

describe('parseStationTimetable', () => {
  it('stops with row, expected and found columns when a column is missing', () => {
    const bad = { RouteID: 'BL-1', LineID: 'BL', StationID: 'BL01', Direction: 0, ServiceDay: WEEKDAY };
    let error: unknown;
    try {
      parse([rec({ line: 'BL', route: 'BL-1', station: 'BL01', dir: 0, dep: [420] }), bad]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ParseError);
    const pe = error as ParseError;
    expect(pe.row).toBe(2);
    expect(pe.expected).toContain('Timetables');
    expect(pe.found).not.toContain('Timetables');
  });

  it('stops on an unreadable time', () => {
    const row = { ...(rec({ line: 'BL', route: 'BL-1', station: 'BL01', dir: 0 }) as object), Timetables: [{ DepartureTime: '7am' }] };
    expect(() => parse([row])).toThrow(ParseError);
  });

  it('drops weekend-only records and counts times before 04:00 as after midnight', () => {
    const rows = parse([
      rec({ line: 'BL', route: 'BL-1', station: 'BL01', dir: 0, dep: [1430, 10] }),
      rec({ line: 'BL', route: 'BL-1', station: 'BL02', dir: 0, dep: [420], service: SATURDAY }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.departures).toEqual([1430, 1450]);
  });
});

describe('headways', () => {
  it('uses the median gap of the 07:00 to before 09:00 window and the mean of the two directions', () => {
    const model = buildTimetableModel(
      parse([
        // 06:55 and 09:00 are outside the window; in-window gaps are 10, 10, 99 (median 10)
        rec({ line: 'BL', route: 'BL-1', station: 'BL01', dir: 0, dep: [415, 420, 430, 440, 539, 540] }),
        // gaps 6 and 6
        rec({ line: 'BL', route: 'BL-1', station: 'BL01', dir: 1, dep: [420, 426, 432] }),
      ]),
    );
    const bl = model.headways.find((h) => h.lineId === 'BL');
    expect(bl?.directions.map((d) => [d.departures, d.medianGap])).toEqual([
      [4, 10],
      [3, 6],
    ]);
    expect(lineHeadway(model, 'BL')).toBe(8);
    expect(transferWaitFor(model, 'BL')).toBe(4);
  });

  it('reports a line with fewer than 2 in-window departures as uncovered, and an absent LRT line', () => {
    const model = buildTimetableModel(
      parse([
        rec({ line: 'G', route: 'G-1', station: 'G01', dir: 0, dep: [420, 545] }),
        rec({ line: 'G', route: 'G-1', station: 'G01', dir: 1, dep: every(5) }),
        ...simpleLine('BL', 10, 10),
      ]),
    );
    expect(model.uncoveredHeadways).toEqual(['G']);
    expect(model.headways.map((h) => h.lineId)).toEqual(['BL']);
    expect(anyLineUsesDefaultWait(model)).toBe(true);
    expect(() => lineHeadway(model, 'G')).toThrow(/No headway for line G/);
    // Ankeng (K) has no StationTimeTable here; the absent Danhai line is excluded with its stated reason
    expect(model.uncovered).toEqual(['K']);
    expect(model.excluded).toEqual([{ lineId: 'V', reason: DANHAI_EXCLUDED_REASON }]);
  });

  it('stops with the line name on a zero headway', () => {
    const rows = parse([
      rec({ line: 'X', route: 'X-1', station: 'X01', dir: 0, dep: [420, 420, 420] }),
      rec({ line: 'X', route: 'X-1', station: 'X01', dir: 1, dep: every(5) }),
    ]);
    expect(() => buildTimetableModel(rows)).toThrow(PipelineError);
    expect(() => buildTimetableModel(rows)).toThrow(/line X direction 0 is 0/);
  });

  it('keeps branch routes G-3 and R-3 out of their main line', () => {
    const model = buildTimetableModel(
      parse([
        ...simpleLine('G', 10, 10),
        rec({ line: 'G', route: 'G-3', station: 'G03', dir: 0, dep: every(20) }),
        rec({ line: 'G', route: 'G-3', station: 'G03', dir: 1, dep: every(20) }),
      ]),
    );
    expect(lineHeadway(model, 'G')).toBe(10);
    expect(lineHeadway(model, 'G-3')).toBe(20);
  });
});

describe('default transfer wait', () => {
  // Per-line half-headways: BL 4/2 = 2, G 6/2 = 3, O 20/2 = 10, R (10 and 6)/2 = 4
  const rows = parse([...simpleLine('BL', 4, 4), ...simpleLine('G', 6, 6), ...simpleLine('O', 20, 20), ...simpleLine('R', 10, 6)]);

  it('is the median of the per-line half-headways, not their mean', () => {
    const model = buildTimetableModel(rows);
    expect(halfHeadways(model)).toEqual([2, 3, 10, 4]);
    expect(defaultTransferWait(model)).toBe(3.5);
  });

  it('stops when the model has no headway', () => {
    expect(() => defaultTransferWait(buildTimetableModel([]))).toThrow(PipelineError);
  });
});

describe('LRT run times', () => {
  it('pairs trips by position per SubRoute and direction, and takes the median of the group medians', () => {
    const model = buildTimetableModel(
      parse([
        rec({ line: 'V', route: 'V-1', station: 'V01', dir: 0, dep: [420, 430, 440] }),
        rec({ line: 'V', route: 'V-1', station: 'V02', dir: 0, arr: [422, 432, 442] }),
        // direction 1 travels V02 -> V01 (reverse of the file order)
        rec({ line: 'V', route: 'V-1', station: 'V01', dir: 1, arr: [428, 438, 448] }),
        rec({ line: 'V', route: 'V-1', station: 'V02', dir: 1, dep: [425, 435, 445] }),
      ]),
    );
    expect(model.interStationTimes).toEqual([{ lineId: 'V', from: 'V01', to: 'V02', minutes: 2.5, samples: 6 }]);
    expect(model.excluded).toEqual([]);
    expect(model.uncovered).toEqual(['K']);
  });

  it('excludes the Danhai LRT when a group fails the quality check (spread above 2 minutes)', () => {
    const model = buildTimetableModel(
      parse([
        rec({ line: 'V', route: 'V-1', station: 'V01', dir: 0, dep: [420, 430, 440] }),
        rec({ line: 'V', route: 'V-1', station: 'V02', dir: 0, arr: [422, 432, 446] }),
        rec({ line: 'V', route: 'V-1', station: 'V01', dir: 1, arr: [428, 438, 448] }),
        rec({ line: 'V', route: 'V-1', station: 'V02', dir: 1, dep: [425, 435, 445] }),
      ]),
    );
    expect(model.interStationTimes).toEqual([]);
    expect(model.excluded).toEqual([{ lineId: 'V', reason: DANHAI_EXCLUDED_REASON }]);
    expect(model.runTimeFailures).toEqual([
      { lineId: 'V', pair: 'V01>V02', reason: 'V-1 direction 0: spread 4 above 2 (min 2, max 6)' },
    ]);
    expect(DANHAI_EXCLUDED_REASON).toBe(
      'The Danhai LRT is not included; the whole line lies within Tamsui District, so this affects only access times within Tamsui.',
    );
  });

  it('lists a pair with no sample (unequal trip counts in both directions) as missing', () => {
    const model = buildTimetableModel(
      parse([
        rec({ line: 'V', route: 'V-1', station: 'V01', dir: 0, dep: [420, 430, 440] }),
        rec({ line: 'V', route: 'V-1', station: 'V02', dir: 0, arr: [422, 432] }),
        rec({ line: 'V', route: 'V-1', station: 'V01', dir: 1, arr: [428, 438] }),
        rec({ line: 'V', route: 'V-1', station: 'V02', dir: 1, dep: [425, 435, 445] }),
      ]),
    );
    expect(model.runTimeFailures.map((f) => [f.pair, f.reason.startsWith('no sample')])).toEqual([['V01>V02', true]]);
    expect(model.excluded.map((e) => e.lineId)).toEqual(['V']);
  });

  it('uses the one direction that has samples for both directions (Ankeng K08 to K09)', () => {
    const model = buildTimetableModel(
      parse([
        rec({ line: 'K', route: 'K-1', station: 'K08', dir: 0, dep: [420, 430, 440] }),
        rec({ line: 'K', route: 'K-1', station: 'K09', dir: 0, arr: [423, 433, 443] }),
        // direction 1: K09 has 3 trips, K08 has 4, so the counts differ and the direction gives no sample
        rec({ line: 'K', route: 'K-1', station: 'K08', dir: 1, arr: [429, 439, 449, 459] }),
        rec({ line: 'K', route: 'K-1', station: 'K09', dir: 1, dep: [425, 435, 445] }),
      ]),
    );
    expect(model.interStationTimes).toEqual([{ lineId: 'K', from: 'K08', to: 'K09', minutes: 3, samples: 3 }]);
    expect(model.uncovered).toEqual([]);
    expect(RUN_TIME_METHOD).toContain('uses that direction value for both directions (Ankeng K08 to K09)');
  });
});

describe('loadTimetableModel', () => {
  it('reads the four files through the injected reader', () => {
    const reader = new MemoryRawReader({
      [TIMETABLE_FILES.TRTC]: JSON.stringify(simpleLine('BL', 4, 4)),
      [TIMETABLE_FILES.NTMC]: '[]',
      [TIMETABLE_FILES.NTDLRT]: '[]',
      [TIMETABLE_FILES.NTALRT]: '[]',
    });
    expect(lineHeadway(loadTimetableModel(reader), 'BL')).toBe(4);
  });
});
