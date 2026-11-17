/**
 * TDX StationTimeTable files for the commute model (Requirement 25 criteria 2 and 15,
 * Requirement 27 criteria 2 to 4 and 16).
 *
 * Provides, from the weekday (Monday to Friday) departures of the four StationTimeTable files only
 * (the TDX Frequency files are not used):
 * - `interStationTimes`: Danhai LRT (V) and Ankeng LRT (K) run times, which the S2S files lack;
 * - line headways in the 07:00 to 09:00 window, per direction, and the transfer wait (half the headway).
 *
 * A line whose run times the StationTimeTable cannot give is returned in `uncovered` with the failing
 * pairs; only then does the last-resort file `data/config/lrt-timetable.csv` (task 23.3) apply. A zero,
 * negative or non-finite headway stops the build with the line name.
 */
import { ParseError, PipelineError } from '../errors.ts';
import type { RawReader } from '../raw-reader.ts';

export const WINDOW_START = 7 * 60;
export const WINDOW_END = 9 * 60;

/** TDX line ids of the two LRT lines with no S2S data. */
export const DANHAI_LINE = 'V';
export const ANKENG_LINE = 'K';
export const LRT_LINES: readonly string[] = [DANHAI_LINE, ANKENG_LINE];

/** Branch routes: each is its own line with its own headway and is excluded from its main line. */
const BRANCH_ROUTES: readonly string[] = ['G-3', 'R-3'];
/** Lines whose SubRoutes share a first section and then split (Danhai: Green Mountain V-1, Blue Coast V-2). */
const SPLIT_ROUTES: Readonly<Record<string, readonly [string, string]>> = { V: ['V-1', 'V-2'] };

export const TIMETABLE_FILES = {
  TRTC: 'timetables/tdx-timetable-TRTC.json',
  NTMC: 'timetables/tdx-timetable-NTMC.json',
  NTDLRT: 'timetables/tdx-timetable-NTDLRT.json',
  NTALRT: 'timetables/tdx-timetable-NTALRT.json',
} as const;

/** Direction is optional: the NTMC file has none for line LB (derived from the destination station). */
const TIMETABLE_COLUMNS = ['RouteID', 'LineID', 'StationID', 'ServiceDay', 'Timetables'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

/**
 * Weekday times of one station on one (route, direction). `index` is the position of the record in the
 * file; the file lists the stations in the order of direction 0, so direction 1 travels in reverse.
 * Both lists are sorted. Arrival falls back to the departure and the reverse when one is absent.
 */
export interface StationSchedule {
  readonly lineId: string;
  readonly routeId: string;
  readonly direction: number;
  readonly stationId: string;
  readonly index: number;
  readonly arrivals: readonly number[];
  readonly departures: readonly number[];
}

export interface InterStationTime {
  readonly lineId: string;
  readonly from: string;
  readonly to: string;
  /** Median minutes over in-window weekday trips. */
  readonly minutes: number;
  readonly samples: number;
}

/** A pair that the StationTimeTable cannot give (no sample, or a zero or negative sample). */
export interface RunTimeFailure {
  readonly lineId: string;
  readonly pair: string;
  readonly reason: string;
}

export interface DirectionHeadway {
  readonly direction: number;
  readonly stationId: string;
  /** Weekday departures at the station in the 07:00 to 09:00 window. */
  readonly departures: number;
  readonly medianGap: number;
}

export interface LineHeadway {
  /** Headway id: the TDX line id, or a branch route id (G-3, R-3), or a Danhai SubRoute section (V-1, V-2). */
  readonly lineId: string;
  readonly section: string;
  readonly minutes: number;
  readonly directions: readonly DirectionHeadway[];
}

export interface TimetableModel {
  readonly interStationTimes: readonly InterStationTime[];
  readonly headways: readonly LineHeadway[];
  /** Headway ids with fewer than 2 in-window departures in a direction (operator-page fallback, 23.3). */
  readonly uncoveredHeadways: readonly string[];
  /** LRT line ids whose StationTimeTable run times are missing or unusable (fallback of task 23.3). */
  readonly uncovered: readonly string[];
  readonly runTimeFailures: readonly RunTimeFailure[];
  /** Lines left out of the network (Danhai LRT when its run times fail); network.ts must not use them. */
  readonly excluded: readonly ExcludedLine[];
}

// ---------------------------------------------------------------------------------------------------
// Parsing

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function foundColumns(v: unknown): string[] {
  return isRecord(v) ? Object.keys(v) : [typeof v];
}

/** "HH:MM" to minutes after midnight; "24:00" and later are allowed. Returns undefined when malformed. */
export function parseClock(text: unknown): number | undefined {
  if (typeof text !== 'string') return undefined;
  const m = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(text.trim());
  if (m === null) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

function stationNumber(stationId: string): number {
  const m = /(\d+)/.exec(stationId);
  return m === null ? 0 : Number(m[1]);
}

function isWeekdayService(serviceDay: unknown): boolean {
  return isRecord(serviceDay) && WEEKDAYS.every((d) => serviceDay[d] === true);
}

/**
 * The files write the last trips of the service day after midnight as "00:01" to "00:59" (service starts
 * at about 06:00). Times before 04:00 belong to the end of the service day: add 24 hours so that the
 * sorted order of a station is the order of the trips.
 */
function afterMidnight(minutes: number): number {
  return minutes < 4 * 60 ? minutes + 24 * 60 : minutes;
}

const byNumber = (a: number, b: number): number => a - b;

/**
 * Parses a StationTimeTable file into weekday station schedules. Weekend and holiday records are dropped.
 * Records of the same (line, route, direction, station) are merged.
 */
export function parseStationTimetable(file: string, text: string): StationSchedule[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new ParseError(file, undefined, TIMETABLE_COLUMNS, ['(invalid JSON)'], (e as Error).message);
  }
  if (!Array.isArray(doc)) {
    throw new ParseError(file, undefined, TIMETABLE_COLUMNS, foundColumns(doc), 'expected a JSON array');
  }
  interface Draft {
    lineId: string;
    routeId: string;
    direction: number;
    stationId: string;
    index: number;
    arrivals: number[];
    departures: number[];
  }
  const drafts = new Map<string, Draft>();
  (doc as unknown[]).forEach((row, i) => {
    const rowNo = i + 1;
    if (
      !isRecord(row) ||
      typeof row['RouteID'] !== 'string' ||
      typeof row['LineID'] !== 'string' ||
      typeof row['StationID'] !== 'string' ||
      (row['Direction'] !== undefined && typeof row['Direction'] !== 'number') ||
      !isRecord(row['ServiceDay']) ||
      !Array.isArray(row['Timetables'])
    ) {
      throw new ParseError(file, rowNo, TIMETABLE_COLUMNS, foundColumns(row), 'missing or mistyped column');
    }
    if (!isWeekdayService(row['ServiceDay'])) return;
    const stationId = row['StationID'];
    const destination = row['DestinationStaionID'];
    const direction =
      typeof row['Direction'] === 'number'
        ? row['Direction']
        : typeof destination === 'string' && stationNumber(destination) < stationNumber(stationId)
          ? 1
          : 0;
    const key = `${row['LineID']}|${row['RouteID']}|${direction}|${stationId}`;
    let d = drafts.get(key);
    if (d === undefined) {
      d = { lineId: row['LineID'], routeId: row['RouteID'], direction, stationId, index: i, arrivals: [], departures: [] };
      drafts.set(key, d);
    }
    for (const t of row['Timetables'] as unknown[]) {
      const arrival = isRecord(t) && t['ArrivalTime'] !== undefined ? parseClock(t['ArrivalTime']) : undefined;
      const departure = isRecord(t) && t['DepartureTime'] !== undefined ? parseClock(t['DepartureTime']) : undefined;
      if (
        !isRecord(t) ||
        (t['ArrivalTime'] !== undefined && arrival === undefined) ||
        (t['DepartureTime'] !== undefined && departure === undefined) ||
        (arrival === undefined && departure === undefined)
      ) {
        throw new ParseError(
          file,
          rowNo,
          ['ArrivalTime (HH:MM)', 'DepartureTime (HH:MM)'],
          isRecord(t) ? [String(t['ArrivalTime']), String(t['DepartureTime'])] : [typeof t],
          'unreadable time',
        );
      }
      d.arrivals.push(afterMidnight((arrival ?? departure) as number));
      d.departures.push(afterMidnight((departure ?? arrival) as number));
    }
  });
  return [...drafts.values()].map((d) => ({
    ...d,
    arrivals: d.arrivals.sort(byNumber),
    departures: d.departures.sort(byNumber),
  }));
}

/** The stations of one (route, direction) in the order of travel. */
function travelOrder(rows: readonly StationSchedule[], routeId: string, direction: number): StationSchedule[] {
  const own = rows.filter((r) => r.routeId === routeId && r.direction === direction).sort((a, b) => a.index - b.index);
  return direction === 1 ? own.reverse() : own;
}

function routeIdsOf(rows: readonly StationSchedule[]): string[] {
  return [...new Set(rows.map((r) => r.routeId))].sort();
}

// ---------------------------------------------------------------------------------------------------
// Run times

function median(values: readonly number[]): number {
  const s = [...values].sort(byNumber);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

interface LineRunTimes {
  readonly times: InterStationTime[];
  readonly failures: RunTimeFailure[];
}

/** Largest allowed spread (max minus min, minutes) of the paired differences of one pair. */
export const MAX_RUN_TIME_SPREAD = 2;

/**
 * Method text for `estimated.method` of the Danhai and Ankeng run times (Requirement 25.2 (e), 25.15 (d)).
 */
export const RUN_TIME_METHOD =
  'Run time of each pair of consecutive stations from the weekday (Monday to Friday) StationTimeTable of the line: ' +
  'trips are split by SubRoute and direction; when both stations of the pair have the same number of weekday trips ' +
  'in that SubRoute and direction, the k-th departure at the first station is paired with the k-th arrival at the next ' +
  'station (time order, times before 04:00 counted as after midnight); only pairs whose first-station departure is at ' +
  'or after 07:00 and before 09:00 are used. The station order of a SubRoute and direction is the order of the stations ' +
  'in the file (reversed for direction 1). Quality check within each SubRoute/direction group only (never pooled across ' +
  `groups): every difference is above 0 and (maximum minus minimum) is at most ${MAX_RUN_TIME_SPREAD} minutes. When every ` +
  'group of a pair passes, the pair run time is the median of the group medians (in minutes). A pair with samples in only ' +
  'one direction uses that direction value for both directions (Ankeng K08 to K09). A pair that fails the check or has no ' +
  'sample is missing, and the line is then taken from the last-resort file (Ankeng) or excluded (Danhai).';

/** Reason shown when the Danhai LRT is excluded from the network. */
export const DANHAI_EXCLUDED_REASON =
  'The Danhai LRT is not included; the whole line lies within Tamsui District, so this affects only access times within Tamsui.';

export interface ExcludedLine {
  readonly lineId: string;
  readonly reason: string;
}

/** Paired samples of one pair from one (SubRoute, direction) group. */
export interface PairGroupSamples {
  readonly group: string;
  readonly samples: readonly number[];
}

/**
 * Collects the paired differences of an LRT line per consecutive-station pair (key `a>b` with a < b by id).
 *
 * Pairing rule: per consecutive pair (station i, station i+1) of a SubRoute and direction, when both stations
 * have the same number of weekday trips, the k-th departure at station i is paired with the k-th arrival at
 * station i+1 (time order). The trip counts the in-window test: the departure at station i must be at or after
 * 07:00 and before 09:00. A pair of unequal counts in a group gives no sample from that group.
 * Each group is checked on its own and never pooled with another group.
 *
 * Quality check (see `lineRunTimes`): per group, every difference > 0 and (max - min) <= 2 minutes.
 */
export function collectPairSamples(rows: readonly StationSchedule[]): Map<string, PairGroupSamples[]> {
  const pairs = new Map<string, PairGroupSamples[]>();
  for (const routeId of routeIdsOf(rows)) {
    for (const direction of [0, 1]) {
      const stations = travelOrder(rows, routeId, direction);
      for (let i = 0; i + 1 < stations.length; i += 1) {
        const from = stations[i] as StationSchedule;
        const to = stations[i + 1] as StationSchedule;
        const key = from.stationId < to.stationId ? `${from.stationId}>${to.stationId}` : `${to.stationId}>${from.stationId}`;
        const list = pairs.get(key) ?? [];
        pairs.set(key, list);
        if (from.departures.length !== to.arrivals.length) continue;
        const samples: number[] = [];
        for (let k = 0; k < from.departures.length; k += 1) {
          const dep = from.departures[k] as number;
          if (dep < WINDOW_START || dep >= WINDOW_END) continue;
          samples.push((to.arrivals[k] as number) - dep);
        }
        if (samples.length > 0) list.push({ group: `${routeId} direction ${direction}`, samples });
      }
    }
  }
  return pairs;
}

/** Null when the samples pass the quality check, else the reason. */
function qualityFault(samples: readonly number[]): string | null {
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  if (lo <= 0) return `zero or negative difference (min ${lo})`;
  if (hi - lo > MAX_RUN_TIME_SPREAD) return `spread ${hi - lo} above ${MAX_RUN_TIME_SPREAD} (min ${lo}, max ${hi})`;
  return null;
}

/**
 * Run times of an LRT line from `collectPairSamples`. A pair with no sample, or failing the quality check in
 * any group or pooled, is a failure and the line is uncovered.
 */
function lineRunTimes(lineId: string, rows: readonly StationSchedule[]): LineRunTimes {
  const pairs = collectPairSamples(rows);
  const times: InterStationTime[] = [];
  const failures: RunTimeFailure[] = [];
  for (const key of [...pairs.keys()].sort()) {
    const groups = pairs.get(key) as PairGroupSamples[];
    const pooled = groups.flatMap((g) => [...g.samples]);
    if (pooled.length === 0) {
      failures.push({ lineId, pair: key, reason: 'no sample (unequal trip counts or no in-window trip)' });
      continue;
    }
    let fault: string | null = null;
    for (const g of groups) {
      const f = qualityFault(g.samples);
      if (f !== null) fault = `${g.group}: ${f}`;
    }
    if (fault !== null) {
      failures.push({ lineId, pair: key, reason: fault });
      continue;
    }
    const [from, to] = key.split('>') as [string, string];
    times.push({ lineId, from, to, minutes: median(groups.map((g) => median(g.samples))), samples: pooled.length });
  }
  if (pairs.size === 0) failures.push({ lineId, pair: '(none)', reason: 'the StationTimeTable has no station pair' });
  return { times: failures.length === 0 ? times : [], failures };
}
// ---------------------------------------------------------------------------------------------------
// Headways

function assertHeadway(id: string, minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new PipelineError(`Headway of line ${id} is ${minutes}; it must be a positive number of minutes`);
  }
  return minutes;
}

interface HeadwayGroup {
  readonly id: string;
  readonly section: string;
  /** Rows of the group; the group's own station filter is already applied. */
  readonly rows: readonly StationSchedule[];
  /** Full route station order per `${routeId}|${direction}` (all stations of the route, used for ties). */
  readonly order: ReadonlyMap<string, readonly string[]>;
}

function headwayGroups(lineId: string, rows: readonly StationSchedule[]): HeadwayGroup[] {
  const order = new Map<string, readonly string[]>();
  for (const routeId of routeIdsOf(rows)) {
    for (const direction of [0, 1]) {
      order.set(`${routeId}|${direction}`, travelOrder(rows, routeId, direction).map((r) => r.stationId));
    }
  }
  const groups: HeadwayGroup[] = [];
  const branches = rows.filter((r) => BRANCH_ROUTES.includes(r.routeId));
  const main = rows.filter((r) => !BRANCH_ROUTES.includes(r.routeId));
  for (const routeId of routeIdsOf(branches)) {
    groups.push({
      id: routeId,
      section: `${lineId} branch ${routeId}`,
      rows: branches.filter((r) => r.routeId === routeId),
      order,
    });
  }
  const split = SPLIT_ROUTES[lineId];
  if (split === undefined) {
    if (main.length > 0) groups.push({ id: lineId, section: `${lineId} all routes`, rows: main, order });
    return groups;
  }
  // Shared section: stations that both SubRoutes serve in that direction; own section: the others.
  const stationsOf = (routeId: string, direction: number): Set<string> =>
    new Set(main.filter((r) => r.routeId === routeId && r.direction === direction).map((r) => r.stationId));
  const sharedOf = (direction: number): Set<string> => {
    const a = stationsOf(split[0], direction);
    const b = stationsOf(split[1], direction);
    return new Set([...a].filter((s) => b.has(s)));
  };
  const shared = [sharedOf(0), sharedOf(1)];
  groups.push({
    id: lineId,
    section: `${lineId} shared section (${split[0]} and ${split[1]} combined)`,
    rows: main.filter((r) => (shared[r.direction] ?? new Set<string>()).has(r.stationId)),
    order,
  });
  for (const routeId of split) {
    groups.push({
      id: routeId,
      section: `${routeId} own section`,
      rows: main.filter((r) => r.routeId === routeId && !(shared[r.direction] ?? new Set<string>()).has(r.stationId)),
      order,
    });
  }
  return groups;
}

/**
 * Headway of one direction of a group, from the StationTimeTable departures at one measuring station.
 *
 * Measuring-station rule: the station of the group with the MOST weekday departures in that direction
 * (all routes of the group together, whole day). If some station is served by every train of the group,
 * its count is the number of trains and so is the maximum; a station that short-turn trains do not reach
 * has a lower count. Ties are broken by the order of travel: the station that comes first on the routes
 * of the group, taking the routes in RouteID order.
 *
 * The direction headway is the MEDIAN of the gaps between consecutive in-window (07:00 to 09:00) weekday
 * departures at that station. Undefined when the direction has fewer than 2 in-window departures.
 */
function directionHeadway(group: HeadwayGroup, direction: number): DirectionHeadway | undefined {
  const rows = group.rows.filter((r) => r.direction === direction);
  if (rows.length === 0) return undefined;
  const departures = new Map<string, number[]>();
  for (const r of rows) departures.set(r.stationId, [...(departures.get(r.stationId) ?? []), ...r.departures]);
  const sequence: string[] = [];
  for (const routeId of routeIdsOf(rows)) {
    for (const id of group.order.get(`${routeId}|${direction}`) ?? []) {
      if (departures.has(id) && !sequence.includes(id)) sequence.push(id);
    }
  }
  let best = '';
  for (const id of sequence) {
    if (best === '' || (departures.get(id) as number[]).length > (departures.get(best) as number[]).length) best = id;
  }
  const inWindow = (departures.get(best) as number[]).filter((t) => t >= WINDOW_START && t < WINDOW_END).sort(byNumber);
  if (inWindow.length < 2) return undefined;
  const gaps: number[] = [];
  for (let i = 1; i < inWindow.length; i += 1) gaps.push((inWindow[i] as number) - (inWindow[i - 1] as number));
  return {
    direction,
    stationId: best,
    departures: inWindow.length,
    medianGap: assertHeadway(`${group.id} direction ${direction}`, median(gaps)),
  };
}

// ---------------------------------------------------------------------------------------------------
// Model

/** Builds the model from the weekday station schedules of all four files. */
export function buildTimetableModel(rows: readonly StationSchedule[]): TimetableModel {
  const interStationTimes: InterStationTime[] = [];
  const headways: LineHeadway[] = [];
  const uncoveredHeadways: string[] = [];
  const uncovered: string[] = [];
  const runTimeFailures: RunTimeFailure[] = [];

  for (const lineId of [...new Set(rows.map((r) => r.lineId))].sort()) {
    const lineRows = rows.filter((r) => r.lineId === lineId);
    for (const group of headwayGroups(lineId, lineRows)) {
      const dirs = [0, 1].map((d) => directionHeadway(group, d));
      if (dirs.some((d) => d === undefined)) {
        uncoveredHeadways.push(group.id);
        continue;
      }
      const directions = dirs as DirectionHeadway[];
      const minutes = assertHeadway(group.id, (directions[0]!.medianGap + directions[1]!.medianGap) / 2);
      headways.push({ lineId: group.id, section: group.section, minutes, directions });
    }
    if (LRT_LINES.includes(lineId)) {
      const run = lineRunTimes(lineId, lineRows);
      if (run.failures.length > 0) {
        uncovered.push(lineId);
        runTimeFailures.push(...run.failures);
      } else {
        interStationTimes.push(...run.times);
      }
    }
  }
  for (const lineId of LRT_LINES) {
    if (!rows.some((r) => r.lineId === lineId)) uncovered.push(lineId);
  }
  const excluded: ExcludedLine[] = [];
  if (uncovered.includes(DANHAI_LINE)) {
    excluded.push({ lineId: DANHAI_LINE, reason: DANHAI_EXCLUDED_REASON });
    const isDanhai = (id: string): boolean => id === DANHAI_LINE || id.startsWith(`${DANHAI_LINE}-`);
    for (let i = headways.length - 1; i >= 0; i -= 1) if (isDanhai((headways[i] as LineHeadway).lineId)) headways.splice(i, 1);
    for (let i = uncoveredHeadways.length - 1; i >= 0; i -= 1) {
      if (isDanhai(uncoveredHeadways[i] as string)) uncoveredHeadways.splice(i, 1);
    }
    uncovered.splice(uncovered.indexOf(DANHAI_LINE), 1);
  }
  return { interStationTimes, headways, uncoveredHeadways, uncovered, runTimeFailures, excluded };
}

/** Reads the four StationTimeTable files through the raw reader and builds the model. */
export function loadTimetableModel(reader: RawReader): TimetableModel {
  const rows: StationSchedule[] = [];
  for (const rel of Object.values(TIMETABLE_FILES)) {
    rows.push(...parseStationTimetable(reader.display(rel), reader.readText(rel)));
  }
  return buildTimetableModel(rows);
}

/** Headway in minutes of the line that the passenger boards. Stops with the line name when absent. */
export function lineHeadway(model: TimetableModel, lineId: string): number {
  const h = model.headways.find((x) => x.lineId === lineId);
  if (h === undefined) throw new PipelineError(`No headway for line ${lineId}`);
  return assertHeadway(lineId, h.minutes);
}

/** Expected wait when transferring onto the line: half of its headway. */
export function transferWaitFor(model: TimetableModel, lineId: string): number {
  return lineHeadway(model, lineId) / 2;
}

/** Half-headways (minutes) of all headway groups; every group counts as a line. */
export function halfHeadways(model: TimetableModel): number[] {
  return model.headways.map((h) => h.minutes / 2);
}

/** Default transfer wait: the MEDIAN of the per-line half-headways. Stops when the model has no headway. */
export function defaultTransferWait(model: TimetableModel): number {
  const halves = halfHeadways(model);
  if (halves.length === 0) throw new PipelineError('No line headway: the default transfer wait cannot be computed');
  return median(halves);
}

/** True when some line has no headway, so a passenger boarding it would use the default transfer wait. */
export function anyLineUsesDefaultWait(model: TimetableModel): boolean {
  return model.uncoveredHeadways.length > 0;
}