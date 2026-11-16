// Constructors for EngineError values and the ok / err result helpers.
// Nothing in this module throws.

import type {
  EngineError,
  EngineErrorCode,
  ParameterIssue,
} from '../types/simulation.ts';

type Details = Readonly<Record<string, string | number | boolean | null>>;

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}

function make(
  code: EngineErrorCode,
  message: string,
  details: Details,
  issues?: readonly ParameterIssue[],
): EngineError {
  return issues === undefined
    ? { code, message: `${code}: ${message}`, details }
    : { code, message: `${code}: ${message}`, details, issues };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function quarterInvalid(received: string, first: string, last: string): EngineError {
  return make(
    'quarter-invalid',
    `quarter "${received}" is not in the form YYYYQn between ${first} and ${last}`,
    { received, first, last },
  );
}

export function noLaterQuarter(quarter: string): EngineError {
  return make('no-later-quarter', `there is no quarter after ${quarter}`, { quarter });
}

export function registryDuplicate(id: string): EngineError {
  return make('registry-duplicate', `two rules share the id "${id}"`, { id });
}

export function ruleReferenceMissing(rule: string, missing: string): EngineError {
  return make(
    'rule-reference-missing',
    `rule "${rule}" refers to "${missing}", which is not present`,
    { rule, missing },
  );
}

export function parametersInvalid(issues: readonly ParameterIssue[]): EngineError {
  const sorted = [...issues].sort(
    (a, b) => compareText(a.parameterId, b.parameterId) || compareText(a.problem, b.problem),
  );
  const list = sorted.map((i) => `${i.parameterId} (${i.problem})`).join(', ');
  return make(
    'parameters-invalid',
    `${sorted.length} parameter problem(s): ${list}`,
    { count: sorted.length },
    sorted,
  );
}

export type CommuteMatrixProblem =
  | { readonly kind: 'size'; readonly rows: number; readonly columns: number }
  | {
      readonly kind: 'cell';
      readonly origin: string;
      readonly destination: string;
      readonly reason: string;
    };

export function commuteMatrixInvalid(problem: CommuteMatrixProblem): EngineError {
  if (problem.kind === 'size') {
    return make(
      'commute-matrix-invalid',
      `matrix has ${problem.rows} rows and ${problem.columns} columns, expected 41 by 41`,
      { rows: problem.rows, columns: problem.columns, reason: 'size' },
    );
  }
  return make(
    'commute-matrix-invalid',
    `matrix cell ${problem.origin} to ${problem.destination} is invalid: ${problem.reason}`,
    { origin: problem.origin, destination: problem.destination, reason: problem.reason },
  );
}

export function baselineMissing(indicator: string, district: string, quarter: string): EngineError {
  return make(
    'baseline-missing',
    `baseline ${indicator} is missing for district ${district} in ${quarter}`,
    { indicator, district, quarter },
  );
}

export function baselineInvalid(
  indicator: string,
  district: string,
  quarter: string,
  value: number | null,
): EngineError {
  return make(
    'baseline-invalid',
    `baseline ${indicator} for district ${district} in ${quarter} is ${String(value)}, expected a finite number of at least 0`,
    { indicator, district, quarter, value },
  );
}

export function trackMissing(input: string, area: string, quarter: string): EngineError {
  return make(
    'track-missing',
    `${input} has no entry for ${area} in ${quarter}`,
    { input, area, quarter },
  );
}

export function policyValueInvalid(
  tool: string,
  field: string,
  area: string,
  quarter: string,
  value: number | null,
  reason?: string,
): EngineError {
  const why = reason === undefined ? '' : `: ${reason}`;
  return make(
    'policy-value-invalid',
    `${tool}.${field} for ${area} in ${quarter} is ${String(value)}${why}`,
    reason === undefined
      ? { tool, field, area, quarter, value }
      : { tool, field, area, quarter, value, reason },
  );
}

export function limitExceeded(
  tool: string,
  field: string,
  area: string,
  period: string,
  value: number,
  side: 'lower' | 'upper',
  limit: number,
  parameterId: string,
): EngineError {
  const word = side === 'upper' ? 'above the upper limit' : 'below the lower limit';
  return make(
    'limit-exceeded',
    `${tool}.${field} ${area} ${period} total ${value} is ${word} ${limit} (${parameterId})`,
    { tool, field, area, period, value, side, limit, parameterId },
  );
}

export function realNetPriceZero(city: string, quarter: string): EngineError {
  return make(
    'real-net-price-zero',
    `real commuter pass net price is 0 while the price is above 0 for ${city} in ${quarter}`,
    { city, quarter },
  );
}

export type HouseholdsExceedRentersWhere =
  | { readonly where: 'rent-subsidy'; readonly city: string }
  | { readonly where: 'social-housing'; readonly district: string };

export function householdsExceedRenters(
  where: HouseholdsExceedRentersWhere,
  quarter: string,
  households: number,
  renters: number,
): EngineError {
  if (where.where === 'rent-subsidy') {
    return make(
      'households-exceed-renters',
      `rent subsidy households ${households} in ${where.city} in ${quarter} exceed renter households ${renters}`,
      { where: where.where, city: where.city, quarter, households, renters },
    );
  }
  return make(
    'households-exceed-renters',
    `social housing households ${households} in district ${where.district} in ${quarter} exceed renter households ${renters}`,
    { where: where.where, district: where.district, quarter, households, renters },
  );
}

export function derivedInputInvalid(id: string, district: string, quarter: string): EngineError {
  return make(
    'derived-input-invalid',
    `derived input ${id} for district ${district} in ${quarter} is missing or not positive`,
    { id, district, quarter },
  );
}

export function eventReferenceUnknown(event: string, value: string): EngineError {
  return make(
    'event-reference-unknown',
    `event "${event}" refers to unknown "${value}"`,
    { event, value },
  );
}

export function eventInvalid(event: string, value: string | number | null): EngineError {
  return make(
    'event-invalid',
    `event "${event}" is invalid: ${String(value)}`,
    { event, value },
  );
}

export function budgetExceeded(
  year: number,
  annualBudget: number,
  committed: number,
): EngineError {
  const over = committed - annualBudget;
  return make(
    'budget-exceeded',
    `year ${year} committed ${committed} is ${over} above the Annual_Budget ${annualBudget}`,
    { year, annualBudget, committed, over },
  );
}

export function ceilingExceeded(
  tool: string,
  year: number,
  ceiling: number,
  committed: number,
): EngineError {
  const over = committed - ceiling;
  return make(
    'ceiling-exceeded',
    `${tool} year ${year} committed ${committed} is ${over} above the Budget_Ceiling ${ceiling}`,
    { tool, year, ceiling, committed, over },
  );
}

export function stockNegative(district: string, quarter: string): EngineError {
  return make(
    'stock-negative',
    `social housing stock in district ${district} in ${quarter} is below 0`,
    { district, quarter },
  );
}

export function nonFinite(quantity: string, district: string, quarter: string): EngineError {
  return make(
    'non-finite',
    `${quantity} for district ${district} in ${quarter} is not a finite number`,
    { quantity, district, quarter },
  );
}
