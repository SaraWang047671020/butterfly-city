/**
 * Shared types and helpers of the policy track builders (pure, Requirement 12).
 *
 * A builder returns `Record<districtCode | city, TrackRecord[44]>` (quarter order). City-level series use the
 * keys `Taipei` and `New Taipei`.
 */
import type { TrackRecord } from '../../../src/types/data-files.ts';
import type { Quarter } from '../../lib/time.ts';

export const CITIES = ['Taipei', 'New Taipei'] as const;
export type TrackCity = (typeof CITIES)[number];

/** One series of 44 track records (quarter order) per district code. */
export type DistrictTrack = Record<string, TrackRecord[]>;

/** One series of 44 track records (quarter order) per city. */
export type CityTrack = Record<TrackCity, TrackRecord[]>;

/** The ten policy series of the build, keyed by series id (registry order is applied at assembly). */
export interface PolicyTrackSeries {
  readonly socialHousingUnitsStarted: DistrictTrack;
  readonly subleaseUnitsMatched: CityTrack;
  readonly rentSubsidyHouseholds: CityTrack;
  readonly rentSubsidyAmountPerHousehold: CityTrack;
  readonly holdingTaxRateLowestTier: CityTrack;
  readonly holdingTaxRateHighestTier: CityTrack;
  readonly houseTaxRevenue: CityTrack;
  readonly commuterPassPrice: CityTrack;
  readonly commuterPassSubsidy: CityTrack;
  readonly commuterPassesSold: CityTrack;
}

export function observed(value: number, source: string): TrackRecord {
  return { value, source, estimated: false };
}

export function estimatedRecord(value: number, source: string, method: string): TrackRecord {
  return { value, source, estimated: true, method };
}

/** Builds a city series from one function per city and quarter index. */
export function cityTrack(fill: (city: TrackCity) => TrackRecord[]): CityTrack {
  return { Taipei: fill('Taipei'), 'New Taipei': fill('New Taipei') };
}

export const MS_PER_DAY = 86_400_000;

/** Whole days since 1970-01-01 of an ISO date `YYYY-MM-DD` (UTC). */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** ISO date of a day number. */
export function isoDate(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** First day (inclusive) and day after the last day (exclusive) of a quarter, as day numbers. */
export function quarterDayRange(quarter: Quarter): { start: number; endExclusive: number } {
  const year = Number(quarter.slice(0, 4));
  const q = Number(quarter.slice(5));
  const start = Date.UTC(year, (q - 1) * 3, 1) / MS_PER_DAY;
  const endExclusive = Date.UTC(year, q * 3, 1) / MS_PER_DAY;
  return { start, endExclusive };
}

/** Last day of a quarter as an ISO date. */
export function quarterLastDay(quarter: Quarter): string {
  return isoDate(quarterDayRange(quarter).endExclusive - 1);
}

/** Number of days of `[from, to)` that fall in `[start, endExclusive)`. */
export function overlapDays(from: number, to: number, start: number, endExclusive: number): number {
  return Math.max(0, Math.min(to, endExclusive) - Math.max(from, start));
}
