// Method registry (design: "Method list"). Every estimated or interpolated value points at one entry.
//
// Structure: one array per group, concatenated in a fixed order into METHOD_REGISTRY.
// A later task that needs a new Method_Entry appends it to the end of its own group
// (or adds a group constant and spreads it into METHOD_REGISTRY before the district group).
import type { MethodEntry } from '../../../src/types/data-files.ts';

const ALL_QUARTERS = '2015Q1–2025Q4';

/** Districts.json field methods. `appliesTo` lists districts.json field names. */
const DISTRICT_METHODS: readonly MethodEntry[] = [
  {
    id: 'district-area',
    kind: 'estimation',
    title: 'District area from boundary geometry',
    inputs: ['boundaries/moi-7441'],
    steps: [
      'Project the full-resolution boundary to an equal-area projection.',
      'Compute the polygon area in square kilometres and round to 2 decimals.',
    ],
    appliesTo: ['areaKm2'],
    quarters: 'n/a',
    setsEstimated: true,
  },
  {
    id: 'district-centroid',
    kind: 'estimation',
    title: 'District centroid from boundary geometry',
    inputs: ['boundaries/moi-7441'],
    steps: [
      'Compute the area-weighted centroid of the full-resolution boundary.',
      'Report [longitude, latitude] rounded to 5 decimals.',
    ],
    appliesTo: ['centroid'],
    quarters: 'n/a',
    setsEstimated: true,
  },
  {
    id: 'boundary-simplify',
    kind: 'estimation',
    title: 'Boundary simplification for display',
    inputs: ['boundaries/moi-7441'],
    steps: [
      'Simplify the boundary with a fixed tolerance, keeping shared edges between neighbouring districts identical.',
      'Orient exterior rings clockwise (d3-geo convention) and round coordinates.',
    ],
    appliesTo: ['geometry'],
    quarters: 'n/a',
    setsEstimated: true,
  },
];

/** History and policy-track methods from the design's method table. */
const SERIES_METHODS: readonly MethodEntry[] = [
  {
    id: 'interp-annual-quarterly',
    kind: 'interpolation',
    title: 'Annual values interpolated to quarters',
    inputs: ['income/fia-103066', 'income/dgbas-9415'],
    steps: [
      'Treat each annual value as the value at the middle of its year.',
      'Interpolate linearly between consecutive mid-year points to obtain each quarter.',
    ],
    appliesTo: ['cityDisposableIncome', 'relativeMedianIncome'],
    quarters: '2015Q1–2023Q4 (and all of cityDisposableIncome)',
    setsEstimated: true,
  },
  {
    id: 'income-relative-extrapolation',
    kind: 'estimation',
    title: 'District income ratio extended from the latest trend',
    inputs: ['income/fia-103066'],
    steps: [
      'Fit a linear trend to the district ratio over the latest published years.',
      'Extend the trend to the quarters after the last published year.',
    ],
    appliesTo: ['relativeMedianIncome'],
    quarters: '2024Q1–2025Q4',
    setsEstimated: true,
  },
  {
    id: 'income-district-combination',
    kind: 'estimation',
    title: 'District household income from city income and district ratio',
    inputs: ['income/fia-103066', 'income/dgbas-9415'],
    steps: ['Multiply the city disposable income by the district relative median income of the same quarter.'],
    appliesTo: ['householdIncome'],
    quarters: ALL_QUARTERS,
    setsEstimated: true,
  },
  {
    id: 'migration-2015-seasonal-split',
    kind: 'estimation',
    title: '2015 migration split into quarters',
    inputs: ['population/taipei-dbas-a05002802', 'population/ntpc-124872'],
    steps: [
      'Take the annual 2015 move-in and move-out totals of the district.',
      'Split them over the four quarters using the seasonal shares of later years.',
    ],
    appliesTo: ['moveIn', 'moveOut'],
    quarters: '2015Q1–2015Q4',
    setsEstimated: true,
  },
  {
    id: 'sale-price-pooled-window',
    kind: 'estimation',
    title: 'Sale price from a pooled window for thin cells',
    inputs: ['lvr/moi-25119'],
    steps: [
      'When a district-quarter has too few records, widen the window to neighbouring quarters.',
      'Take the median unit price of the pooled records.',
    ],
    appliesTo: ['salePrice'],
    quarters: 'thin cells only',
    setsEstimated: true,
  },
  {
    id: 'median-total-price-pooled-window',
    kind: 'estimation',
    title: 'Median total price from a pooled window for thin cells',
    inputs: ['lvr/moi-25119'],
    steps: [
      'Count the residential building sales of the district and quarter that pass the sale price filter and have a total price (總價元) greater than 0. The house-price-to-income ratio uses the same sales for its numerator.',
      'When fewer than 10 such sales exist, widen the window to neighbouring quarters by the same rule as the sale price pooled window, counting only these sales.',
      'Take the median total price of the pooled sales.',
      'Dividing this value by the district household income indicator gives a district price-to-income figure; the pipeline publishes the numerator only.',
    ],
    appliesTo: ['medianTotalPrice'],
    quarters: 'thin cells only',
    setsEstimated: true,
  },
  {
    id: 'rent-relative-cpi',
    kind: 'estimation',
    title: 'Rent per m² carried by the city rent price index',
    inputs: ['lvr/moi-25118', 'macro/taipei-dbas-131822', 'macro/dgbas-6019'],
    steps: [
      'Compute the district rent level from rental records where enough exist.',
      'Move the level between quarters with the rent index of the city.',
    ],
    appliesTo: ['rent'],
    quarters: `${ALL_QUARTERS}, districts with ≥ 30 records`,
    setsEstimated: true,
  },
  {
    id: 'rent-reference-stats',
    kind: 'estimation',
    title: 'Rent from MOI rent statistics for reference districts',
    inputs: ['rent/moi-rent-stats', 'macro/taipei-dbas-131822', 'macro/dgbas-6019'],
    steps: [
      'Use the published district rent level as the anchor.',
      'Move the level between quarters with the rent index of the city.',
    ],
    appliesTo: ['rent'],
    quarters: 'reference districts covered by MOI rent statistics',
    setsEstimated: true,
  },
  {
    id: 'rent-reference-sale-ratio',
    kind: 'estimation',
    title: 'Rent from the sale price and a reference rent-to-price ratio',
    inputs: ['lvr/moi-25119', 'macro/taipei-dbas-131822', 'macro/dgbas-6019'],
    steps: [
      'Multiply the district sale price by the rent-to-price ratio observed in reference districts.',
      'Move the level between quarters with the rent index of the city.',
    ],
    appliesTo: ['rent'],
    quarters: 'reference districts not covered by MOI rent statistics',
    setsEstimated: true,
  },
  {
    id: 'price-to-income-computed',
    kind: 'estimation',
    title: 'Price-to-income ratio computed from city series',
    inputs: ['lvr/moi-25119', 'income/dgbas-9415'],
    steps: ['Divide the city median home price by the city disposable income of the same quarter.'],
    appliesTo: ['priceToIncomeRatio'],
    quarters: ALL_QUARTERS,
    setsEstimated: true,
  },
  {
    id: 'mrt-seasonal-split',
    kind: 'estimation',
    title: 'Metro entries split into quarters',
    inputs: ['mrt/trtc-133184', 'mrt/trtc-128683', 'stations/tdx-metro-station', 'boundaries/moi-7441'],
    steps: [
      'Assign each station to the district containing it.',
      'Where only coarser totals exist, split them over the quarters using the seasonal shares of available periods.',
    ],
    appliesTo: ['mrtEntries'],
    quarters: 'every quarter of a district with an Active_Station',
    setsEstimated: true,
  },
  {
    id: 'rent-amount-annual-average',
    kind: 'estimation',
    title: 'Rent subsidy amount from the 2023 annual average',
    inputs: ['policy/moi-169800'],
    steps: ['Divide the 2023 subsidy amount by the 2023 household-months and use it for each quarter of 2023.'],
    appliesTo: ['rentSubsidyAmountPerHousehold'],
    quarters: '2023Q1–2023Q4',
    setsEstimated: true,
  },
  {
    id: 'rent-amount-carry',
    kind: 'estimation',
    title: 'Rent subsidy amount carried from the nearest published year',
    inputs: ['policy/moi-169800'],
    steps: ['Use the 2023 per-household amount for every quarter outside 2023.'],
    appliesTo: ['rentSubsidyAmountPerHousehold'],
    quarters: 'every quarter outside 2023',
    setsEstimated: true,
  },
  {
    id: 'sublease-phase-spread',
    kind: 'estimation',
    title: 'Sublease matches spread across the quarters of each phase',
    inputs: ['policy/moi-b5010'],
    steps: [
      'Take the cumulative matches of each program phase and channel (city-run or central) published by MOI as of 2026-10-31.',
      'Spread each phase total evenly by day from its start date to the start date of the next phase of the same channel, or to the publication date for the last phase.',
      'Count only the days up to 2025-12-31, round the counted share to whole units and split it over the quarters by counted days with the largest remainder rule, so the quarters sum exactly.',
      'Phase 1 has no published start date; 2017-01-01 is assumed.',
    ],
    appliesTo: ['subleaseUnitsMatched'],
    quarters: ALL_QUARTERS,
    setsEstimated: true,
  },
  {
    id: 'holding-tax-statutory-minimum',
    kind: 'estimation',
    title: 'New Taipei house tax rate set to the statutory minimum',
    inputs: ['policy/house-tax-act', 'policy/ntpc-ordinance'],
    steps: ['Where no city ordinance rate is recorded for the last day of the quarter, use the lower limit of the House Tax Act range in force on that day for both the lowest and the highest rate.'],
    appliesTo: ['holdingTaxRateLowestTier', 'holdingTaxRateHighestTier'],
    quarters: 'New Taipei, 2015Q1–2017Q2',
    setsEstimated: true,
  },
  {
    id: 'house-tax-even-split',
    kind: 'estimation',
    title: 'Annual house tax revenue split evenly over quarters',
    inputs: ['policy/mof-6742'],
    steps: ['Round the annual house tax net collection of the city (NT$ thousand) to an integer.', 'Split it into four whole-number quarters with the largest remainder rule, so the quarters sum to the annual figure.'],
    appliesTo: ['houseTaxRevenue'],
    quarters: ALL_QUARTERS,
    setsEstimated: true,
  },
  {
    id: 'commuter-subsidy-definition',
    kind: 'estimation',
    title: 'Commuter pass subsidy per pass',
    inputs: ['policy/trtc-products'],
    steps: ['Set the city subsidy per pass, on top of the published pass price, to 0 in every quarter, because no local-government share is published.'],
    appliesTo: ['commuterPassSubsidy'],
    quarters: ALL_QUARTERS,
    setsEstimated: true,
  },
  {
    id: 'commuter-passes-estimate',
    kind: 'estimation',
    title: 'Commuter passes sold per quarter',
    inputs: ['policy/taipei-dot-2019', 'population/ris-odrp014'],
    steps: [
      'Take the published lower bound of more than 5.15 million commuter passes sold by the end of October 2019 (Taipei City Department of Transportation, reported by Newtalk on 2019-11-27) and spread it over the 564 days from 2018-04-16 to 2019-10-31 as a daily rate.',
      'Weight each city and quarter by the daily rate, the days of the quarter in that period with a pass price above 0, and the city share of the combined resident population of the two cities in that quarter.',
      'Split 5,150,000 over 2018Q2 to 2019Q4 in proportion to these weights with the largest remainder rule, so that period sums exactly.',
      'Hold the daily rate constant after 2019-10-31: add the rounded weight of the days from 2019-11-01 to every quarter from 2019Q4 on. A quarter with a pass price of 0 has 0 passes.',
    ],
    appliesTo: ['commuterPassesSold'],
    quarters: ALL_QUARTERS,
    setsEstimated: true,
  },
];

/** All methods in fixed order. Later tasks append entries to the end of their group above. */
export const METHOD_REGISTRY: readonly MethodEntry[] = [...SERIES_METHODS, ...DISTRICT_METHODS];

const BY_ID: ReadonlyMap<string, MethodEntry> = new Map(METHOD_REGISTRY.map((m) => [m.id, m]));

export function methodById(id: string): MethodEntry {
  const entry = BY_ID.get(id);
  if (entry === undefined) throw new Error(`Unknown method id: ${id}`);
  return entry;
}

/** Entries for the given ids, in registry order, without duplicates. Throws on an unknown id. */
export function referencedMethods(ids: Iterable<string>): MethodEntry[] {
  const wanted = new Set<string>();
  for (const id of ids) {
    methodById(id);
    wanted.add(id);
  }
  return METHOD_REGISTRY.filter((m) => wanted.has(m.id));
}
