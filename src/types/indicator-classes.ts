// Indicator_Class bounds of the five Map_Indicators. Single source of truth for the game view
// (legend bounds) and the UI (classification). Types and constants only.
// Bounds: Design_Proposal section 5 (provisional approval 2026-11-18).
// commuteTime bounds rechecked on the Engine output of 2015Q1-2025Q4 in Phase D and changed on 2026-11-23 to
// [35, 45, 60, 80, 100, 130]: no empty class, and 45 and 60 minutes are the commute risk and ghost lines.

export const CLASS_INDICATOR_IDS = [
  'rentBurden',
  'priceToIncome',
  'commuteTime',
  'populationChange',
  'lowUseHousingRate',
] as const;
export type ClassIndicatorId = (typeof CLASS_INDICATOR_IDS)[number];

export interface IndicatorClassSpec {
  readonly unit: string;
  readonly decimals: number; // legend decimals
  readonly scale: 'sequential' | 'diverging';
  readonly bounds: readonly number[]; // ascending inner bounds; classes = bounds.length + 1
}

export const INDICATOR_CLASSES: Readonly<Record<ClassIndicatorId, IndicatorClassSpec>> = {
  rentBurden: { unit: '%', decimals: 0, scale: 'sequential', bounds: [10, 15, 20, 25, 30, 35] },
  priceToIncome: { unit: 'years', decimals: 0, scale: 'sequential', bounds: [4, 7, 9, 11, 13, 16] },
  commuteTime: { unit: 'min', decimals: 0, scale: 'sequential', bounds: [35, 45, 60, 80, 100, 130] },
  populationChange: { unit: '%', decimals: 0, scale: 'diverging', bounds: [-10, -5, -1, 1, 5, 10] },
  lowUseHousingRate: { unit: '%', decimals: 2, scale: 'sequential', bounds: [5, 7.5, 10, 15, 20, 25] },
};
