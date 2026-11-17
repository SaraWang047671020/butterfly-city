/**
 * Parameter table part 1 step (task 25.7): builds the entries of tasks 25.1 to 25.6 into
 * `BuildState.paramsPart1` and prints one line per entry. Task 26 consumes the state.
 *
 * Order of the entries: fixed table, social housing, housing, ghost rent, ghost commute, job shares, commute cost.
 * Needs the population, income, rent and social housing steps and the commute matrix and fare slope steps.
 */
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import { DISTRICTS, type City } from '../../lib/districts.ts';
import type { BuildContext } from '../context.ts';
import { DataError } from '../errors.ts';
import { loadSocialHousing } from '../indicators/social-housing.ts';
import type { DistrictSeries } from '../indicators/series.ts';
import { parseFiaQuartiles } from '../parsers/income.ts';
import { fsCommittedReader, type CommittedReader } from '../policy/step.ts';
import type { BuildState, Step } from '../run.ts';
import { CENSUS_EMPLOYEES_TABLE, parseCensusEmployees } from './census-employees.ts';
import { commuteCostParam } from './commute-cost.ts';
import { readFixedType1Params } from './fixed-table.ts';
import {
  GHOST_REFERENCE_YEAR,
  WORKPLACE_TABLE_PATH,
  commuteGhostParams,
  parseCensusWorkplaceOds,
  rentGhostParams,
  type CityWorkplace,
  type RentGhostDistrictInput,
} from './ghost.ts';
import { loadHousingParams, renterRateId, dwellingSizeId, type HousingResult } from './housing.ts';
import { jobShareEntries, type ParamMethodNote } from './job-share.ts';
import { socialHousingParams } from './social-housing.ts';

/** Result of the step, kept in `BuildState.paramsPart1`. */
export interface ParamsPart1 {
  /** Every entry of part 1 by id, in build order. */
  readonly entries: ReadonlyMap<string, ScalarParameter>;
  /** Method text of the entries whose text the Sources_Document renders as a group (job shares, commute cost). */
  readonly methods: readonly ParamMethodNote[];
  /** Notes of the social housing entries (qualifying projects, 0-quarter lag guids, exclusions, unit cost, rent). */
  readonly socialHousingNotes: readonly string[];
  /** `setupplan_guid` of the projects with a 0-quarter lag. */
  readonly zeroLagGuids: readonly string[];
  /** Housing counts, including `rentalFilter` and `rentCrossCheck`. */
  readonly housingCounts: HousingResult['counts'];
}

/** FIA file of the ghost reference year (income year 2023, ROC 112). */
export const FIA_REFERENCE_FILE = `income/${GHOST_REFERENCE_YEAR - 1911}_165-9.csv`;

const fmt = (n: number): string => String(Number(n.toPrecision(6)));

/** `<id>: low <low>, value <value>, high <high>, status <status>` (low and high are `n/a` without a range). */
export function formatParamLine(id: string, entry: ScalarParameter): string {
  const low = entry.range === undefined ? 'n/a' : fmt(entry.range.low);
  const high = entry.range === undefined ? 'n/a' : fmt(entry.range.high);
  return `${id}: low ${low}, value ${fmt(entry.value)}, high ${high}, status ${entry.status}`;
}

function need<T>(value: T | undefined, what: string, step: string): T {
  if (value === undefined) throw new DataError('missing-step-output', what, [`run the ${step} step before the parameter table`]);
  return value;
}

export function paramsPart1Step(readCommitted: CommittedReader = fsCommittedReader): Step {
  return {
    name: 'params-part1',
    run(ctx: BuildContext, state: BuildState) {
      const population = need(state.population, 'population', 'population');
      const householdIncome = need(state.householdIncome, 'householdIncome', 'income');
      const rent = need(state.rent, 'rent', 'rent');
      const jobShare = need(state.jobShare, 'job shares', 'commute-matrix');
      const matrix = need(state.commuteMatrix, 'commute matrix', 'commute-matrix');

      const entries = new Map<string, ScalarParameter>();
      const add = (id: string, entry: ScalarParameter): void => {
        if (entries.has(id)) throw new DataError('duplicate-parameter-id', id);
        entries.set(id, entry);
      };

      const fixed = readFixedType1Params(readCommitted);
      for (const [id, e] of Object.entries(fixed)) add(id, e);

      const load = state.socialHousing ?? loadSocialHousing(ctx);
      const social = socialHousingParams({ projects: load.projects, rent, quarters: ctx.quarters, readCommitted });
      for (const [id, e] of Object.entries(social.entries)) add(id, e);

      const housing = loadHousingParams(ctx);
      for (const [id, e] of housing.entries) add(id, e);

      // Ghost rent: 2023 slices of the indicators, dwelling size and renter rate from the housing entries.
      const q2023 = [1, 2, 3, 4].map((q) => ctx.quarters.indexOf(`${GHOST_REFERENCE_YEAR}Q${q}` as never));
      if (q2023.some((i) => i < 0)) throw new DataError('missing-quarter', String(GHOST_REFERENCE_YEAR), ['2023Q1..Q4 not in the build quarters']);
      const quartiles = new Map(
        parseFiaQuartiles(ctx.reader.readText(FIA_REFERENCE_FILE), ctx.reader.display(FIA_REFERENCE_FILE), GHOST_REFERENCE_YEAR).map((r) => [r.districtCode, r]),
      );
      const districts: RentGhostDistrictInput[] = DISTRICTS.map((d) => {
        const q = quartiles.get(d.code);
        if (q === undefined) throw new DataError('fia-quartiles-missing', d.code, [`no district total row in ${FIA_REFERENCE_FILE}`]);
        const slice = (series: DistrictSeries, what: string): number[] => {
          const s = series[d.code];
          if (s === undefined) throw new DataError('missing-series', d.code, [what]);
          return q2023.map((i) => {
            const v = s[i]?.value;
            if (v === null || v === undefined) throw new DataError('missing-value', d.code, [`${what} has no value in ${ctx.quarters[i]}`]);
            return v;
          });
        };
        return {
          districtCode: d.code,
          city: d.city,
          householdIncome: slice(householdIncome, 'householdIncome'),
          rent: slice(rent, 'rent'),
          population: slice(population, 'population')[3] as number,
          q1: q.q1,
          q3: q.q3,
        };
      });
      const dwellingSize = (housing.entries.get(dwellingSizeId) as ScalarParameter).value;
      const renterRate = {} as Record<City, number>;
      for (const city of ['Taipei', 'New Taipei'] as const) renterRate[city] = (housing.entries.get(renterRateId(city)) as ScalarParameter).value;
      const rentThreshold = (fixed['ghost.rentThreshold'] as ScalarParameter).value;
      const rentGhost = rentGhostParams({ districts, dwellingSize, renterRate, rentThreshold });
      add('ghost.shareRent', rentGhost.shareRent);
      add('ghost.sensitivityRent', rentGhost.sensitivityRent);

      // Ghost commute: table 14 of both cities, job shares and the commute matrix.
      const workplace: CityWorkplace[] = (['Taipei', 'New Taipei'] as const).map((city) => {
        const p = WORKPLACE_TABLE_PATH[city];
        return parseCensusWorkplaceOds(ctx.reader.readBytes(p), ctx.reader.display(p), city);
      });
      const commute = commuteGhostParams({ workplace, jobShare, matrix });
      add('ghost.shareCommuteWithin', commute.shareCommuteWithin);
      add('ghost.sensitivityCommute', commute.sensitivityCommute);

      const jobShares = jobShareEntries(parseCensusEmployees(readCommitted(CENSUS_EMPLOYEES_TABLE)));
      for (const [id, e] of jobShares.entries) add(id, e);

      const cost = commuteCostParam(state.fareSlope);
      add(cost.id, cost.entry);

      state.paramsPart1 = {
        entries,
        methods: [...jobShares.methods, ...cost.methods],
        socialHousingNotes: social.notes,
        zeroLagGuids: social.zeroLagGuids,
        housingCounts: housing.counts,
      };

      for (const [id, e] of entries) ctx.logger.info(formatParamLine(id, e));
      const rc = housing.counts.rentCrossCheck;
      for (const city of ['Taipei', 'New Taipei'] as const) {
        const c = rc[city];
        ctx.logger.info(`housing.rentCrossCheck ${city}: area-based ${fmt(c.areaBasedRent)}, median total rent ${fmt(c.medianTotalRent)}, gap ${c.gapPercent.toFixed(1)} %`);
      }
      for (const note of social.notes) ctx.logger.info(note);
    },
  };
}
