// Display-only conversions of the game core (Requirement 18.4, design decision G9).
// Price_To_Income and Population_Change are the only values computed outside the Engine.

import type { DistrictCode, HistoryFile, QuarterKey, ValueRecord } from '../../types/data-files.ts';
import { roundHalfUp } from '../../simulation/numeric.ts';

export interface PriceToIncome {
  readonly value: number | null;
  readonly estimated: boolean;
  readonly methodIds: readonly string[];
}

const NO_VALUE: PriceToIncome = { value: null, estimated: false, methodIds: [] };

function recordOf(history: HistoryFile, indicatorId: string, code: DistrictCode, q: QuarterKey): ValueRecord | null {
  const indicator = history.indicators.find((i) => i.id === indicatorId);
  if (indicator === undefined || indicator.level !== 'district') return null;
  const index = history.quarters.indexOf(q);
  if (index < 0) return null;
  const series = indicator.series[code];
  return series?.[index] ?? null;
}

function methodOf(record: ValueRecord): string | null {
  return record.estimated ? record.method : null;
}

/**
 * medianTotalPrice ÷ householdIncome of the district and quarter, rounded half up to 2 decimals
 * (Requirements 3.5, 3.6, 3.14). A non-null value is always marked estimated.
 */
export function priceToIncome(history: HistoryFile, code: DistrictCode, q: QuarterKey): PriceToIncome {
  const price = recordOf(history, 'medianTotalPrice', code, q);
  const income = recordOf(history, 'householdIncome', code, q);
  if (price === null || price.value === null) return NO_VALUE;
  if (income === null || income.value === null || income.value === 0) return NO_VALUE;

  const ids: string[] = [];
  for (const record of [income, price]) {
    const id = methodOf(record);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return {
    value: roundHalfUp((price.value / income.value) * 100) / 100,
    estimated: true,
    methodIds: ids,
  };
}

/** (population − base) ÷ base × 100, base = history.json population of 2015Q1; not rounded. */
export function populationChange(population: number, base: number): number {
  return ((population - base) / base) * 100;
}
