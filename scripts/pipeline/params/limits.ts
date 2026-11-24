/**
 * Documented_Limits of the policy tools (housing-tools Requirement 2, simulation.md "Policy tool limits").
 *
 * - `limit.socialHousing.unitsStarted.max.<city>.<year>`: the city's allocation in the central plan ÷ its years
 *   (type 1, from `data/config/policy-limits.json`).
 * - `limit.rentSubsidy.amount.max.<city>.<year>`: the largest monthly amount a household could receive (type 1).
 * - `limit.rentSubsidy.households.max.<city>.<year>`: the applications of the year, computed as the largest
 *   quarterly number of subsidised households of the year ÷ the approval rate of the year (type 2, from the policy
 *   track and `data/config/application-supply.json`).
 *
 * Every real value lies within its limit (checked here, so the real track stays feasible).
 */
import { CITY_NAMES, type CityName, type PolicyTrackFile } from '../../../src/types/data-files.ts';
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import { PipelineError } from '../errors.ts';
import { fsCommittedReader, type CommittedReader } from '../policy/step.ts';

export const LIMITS_FILE = 'data/config/policy-limits.json';
const SUPPLY_FILE = 'data/config/application-supply.json';
const FIRST_YEAR = 2015;
const LAST_YEAR = 2025;

const YEARS: readonly number[] = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

export const SOCIAL_HOUSING_MAX = 'limit.socialHousing.unitsStarted.max';
export const AMOUNT_MAX = 'limit.rentSubsidy.amount.max';
export const HOUSEHOLDS_MAX = 'limit.rentSubsidy.households.max';

/** Every limit id this module builds; the engine reads them optionally (`checkLimit`). */
export function limitIds(): string[] {
  const out: string[] = [];
  for (const base of [SOCIAL_HOUSING_MAX, AMOUNT_MAX, HOUSEHOLDS_MAX]) {
    for (const city of CITY_NAMES) for (const y of YEARS) out.push(`${base}.${city}.${y}`);
  }
  return out;
}

/** Parameter_Source_Type of a limit id built here, or null for any other id. */
export function limitSourceType(id: string): 1 | 2 | null {
  if (id.startsWith(`${HOUSEHOLDS_MAX}.`)) return 2;
  if (id.startsWith(`${SOCIAL_HOUSING_MAX}.`) || id.startsWith(`${AMOUNT_MAX}.`)) return 1;
  return null;
}

interface Period {
  readonly city: CityName;
  readonly fromYear: number;
  readonly toYear: number;
  readonly citation: string;
  readonly url: string;
  readonly method: string;
}
interface StartsPeriod extends Period {
  readonly units: number;
  readonly years: number;
}
interface AmountPeriod extends Period {
  readonly value: number;
}
interface LimitsConfig {
  readonly socialHousingStarts: readonly StartsPeriod[];
  readonly rentSubsidyAmount: readonly AmountPeriod[];
}

export interface LimitParams {
  readonly type1: Readonly<Record<string, ScalarParameter>>;
  readonly type2: Readonly<Record<string, ScalarParameter>>;
}

function periodOf<T extends Period>(list: readonly T[], city: CityName, year: number, what: string): T {
  const found = list.filter((p) => p.city === city && p.fromYear <= year && year <= p.toYear);
  if (found.length !== 1) throw new PipelineError(`${LIMITS_FILE}: ${what}`, [`${city} ${year}: ${found.length} periods, expected 1`]);
  return found[0] as T;
}

function seriesOf(track: PolicyTrackFile, id: string): Readonly<Record<string, readonly { value: number | null }[]>> {
  const s = track.policySeries.find((x) => x.id === id);
  if (s === undefined) throw new PipelineError(`policy track: series ${id} missing`);
  return s.series as Readonly<Record<string, readonly { value: number | null }[]>>;
}

/** The real values of a city and year, summed over districts for a district series. */
function yearValues(track: PolicyTrackFile, id: string, codes: readonly string[], year: number): number[] {
  const series = seriesOf(track, id);
  const out: number[] = [];
  track.quarters.forEach((q, i) => {
    if (!q.startsWith(String(year))) return;
    let sum = 0;
    for (const code of codes) sum += series[code]?.[i]?.value ?? 0;
    out.push(sum);
  });
  return out;
}

export function limitParams(
  track: PolicyTrackFile,
  districtsOf: (city: CityName) => readonly string[],
  readCommitted: CommittedReader = fsCommittedReader,
): LimitParams {
  const config = JSON.parse(readCommitted(LIMITS_FILE)) as LimitsConfig;
  const supply = JSON.parse(readCommitted(SUPPLY_FILE)) as {
    readonly sources: Readonly<Record<string, { readonly title: string; readonly url: string }>>;
    readonly rentSubsidy: {
      readonly realOdds: Readonly<Record<CityName, { readonly byYear: Readonly<Record<string, number>>; readonly sources: readonly string[] }>>;
    };
  };
  const type1: Record<string, ScalarParameter> = {};
  const type2: Record<string, ScalarParameter> = {};
  const problems: string[] = [];

  for (const city of CITY_NAMES) {
    for (const year of YEARS) {
      const sh = periodOf(config.socialHousingStarts, city, year, 'social housing starts');
      const shMax = Math.round(sh.units / sh.years);
      type1[`${SOCIAL_HOUSING_MAX}.${city}.${year}`] = {
        kind: 'scalar',
        value: shMax,
        unit: 'units started per city and year',
        status: 'secondary',
        source: { citation: sh.citation, url: sh.url },
        estimated: { method: sh.method },
      };
      const realStarts = yearValues(track, 'socialHousingUnitsStarted', districtsOf(city), year).reduce((a, b) => a + b, 0);
      if (realStarts > shMax) problems.push(`${city} ${year}: real starts ${realStarts} above ${shMax}`);

      const am = periodOf(config.rentSubsidyAmount, city, year, 'rent subsidy amount');
      type1[`${AMOUNT_MAX}.${city}.${year}`] = {
        kind: 'scalar',
        value: am.value,
        unit: 'TWD per household per month',
        status: 'secondary',
        source: { citation: am.citation, url: am.url },
        estimated: { method: am.method },
      };
      for (const v of yearValues(track, 'rentSubsidyAmountPerHousehold', [city], year)) {
        if (v > am.value) problems.push(`${city} ${year}: real amount ${v} above ${am.value}`);
      }

      const odds = supply.rentSubsidy.realOdds[city];
      const rate = odds?.byYear[String(year)];
      const sourceId = odds?.sources[0];
      const source = sourceId === undefined ? undefined : supply.sources[sourceId];
      if (rate === undefined || !(rate > 0) || source === undefined) {
        problems.push(`${city} ${year}: no approval rate of the rent subsidy`);
        continue;
      }
      const households = Math.max(0, ...yearValues(track, 'rentSubsidyHouseholds', [city], year));
      type2[`${HOUSEHOLDS_MAX}.${city}.${year}`] = {
        kind: 'scalar',
        value: Math.ceil(households / rate),
        unit: 'households',
        status: 'secondary',
        source: { citation: source.title, url: source.url },
        estimated: {
          method: `Applications of the year: the largest quarterly number of subsidised households of ${year} (${households}, policy track) divided by the approval rate of the year (${rate}, the city's rent subsidy statistics). Only households that applied can receive the subsidy.`,
        },
      };
    }
  }
  if (problems.length > 0) throw new PipelineError('Documented_Limits below real values or missing', problems);
  return { type1, type2 };
}
