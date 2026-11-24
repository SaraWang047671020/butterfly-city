/**
 * Params file assembly (task 26.6, Requirements 20.1, 20.4 to 20.6, 20.11).
 *
 * Merges the part 1 entries (type 1 and type 2), the fixed type 3 gap entries, the migration anchors and the
 * derived entries, rounds each value to the decimals of its id, sorts the ids by code point and runs the
 * Id_Set_Check. A missing or extra id stops the build before any file is written.
 */
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { ParamsFile } from '../../../src/types/data-files.ts';
import type { ParameterTable, ScalarParameter, ScheduleParameter } from '../../../src/types/simulation.ts';
import type { BuildContext } from '../context.ts';
import { DataError } from '../errors.ts';
import { roundTo } from '../numeric.ts';
import { fsCommittedReader, type CommittedReader } from '../policy/step.ts';
import type { BuildState, Step } from '../run.ts';
import { COST_SCHEDULE_ID, SHARE_BOTH_ID, deriveCostSchedule, deriveShareBoth } from './derived.ts';
import { engineIdSet, idSetDiff } from './engine-ids.ts';
import { FIXED_TYPE1_IDS, FIXED_TYPE3_IDS, readFixedType3Params } from './fixed-table.ts';
import { dwellingSizeId } from './housing.ts';
import { limitParams, type LimitParams } from './limits.ts';
import {
  MIGRATION_EXIT_SHARE_ID,
  MIGRATION_SHARE_ID,
  MIGRATION_THRESHOLD_ID,
  migrationAnchorParams,
  migrationThresholdParam,
  readExitTotals,
} from './migration-anchors.ts';

type Entry = ScalarParameter | ScheduleParameter;

export type SourceType = 1 | 2 | 3;

/** Result of the step, kept in `BuildState.params`. */
export interface ParamsBuild {
  readonly file: ParamsFile;
  /** Parameter_Source_Type of each id. */
  readonly sourceTypes: ReadonlyMap<string, SourceType>;
}

/** Type 3 ids that are not in the fixed table: anchors and derived entries. */
const COMPUTED_TYPE3_IDS: readonly string[] = [
  MIGRATION_THRESHOLD_ID,
  MIGRATION_SHARE_ID,
  MIGRATION_EXIT_SHARE_ID,
  SHARE_BOTH_ID,
  COST_SCHEDULE_ID,
];

/** Decimals of ids that are not shares or rates (default 6): money and counts 0, minutes and pp 1, elasticity 2. */
const DECIMALS_BY_ID: Readonly<Record<string, number>> = {
  'socialHousing.lag': 0,
  'rentSubsidy.lag': 0,
  'commuterPass.lag': 0,
  'socialHousing.unitCost': 0,
  'commuterPass.unitCost': 0,
  'rentSubsidy.unitCost': 0,
  'rentSubsidy.nationalBudget': 0,
  'rentSubsidy.nationalHouseholds': 0,
  'ghost.size': 0,
  'commuterPass.elasticity': 2,
  'migration.threshold': 1,
  'housing.dwellingSize': 1,
};

export function decimalsOf(id: string): number {
  return DECIMALS_BY_ID[id] ?? 6;
}

function roundEntry(id: string, entry: Entry): Entry {
  const d = decimalsOf(id);
  if (entry.kind === 'schedule') {
    const shares = entry.shares.map((s) => roundTo(s, 6));
    if (shares.length > 0) {
      const head = shares.slice(0, -1).reduce((a, b) => a + b, 0);
      shares[shares.length - 1] = roundTo(1 - head, 6);
    }
    return { ...entry, shares };
  }
  const out: ScalarParameter = { ...entry, value: roundTo(entry.value, d) };
  if (entry.range === undefined) return out;
  return { ...out, range: { ...entry.range, low: roundTo(entry.range.low, d), high: roundTo(entry.range.high, d) } };
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface ParamsInputs {
  readonly part1: ReadonlyMap<string, ScalarParameter>;
  readonly fixedType3: Readonly<Record<string, ScalarParameter>>;
  readonly anchors: Readonly<Record<string, ScalarParameter>>;
  /** Documented_Limits (housing-tools); absent in older fixtures. */
  readonly limits?: LimitParams;
}

/** Merges, derives, rounds and sorts; runs the Id_Set_Check. Pure. */
export function assembleParams(inputs: ParamsInputs, engine: ReadonlySet<string>): ParamsBuild {
  const merged = new Map<string, Entry>();
  const sourceTypes = new Map<string, SourceType>();
  const add = (id: string, entry: Entry, type: SourceType): void => {
    if (merged.has(id)) throw new DataError('duplicate-parameter-id', id);
    merged.set(id, entry);
    sourceTypes.set(id, type);
  };
  for (const [id, e] of inputs.part1) add(id, e, FIXED_TYPE1_IDS.includes(id) ? 1 : 2);
  for (const [id, e] of Object.entries(inputs.fixedType3)) add(id, e, 3);
  for (const [id, e] of Object.entries(inputs.anchors)) add(id, e, 3);
  for (const [id, e] of Object.entries(inputs.limits?.type1 ?? {})) add(id, e, 1);
  for (const [id, e] of Object.entries(inputs.limits?.type2 ?? {})) add(id, e, 2);

  const scalars = new Map<string, ScalarParameter>();
  for (const [id, e] of merged) if (e.kind === 'scalar') scalars.set(id, e);
  add(SHARE_BOTH_ID, deriveShareBoth(scalars), 3);
  add(COST_SCHEDULE_ID, deriveCostSchedule(scalars), 3);

  const parameters: Record<string, Entry> = {};
  for (const id of [...merged.keys()].sort(byCodePoint)) {
    const rounded = roundEntry(id, merged.get(id) as Entry);
    const issues = checkParameterEntry(id, rounded);
    if (issues.length > 0) throw new DataError('params-entry-invalid', id, issues.map((i) => i.problem));
    parameters[id] = rounded;
  }

  const diff = idSetDiff(Object.keys(parameters), engine);
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    throw new DataError('params-id-set', 'params.json', [
      ...diff.missing.map((id) => `missing: ${id}`),
      ...diff.extra.map((id) => `extra: ${id}`),
    ]);
  }
  const file: ParamsFile = { schemaVersion: 1, parameters: parameters as ParameterTable };
  return { file, sourceTypes };
}

function need<T>(value: T | undefined, what: string, step: string): T {
  if (value === undefined) throw new DataError('missing-step-output', what, [`run the ${step} step before the parameter table`]);
  return value;
}

export function paramsStep(readCommitted: CommittedReader = fsCommittedReader): Step {
  return {
    name: 'params',
    run(ctx: BuildContext, state: BuildState) {
      const part1 = need(state.paramsPart1, 'params part 1', 'params-part1');
      const moveOut = need(state.moveOut, 'moveOut', 'migration');
      const population = need(state.population, 'population', 'population');
      const rent = need(state.rent, 'rent', 'rent');
      const householdIncome = need(state.householdIncome, 'householdIncome', 'income');
      const dwelling = part1.entries.get(dwellingSizeId);
      if (dwelling === undefined) throw new DataError('missing-step-output', dwellingSizeId, ['not in the part 1 entries']);

      const track = need(state.policyTrackFile, 'policy-track.json', 'policy-file');
      const districts = need(state.districtsFile, 'districts.json', 'districts');
      const limits = limitParams(
        track,
        (city) => districts.districts.filter((d) => d.city === city).map((d) => d.code),
        readCommitted,
      );
      const exits = readExitTotals(ctx.reader, ctx.quarters);
      const anchors = migrationAnchorParams(moveOut, population, ctx.quarters, exits);
      const inputs: ParamsInputs = {
        part1: part1.entries,
        fixedType3: readFixedType3Params(readCommitted),
        anchors: {
          [MIGRATION_SHARE_ID]: anchors.share,
          [MIGRATION_EXIT_SHARE_ID]: anchors.exitShare,
          [MIGRATION_THRESHOLD_ID]: migrationThresholdParam(rent, householdIncome, ctx.quarters, dwelling.value),
        },
        limits,
      };
      state.params = assembleParams(inputs, engineIdSet());
    },
  };
}

/** Summary lines: number of ids, entries by Parameter_Source_Type and by Parameter_Status (Requirement 20.1). */
export function formatParamsSummary(build: ParamsBuild): string[] {
  const counts: Record<SourceType, number> = { 1: 0, 2: 0, 3: 0 };
  for (const t of build.sourceTypes.values()) counts[t] += 1;
  const status: Record<string, number> = {};
  for (const e of Object.values(build.file.parameters)) status[e.status] = (status[e.status] ?? 0) + 1;
  return [
    `params: ${Object.keys(build.file.parameters).length} ids, id set matches the engine`,
    `params source types: type 1 ${counts[1]}, type 2 ${counts[2]}, type 3 ${counts[3]}`,
    `params status: ${Object.entries(status).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  ];
}

export const TYPE3_ID_COUNT = FIXED_TYPE3_IDS.length + COMPUTED_TYPE3_IDS.length;
