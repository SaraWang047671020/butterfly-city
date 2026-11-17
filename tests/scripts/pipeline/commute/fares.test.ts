import { describe, expect, it } from 'vitest';
import {
  COMMUTE_COST_ID,
  COMMUTE_COST_UNIT,
  PASS_UNIT_NORMALISATION,
  commuteCostEntry,
  fareSlopes,
  pairFaresWithTimes,
  parseFares,
  type FarePair,
  type FareRow,
} from '../../../../scripts/pipeline/commute/fares.ts';
import { fareSlopeStep, formatFareLine } from '../../../../scripts/pipeline/commute/step.ts';
import { DataError, ParseError } from '../../../../scripts/pipeline/errors.ts';
import { POLICY_SERIES_SPECS } from '../../../../scripts/pipeline/registry/indicators.ts';

const fare = (from: string, to: string, fares: object[]) => ({ OriginStationID: from, DestinationStationID: to, Fares: fares });
const adult = (price: number) => ({ TicketType: 1, FareClass: 1, Price: price });

const pair = (i: number, minutes: number, f: number): FarePair => ({ from: `S${i}`, to: `T${i}`, fare: f, minutes });
const pairsOf = (points: readonly (readonly [number, number])[]): FarePair[] => points.map(([m, f], i) => pair(i, m, f));

// Fare = 10 + 2 x minutes, capped at 60 TWD from 25 minutes
const CAPPED = pairsOf([
  [5, 20],
  [10, 30],
  [15, 40],
  [20, 50],
  [25, 60],
  [30, 60],
  [35, 60],
]);

describe('parseFares', () => {
  it('reads the adult full fare, and leaves other tickets and citizen fares undefined', () => {
    const rows = parseFares(
      'f.json',
      JSON.stringify([
        fare('A', 'B', [adult(20), { TicketType: 2, FareClass: 1, Price: 10 }]),
        fare('A', 'C', [{ TicketType: 2, FareClass: 1, Price: 10 }]),
        fare('A', 'D', [{ ...adult(5), CitizenCode: 'x' }]),
      ]),
    );
    expect(rows).toEqual([
      { from: 'A', to: 'B', fare: 20 },
      { from: 'A', to: 'C', fare: undefined },
      { from: 'A', to: 'D', fare: undefined },
    ]);
  });

  it('strips a byte order mark', () => {
    expect(parseFares('f.json', `\uFEFF${JSON.stringify([fare('A', 'B', [adult(20)])])}`)).toHaveLength(1);
  });

  it('stops with the row and the expected columns when a column is missing', () => {
    let error: unknown;
    try {
      parseFares('f.json', JSON.stringify([fare('A', 'B', [adult(20)]), { OriginStationID: 'A', DestinationStationID: 'C' }]));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ParseError);
    expect((error as ParseError).row).toBe(2);
    expect((error as ParseError).expected).toContain('Fares[].Price');
  });

  it('stops on a Fares entry without Price and on a non-finite Price', () => {
    expect(() => parseFares('f.json', JSON.stringify([fare('A', 'B', [{ TicketType: 1, FareClass: 1 }])]))).toThrow(ParseError);
    expect(() => parseFares('f.json', JSON.stringify([fare('A', 'B', [{ TicketType: 1, FareClass: 1, Price: 'x' }])]))).toThrow(ParseError);
  });
});

describe('pairFaresWithTimes', () => {
  const rows: FareRow[] = [
    { from: 'A', to: 'B', fare: 20 },
    { from: 'A', to: 'C', fare: undefined },
    { from: 'A', to: 'D', fare: 30 },
    { from: 'A', to: 'A', fare: 0 },
    { from: 'A', to: 'B', fare: 20 },
    { from: 'R01', to: 'A', fare: 40 },
  ];
  const times = new Map([['A>B', 4]]);
  const result = pairFaresWithTimes(rows, (a, b) => times.get(`${a}>${b}`));

  it('keeps the pair that has a fare and a path time', () => {
    expect(result.pairs).toEqual([{ from: 'A', to: 'B', fare: 20, minutes: 4 }]);
    expect(result.rows).toBe(6);
  });

  it('excludes and counts a pair without a fare, a pair without a path time, and the other reasons', () => {
    expect(result.excluded).toEqual({
      'same-station': { count: 1, examples: ['A>A'] },
      'no-adult-fare': { count: 1, examples: ['A>C'] },
      'no-path-time': { count: 1, examples: ['A>D'] },
      'duplicate-pair': { count: 1, examples: ['A>B'] },
      'not-open-2025Q4': { count: 1, examples: ['R01>A'] },
    });
  });

  it('does not look up a path time for a station that is not open by 2025Q4', () => {
    const asked: string[] = [];
    pairFaresWithTimes([{ from: 'R01', to: 'A', fare: 40 }], (a, b) => {
      asked.push(`${a}>${b}`);
      return 9;
    });
    expect(asked).toEqual([]);
  });
});

describe('commuteCostEntry', () => {
  it('sets high to the Uncapped_Range slope when that slope is higher than the all-pairs slope', () => {
    const slopes = fareSlopes(CAPPED);
    expect([slopes.cap, slopes.tCap, slopes.cappedCount, slopes.uncappedCount]).toEqual([60, 25, 3, 4]);
    expect(slopes.uncappedSlope).toBeCloseTo(2, 10);
    expect(slopes.allSlope).toBeCloseTo(1000 / 700, 10);

    const entry = commuteCostEntry(CAPPED, 44);
    expect(entry.value).toBeCloseTo(44000 / 700, 8); // 62.857...
    expect(entry.range?.low).toBe(0);
    expect(entry.range?.high).toBeCloseTo(88, 8);
    expect(entry.unit).toBe('TWD per minute per commuter per month');
    expect(entry.status).toBe('secondary');
    expect(entry.range?.lowSource.url).not.toBe('');
    expect(entry.range?.highSource.citation).not.toBe('');
    expect(entry.estimated?.method).toContain('3 of 7 station pairs');
  });

  it('sets high equal to value when the Uncapped_Range slope is lower than the all-pairs slope', () => {
    const lowerUncapped = pairsOf([
      [5, 20],
      [10, 22],
      [15, 24],
      [20, 60],
      [25, 60],
    ]);
    const slopes = fareSlopes(lowerUncapped);
    expect(slopes.uncappedSlope).toBeCloseTo(0.4, 10);
    expect(slopes.allSlope).toBeCloseTo(2.36, 10);
    const entry = commuteCostEntry(lowerUncapped, 44);
    expect(entry.value).toBeCloseTo(103.84, 8);
    expect(entry.range?.high).toBe(entry.value);
    expect(entry.estimated?.method).toContain('so high equals value');
  });

  it('sets high equal to value when no pair is charged the Fare_Cap', () => {
    const noCap = pairsOf([
      [5, 20],
      [10, 30],
      [15, 40],
      [20, 50],
    ]);
    const slopes = fareSlopes(noCap, 100);
    expect([slopes.tCap, slopes.cappedCount, slopes.uncappedCount]).toEqual([undefined, 0, 4]);
    const entry = commuteCostEntry(noCap, 44, { cap: 100 });
    expect(entry.value).toBeCloseTo(88, 8);
    expect(entry.range?.high).toBe(entry.value);
    expect(entry.estimated?.method).toContain('No pair is charged the Fare_Cap');
  });

  it('stops with DataError naming the id, the three values and the pair count when value is negative', () => {
    const falling = pairsOf([
      [5, 50],
      [10, 40],
      [15, 30],
    ]);
    let error: unknown;
    try {
      commuteCostEntry(falling, 44, { cap: 100 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DataError);
    const de = error as DataError;
    expect(de.subject).toBe(COMMUTE_COST_ID);
    expect(de.details[0]).toContain('low 0, value -88, high -88');
    expect(de.details[1]).toBe('pairs: 3 (Uncapped_Range 3)');
  });

  it('stops with DataError on a non-finite slope', () => {
    const infinite = pairsOf([
      [5, 20],
      [10, Infinity],
      [15, 40],
    ]);
    expect(() => commuteCostEntry(infinite, 44)).toThrow(DataError);
  });

  it('stops with DataError when the path times have no spread (slope undefined)', () => {
    const flat = pairsOf([
      [5, 20],
      [5, 30],
    ]);
    let error: unknown;
    try {
      commuteCostEntry(flat, 44);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).subject).toBe(COMMUTE_COST_ID);
  });

  it('adds the not-open statement only when pairs were excluded for it', () => {
    expect(commuteCostEntry(CAPPED, 44, { notOpenPairs: 2 }).estimated?.method).toContain('R01 is not yet open; 2 station pairs are excluded.');
    expect(commuteCostEntry(CAPPED, 44).estimated?.method).not.toContain('R01');
  });
});

describe('units', () => {
  it('multiplying the unit of migration.commuteCostPerMinute by minutes gives TWD per commuter per month', () => {
    // "TWD per minute per commuter per month" x "minutes": the minute cancels the "per minute" factor
    const perMinute = ' per minute';
    expect(COMMUTE_COST_UNIT.split(perMinute)).toHaveLength(2);
    expect(COMMUTE_COST_UNIT.replace(perMinute, '')).toBe('TWD per commuter per month');
  });

  it('the commuterPassSubsidy unit denotes the same quantity after the normalisation table', () => {
    const subsidy = POLICY_SERIES_SPECS.find((s) => s.id === 'commuterPassSubsidy');
    expect(subsidy?.unit).toBe('TWD per 30-day pass');
    const normalised = (subsidy?.unit ?? '').replace('30-day pass', PASS_UNIT_NORMALISATION['30-day pass'] ?? '');
    expect(normalised).toBe('TWD per commuter per month');
    expect(normalised).toBe(COMMUTE_COST_UNIT.replace(' per minute', ''));
    expect(PASS_UNIT_NORMALISATION['pass per month']).toBe('commuter per month');
  });
});

describe('fare slope step', () => {
  it('prints one line with the pairs used, the excluded counts, the slopes and the three values', () => {
    const rows: FareRow[] = [...CAPPED.map((p) => ({ from: p.from, to: p.to, fare: p.fare })), { from: 'X', to: 'Y', fare: undefined }];
    const minutes = new Map(CAPPED.map((p) => [`${p.from}>${p.to}`, p.minutes]));
    const pairing = pairFaresWithTimes(rows, (a, b) => minutes.get(`${a}>${b}`));
    const slopes = fareSlopes(pairing.pairs, pairing.cap);
    const entry = commuteCostEntry(pairing.pairs, 44, { cap: pairing.cap as number });
    expect(formatFareLine({ pairing, slopes, entry })).toBe(
      'fares: 7 pairs used, excluded: no-adult-fare 1; slope all 1.4286, uncapped 2.0000 TWD/min/trip; ' +
        '62.86 (low 0.00, high 88.00) TWD/min/month',
    );
  });

  it('stops when the network step has not run', () => {
    expect(() => fareSlopeStep().run({} as never, {} as never)).toThrow(DataError);
  });
});
