// Writes the 6 fixture Data_Files next to this file. Run: node tests/data/fixtures/generate.ts
// Values come from the engine fixtures in tests/simulation/fixtures/. Output is deterministic.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineIdSet } from '../../../scripts/pipeline/params/engine-ids.ts';
import { paramSourceType } from './source-types.ts';
import {
  CITIES,
  DISTRICTS,
  DISTRICT_CODES,
  buildBaseline,
  buildCommuteMatrix,
  buildParams,
  passPrice,
  quarterList,
} from '../../simulation/fixtures/index.ts';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const QUARTERS = quarterList(44);

const SOURCE_IDS = ['fixture/source-a', 'fixture/source-b'];
const sources = (): Json[] =>
  SOURCE_IDS.map((id) => ({
    id,
    agency: 'Fixture Agency',
    dataset: 'Fixture dataset',
    datasetEn: 'Fixture dataset (English)',
    url: `https://data.example.gov.tw/${id}`,
    years: [2015, 2025],
    license: 'Open Government Data License 1.0',
  }));

const METHOD_IDS = {
  interp: 'interp-annual-quarterly',
  estimate: 'fixture-estimate',
};
const methods = (): Json[] => [
  {
    id: METHOD_IDS.interp,
    kind: 'interpolation',
    title: 'Fixture interpolation',
    inputs: [SOURCE_IDS[0]],
    steps: ['Interpolate annual values to quarters.'],
    appliesTo: ['cityDisposableIncome'],
    quarters: '2015Q1??025Q4',
    setsEstimated: true,
  },
  {
    id: METHOD_IDS.estimate,
    kind: 'estimation',
    title: 'Fixture estimate',
    inputs: [SOURCE_IDS[0]],
    steps: ['Extrapolate the latest trend.'],
    appliesTo: ['householdIncome', 'rent', 'relativeMedianIncome', 'priceToIncomeRatio'],
    quarters: '2015Q1??025Q4',
    setsEstimated: true,
  },
];

const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;
const plain = (value: number): Json => ({ value, estimated: false });
const est = (value: number): Json => ({ value, estimated: true, method: METHOD_IDS.estimate });

function perDistrict(make: (d: number, q: number) => Json): Json {
  const out: Json = {};
  DISTRICT_CODES.forEach((code, d) => {
    out[code] = QUARTERS.map((_, q) => make(d, q));
  });
  return out;
}
function perCity(make: (c: number, q: number) => Json): Json {
  const out: Json = {};
  CITIES.forEach((city, c) => {
    out[city] = QUARTERS.map((_, q) => make(c, q));
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// districts.json

function districtsFile(): Json {
  const districts = DISTRICTS.map((dist, i) => {
    const x0 = round(121 + (i % 10) * 0.1, 5);
    const y0 = round(24.9 + Math.floor(i / 10) * 0.1, 5);
    const x1 = round(x0 + 0.05, 5);
    const y1 = round(y0 + 0.05, 5);
    return {
      code: dist.code,
      city: dist.city,
      name: `Fixture ${i + 1}`,
      areaKm2: 10.5 + i,
      centroid: [round((x0 + x1) / 2, 5), round((y0 + y1) / 2, 5)],
      geometry: {
        type: 'Polygon',
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
  const prov = { sources: [SOURCE_IDS[0]] };
  return {
    schemaVersion: 1,
    provenance: { code: prov, city: prov, name: prov, areaKm2: prov, centroid: prov, geometry: prov },
    districts,
    sources: sources(),
    methods: methods(),
  };
}

// ---------------------------------------------------------------------------------------------
// history.json

interface Spec {
  readonly id: string;
  readonly level: 'district' | 'city';
  readonly unit: string;
  readonly kind: string;
  readonly decimals: number;
  readonly periodic?: true;
  readonly make: (i: number, q: number) => Json;
}

function historyFile(): Json {
  const base = buildBaseline();
  const fromBase = (id: string, i: number, q: number): number => {
    const v = (base.indicators[id] as Json)[DISTRICT_CODES[i] as string][q];
    return v as number;
  };
  const lowUse = (valueOf: (i: number, y: number) => number) => (i: number, q: number): Json => {
    const m = q % 4; // 1 = Q2 -> H1, 3 = Q4 -> H2
    if (m !== 1 && m !== 3) return { value: null, estimated: false };
    const year = 2015 + Math.floor(q / 4);
    return { value: valueOf(i, year), estimated: false, dataPeriod: `${year}H${m === 1 ? 1 : 2}` };
  };
  const specs: Spec[] = [
    { id: 'population', level: 'district', unit: 'persons', kind: 'count', decimals: 0, make: (i, q) => plain(fromBase('population', i, q)) },
    { id: 'moveIn', level: 'district', unit: 'persons per quarter', kind: 'count', decimals: 0, make: (i, q) => plain(2000 + i * 10 + q) },
    { id: 'moveOut', level: 'district', unit: 'persons per quarter', kind: 'count', decimals: 0, make: (i, q) => plain(2000 + i * 10 + q) },
    { id: 'relativeMedianIncome', level: 'district', unit: 'ratio', kind: 'positive', decimals: 4, make: (i) => est(round(0.8 + i * 0.01, 4)) },
    { id: 'householdIncome', level: 'district', unit: 'TWD per household per year', kind: 'positive', decimals: 0, make: (i, q) => est(fromBase('householdIncome', i, q)) },
    { id: 'salePrice', level: 'district', unit: 'TWD per m²', kind: 'positive', decimals: 0, make: (i, q) => plain(200_000 + i * 1000 + q * 500) },
    { id: 'medianTotalPrice', level: 'district', unit: 'TWD per transaction', kind: 'positive', decimals: 0, make: (i, q) => plain(15_000_000 + i * 100_000 + q * 50_000) },
    { id: 'rent', level: 'district', unit: 'TWD per m² per month', kind: 'positive', decimals: 1, make: (i, q) => est(round(fromBase('rent', i, q), 1)) },
    { id: 'mrtEntries', level: 'district', unit: 'entries per quarter', kind: 'count', decimals: 0, make: (i, q) => plain(fromBase('mrtEntries', i, q)) },
    { id: 'socialHousingCompletions', level: 'district', unit: 'units per quarter', kind: 'count', decimals: 0, make: (i, q) => plain(i % 7 === 0 && q % 8 === 0 ? 20 : 0) },
    { id: 'socialHousingStock', level: 'district', unit: 'units', kind: 'count', decimals: 0, make: (i, q) => plain(fromBase('socialHousingStock', i, q)) },
    { id: 'lowUseHousingCount', level: 'district', unit: 'dwellings', kind: 'count', decimals: 0, periodic: true, make: lowUse((i, y) => 3000 + i * 10 + (y - 2015)) },
    { id: 'lowUseHousingRate', level: 'district', unit: 'percent of dwellings', kind: 'percent', decimals: 2, periodic: true, make: lowUse((i, y) => round(5 + i * 0.01 + (y - 2015) * 0.01, 2)) },
    { id: 'cityDisposableIncome', level: 'city', unit: 'TWD per household per year', kind: 'positive', decimals: 0, make: (c, q) => ({ value: 1_300_000 + c * 100_000 + q * 5000, estimated: true, method: METHOD_IDS.interp }) },
    { id: 'priceToIncomeRatio', level: 'city', unit: 'years of income', kind: 'positive', decimals: 2, make: (c, q) => est(round(12 + c + q / 100, 2)) },
  ];
  return {
    schemaVersion: 1,
    quarters: [...QUARTERS],
    indicators: specs.map((s) => ({
      id: s.id,
      level: s.level,
      unit: s.unit,
      kind: s.kind,
      decimals: s.decimals,
      ...(s.periodic === true ? { periodic: true } : {}),
      description: `Fixture series for ${s.id}.`,
      sources: [SOURCE_IDS[0]],
      series: s.level === 'district' ? perDistrict(s.make) : perCity(s.make),
    })),
    sources: sources(),
    methods: methods(),
  };
}

// ---------------------------------------------------------------------------------------------
// policy-track.json

function policyTrackFile(): Json {
  const rec = (value: number): Json => ({ value, source: SOURCE_IDS[0], estimated: false });
  const city = (
    id: string,
    tool: string,
    unit: string,
    kind: string,
    decimals: number,
    value: (c: number, q: number) => number,
  ): Json => ({
    id,
    tool,
    level: 'city',
    unit,
    kind,
    decimals,
    description: `Fixture series for ${id}.`,
    sources: [SOURCE_IDS[0]],
    series: perCity((c, q) => rec(value(c, q))),
  });
  const priced = (q: number): boolean => passPrice(q) > 0;
  return {
    schemaVersion: 1,
    quarters: [...QUARTERS],
    policySeries: [
      {
        id: 'socialHousingUnitsStarted',
        tool: 'socialHousing',
        level: 'district',
        unit: 'units per quarter',
        kind: 'count',
        decimals: 0,
        description: 'Fixture series for socialHousingUnitsStarted.',
        sources: [SOURCE_IDS[0]],
        series: perDistrict(() => rec(10)),
      },
      city('subleaseUnitsMatched', 'sublease', 'units per quarter', 'count', 0, (_, q) => 100 + q),
      city('rentSubsidyHouseholds', 'rentSubsidy', 'households', 'count', 0, () => 5000),
      city('rentSubsidyAmountPerHousehold', 'rentSubsidy', 'TWD per household per month', 'non-negative', 0, (c) => (c === 0 ? 960 : 1200)),
      city('holdingTaxRateLowestTier', 'holdingTax', 'percent of assessed house value', 'percent', 2, () => 1.2),
      city('holdingTaxRateHighestTier', 'holdingTax', 'percent of assessed house value', 'percent', 2, () => 3.6),
      city('houseTaxRevenue', 'holdingTax', 'NT$ thousand per quarter', 'count', 0, (c, q) => 1_000_000 + c * 1000 + q),
      city('commuterPassPrice', 'commuterPass', 'TWD per 30-day pass', 'non-negative', 0, (_, q) => passPrice(q)),
      city('commuterPassSubsidy', 'commuterPass', 'TWD per 30-day pass', 'non-negative', 0, () => 0),
      city('commuterPassesSold', 'commuterPass', 'passes per quarter', 'count', 0, (_, q) => (priced(q) ? 100_000 : 0)),
    ],
    sources: sources(),
    methods: methods(),
  };
}

// ---------------------------------------------------------------------------------------------
// events.json (event-library card shape, 13 keys)

function eventsFile(): Json {
  const src = [{ label: 'Fixture source', publisher: 'Fixture Agency', url: 'https://data.example.gov.tw/event' }];
  const card = (id: string, date: string, firstQuarter: string, lastQuarter: string, type: string, title: string, major: boolean): Json => ({
    id,
    date,
    datePrecision: 'day',
    firstQuarter,
    lastQuarter,
    type,
    title,
    description: `Fixture description for ${id}.`,
    role: 'narrative',
    major,
    verified: true,
    verificationNote: 'The research notes mark this row verified with the linked sources (requirement 5.2).',
    sources: src,
  });
  return {
    schemaVersion: 1,
    events: [
      card('fixture-rate-cut-2020', '2020-03-20', '2020Q1', '2020Q1', 'interest-rate', 'Fixture rate change', false),
      card('fixture-major-event-2022', '2022-03-18', '2022Q1', '2022Q1', 'interest-rate', 'Fixture major event', true),
      card('fixture-tpass-2023', '2023-07-01', '2023Q3', '2023Q3', 'policy', 'Fixture transit pass launch', false),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// params.json (engine ids only, Parameter_Source_Type 1 / 2 / 3)

function paramsFile(): Json {
  const table = buildParams() as Record<string, Json>;
  const out: Record<string, Json> = {};
  for (const id of [...engineIdSet()].sort()) {
    const e = { ...table[id] };
    if (paramSourceType(id) === 3 && e.status !== 'gap') {
      e.status = 'gap';
      e.estimated = { method: 'Fixture estimate.' };
      e.assumption = 'Fixture assumption.';
    }
    out[id] = e;
  }
  return { schemaVersion: 1, parameters: out };
}

// ---------------------------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
const files: Record<string, Json> = {
  'districts.json': districtsFile(),
  'history.json': historyFile(),
  'policy-track.json': policyTrackFile(),
  'events.json': eventsFile(),
  'params.json': paramsFile(),
  'commute-matrix.json': buildCommuteMatrix(),
};
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(OUT_DIR, name), JSON.stringify(content) + '\n');
}
