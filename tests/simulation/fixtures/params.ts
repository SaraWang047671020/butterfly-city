// A complete valid Parameter_Table for engine tests, built in memory.
// Every required id of the design's parameter table is present, with status, estimated and assumption
// where the metadata checks require them. Values are test values, not research values.

import type {
  Citation,
  Estimated,
  ParameterRange,
  ParameterStatus,
  ParameterTable,
  ScalarParameter,
  ScheduleParameter,
} from '../../../src/types/simulation.ts';
import { quarterAt } from '../../../src/simulation/quarter.ts';
import { CITIES, DISTRICT_CODES } from './districts.ts';
import { passPrice } from './baseline.ts';

export const FIXTURE_CITATION: Citation = {
  citation: 'Test fixture',
  url: 'https://example.org/fixture',
};

export type ParameterEntry = ScalarParameter | ScheduleParameter;

interface ScalarOptions {
  readonly unit?: string;
  readonly status?: ParameterStatus;
  readonly range?: readonly [number, number];
  readonly estimated?: string;
  readonly assumption?: string;
}

function makeRange(low: number, high: number): ParameterRange {
  return { low, high, lowSource: FIXTURE_CITATION, highSource: FIXTURE_CITATION };
}

/** A scalar parameter with a fixture citation. Status defaults to `verified`. */
export function scalar(value: number, options: ScalarOptions = {}): ScalarParameter {
  const estimated: Estimated | undefined =
    options.estimated === undefined ? undefined : { method: options.estimated };
  return {
    kind: 'scalar',
    value,
    unit: options.unit ?? 'unit',
    source: FIXTURE_CITATION,
    status: options.status ?? 'verified',
    ...(options.range === undefined ? {} : { range: makeRange(options.range[0], options.range[1]) }),
    ...(estimated === undefined ? {} : { estimated }),
    ...(options.assumption === undefined ? {} : { assumption: options.assumption }),
  };
}

export function schedule(
  offsets: readonly number[],
  shares: readonly number[],
  status: ParameterStatus = 'verified',
): ScheduleParameter {
  return { kind: 'schedule', offsets, shares, unit: 'share', source: FIXTURE_CITATION, status };
}

const LIMIT_FIELDS: readonly { readonly tool: string; readonly field: string; readonly upper: boolean }[] = [
  { tool: 'socialHousing', field: 'unitsStarted', upper: true },
  { tool: 'commuterPass', field: 'subsidy', upper: false }, // upper limit is the pass price
  { tool: 'rentSubsidy', field: 'households', upper: true },
  { tool: 'rentSubsidy', field: 'amount', upper: true },
];

/** The complete valid table as a mutable record, so callers can adjust it before freezing. */
function buildEntries(): Record<string, ParameterEntry> {
  const p: Record<string, ParameterEntry> = {};

  // Social housing
  p['socialHousing.lag'] = scalar(12, {
    unit: 'quarters',
    status: 'secondary',
    estimated: 'Median of NLMA portal projects, whole quarters (NLMA derivation, fixture value).',
  });
  p['socialHousing.unitCost'] = scalar(7_800_000, {
    unit: 'TWD per dwelling',
    status: 'secondary',
    range: [5_450_000, 8_600_000],
    estimated: 'Three Taipei projects, fixture value.',
  });
  p['socialHousing.costSchedule'] = schedule([0, 1, 2, 3], [0.25, 0.25, 0.25, 0.25]);
  p['socialHousing.rentPerUnit'] = scalar(0, {
    unit: 'TWD per m2 per month per unit',
    status: 'secondary',
    range: [-0.002, 0.005],
    estimated: 'Converted from a percent-of-sale-price estimate, fixture value.',
  });
  p['socialHousing.rentRatio'] = scalar(0.8, {
    unit: 'share of market rent',
    status: 'secondary',
    range: [0.5, 0.9],
    estimated: 'Tenant rent share reported in research notes, fixture value.',
    assumption: 'Taipei and New Taipei social housing rent rules are still to be checked.',
  });

  // Other tools
  p['commuterPass.lag'] = scalar(1, { unit: 'quarters' });
  p['rentSubsidy.lag'] = scalar(1, { unit: 'quarters' });
  p['commuterPass.unitCost'] = scalar(1, { unit: 'TWD of budget per TWD of subsidy' });
  p['rentSubsidy.unitCost'] = scalar(1, { unit: 'TWD of budget per TWD of subsidy' });
  p['commuterPass.elasticity'] = scalar(-0.3, {
    unit: 'elasticity',
    status: 'check',
    range: [-0.5, -0.2],
  });
  p['rentSubsidy.passThrough'] = scalar(0.5, {
    unit: 'share',
    status: 'secondary',
    range: [0.16, 0.78],
    estimated: 'Range of landlord pass-through studies, fixture value.',
  });
  p['rentSubsidy.nationalBudget'] = scalar(30_000_000_000, { unit: 'TWD per year' });
  p['rentSubsidy.nationalHouseholds'] = scalar(500_000, { unit: 'households' });

  for (const city of CITIES) {
    for (let q = 0; q < 44; q++) {
      p[`commuterPass.price.${city}.${quarterAt(q)}`] = scalar(passPrice(q), { unit: 'TWD per month' });
    }
  }

  // Housing derivations
  p['housing.dwellingSize'] = scalar(30, { unit: 'm2' });
  p['housing.householdSize.Taipei'] = scalar(2.5, { unit: 'persons per household' });
  p['housing.householdSize.New Taipei'] = scalar(2.7, { unit: 'persons per household' });
  p['housing.renterRate.Taipei'] = scalar(0.4, { unit: 'share' });
  p['housing.renterRate.New Taipei'] = scalar(0.35, { unit: 'share' });
  for (const code of DISTRICT_CODES) {
    p[`commute.jobShare.${code}`] = scalar(1 / DISTRICT_CODES.length, { unit: 'share' });
  }

  // Migration
  p['migration.threshold'] = scalar(5, { unit: 'percentage points' });
  p['migration.share'] = scalar(0.01, { unit: 'share' });
  p['migration.exitShare'] = scalar(0.1, { unit: 'share' });
  p['migration.weightTime'] = scalar(0.05, { unit: 'per minute' });
  p['migration.weightBurden'] = scalar(0.05, { unit: 'per percentage point' });
  p['migration.weightCost'] = scalar(0.001, { unit: 'per TWD' });
  p['migration.commuteCostPerMinute'] = scalar(10, { unit: 'TWD per minute per month' });

  // Ghost
  p['ghost.size'] = scalar(1000, { unit: 'residents per ghost' });
  p['ghost.rentThreshold'] = scalar(50, { unit: 'percent of income' }); // no range allowed
  p['ghost.atRiskThreshold'] = scalar(30, { unit: 'percent of income' }); // optional, never read
  p['ghost.commuteThreshold'] = scalar(60, {
    unit: 'minutes one way',
    status: 'secondary',
    range: [45, 60],
    estimated: 'Survey report threshold, fixture value.',
  });
  p['ghost.shareRent'] = scalar(0.15, { unit: 'share' });
  // shareBoth <= min(shareRent, 1 - shareCommuteWithin.high) = min(0.15, 0.3)
  p['ghost.shareBoth'] = scalar(0.03, { unit: 'share' });
  p['ghost.shareCommuteWithin'] = scalar(0.7, {
    unit: 'share',
    status: 'secondary',
    range: [0.55, 0.7],
    estimated: 'Share within 45 and within 60 minutes, fixture value.',
  });
  p['ghost.sensitivityRent'] = scalar(0.02, {
    unit: 'share per percentage point',
    status: 'gap',
    estimated: 'No source yet; fixture value.',
    assumption: 'Fixture assumption: 2 percent of a group crosses the threshold per point.',
  });
  p['ghost.sensitivityCommute'] = scalar(0.001, { unit: 'share per minute' });

  // Limits
  for (const { tool, field, upper } of LIMIT_FIELDS) {
    p[`limit.${tool}.${field}.lowerFactor`] = scalar(0, { unit: 'factor' });
    if (upper) p[`limit.${tool}.${field}.upperFactor`] = scalar(2, { unit: 'factor' });
  }

  // Budget ceilings: present for every tool and year, far above any fixture spending.
  for (const tool of ['socialHousing', 'commuterPass', 'rentSubsidy']) {
    for (let year = 2015; year <= 2025; year++) {
      p[`budget.ceiling.${tool}.${year}`] = scalar(1_000_000_000_000_000, { unit: 'TWD' });
    }
  }

  return p;
}

export interface ParamsOptions {
  /** Replace or add entries. A `null` value removes the id. */
  readonly overrides?: Readonly<Record<string, ParameterEntry | null>>;
}

/** The complete valid Parameter_Table, optionally adjusted. */
export function buildParams(options: ParamsOptions = {}): ParameterTable {
  const entries = buildEntries();
  for (const [id, entry] of Object.entries(options.overrides ?? {})) {
    if (entry === null) delete entries[id];
    else entries[id] = entry;
  }
  return entries;
}

/** Ids of the synthetic Event modifier parameters, `test.modifier.<n>`. */
export function modifierParameterId(n: number): string {
  return `test.modifier.${n}`;
}

/**
 * Adds `test.modifier.<n>` parameters (one per value, n from 0) to a table.
 * Synthetic test tables only: real data never carries a modifier (Requirement 11.9).
 */
export function withModifierParameters(
  table: ParameterTable,
  values: readonly number[],
): ParameterTable {
  const extra: Record<string, ParameterEntry> = {};
  values.forEach((v, n) => {
    extra[modifierParameterId(n)] = scalar(v, { unit: 'multiplier', status: 'check' });
  });
  return { ...table, ...extra };
}
