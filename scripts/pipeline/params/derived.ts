/**
 * Derived parameter entries (task 26.3, Requirements 23.4, 23.5). Pure functions of the part 1 entries.
 *
 *   ghost.shareBoth             shareRent * (1 - shareCommuteWithin.value), independence assumed;
 *                               checked against min(shareRent, 1 - shareCommuteWithin.high)
 *   socialHousing.costSchedule  equal shares over offsets 0 to lag - 1, the last share absorbs the rounding
 */
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { ScalarParameter, ScheduleParameter } from '../../../src/types/simulation.ts';
import { DataError } from '../errors.ts';

export const SHARE_BOTH_ID = 'ghost.shareBoth';
export const COST_SCHEDULE_ID = 'socialHousing.costSchedule';
export const SUBLEASE_SCHEDULE_ID = 'sublease.costSchedule';
export const HOLDING_TAX_SCHEDULE_ID = 'holdingTax.costSchedule';
/** Quarters of one sublease contract (3 years, S19 of data/research/housing-tools-2026-11-24.md). */
export const SUBLEASE_CONTRACT_QUARTERS = 12;

const SHARE_RENT_ID = 'ghost.shareRent';
const SHARE_COMMUTE_WITHIN_ID = 'ghost.shareCommuteWithin';
const LAG_ID = 'socialHousing.lag';

/** Largest accepted rounding difference when comparing the product with its bound. */
const BOUND_TOLERANCE = 1e-12;

export type EntryMap = ReadonlyMap<string, ScalarParameter>;

function scalar(entries: EntryMap, id: string): ScalarParameter {
  const e = entries.get(id);
  if (e === undefined) throw new DataError('derived-input-missing', id);
  return e;
}

function checked<T extends ScalarParameter | ScheduleParameter>(id: string, entry: T): T {
  const issues = checkParameterEntry(id, entry);
  if (issues.length > 0) throw new DataError('derived-entry-invalid', id, issues.map((i) => i.problem));
  return entry;
}

/** `ghost.shareBoth`: share of residents with a rent burden above the threshold and a commute above the threshold. */
export function deriveShareBoth(entries: EntryMap): ScalarParameter {
  const rent = scalar(entries, SHARE_RENT_ID);
  const within = scalar(entries, SHARE_COMMUTE_WITHIN_ID);
  const withinHigh = within.range?.high ?? within.value;
  const value = rent.value * (1 - within.value);
  const bound = Math.min(rent.value, 1 - withinHigh);
  if (value > bound + BOUND_TOLERANCE) {
    throw new DataError('share-both-above-bound', SHARE_BOTH_ID, [
      `shareRent ${rent.value}`,
      `shareCommuteWithin value ${within.value}, high ${withinHigh}`,
      `shareBoth ${value} is above min(shareRent, 1 - shareCommuteWithin.high) = ${bound}`,
    ]);
  }
  const entry: ScalarParameter = {
    kind: 'scalar',
    value,
    unit: 'share of residents',
    status: 'gap',
    source: {
      citation: `Derived from ${SHARE_RENT_ID} and ${SHARE_COMMUTE_WITHIN_ID}; see their sources`,
      url: rent.source.url,
    },
    estimated: {
      method: `${SHARE_RENT_ID} (${rent.value}) times (1 - ${SHARE_COMMUTE_WITHIN_ID}) (1 - ${within.value}); checked to be at most min(shareRent, 1 - shareCommuteWithin.high) = ${bound}`,
    },
    assumption:
      'Independence: a resident being rent burdened and a resident having a long commute are treated as independent events, so the joint share is the product of the two shares. No data on the joint distribution was found; it would replace this assumption.',
  };
  return checked(SHARE_BOTH_ID, entry);
}

/** `socialHousing.costSchedule`: equal shares over offsets 0 to lag - 1; the last share absorbs the rounding. */
export function deriveCostSchedule(entries: EntryMap): ScheduleParameter {
  const lagEntry = scalar(entries, LAG_ID);
  const lag = lagEntry.value;
  if (!Number.isInteger(lag) || lag < 1) {
    throw new DataError('cost-schedule-lag-invalid', LAG_ID, [`lag ${lag} is not an integer of at least 1`]);
  }
  const offsets = Array.from({ length: lag }, (_, i) => i);
  const each = 1 / lag;
  const shares = offsets.map(() => each);
  let head = 0;
  for (let i = 0; i < lag - 1; i += 1) head += shares[i] as number;
  shares[lag - 1] = 1 - head;
  const sum = shares.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new DataError('cost-schedule-sum', COST_SCHEDULE_ID, [`shares sum to ${sum}`]);
  }
  const entry: ScheduleParameter = {
    kind: 'schedule',
    offsets,
    shares,
    unit: 'share of the project cost per quarter after the start',
    status: 'gap',
    source: {
      citation: `Derived from ${LAG_ID} (${lag} quarters); see its source`,
      url: lagEntry.source.url,
    },
    estimated: {
      method: `Equal shares of 1/${lag} at offsets 0 to ${lag - 1} (${LAG_ID} = ${lag}); the last share is 1 minus the sum of the others so the shares sum to 1`,
    },
    assumption:
      'Even payment: the cost of a project is paid in equal amounts in every quarter from start to completion. Payment schedules of completed projects would replace this assumption.',
  };
  return checked(COST_SCHEDULE_ID, entry);
}

/**
 * `sublease.costSchedule`: the cost of one matched home is paid in equal shares over the 12 quarters of its 3-year
 * contract (offsets 0 to 11); the last share absorbs the rounding. Read from `sublease.unitCost` for the source.
 */
export function deriveSubleaseSchedule(entries: EntryMap): ScheduleParameter {
  const cost = scalar(entries, 'sublease.unitCost');
  const n = SUBLEASE_CONTRACT_QUARTERS;
  const offsets = Array.from({ length: n }, (_, i) => i);
  const shares = offsets.map(() => 1 / n);
  let head = 0;
  for (let i = 0; i < n - 1; i += 1) head += shares[i] as number;
  shares[n - 1] = 1 - head;
  const entry: ScheduleParameter = {
    kind: 'schedule',
    offsets,
    shares,
    unit: 'share of the cost of one matched home per quarter after the match',
    status: 'gap',
    source: { citation: `Derived from sublease.unitCost (36 months of fees); see its source`, url: cost.source.url },
    estimated: {
      method: `Equal shares of 1/${n} at offsets 0 to ${n - 1}; the last share is 1 minus the sum of the others so the shares sum to 1`,
    },
    assumption:
      'Even payment: the one-off matching fee is spread over the contract like the monthly fees. Payment records of the programme would replace this assumption.',
  };
  return checked(SUBLEASE_SCHEDULE_ID, entry);
}

/**
 * `holdingTax.costSchedule`: the revenue change of a quarter is moved 4 quarters on, into the next year's Annual_Budget
 * (housing-tools Requirement 5.4). A slot after 2025Q4 is recorded in 2025Q4 by the Engine.
 */
export function deriveHoldingTaxSchedule(): ScheduleParameter {
  const entry: ScheduleParameter = {
    kind: 'schedule',
    offsets: [4],
    shares: [1],
    unit: 'share of the revenue change of a quarter, by quarters after it',
    status: 'gap',
    source: { citation: 'product.md: revenue from the holding tax flows back into the budget; housing-tools Requirement 5.4 (next year)', url: '.kiro/steering/product.md' },
    estimated: { method: 'All of the revenue change of a quarter at offset 4 (the same quarter of the next year).' },
    assumption: 'The revenue of a year reaches the budget of the next year, in the same quarter one year later.',
  };
  return checked(HOLDING_TAX_SCHEDULE_ID, entry);
}
