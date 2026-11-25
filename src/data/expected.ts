/**
 * Expected shape of the static data files the game reads (Requirements 2.1, 2.5).
 * Parity with the scripts' tables is checked by a test; `src/` never imports `scripts/`.
 */
import type { HistoryIndicatorId } from '../types/data-files.ts';

/** The six files under public/data/ that the Data_Loader fetches, in load order. */
export const DATA_FILE_NAMES = [
  'districts.json',
  'history.json',
  'policy-track.json',
  'events.json',
  'params.json',
  'commute-matrix.json',
] as const;
export type DataFileName = (typeof DATA_FILE_NAMES)[number];

/** Policy series ids policy-track.json must contain, in file order (same as the scripts' POLICY_SERIES_SPECS). */
export const EXPECTED_POLICY_SERIES_IDS: readonly string[] = [
  'socialHousingUnitsStarted',
  'subleaseUnitsMatched',
  'rentSubsidyHouseholds',
  'rentSubsidyAmountPerHousehold',
  'holdingTaxRateLowestTier',
  'holdingTaxRateHighestTier',
  'houseTaxRevenue',
  'commuterPassPrice',
  'commuterPassSubsidy',
  'commuterPassesSold',
];

/** History indicators the game reads (a subset of HISTORY_INDICATOR_IDS). */
export const REQUIRED_HISTORY_INDICATORS: readonly HistoryIndicatorId[] = [
  'population',
  'householdIncome',
  'rent',
  'mrtEntries',
  'socialHousingStock',
  'medianTotalPrice',
];

/** Track series that become tool fields: series id -> tool, field. */
export const TRACK_FIELDS: Readonly<Record<string, { readonly tool: string; readonly field: string }>> = {
  socialHousingUnitsStarted: { tool: 'socialHousing', field: 'unitsStarted' },
  commuterPassSubsidy: { tool: 'commuterPass', field: 'subsidy' },
  commuterPassesSold: { tool: 'commuterPass', field: 'passesSold' },
  rentSubsidyHouseholds: { tool: 'rentSubsidy', field: 'households' },
  rentSubsidyAmountPerHousehold: { tool: 'rentSubsidy', field: 'amount' },
  subleaseUnitsMatched: { tool: 'sublease', field: 'unitsMatched' },
  holdingTaxRateLowestTier: { tool: 'holdingTax', field: 'lowestRate' },
  holdingTaxRateHighestTier: { tool: 'holdingTax', field: 'highestRate' },
};

/** Policy series holding the commuter pass price; it becomes per-city, per-quarter parameters. */
export const PASS_PRICE_SERIES = 'commuterPassPrice';
