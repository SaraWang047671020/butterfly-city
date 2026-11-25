/**
 * Reader of the Fixed_Parameter_Table `data/config/params-fixed.json` (Requirement 21 criterion 1).
 *
 * File shape: `{ "schemaVersion": 1, "parameters": { "<id>": <Parameter_Entry>, ... } }`. The file holds the
 * type 1 entries (read here) and, from task 26, the type 3 gap entries. This reader returns exactly the type 1
 * ids and ignores every other id.
 *
 * Stops with a PipelineError naming each failing id and rule (empty unit, citation or url, unknown status,
 * range out of order) and returns the entries without change.
 */
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import { PipelineError } from '../errors.ts';
import { fsCommittedReader, type CommittedReader } from '../policy/step.ts';

export const FIXED_PARAMS_FILE = 'data/config/params-fixed.json';

export const FIXED_TYPE1_IDS: readonly string[] = [
  'socialHousing.rentRatio',
  'rentSubsidy.passThrough',
  'commuterPass.elasticity',
  'ghost.rentThreshold',
  'ghost.commuteThreshold',
  'rentSubsidy.nationalBudget',
  'rentSubsidy.nationalHouseholds',
  'rentSubsidy.lag',
  'sublease.unitCost',
  'sublease.rentShare',
];

/** Type 3 gap ids held as fixed values. `migration.threshold`, `.share`, `.exitShare`, `ghost.shareBoth`, `socialHousing.costSchedule` and `sublease.costSchedule` are computed elsewhere. */
export const FIXED_TYPE3_IDS: readonly string[] = [
  'migration.weightTime',
  'migration.weightBurden',
  'migration.weightCost',
  'ghost.size',
  'commuterPass.lag',
  'commuterPass.unitCost',
  'rentSubsidy.unitCost',
  'sublease.lag',
];

export type FixedType1Params = Readonly<Record<string, ScalarParameter>>;

export function readFixedType1Params(readCommitted: CommittedReader = fsCommittedReader): FixedType1Params {
  return readFixedScalars(FIXED_TYPE1_IDS, readCommitted);
}

/** Reads the fixed type 3 gap entries; each must be a scalar entry with status `gap` and a non-blank assumption. */
export function readFixedType3Params(readCommitted: CommittedReader = fsCommittedReader): FixedType1Params {
  const out = readFixedScalars(FIXED_TYPE3_IDS, readCommitted);
  const details: string[] = [];
  for (const [id, e] of Object.entries(out)) {
    if (e.status !== 'gap') details.push(`${id}: status must be gap`);
    if (e.assumption === undefined || e.assumption.trim() === '') details.push(`${id}: assumption is blank`);
    if (e.estimated === undefined || e.estimated.method.trim() === '') details.push(`${id}: estimated.method is blank`);
  }
  if (details.length > 0) throw new PipelineError(`${FIXED_PARAMS_FILE}: invalid gap entries`, details);
  return out;
}

function readFixedScalars(ids: readonly string[], readCommitted: CommittedReader): FixedType1Params {
  let doc: unknown;
  try {
    doc = JSON.parse(readCommitted(FIXED_PARAMS_FILE));
  } catch (e) {
    throw new PipelineError(`${FIXED_PARAMS_FILE}: cannot read or parse the file`, [(e as Error).message]);
  }
  const parameters =
    typeof doc === 'object' && doc !== null && !Array.isArray(doc)
      ? (doc as { parameters?: unknown }).parameters
      : undefined;
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    throw new PipelineError(`${FIXED_PARAMS_FILE}: expected { "schemaVersion": 1, "parameters": { ... } }`);
  }
  const table = parameters as Readonly<Record<string, unknown>>;

  const details: string[] = [];
  const out: Record<string, ScalarParameter> = {};
  for (const id of ids) {
    const entry = table[id];
    const issues = checkParameterEntry(id, entry);
    if (issues.length > 0) {
      details.push(`${id}: ${issues.map((i) => i.problem).join(', ')}`);
    } else if ((entry as { kind: string }).kind !== 'scalar') {
      details.push(`${id}: schedule-invalid (a type 1 parameter must be a scalar entry)`);
    } else {
      out[id] = entry as ScalarParameter;
    }
  }
  if (details.length > 0) {
    throw new PipelineError(
      `${FIXED_PARAMS_FILE}: ${details.length} invalid entr${details.length === 1 ? 'y' : 'ies'}`,
      details,
    );
  }
  return out;
}
