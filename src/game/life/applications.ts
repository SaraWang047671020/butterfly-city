// Applications of the Character for social housing and the rent subsidy (life-story Requirement 3, design
// "Applications"). Pure. The odds of a track scale the real odds by the supply of that track:
//   odds_t = min(1, oddsReal × supply_t ÷ supplyReal)
// which is Requirement 3.2 (supply ÷ applicants) with the applicants implied by the published real odds. Both tracks
// use one Shared_Draw, so a different result is caused by the supply (the policy) and nothing else.
import { quarterAt, quarterIndex } from '../../simulation/quarter.ts';
import type { QuarterKey } from '../../types/data-files.ts';
import { hashSeed, mulberry32 } from '../random.ts';
import type { Benefit, LifeState } from './life-state.ts';

export type City = 'Taipei' | 'New Taipei';
export type Track = 'player' | 'real';

/** A value per year; missing years are interpolated (see `valueAtYear`). */
export type ByYear = Readonly<Record<string, number>>;

/** The Application_Supply_File in the shape the game reads (validated by the loader). */
export interface ApplicationSupply {
  readonly socialHousing: {
    readonly realOdds: Readonly<Record<City, { readonly byYear: ByYear; readonly fallback: number }>>;
    readonly incomeLimit: Readonly<Record<City, ByYear>>;
    readonly leaseQuarters: number;
    readonly maxQuarters: number;
    readonly turnoverQuarters: number;
    readonly rentShare: Readonly<Record<City, number>>;
  };
  readonly rentSubsidy: {
    readonly realOdds: Readonly<Record<City, { readonly byYear: ByYear; readonly fallback: number }>>;
    readonly minimumLivingExpense: Readonly<Record<City, ByYear>>;
    readonly incomeMultiple: readonly { readonly from: QuarterKey; readonly k: number }[];
    readonly singleUnder40: { readonly city: City; readonly until: QuarterKey };
    readonly multipliers: {
      readonly from: QuarterKey;
      readonly singleYouth: number;
      readonly newlywed: number;
      readonly newlywedQuarters: number;
      readonly children: readonly number[];
    };
  };
}

const yearOf = (q: QuarterKey): number => Number(q.slice(0, 4));

/** The value of `year`: the known value, linear between the nearest known years, else the nearest known value. */
export function valueAtYear(table: ByYear, year: number): number | null {
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (years.length === 0) return null;
  const exact = table[String(year)];
  if (exact !== undefined) return exact;
  const before = years.filter((y) => y < year).pop();
  const after = years.find((y) => y > year);
  if (before === undefined) return table[String(after)]!;
  if (after === undefined) return table[String(before)]!;
  const a = table[String(before)]!;
  const b = table[String(after)]!;
  return a + ((b - a) * (year - before)) / (after - before);
}

/** The real odds of a benefit in a city and year: the published value of the year, else the stated fallback. */
export function realOdds(s: ApplicationSupply, benefit: Benefit, city: City, year: number): number {
  const t = s[benefit].realOdds[city];
  return t.byYear[String(year)] ?? t.fallback;
}

/**
 * The odds on a track. `supplyReal` is the real supply of the quarter; when it is 0 (no lettings in real history that
 * quarter), the player's supply is compared with the mean real supply of the city instead, and the real odds are 0.
 */
export function trackOdds(real: number, supplyTrack: number, supplyReal: number, meanSupplyReal: number): number {
  const base = supplyReal > 0 ? supplyReal : meanSupplyReal;
  if (base <= 0 || supplyTrack <= 0) return 0;
  return Math.min(1, Math.max(0, (real * supplyTrack) / base));
}

/** The Shared_Draw of an Application: one number in [0, 1) from the seed, the benefit and the quarter. */
export function sharedDraw(seed: number, benefit: Benefit, quarter: QuarterKey): number {
  return mulberry32(hashSeed(`${seed}:${benefit}:${quarter}`))();
}

/** An Application succeeds on a track WHEN its Shared_Draw is below the odds of that track (Requirement 3.3). */
export const succeeds = (draw: number, odds: number): boolean => draw < odds;

export type Ineligible =
  | { readonly ok: false; readonly rule: 'income'; readonly limit: number; readonly value: number }
  | { readonly ok: false; readonly rule: 'singleUnder40' }
  | { readonly ok: false; readonly rule: 'tenure' }
  | { readonly ok: false; readonly rule: 'noIncome' };

export type Eligibility = { readonly ok: true } | Ineligible;

export interface Household {
  readonly city: City;
  /** Sum of the earners' wages, TWD per month; null when a wage is missing. */
  readonly incomeMonth: number | null;
  readonly persons: number;
  readonly state: LifeState;
}

/** The monthly income multiple of the minimum living expense for the rent subsidy in `quarter`. */
export function incomeMultiple(s: ApplicationSupply, quarter: QuarterKey): number {
  const qi = quarterIndex(quarter);
  let k = s.rentSubsidy.incomeMultiple[0]?.k ?? 0;
  for (const step of s.rentSubsidy.incomeMultiple) if (quarterIndex(step.from) <= qi) k = step.k;
  return k;
}

const isSingle = (state: LifeState): boolean => !state.members.some((m) => m.kind === 'partner' || m.kind === 'child');

/** Eligibility of the household for a benefit in `quarter` (Requirement 3.1; values in the Application_Supply_File). */
export function eligibility(s: ApplicationSupply, benefit: Benefit, h: Household, quarter: QuarterKey): Eligibility {
  if (h.incomeMonth === null) return { ok: false, rule: 'noIncome' };
  const year = yearOf(quarter);
  if (benefit === 'socialHousing') {
    if (h.state.tenure === 'social') return { ok: false, rule: 'tenure' };
    const limit = valueAtYear(s.socialHousing.incomeLimit[h.city], year) ?? 0;
    const value = h.incomeMonth * 12;
    return value < limit ? { ok: true } : { ok: false, rule: 'income', limit, value };
  }
  if (h.state.tenure !== 'renting') return { ok: false, rule: 'tenure' };
  const rule = s.rentSubsidy.singleUnder40;
  if (h.city === rule.city && isSingle(h.state) && quarterIndex(quarter) <= quarterIndex(rule.until)) return { ok: false, rule: 'singleUnder40' };
  const limit = incomeMultiple(s, quarter) * (valueAtYear(s.rentSubsidy.minimumLivingExpense[h.city], year) ?? 0);
  const value = h.incomeMonth / Math.max(1, h.persons);
  return value < limit ? { ok: true } : { ok: false, rule: 'income', limit, value };
}

/**
 * The last quarter of a rent subsidy that starts in `from`: 4 quarters (12 months). The real programme pays for the
 * calendar year, back to the month of the application, and households apply again each year; paying from the quarter
 * after the result for 4 quarters keeps the 12 months without paying for a quarter before the result (assumption of
 * the Application_Supply_File, `period`).
 */
export const subsidyUntil = (from: QuarterKey): QuarterKey => quarterAt(quarterIndex(from) + 3);

/**
 * The rent subsidy multiplier of the household from the multiplier quarter (2022Q3): single under 40, married within
 * `newlywedQuarters`, or the number of children; the largest one that applies (assumption of the file). 1 before.
 */
export function subsidyMultiplier(s: ApplicationSupply, state: LifeState, quarter: QuarterKey): number {
  const m = s.rentSubsidy.multipliers;
  const qi = quarterIndex(quarter);
  if (qi < quarterIndex(m.from)) return 1;
  const options = [1];
  const children = state.members.filter((x) => x.kind === 'child').length;
  if (children > 0) options.push(m.children[Math.min(children, m.children.length) - 1] ?? 1);
  if (isSingle(state)) options.push(m.singleYouth);
  if (state.married && state.marriedIn !== undefined && qi - quarterIndex(state.marriedIn) < m.newlywedQuarters) options.push(m.newlywed);
  return Math.max(...options);
}

/** Quarters in social housing in `quarter` (0 in the quarter of moving in); null when not in social housing. */
export function tenancyQuarters(state: LifeState, quarter: QuarterKey): number | null {
  if (state.tenure !== 'social' || state.socialSince === undefined) return null;
  return quarterIndex(quarter) - quarterIndex(state.socialSince);
}

/** The tenancy ends after `quarter` WHEN the maximum is reached, or at a lease renewal WHEN the household is no longer eligible. */
export function tenancyEnds(s: ApplicationSupply, h: Household, quarter: QuarterKey): 'limit' | 'income' | null {
  const q = tenancyQuarters(h.state, quarter);
  if (q === null) return null;
  const next = q + 1;
  if (next >= s.socialHousing.maxQuarters) return 'limit';
  if (next % s.socialHousing.leaseQuarters === 0) {
    const asRenter = eligibility(s, 'socialHousing', { ...h, state: { ...h.state, tenure: 'renting' } }, quarter);
    if (!asRenter.ok && asRenter.rule === 'income') return 'income';
  }
  return null;
}
