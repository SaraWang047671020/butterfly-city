// Builders of small but complete valid in-memory data files for validator tests.
// Each call returns a fresh, mutable object so tests can break one field at a time.
// Reused by tests for tasks 13.3 and 14.x.

import type { ValidationContext } from '../../src/data/validate.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export const DISTRICT_COUNT = 41;
export const TAIPEI_DISTRICT_COUNT = 12;

/** 41 ascending 8-digit codes; the first 12 are in Taipei, the rest in New Taipei. */
export const DISTRICT_CODES: readonly string[] = Array.from({ length: DISTRICT_COUNT }, (_, i) =>
  String(65000000 + (i + 1) * 10),
);

export const QUARTERS: readonly string[] = Array.from({ length: 44 }, (_, i) => `${2015 + Math.floor(i / 4)}Q${(i % 4) + 1}`);

export const POLICY_SERIES_IDS: readonly string[] = [
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

export const HISTORY_INDICATOR_IDS: readonly string[] = ['population', 'rent', 'priceToIncomeRatio'];

export function validContext(): ValidationContext {
  return {
    districtCodes: [...DISTRICT_CODES],
    quarters: [...QUARTERS],
    indicatorIds: [...HISTORY_INDICATOR_IDS],
    policySeriesIds: [...POLICY_SERIES_IDS],
  };
}

function source(id: string): Json {
  return {
    id,
    agency: 'Example Agency',
    dataset: 'Example dataset',
    datasetEn: 'Example dataset (English)',
    url: `https://data.example.gov.tw/${id}?api_key=REDACTED&format=json`,
    years: [2015, 2025],
    license: 'Open Government Data License 1.0',
  };
}

function method(id: string, kind: 'interpolation' | 'estimation' | 'missing-reason', appliesTo: string[]): Json {
  return {
    id,
    kind,
    title: `Method ${id}`,
    inputs: ['test/source-a'],
    steps: ['Step one.'],
    appliesTo,
    quarters: '2015Q1–2025Q4',
    setsEstimated: true,
  };
}

function sharedSourcesAndMethods(): { sources: Json[]; methods: Json[] } {
  return {
    sources: [source('test/source-a'), source('test/source-b')],
    methods: [
      method('interp-annual-quarterly', 'interpolation', ['population']),
      method('trend-extrapolation', 'estimation', ['rent']),
      method('no-data-reason', 'missing-reason', ['rent']),
    ],
  };
}

function plain(value: number): Json {
  return { value, estimated: false };
}

function perDistrict(make: (districtIndex: number, quarterIndex: number) => Json): Json {
  const series: Json = {};
  DISTRICT_CODES.forEach((code, d) => {
    series[code] = QUARTERS.map((_, q) => make(d, q));
  });
  return series;
}

function perCity(make: (cityIndex: number, quarterIndex: number) => Json): Json {
  const series: Json = {};
  ['Taipei', 'New Taipei'].forEach((city, c) => {
    series[city] = QUARTERS.map((_, q) => make(c, q));
  });
  return series;
}

export function validHistoryFile(): Json {
  return {
    schemaVersion: 1,
    quarters: [...QUARTERS],
    indicators: [
      {
        id: 'population',
        level: 'district',
        unit: 'persons',
        kind: 'count',
        decimals: 0,
        description: 'Registered residents of the district at the end of the quarter.',
        sources: ['test/source-a'],
        series: perDistrict((d, q) => plain(10000 + d * 100 + q)),
      },
      {
        id: 'rent',
        level: 'district',
        unit: 'TWD per m² per month',
        kind: 'positive',
        decimals: 1,
        description: 'Median asking rent per square metre per month.',
        sources: ['test/source-a', 'test/source-b'],
        series: perDistrict((d, q) => plain(Math.round((400 + d + q / 10) * 10) / 10)),
      },
      {
        id: 'priceToIncomeRatio',
        level: 'city',
        unit: 'ratio',
        kind: 'positive',
        decimals: 2,
        description: 'Median house price divided by median annual household income.',
        sources: ['test/source-b'],
        series: perCity((c, q) => plain(Math.round((10 + c + q / 100) * 100) / 100)),
      },
    ],
    ...sharedSourcesAndMethods(),
  };
}

function round5(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}

export function validDistrictsFile(): Json {
  const districts = DISTRICT_CODES.map((code, i) => {
    const x0 = round5(121 + (i % 10) * 0.1);
    const y0 = round5(24.9 + Math.floor(i / 10) * 0.1);
    const x1 = round5(x0 + 0.05);
    const y1 = round5(y0 + 0.05);
    return {
      code,
      city: i < TAIPEI_DISTRICT_COUNT ? 'Taipei' : 'New Taipei',
      name: `District${i + 1}`,
      areaKm2: 10.5 + i,
      centroid: [round5((x0 + x1) / 2), round5((y0 + y1) / 2)],
      geometry: {
        type: 'Polygon',
        // Clockwise exterior (x east, y north).
        coordinates: [
          [
            [x0, y0],
            [x0, y1],
            [x1, y1],
            [x1, y0],
            [x0, y0],
          ],
        ],
      },
    };
  });
  const prov = { sources: ['test/source-a'] };
  return {
    schemaVersion: 1,
    provenance: {
      code: { ...prov },
      city: { ...prov },
      name: { ...prov },
      areaKm2: { sources: ['test/source-a'], method: 'interp-annual-quarterly' },
      centroid: { ...prov },
      geometry: { ...prov },
    },
    districts,
    ...sharedSourcesAndMethods(),
  };
}

export function validPolicyTrackFile(): Json {
  const rec = (value: number): Json => ({ value, source: 'test/source-a', estimated: false });
  const citySeries = (
    id: string,
    tool: string,
    kind: string,
    decimals: number,
    value: (c: number, q: number) => number,
  ): Json => ({
    id,
    tool,
    level: 'city',
    unit: 'unit',
    kind,
    decimals,
    description: `Real quarterly value of ${id}.`,
    sources: ['test/source-a'],
    series: perCity((c, q) => rec(value(c, q))),
  });
  return {
    schemaVersion: 1,
    quarters: [...QUARTERS],
    policySeries: [
      {
        id: 'socialHousingUnitsStarted',
        tool: 'socialHousing',
        level: 'district',
        unit: 'units',
        kind: 'count',
        decimals: 0,
        description: 'Social housing units started in the district during the quarter.',
        sources: ['test/source-a'],
        series: perDistrict((d, q) => rec(d + q)),
      },
      citySeries('subleaseUnitsMatched', 'sublease', 'count', 0, (c, q) => 100 + c + q),
      citySeries('rentSubsidyHouseholds', 'rentSubsidy', 'count', 0, (c, q) => 5000 + c + q),
      citySeries('rentSubsidyAmountPerHousehold', 'rentSubsidy', 'non-negative', 0, () => 3600),
      citySeries('holdingTaxRateLowestTier', 'holdingTax', 'percent', 2, () => 1.2),
      citySeries('holdingTaxRateHighestTier', 'holdingTax', 'percent', 2, () => 3.6),
      citySeries('houseTaxRevenue', 'holdingTax', 'count', 0, (c, q) => 1000000 + c + q),
      citySeries('commuterPassPrice', 'commuterPass', 'non-negative', 0, () => 1280),
      citySeries('commuterPassSubsidy', 'commuterPass', 'non-negative', 0, () => 0),
      citySeries('commuterPassesSold', 'commuterPass', 'count', 0, (c, q) => 20000 + c + q),
    ],
    ...sharedSourcesAndMethods(),
  };
}
