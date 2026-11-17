// Indicator and policy series metadata (design: "Indicator list" and "Policy series").
// This is metadata only: the records (`series`) are added by the build tasks.
import type { IndicatorKind, PolicyToolId } from '../../../src/types/data-files.ts';

export interface IndicatorSpec {
  readonly id: string;
  readonly level: 'district' | 'city';
  readonly unit: string;
  readonly kind: IndicatorKind;
  readonly decimals: number;
  readonly periodic?: true; // published per half-year; no-data records allowed (Req 26)
  readonly description: string;
  readonly sources: readonly string[];
}

export interface PolicySeriesSpec extends IndicatorSpec {
  readonly tool: PolicyToolId;
}

const MIGRATION_SOURCES = [
  'population/moi-32975',
  'population/ris-odrp011',
  'population/moi-77144',
  'population/taipei-dbas-a05002802',
  'population/ntpc-124872',
] as const;

const HOLDING_TAX_RATE_SOURCES = ['policy/house-tax-act', 'policy/taipei-ordinance', 'policy/ntpc-ordinance'] as const;

/** Fixed order: the 12 district indicators first, then the 2 city indicators. */
export const INDICATOR_SPECS: readonly IndicatorSpec[] = [
  {
    id: 'population',
    level: 'district',
    unit: 'persons',
    kind: 'count',
    decimals: 0,
    description: 'Registered residents of the district at the end of the quarter.',
    sources: ['population/moi-32973', 'population/ris-odrp014'],
  },
  {
    id: 'moveIn',
    level: 'district',
    unit: 'persons per quarter',
    kind: 'count',
    decimals: 0,
    description: 'Residents who registered a move into the district during the quarter.',
    sources: MIGRATION_SOURCES,
  },
  {
    id: 'moveOut',
    level: 'district',
    unit: 'persons per quarter',
    kind: 'count',
    decimals: 0,
    description: 'Residents who registered a move out of the district during the quarter.',
    sources: MIGRATION_SOURCES,
  },
  {
    id: 'relativeMedianIncome',
    level: 'district',
    unit: 'ratio to city median of district medians',
    kind: 'positive',
    decimals: 4,
    description: 'District median taxable income divided by the median of the district medians of its city.',
    sources: ['income/fia-103066'],
  },
  {
    id: 'householdIncome',
    level: 'district',
    unit: 'TWD per household per year',
    kind: 'positive',
    decimals: 0,
    description: 'Estimated disposable income of an average household in the district.',
    sources: ['income/fia-103066', 'income/dgbas-9415'],
  },
  {
    id: 'salePrice',
    level: 'district',
    unit: 'TWD per m²',
    kind: 'positive',
    decimals: 0,
    description: 'Median unit price of registered residential sales in the district.',
    sources: ['lvr/moi-25119'],
  },
  {
    id: 'rent',
    level: 'district',
    unit: 'TWD per m² per month',
    kind: 'positive',
    decimals: 1,
    description: 'Median monthly rent per square metre of residential rentals in the district.',
    sources: ['lvr/moi-25118', 'macro/taipei-dbas-131822', 'macro/dgbas-6019', 'rent/moi-rent-stats'],
  },
  {
    id: 'mrtEntries',
    level: 'district',
    unit: 'entries per quarter',
    kind: 'count',
    decimals: 0,
    description: 'Metro station entries in the district during the quarter.',
    sources: ['mrt/trtc-133184', 'mrt/trtc-128683', 'stations/tdx-metro-station', 'boundaries/moi-7441'],
  },
  {
    id: 'socialHousingCompletions',
    level: 'district',
    unit: 'units per quarter',
    kind: 'count',
    decimals: 0,
    description: 'Social housing units completed in the district during the quarter.',
    sources: ['social-housing/nlma-portal'],
  },
  {
    id: 'socialHousingStock',
    level: 'district',
    unit: 'units',
    kind: 'count',
    decimals: 0,
    description: 'Social housing units in operation in the district at the end of the quarter.',
    sources: ['social-housing/nlma-portal'],
  },
  {
    id: 'lowUseHousingCount',
    level: 'district',
    unit: 'dwellings',
    kind: 'count',
    decimals: 0,
    periodic: true,
    description: 'Dwellings in the district with an average monthly electricity use of at most 60 kWh.',
    sources: ['housing/moi-low-use'],
  },
  {
    id: 'lowUseHousingRate',
    level: 'district',
    unit: 'percent of dwellings',
    kind: 'percent',
    decimals: 2,
    periodic: true,
    description: 'Share of the dwellings in the district with an average monthly electricity use of at most 60 kWh.',
    sources: ['housing/moi-low-use'],
  },
  {
    id: 'cityDisposableIncome',
    level: 'city',
    unit: 'TWD per household per year',
    kind: 'positive',
    decimals: 0,
    description: 'Average disposable income per household in the city.',
    sources: ['income/dgbas-9415'],
  },
  {
    id: 'priceToIncomeRatio',
    level: 'city',
    unit: 'years of income',
    kind: 'positive',
    decimals: 2,
    description: 'Median home price divided by median household disposable income in the city.',
    sources: ['lvr/moi-25119', 'income/dgbas-9415'],
  },
];

/** Fixed order, as written to policy-track.json. */
export const POLICY_SERIES_SPECS: readonly PolicySeriesSpec[] = [
  {
    id: 'socialHousingUnitsStarted',
    tool: 'socialHousing',
    level: 'district',
    unit: 'units per quarter',
    kind: 'count',
    decimals: 0,
    description: 'Social housing units whose construction started in the district during the quarter.',
    sources: ['social-housing/nlma-portal'],
  },
  {
    id: 'subleaseUnitsMatched',
    tool: 'sublease',
    level: 'city',
    unit: 'units per quarter',
    kind: 'count',
    decimals: 0,
    description: 'Homes newly matched under the sublease and rental management program during the quarter.',
    sources: ['policy/moi-b5010'],
  },
  {
    id: 'rentSubsidyHouseholds',
    tool: 'rentSubsidy',
    level: 'city',
    unit: 'households',
    kind: 'count',
    decimals: 0,
    description: 'Households receiving a rent subsidy in the quarter.',
    sources: ['policy/moi-e3010'],
  },
  {
    id: 'rentSubsidyAmountPerHousehold',
    tool: 'rentSubsidy',
    level: 'city',
    unit: 'TWD per household per month',
    kind: 'non-negative',
    decimals: 0,
    description: 'Average monthly rent subsidy paid per household.',
    sources: ['policy/moi-169800'],
  },
  {
    id: 'holdingTaxRateLowestTier',
    tool: 'holdingTax',
    level: 'city',
    unit: 'percent of assessed house value',
    kind: 'percent',
    decimals: 2,
    description: 'Lowest house tax rate applied to residential buildings that are not self-occupied.',
    sources: HOLDING_TAX_RATE_SOURCES,
  },
  {
    id: 'holdingTaxRateHighestTier',
    tool: 'holdingTax',
    level: 'city',
    unit: 'percent of assessed house value',
    kind: 'percent',
    decimals: 2,
    description: 'Highest house tax rate applied to residential buildings that are not self-occupied.',
    sources: HOLDING_TAX_RATE_SOURCES,
  },
  {
    id: 'houseTaxRevenue',
    tool: 'holdingTax',
    level: 'city',
    unit: 'NT$ thousand per quarter',
    kind: 'count',
    decimals: 0,
    description: 'House tax collected in the city during the quarter.',
    sources: ['policy/mof-6742'],
  },
  {
    id: 'commuterPassPrice',
    tool: 'commuterPass',
    level: 'city',
    unit: 'TWD per 30-day pass',
    kind: 'non-negative',
    decimals: 0,
    description: 'Price of the 30-day commuter pass in the quarter; 0 before the first pass product.',
    sources: ['policy/trtc-products'],
  },
  {
    id: 'commuterPassSubsidy',
    tool: 'commuterPass',
    level: 'city',
    unit: 'TWD per 30-day pass',
    kind: 'non-negative',
    decimals: 0,
    description: 'Public subsidy per 30-day commuter pass in the quarter; 0 before the first pass product.',
    sources: ['policy/trtc-products'],
  },
  {
    id: 'commuterPassesSold',
    tool: 'commuterPass',
    level: 'city',
    unit: 'passes per quarter',
    kind: 'count',
    decimals: 0,
    description: 'Commuter passes sold in the quarter; 0 before the first pass product.',
    sources: ['policy/taipei-dot-2019', 'population/ris-odrp014'],
  },
];
