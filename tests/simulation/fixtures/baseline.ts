// Synthetic Baseline builder, Real_Policy_Track builder and Commute_Matrix builder. All in memory.

import type { CityName, DistrictCode, QuarterKey } from '../../../src/types/data-files.ts';
import type {
  AreaKey,
  CommuteMatrix,
  EngineBaseline,
  PolicySetting,
  PolicyTimeline,
  ToolSetting,
} from '../../../src/types/simulation.ts';
import { quarterAt } from '../../../src/simulation/quarter.ts';
import { CITIES, DISTRICTS, DISTRICT_CODES, cityOf } from './districts.ts';

export const BASELINE_SOURCE_IDS: readonly string[] = [
  'src.population',
  'src.householdIncome',
  'src.rent',
  'src.mrtEntries',
  'src.socialHousingStock',
];

export interface BaselineOptions {
  /** Number of quarters from 2015Q1, 1 to 44. Default 44. */
  readonly quarters?: number;
  /** Per-district base values; defaults vary slightly by district index. */
  readonly population?: (index: number, q: number) => number | null;
  readonly householdIncome?: (index: number, q: number) => number | null;
  readonly rent?: (index: number, q: number) => number | null;
  readonly mrtEntries?: (index: number, q: number) => number | null;
  readonly socialHousingStock?: (index: number, q: number) => number | null;
}

/** Quarters 2015Q1 onward, `count` of them (1 to 44). */
export function quarterList(count: number): readonly QuarterKey[] {
  return Array.from({ length: count }, (_, i) => quarterAt(i));
}

export function buildBaseline(options: BaselineOptions = {}): EngineBaseline {
  const count = options.quarters ?? 44;
  const quarters = quarterList(count);
  const defaults = {
    population: (i: number, q: number) => 100_000 + i * 1_000 + q * 100,
    householdIncome: (i: number, q: number) => 720_000 + i * 2_000 + q * 3_000,
    rent: (i: number, q: number) => 600 + i * 2 + q * 1.5,
    mrtEntries: (i: number, q: number) => (i % 5 === 0 ? 0 : 1_000_000 + i * 10_000 + q * 5_000),
    socialHousingStock: (i: number, q: number) => 500 + i * 3 + q,
  };
  const ids = ['population', 'householdIncome', 'rent', 'mrtEntries', 'socialHousingStock'] as const;
  const indicators: Record<string, Record<DistrictCode, readonly (number | null)[]>> = {};
  for (const id of ids) {
    const fn = options[id] ?? defaults[id];
    const byDistrict: Record<DistrictCode, readonly (number | null)[]> = {};
    DISTRICT_CODES.forEach((code, i) => {
      byDistrict[code] = quarters.map((_, q) => fn(i, q));
    });
    indicators[id] = byDistrict;
  }
  return {
    quarters,
    districts: DISTRICTS.map((d) => ({ code: d.code, city: d.city })),
    indicators,
    indicatorSources: {
      population: ['src.population'],
      householdIncome: ['src.householdIncome'],
      rent: ['src.rent'],
      mrtEntries: ['src.mrtEntries'],
      socialHousingStock: ['src.socialHousingStock'],
    },
    sourceIds: BASELINE_SOURCE_IDS,
  };
}

/** First quarter (2023Q1) in which the fixture commuter pass has a positive price. */
export const PASS_START_INDEX = 32;
export const PASS_PRICE = 1280;

export function passPrice(quarterIndex: number): number {
  return quarterIndex >= PASS_START_INDEX ? PASS_PRICE : 0;
}

export interface RealTrackOptions {
  /** Number of quarters from 2015Q1, 1 to 44. Default 44. */
  readonly quarters?: number;
  readonly unitsStarted?: number;
  /** Real commuter pass subsidy per pass while the price is positive. Default 0. */
  readonly subsidy?: number;
  readonly passesSold?: number;
  readonly households?: number;
  /** Total monthly subsidy in TWD, per city. */
  readonly amount?: Readonly<Record<CityName, number>>;
}

export function buildRealTrack(options: RealTrackOptions = {}): PolicyTimeline {
  const count = options.quarters ?? 44;
  const amount = options.amount ?? { Taipei: 4_800_000, 'New Taipei': 6_000_000 };
  const out: PolicySetting[] = [];
  for (let q = 0; q < count; q++) {
    const unitsStarted: Record<AreaKey, number> = {};
    for (const code of DISTRICT_CODES) unitsStarted[code] = options.unitsStarted ?? 10;
    const subsidy: Record<AreaKey, number> = {};
    const passesSold: Record<AreaKey, number> = {};
    const households: Record<AreaKey, number> = {};
    const amountField: Record<AreaKey, number> = {};
    for (const city of CITIES) {
      subsidy[city] = passPrice(q) > 0 ? (options.subsidy ?? 0) : 0;
      passesSold[city] = passPrice(q) > 0 ? (options.passesSold ?? 100_000) : 0;
      households[city] = options.households ?? 5_000;
      amountField[city] = amount[city];
    }
    const tools: Record<string, ToolSetting> = {
      socialHousing: { unitsStarted },
      commuterPass: { subsidy, passesSold },
      rentSubsidy: { households, amount: amountField },
    };
    out.push({ quarter: quarterAt(q), tools });
  }
  return out;
}

/** Valid 41 x 41 matrix with a zero diagonal; symmetric, positive off the diagonal. */
export function buildCommuteMatrix(): CommuteMatrix {
  const minutes = DISTRICT_CODES.map((a, i) =>
    DISTRICT_CODES.map((b, j) => {
      if (i === j) return 0;
      const cross = cityOf(a) === cityOf(b) ? 0 : 10;
      return 10 + 1.5 * Math.abs(i - j) + cross;
    }),
  );
  return { codes: DISTRICT_CODES, minutes };
}
