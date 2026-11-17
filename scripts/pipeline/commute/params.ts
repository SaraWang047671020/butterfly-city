/**
 * Reader of the Commute_Config_File `data/config/commute-params.json` (Requirement 25 criteria 3 and 4).
 *
 * File shape: `{ "schemaVersion": 1, "parameters": { "<id>": <scalar Parameter_Entry>, ... } }`, the
 * wrapped form of the Params_File. The eight ids are not engine ids and never enter params.json.
 *
 * Stops with a PipelineError that names the id when an id is absent, a value is non-finite, a `unit` is
 * empty, or a non-`gap` entry has no source. A `gap` entry with an assumption never blocks the build.
 */
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import { PipelineError } from '../errors.ts';
import { fsCommittedReader, type CommittedReader } from '../policy/step.ts';

export const COMMUTE_PARAMS_FILE = 'data/config/commute-params.json';

export const COMMUTE_PARAM_IDS: readonly string[] = [
  'commute.detourFactor',
  'commute.walkSpeed',
  'commute.roadSpeed.taipei',
  'commute.roadSpeed.newTaipei',
  'commute.accessTime',
  'commute.transferWalk',
  'commute.transferWait',
  'commute.tripsPerMonth',
];

export type CommuteParams = Readonly<Record<string, ScalarParameter>>;

export function readCommuteParams(readCommitted: CommittedReader = fsCommittedReader): CommuteParams {
  let doc: unknown;
  try {
    doc = JSON.parse(readCommitted(COMMUTE_PARAMS_FILE));
  } catch (e) {
    throw new PipelineError(`${COMMUTE_PARAMS_FILE}: cannot read or parse the file`, [(e as Error).message]);
  }
  const parameters =
    typeof doc === 'object' && doc !== null && !Array.isArray(doc)
      ? (doc as { parameters?: unknown }).parameters
      : undefined;
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    throw new PipelineError(`${COMMUTE_PARAMS_FILE}: expected { "schemaVersion": 1, "parameters": { ... } }`);
  }
  const table = parameters as Readonly<Record<string, unknown>>;

  const details: string[] = [];
  const out: Record<string, ScalarParameter> = {};
  for (const id of COMMUTE_PARAM_IDS) {
    const entry = table[id];
    const issues = checkParameterEntry(id, entry, { sourceOptionalForGap: true });
    if (issues.length > 0) {
      details.push(`${id}: ${issues.map((i) => i.problem).join(', ')}`);
    } else if ((entry as { kind: string }).kind !== 'scalar') {
      details.push(`${id}: schedule-invalid (a commute constant must be a scalar entry)`);
    } else {
      out[id] = entry as ScalarParameter;
    }
  }
  if (details.length > 0) {
    throw new PipelineError(`${COMMUTE_PARAMS_FILE}: ${details.length} invalid entr${details.length === 1 ? 'y' : 'ies'}`, details);
  }
  return out;
}
