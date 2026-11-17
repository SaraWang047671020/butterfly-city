/**
 * Step runner: runs a fixed, ordered list of named steps against one BuildContext and one BuildState.
 *
 * - First action: delete stale `*.pipeline-tmp` files left next to the outputs by an interrupted run.
 * - The first thrown error stops the run. A PipelineError prints `step <name> failed: <message>` and its
 *   detail lines; any other error prints the same first line and the stack. Both return exit code 1.
 * - On success the runner prints one summary line per indicator, then the non-fatal notes, and returns 0.
 *
 * The runner never calls `process.exit`. The caller (scripts/build-data.ts) sets `process.exitCode`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CommuteMatrixFile, DistrictsFile, HistoryFile, PolicyTrackFile } from '../../src/types/data-files.ts';
import type { LowUseContext, ValidationContext } from '../../src/data/validate.ts';
import { PUBLIC_DATA, ROOT } from '../lib/paths.ts';
import { bannedTermsStep } from './banned-terms.ts';
import { createContext, type BuildContext, type Logger } from './context.ts';
import type { CentroidResult } from './commute/centroids.ts';
import type { NearestStationInfo } from './commute/model.ts';
import type { RailNetwork } from './commute/network.ts';
import { commuteMatrixStep, fareSlopeStep, networkStep, type FareSlopeResult } from './commute/step.ts';
import type { SurveyCheckResult } from './commute/survey-check.ts';
import { districtsStep } from './districts-file.ts';
import { censusCheckStep } from './params/census-employees.ts';
import { paramsPart1Step, type ParamsPart1 } from './params/part1.ts';
import { formatParamsSummary, paramsStep, type ParamsBuild } from './params/params-file.ts';
import { PipelineError } from './errors.ts';
import type { DistrictShape } from './geo.ts';
import { historyFileStep } from './history-file.ts';
import { incomeStep } from './indicators/income.ts';
import type { LvrLoad } from './indicators/lvr-input.ts';
import { migrationStep } from './indicators/migration.ts';
import { mrtStep } from './indicators/mrt.ts';
import { populationStep } from './indicators/population.ts';
import { priceToIncomeStep } from './indicators/price-to-income.ts';
import { rentStep, type RentReferenceInfo } from './indicators/rent.ts';
import { salePriceStep } from './indicators/sale-price.ts';
import type { CitySeries, DistrictSeries } from './indicators/series.ts';
import { socialHousingStep, type ProjectExclusion, type SocialHousingLoad } from './indicators/social-housing.ts';
import { fsCommittedExists, preflight } from './manifest.ts';
import { lowUseStep } from './low-use.ts';
import { policyFileStep } from './policy-file.ts';
import { policyStep, type CommittedReader } from './policy/step.ts';
import type { PolicyTrackSeries } from './policy/track.ts';
import { sourcesDocStep } from './sources-doc.ts';
import { validateStep } from './validate-step.ts';
import { writeStep, type WriteFs } from './write.ts';

/** Count of values and of estimated values for one indicator (Requirement 1.4). */
export interface IndicatorSummary {
  readonly id: string;
  readonly values: number;
  readonly estimated: number;
}

/** Results that steps add as the build proceeds. Later tasks extend this interface. */
export interface BuildState {
  /** One entry per indicator, filled by the history assembly. */
  readonly summaries: IndicatorSummary[];
  /** Non-fatal notes printed after the summary lines. */
  readonly notes: string[];
  /** Set by the districts step. */
  districtsFile?: DistrictsFile;
  /** Set by the population step (task 5.2). */
  population?: DistrictSeries;
  /** Set by the migration step (task 5.2). */
  moveIn?: DistrictSeries;
  moveOut?: DistrictSeries;
  /** Set by the income step (task 6.2). */
  cityDisposableIncome?: CitySeries;
  relativeMedianIncome?: DistrictSeries;
  householdIncome?: DistrictSeries;
  /** Loaded sale files, shared by the sale price and price-to-income steps (task 7.2). */
  lvrSales?: LvrLoad;
  /** Set by the sale price step (task 7.2). */
  salePrice?: DistrictSeries;
  /** Per district code: number of quarters by window radius (0 = own median). For SOURCES.md. */
  salePriceWindowCounts?: ReadonlyMap<string, ReadonlyMap<number, number>>;
  /** Set by the price-to-income step (task 7.2). */
  priceToIncomeRatio?: CitySeries;
  /** Per district code: the 44 sale price values before rounding (set by the sale price step). */
  salePriceUnrounded?: ReadonlyMap<string, readonly number[]>;
  /** District shapes with polygons, set by the districts step (used for adjacency). */
  shapes?: readonly DistrictShape[];
  /** Loaded rental files (task 8.2). */
  lvrRentals?: LvrLoad;
  /** Set by the rent step (task 8.2). */
  rent?: DistrictSeries;
  /** Reference entries used by the rent step, for SOURCES.md (task 8.2). */
  rentReferences?: readonly RentReferenceInfo[];
  /** Set by the MRT step (task 9.2), with the SOURCES.md note lines. */
  mrtEntries?: DistrictSeries;
  mrtBorderNotes?: readonly string[];
  mrtComparableNotes?: readonly string[];
  /** Set by the social housing step (task 10.1); `socialHousing` is reused by the policy starts series. */
  socialHousing?: SocialHousingLoad;
  socialHousingCompletions?: DistrictSeries;
  socialHousingStock?: DistrictSeries;
  socialHousingExclusions?: readonly ProjectExclusion[];
  /** Set by the low-use step (task 27.4): the two periodic series and the validator context. */
  lowUseHousingCount?: DistrictSeries;
  lowUseHousingRate?: DistrictSeries;
  lowUse?: LowUseContext;
  /** Set by the policy track step (task 12.1): the ten real policy series. */
  policyTrack?: PolicyTrackSeries;
  /** Set by the policy file step (task 12.2): the assembled policy-track.json content. */
  policyTrackFile?: PolicyTrackFile;
  /** Set by the history file step (task 13.2): the assembled history.json content. */
  historyFile?: HistoryFile;
  /** Set by the network step (task 23.6): the rail graph of the commute model. */
  network?: RailNetwork;
  /** Set by the fare slope step (task 23.6): paired fares, slopes and the commute cost entry. */
  fareSlope?: FareSlopeResult;
  /** Set by the commute matrix step (task 24.4): job shares, the matrix file content and the survey check. */
  jobShare?: ReadonlyMap<string, number>;
  commuteMatrix?: CommuteMatrixFile;
  commuteSurvey?: SurveyCheckResult;
  /** Set by the commute matrix step (task 24.5): the population-weighted centroids, for SOURCES.md. */
  commuteCentroids?: CentroidResult;
  /** Set by the params part 1 step (task 25.7): the entries of tasks 25.1 to 25.6 and their method notes. */
  paramsPart1?: ParamsPart1;
  /** Set by the params step (task 26.6): the assembled params.json content and the source type of each id. */
  params?: ParamsBuild;
  /** Set by the commute matrix step (task 24.5): the nearest station of Linkou, for SOURCES.md. */
  commuteLinkou?: NearestStationInfo | undefined;
  /** Set by the SOURCES.md step (task 15.2): the full text of data/SOURCES.md. */
  sourcesDoc?: string;
  /** Lines about the policy track, e.g. social housing starts excluded from it (also added to `notes`). */
  policyNotes?: readonly string[];
}

export interface Step {
  readonly name: string;
  run(ctx: BuildContext, state: BuildState): void;
}

export function createState(): BuildState {
  return { summaries: [], notes: [] };
}

/** `<id>: <n> values, <k> estimated` */
export function formatSummaryLine(summary: IndicatorSummary): string {
  return `${summary.id}: ${summary.values} values, ${summary.estimated} estimated`;
}

export const STALE_TEMP_SUFFIX = '.pipeline-tmp';

/** Deletes `*.pipeline-tmp` files in the given directories (not recursive). Returns the deleted paths. */
export function deleteStaleTempFiles(dirs: readonly string[]): string[] {
  const deleted: string[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const name of names) {
      if (!name.endsWith(STALE_TEMP_SUFFIX)) continue;
      const file = path.join(dir, name);
      fs.rmSync(file, { force: true });
      deleted.push(file);
    }
  }
  return deleted;
}

/** Directories that hold the pipeline outputs: public/data/ and data/ (SOURCES.md). */
export function outputDirectories(): string[] {
  return [PUBLIC_DATA, path.join(ROOT, 'data')];
}

export const PREFLIGHT_STEP: Step = {
  name: 'preflight',
  run(ctx) {
    preflight(ctx.reader, fsCommittedExists);
  },
};

export interface DefaultStepsOptions {
  /** File operations of the write step. Default: node:fs. */
  readonly writeFs?: WriteFs;
  /** Reader of the committed tables in data/config/. Default: node:fs. */
  readonly committedReader?: CommittedReader;
  /** Replaces the validation context built from the registry (tests with synthetic files). */
  readonly validationContext?: ValidationContext;
}

/**
 * The fixed step list in build-flow order. Each step only reads state fields set by earlier steps:
 * districts sets `shapes` (mrt); population feeds the policy track (commuter passes sold); social housing is
 * loaded once and reused by the policy track; history and policy file assembly need all series.
 */
export function createDefaultSteps(options: DefaultStepsOptions = {}): readonly Step[] {
  return [
    PREFLIGHT_STEP,
    censusCheckStep(options.committedReader),
    districtsStep(),
    populationStep(),
    migrationStep(),
    incomeStep(),
    salePriceStep(),
    priceToIncomeStep(),
    rentStep(),
    mrtStep(),
    socialHousingStep(),
    policyStep(options.committedReader),
    lowUseStep(),
    historyFileStep(),
    policyFileStep(),
    networkStep(options.committedReader),
    fareSlopeStep(options.committedReader),
    commuteMatrixStep(options.committedReader),
    paramsPart1Step(options.committedReader),
    paramsStep(options.committedReader),
    validateStep(options.validationContext),
    sourcesDocStep(options.committedReader),
    bannedTermsStep(options.committedReader),
    // Resolved at run time: write.ts imports this module, so `nodeFs` is not initialized yet at load time.
    { name: 'write', run: (ctx, state) => writeStep(options.writeFs).run(ctx, state) },
  ];
}

export const DEFAULT_STEPS: readonly Step[] = createDefaultSteps();

export interface RunOptions {
  readonly steps?: readonly Step[];
  readonly ctx?: BuildContext;
  readonly logger?: Logger;
  /** Removes stale temp files; injected by tests. */
  readonly cleanStale?: () => void;
}

function reportFailure(logger: Logger, stepName: string, error: unknown): void {
  if (error instanceof PipelineError) {
    logger.warn(`step ${stepName} failed: ${error.message}`);
    for (const line of error.details) logger.warn(`  ${line}`);
  } else if (error instanceof Error) {
    logger.warn(`step ${stepName} failed: ${error.message}`);
    logger.warn(error.stack ?? String(error));
  } else {
    logger.warn(`step ${stepName} failed: ${String(error)}`);
  }
}

/** Runs the steps in order and returns the process exit code (0 success, 1 failure). */
export function runPipeline(options: RunOptions = {}): number {
  const steps = options.steps ?? DEFAULT_STEPS;
  const ctx = options.ctx ?? createContext(options.logger === undefined ? {} : { logger: options.logger });
  const logger = options.logger ?? ctx.logger;
  const cleanStale = options.cleanStale ?? (() => void deleteStaleTempFiles(outputDirectories()));
  const state = createState();

  try {
    cleanStale();
  } catch (error) {
    reportFailure(logger, 'clean-stale-temp-files', error);
    return 1;
  }

  for (const step of steps) {
    try {
      step.run(ctx, state);
    } catch (error) {
      reportFailure(logger, step.name, error);
      return 1;
    }
  }

  for (const summary of state.summaries) logger.info(formatSummaryLine(summary));
  if (state.commuteSurvey !== undefined) {
    logger.info(`commute-matrix: 41 x 41 minutes, mean modelled commute time ${state.commuteSurvey.modelled.toFixed(1)} min`);
  }
  if (state.params !== undefined) for (const line of formatParamsSummary(state.params)) logger.info(line);
  // The social housing and policy track steps can report the same exclusion; print each note once.
  for (const note of new Set(state.notes)) logger.info(note);
  return 0;
}
