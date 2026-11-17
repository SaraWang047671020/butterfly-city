/**
 * Build steps of the commute model (task 23.6): the rail network and the fare slopes.
 *
 * `network` loads the TDX station, S2S, transfer-walk and StationTimeTable files and builds the rail graph;
 * `fare-slope` pairs the fare tables with graph path times and builds the `migration.commuteCostPerMinute` entry.
 * Both results are kept in the build state for later steps. The fare step prints one line.
 */
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import type { BuildContext } from '../context.ts';
import { DataError } from '../errors.ts';
import { fsCommittedReader, type CommittedReader } from '../policy/step.ts';
import type { BuildState, Step } from '../run.ts';
import {
  FARE_FILES,
  FARE_OPERATORS,
  commuteCostEntry,
  fareSlopes,
  pairFaresWithTimes,
  parseFares,
  type FareRow,
  type FareSlopes,
  type PairingResult,
} from './fares.ts';
import { defaultWaitStatement, loadRailNetwork } from './network.ts';
import { readCommuteParams, type CommuteParams } from './params.ts';
import { loadVillageCentroids } from './centroids.ts';
import { buildCommuteFile } from './commute-file.ts';
import { buildCommuteMatrix, loadLrtStationCoords, modelConstants, nearestStationInfo, type LonLat } from './model.ts';

/** District_Code of Linkou (see scripts/lib/districts.ts). */
const LINKOU_CODE = '65000170';
import { population2025Mean, surveyCheck, surveyCheckLine } from './survey-check.ts';
import { jobShares } from '../params/job-share.ts';
import { CENSUS_EMPLOYEES_TABLE, parseCensusEmployees } from '../params/census-employees.ts';
import { loadTimetableModel } from './timetable.ts';

/** Result of the fare slope step, kept in `BuildState.fareSlope`. */
export interface FareSlopeResult {
  readonly pairing: PairingResult;
  readonly slopes: FareSlopes;
  readonly entry: ScalarParameter;
}

function paramValue(params: CommuteParams, id: string): number {
  const p = params[id];
  if (p === undefined) throw new DataError('missing-commute-param', id);
  return p.value;
}

export function networkStep(readCommitted?: CommittedReader): Step {
  return {
    name: 'network',
    run(ctx: BuildContext, state: BuildState) {
      const params = readCommuteParams(readCommitted);
      const timetable = loadTimetableModel(ctx.reader);
      const network = loadRailNetwork(ctx.reader, timetable, {
        defaultTransferWait: paramValue(params, 'commute.transferWait'),
      });
      const statement = defaultWaitStatement(network.defaultWaitLines);
      const method = params['commute.transferWait']?.estimated?.method ?? '';
      if (statement !== '' && !method.includes(statement)) {
        throw new DataError('transfer-wait-method-stale', 'commute.transferWait', [
          `lines without a headway: ${network.defaultWaitLines.join(', ')}`,
          `the estimated.method in data/config/commute-params.json must contain: ${statement}`,
        ]);
      }
      state.network = network;
    },
  };
}

/** The one-line report of the fare slope step. */
export function formatFareLine(result: FareSlopeResult): string {
  const { pairing, slopes, entry } = result;
  const reasons = Object.entries(pairing.excluded)
    .map(([reason, e]) => `${reason} ${e?.count ?? 0}`)
    .join(', ');
  const range = entry.range;
  return (
    `fares: ${pairing.pairs.length} pairs used, excluded: ${reasons === '' ? 'none' : reasons}` +
    `${pairing.excludedStations.length === 0 ? '' : ` (stations not in network: ${pairing.excludedStations.join(', ')})`}; ` +
    `slope all ${slopes.allSlope.toFixed(4)}, uncapped ${slopes.uncappedSlope.toFixed(4)} TWD/min/trip; ` +
    `${entry.value.toFixed(2)} (low ${range?.low.toFixed(2) ?? 'n/a'}, high ${range?.high.toFixed(2) ?? 'n/a'}) TWD/min/month`
  );
}

/**
 * Builds the commute matrix (Requirements 24.1, 24.8): village centroids, the model, the file content and the
 * survey check. The survey check is only printed; it never changes the matrix or the exit code.
 */
export function commuteMatrixStep(readCommitted: CommittedReader = fsCommittedReader): Step {
  return {
    name: 'commute-matrix',
    run(ctx: BuildContext, state: BuildState) {
      const { network, shapes, population } = state;
      if (network === undefined) throw new DataError('missing-step-output', 'rail network', ['run the network step first']);
      if (shapes === undefined) throw new DataError('missing-step-output', 'district shapes', ['run the districts step first']);
      if (population === undefined) throw new DataError('missing-step-output', 'population', ['run the population step first']);
      const params = readCommuteParams(readCommitted);
      const centroids = loadVillageCentroids(ctx.reader, shapes);
      const jobShare = jobShares(parseCensusEmployees(readCommitted(CENSUS_EMPLOYEES_TABLE)));
      const lrtCoords = loadLrtStationCoords(ctx.reader);
      const centroidOf = new Map([...centroids.districts].map(([code, c]) => [code, c.weighted as LonLat]));
      const result = buildCommuteMatrix({
        districts: ctx.districts,
        centroids: centroidOf,
        network,
        constants: modelConstants(params),
        lrtCoords,
      });
      const linkouCentroid = centroidOf.get(LINKOU_CODE);
      if (linkouCentroid !== undefined) {
        state.commuteLinkou = nearestStationInfo(network, lrtCoords, linkouCentroid, result.nearest.get(LINKOU_CODE));
      }
      const cityOf = new Map(ctx.districts.map((d) => [d.code, d.city]));
      const survey = surveyCheck({
        codes: result.codes,
        minutes: result.minutes,
        cityOf,
        population: population2025Mean(population),
        jobShare,
      });
      state.jobShare = jobShare;
      state.commuteMatrix = buildCommuteFile(result);
      state.commuteSurvey = survey;
      state.commuteCentroids = centroids;
      ctx.logger.info(surveyCheckLine(survey));
    },
  };
}

export function fareSlopeStep(readCommitted?: CommittedReader): Step {
  return {
    name: 'fare-slope',
    run(ctx: BuildContext, state: BuildState) {
      const network = state.network;
      if (network === undefined) {
        throw new DataError('missing-step-output', 'rail network', ['run the network step before the fare slope step']);
      }
      const params = readCommuteParams(readCommitted);
      const tripsParam = params['commute.tripsPerMonth'];
      if (tripsParam === undefined) throw new DataError('missing-commute-param', 'commute.tripsPerMonth');
      const rows: FareRow[] = [];
      for (const op of FARE_OPERATORS) {
        const rel = FARE_FILES[op];
        rows.push(...parseFares(ctx.reader.display(rel), ctx.reader.readText(rel)));
      }
      const pairing = pairFaresWithTimes(
        rows,
        (a, b) => network.pathTime(a, b),
        (id) => network.inNetwork(id),
      );
      const slopes = fareSlopes(pairing.pairs, pairing.cap);
      const entry = commuteCostEntry(pairing.pairs, tripsParam.value, {
        ...(pairing.cap === undefined ? {} : { cap: pairing.cap }),
        tripsStatus: tripsParam.status,
        excludedStations: pairing.excludedStations,
        excludedPairs: pairing.excluded['station-not-in-network']?.count ?? 0,
      });
      const result: FareSlopeResult = { pairing, slopes, entry };
      state.fareSlope = result;
      ctx.logger.info(formatFareLine(result));
    },
  };
}
