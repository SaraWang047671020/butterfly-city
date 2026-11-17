/**
 * Commute cost per minute from the metro fare tables (Requirement 29, Decision D44).
 *
 * `parseFares` reads the TDX ODFare files (adult single-journey full fare: TicketType 1, FareClass 1).
 * `pairFaresWithTimes` pairs each fare with the rail-graph path time of the same station pair and counts
 * every excluded pair by reason. `commuteCostEntry` builds the Parameter_Entry of
 * `migration.commuteCostPerMinute`. The module is pure; the caller reads the files.
 */
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import { DataError, ParseError } from '../errors.ts';
import { linearFit } from '../numeric.ts';

export const COMMUTE_COST_ID = 'migration.commuteCostPerMinute';
export const COMMUTE_COST_UNIT = 'TWD per minute per commuter per month';
export const FARE_OPERATORS = ['TRTC', 'NTMC', 'NTDLRT', 'NTALRT'] as const;
export const FARE_FILES: Readonly<Record<(typeof FARE_OPERATORS)[number], string>> = {
  TRTC: 'fares/tdx-metro-od-fare-TRTC.json',
  NTMC: 'fares/tdx-metro-od-fare-NTMC.json',
  NTDLRT: 'fares/tdx-metro-od-fare-NTDLRT.json',
  NTALRT: 'fares/tdx-metro-od-fare-NTALRT.json',
};

/** Adult full-fare single journey. */
const ADULT_TICKET_TYPE = 1;
const ADULT_FARE_CLASS = 1;

const FARE_COLUMNS = ['OriginStationID', 'DestinationStationID', 'Fares[].TicketType', 'Fares[].FareClass', 'Fares[].Price'];

/** One station-pair row of a Fare_Table. `fare` is undefined when the row has no adult full fare. */
export interface FareRow {
  readonly from: string;
  readonly to: string;
  readonly fare: number | undefined;
}

export interface FarePair {
  readonly from: string;
  readonly to: string;
  /** TWD, adult full fare. */
  readonly fare: number;
  /** In-vehicle path time in minutes. */
  readonly minutes: number;
}

export type ExcludeReason = 'same-station' | 'no-adult-fare' | 'not-open-2025Q4' | 'no-path-time' | 'duplicate-pair';

/**
 * Stations in the Fare_Table that are not open by 2025-12-31 (reason 
ot-open-2025Q4). R01 (Guangci/Fengtian
 * Temple, Xinyi Line east extension) is in the TDX files but has no opening date in the opening-date table of
 * Requirement 11 criterion 4 (DATA-CHECK.md item 10.5 gives about 2026-08, news only) and no run time.
 */
export const NOT_OPEN_2025Q4: ReadonlySet<string> = new Set(['R01']);

export interface PairingResult {
  readonly pairs: readonly FarePair[];
  /** Count and first examples (at most 5, "from>to") per reason; a reason with no pair is absent. */
  readonly excluded: Readonly<Partial<Record<ExcludeReason, { readonly count: number; readonly examples: readonly string[] }>>>;
  /** Highest adult fare among all rows with a fare and distinct stations (the Fare_Cap). undefined when none. */
  readonly cap: number | undefined;
  readonly rows: number;
}

export function parseFares(file: string, text: string): FareRow[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    throw new ParseError(file, undefined, FARE_COLUMNS, [], `not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(doc)) throw new ParseError(file, undefined, FARE_COLUMNS, [], 'top level is not an array');
  const rows: FareRow[] = [];
  doc.forEach((rec: unknown, i: number) => {
    const r = typeof rec === 'object' && rec !== null ? (rec as Record<string, unknown>) : {};
    const found = Object.keys(r);
    const from = r.OriginStationID;
    const to = r.DestinationStationID;
    if (typeof from !== 'string' || typeof to !== 'string' || !Array.isArray(r.Fares)) {
      throw new ParseError(file, i + 1, FARE_COLUMNS, found, 'missing OriginStationID, DestinationStationID or Fares');
    }
    let fare: number | undefined;
    for (const f of r.Fares as unknown[]) {
      const x = typeof f === 'object' && f !== null ? (f as Record<string, unknown>) : {};
      if (!('TicketType' in x) || !('FareClass' in x) || !('Price' in x)) {
        throw new ParseError(file, i + 1, FARE_COLUMNS, Object.keys(x), 'a Fares entry lacks TicketType, FareClass or Price');
      }
      if (x.TicketType === ADULT_TICKET_TYPE && x.FareClass === ADULT_FARE_CLASS && x.CitizenCode === undefined) {
        if (typeof x.Price !== 'number' || !Number.isFinite(x.Price)) {
          throw new ParseError(file, i + 1, FARE_COLUMNS, Object.keys(x), 'Price is not a finite number');
        }
        fare = x.Price;
      }
    }
    rows.push({ from, to, fare });
  });
  return rows;
}

export function pairFaresWithTimes(
  rows: readonly FareRow[],
  pathTime: (a: string, b: string) => number | undefined,
  notOpen: ReadonlySet<string> = NOT_OPEN_2025Q4,
): PairingResult {
  const pairs: FarePair[] = [];
  const counts = new Map<ExcludeReason, { count: number; examples: string[] }>();
  const exclude = (reason: ExcludeReason, r: FareRow): void => {
    const e = counts.get(reason) ?? { count: 0, examples: [] };
    e.count += 1;
    if (e.examples.length < 5) e.examples.push(`${r.from}>${r.to}`);
    counts.set(reason, e);
  };
  const seen = new Set<string>();
  let cap: number | undefined;
  for (const r of rows) {
    if (r.from === r.to) {
      exclude('same-station', r);
      continue;
    }
    if (r.fare === undefined) {
      exclude('no-adult-fare', r);
      continue;
    }
    if (cap === undefined || r.fare > cap) cap = r.fare;
    if (notOpen.has(r.from) || notOpen.has(r.to)) {
      exclude('not-open-2025Q4', r);
      continue;
    }
    const key = `${r.from}>${r.to}`;
    if (seen.has(key)) {
      exclude('duplicate-pair', r);
      continue;
    }
    seen.add(key);
    const minutes = pathTime(r.from, r.to);
    if (minutes === undefined) {
      exclude('no-path-time', r);
      continue;
    }
    pairs.push({ from: r.from, to: r.to, fare: r.fare, minutes });
  }
  const excluded: Record<string, { count: number; examples: readonly string[] }> = {};
  for (const [k, v] of counts) excluded[k] = v;
  return { pairs, excluded, cap, rows: rows.length };
}

export interface FareSlopes {
  readonly pairCount: number;
  readonly allSlope: number;
  readonly uncappedSlope: number;
  readonly uncappedCount: number;
  readonly cap: number | undefined;
  /** Shortest path time among the pairs charged the cap; undefined when none is capped. */
  readonly tCap: number | undefined;
  /** Number of pairs charged the cap. */
  readonly cappedCount: number;
}

function slopeOf(pairs: readonly FarePair[], what: string): number {
  try {
    return linearFit(
      pairs.map((p) => p.minutes),
      pairs.map((p) => p.fare),
    ).slope;
  } catch (e) {
    throw new DataError('fare-slope-undefined', COMMUTE_COST_ID, [`${what}: ${(e as Error).message}`, `pairs: ${pairs.length}`]);
  }
}

/** Fare_Slopes of Requirement 29 criteria 3 and 4. `cap` defaults to the highest fare among `pairs`. */
export function fareSlopes(pairs: readonly FarePair[], cap: number | undefined = undefined): FareSlopes {
  const fareCap = cap ?? pairs.reduce<number | undefined>((m, p) => (m === undefined || p.fare > m ? p.fare : m), undefined);
  const capped = pairs.filter((p) => p.fare === fareCap);
  const tCap = capped.length === 0 ? undefined : Math.min(...capped.map((p) => p.minutes));
  const uncapped = tCap === undefined ? pairs : pairs.filter((p) => p.minutes < tCap);
  return {
    pairCount: pairs.length,
    allSlope: slopeOf(pairs, 'all pairs'),
    uncappedSlope: slopeOf(uncapped, 'Uncapped_Range'),
    uncappedCount: uncapped.length,
    cap: fareCap,
    tCap,
    cappedCount: capped.length,
  };
}

/** Normalisation table of Decision D44: pass units to the commuter-month unit. */
export const PASS_UNIT_NORMALISATION: Readonly<Record<string, string>> = {
  '30-day pass': 'commuter per month',
  'pass per month': 'commuter per month',
};

const FARE_CITATION = {
  citation:
    'TDX Rail/Metro ODFare, Taipei Metro (TRTC), New Taipei Metro (NTMC), Danhai LRT (NTDLRT) and Ankeng LRT (NTALRT), adult single-journey full fare, Ministry of Transport and Communications',
  url: 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/ODFare/{TRTC,NTMC,NTDLRT,NTALRT}?%24format=JSON',
} as const;

const PASS_CITATION = {
  citation: 'Taipei Metro, commuter pass and TPASS product table (policy/trtc-products): a pass holder pays no per-trip fare',
  url: 'https://www.metro.taipei/cp.aspx?n=CEF54168B23F73B4&s=BB3631329CC1A297',
} as const;

/**
 * Parameter_Entry of `migration.commuteCostPerMinute`. `tripsPerMonth` is `commute.tripsPerMonth` and
 * `tripsStatus` its Parameter_Status (default `gap`). Throws DataError when 0 ≤ value ≤ high fails.
 */
export function commuteCostEntry(
  pairs: readonly FarePair[],
  tripsPerMonth: number,
  options: { readonly cap?: number; readonly tripsStatus?: string; readonly notOpenPairs?: number } = {},
): ScalarParameter {
  const s = fareSlopes(pairs, options.cap);
  const value = s.allSlope * tripsPerMonth;
  const uncappedValue = s.uncappedSlope * tripsPerMonth;
  const high = Math.max(value, uncappedValue);
  if (!(value >= 0) || !Number.isFinite(value) || !Number.isFinite(uncappedValue) || !Number.isFinite(high)) {
    throw new DataError('commute-cost-order', COMMUTE_COST_ID, [
      `low 0, value ${value}, high ${high} (Uncapped_Range slope x trips ${uncappedValue}); need value >= 0 and finite slopes`,
      `pairs: ${pairs.length} (Uncapped_Range ${s.uncappedCount})`,
    ]);
  }
  const tripsStatus = options.tripsStatus ?? 'gap';
  const rangeRule =
    s.tCap === undefined
      ? 'No pair is charged the Fare_Cap, so the Uncapped_Range is all pairs.'
      : `The Uncapped_Range is the ${s.uncappedCount} pairs with a path time below ${s.tCap} minutes, the shortest pair charged the Fare_Cap of ${s.cap} TWD.`;
  const capShare = s.pairCount === 0 ? 0 : (100 * s.cappedCount) / s.pairCount;
  const capText = `${s.cappedCount} of ${s.pairCount.toLocaleString('en-US')} station pairs (${capShare.toFixed(1)} percent)`;
  const rangeText =
    uncappedValue > value
      ? `The Uncapped_Range slope is higher than the all-pairs slope, so high is the Uncapped_Range slope multiplied by the monthly trips (${high.toFixed(2)}), not value (${value.toFixed(2)}); the Fare_Cap is charged on ${capText}.`
      : `The Fare_Cap affects only ${capText}. The slope does not rise after excluding them (${s.uncappedSlope.toFixed(4)} against ${s.allSlope.toFixed(4)} TWD per minute per trip), so high equals value (${value.toFixed(2)}). The uncertainty range is provided by low = 0.`;
  const notOpen = options.notOpenPairs ?? 0;
  const method = [
    `Regression: least squares with an intercept of the adult full fare (TWD) on the rail-graph in-vehicle path time (minutes) over ${s.pairCount} station pairs gives ${s.allSlope.toFixed(4)} TWD per minute per trip; value is this slope multiplied by the monthly trips.`,
    `Selection: high is the larger of value and the same regression over the Uncapped_Range multiplied by the monthly trips, ${s.uncappedSlope.toFixed(4)} TWD per minute per trip. ${rangeRule} low is 0, the marginal cost of a minute for a pass holder.`,
    `Monthly trips: commute.tripsPerMonth = ${tripsPerMonth} one-way trips per commuter per month, Parameter_Status ${tripsStatus}.`,
    `Fare cap: fares are capped (maximum ${s.cap ?? 'none'} TWD), so a linear per-minute cost over-estimates long trips. ${rangeText}`,
    notOpen > 0 ? `Not yet open: R01 is not yet open; ${notOpen} station pairs are excluded.` : '',
    'Migration weights: the fares are cited, but the migration weights (migration.weight*, migration.threshold, migration.share) are gap, so how strongly the commuter pass subsidy moves migration is an assumption.',
    'Backtest: the TPASS backtest validates MRT entries only and does not validate migration.',
  ]
    .filter((x) => x !== '')
    .join(' ');  const entry: ScalarParameter = {
    kind: 'scalar',
    value,
    unit: COMMUTE_COST_UNIT,
    status: 'secondary',
    source: FARE_CITATION,
    range: { low: 0, high, lowSource: PASS_CITATION, highSource: FARE_CITATION },
    estimated: { method },
  };
  const issues = checkParameterEntry(COMMUTE_COST_ID, entry);
  if (issues.length > 0) {
    throw new DataError('commute-cost-entry-invalid', COMMUTE_COST_ID, issues.map((i) => i.problem));
  }
  return entry;
}
