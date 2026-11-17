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
import type { CommittedReader } from '../policy/step.ts';
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
import { loadRailNetwork } from './network.ts';
import { readCommuteParams, type CommuteParams } from './params.ts';
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
      state.network = loadRailNetwork(ctx.reader, timetable, {
        defaultTransferWait: paramValue(params, 'commute.transferWait'),
      });
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
    `fares: ${pairing.pairs.length} pairs used, excluded: ${reasons === '' ? 'none' : reasons}; ` +
    `slope all ${slopes.allSlope.toFixed(4)}, uncapped ${slopes.uncappedSlope.toFixed(4)} TWD/min/trip; ` +
    `${entry.value.toFixed(2)} (low ${range?.low.toFixed(2) ?? 'n/a'}, high ${range?.high.toFixed(2) ?? 'n/a'}) TWD/min/month`
  );
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
      const pairing = pairFaresWithTimes(rows, (a, b) => network.pathTime(a, b));
      const slopes = fareSlopes(pairing.pairs, pairing.cap);
      const entry = commuteCostEntry(pairing.pairs, tripsParam.value, {
        ...(pairing.cap === undefined ? {} : { cap: pairing.cap }),
        tripsStatus: tripsParam.status,
        notOpenPairs: pairing.excluded['not-open-2025Q4']?.count ?? 0,
      });
      const result: FareSlopeResult = { pairing, slopes, entry };
      state.fareSlope = result;
      ctx.logger.info(formatFareLine(result));
    },
  };
}
