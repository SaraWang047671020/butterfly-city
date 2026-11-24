import { COST_SCHEDULE_ID, SHARE_BOTH_ID } from '../../../scripts/pipeline/params/derived.ts';
import { limitSourceType } from '../../../scripts/pipeline/params/limits.ts';
import { FIXED_TYPE1_IDS, FIXED_TYPE3_IDS } from '../../../scripts/pipeline/params/fixed-table.ts';

const COMPUTED_TYPE3 = ['migration.threshold', 'migration.share', 'migration.exitShare', SHARE_BOTH_ID, COST_SCHEDULE_ID];

/** Parameter_Source_Type of an engine parameter id (1 fixed, 2 computed from data, 3 gap). */
export function paramSourceType(id: string): 1 | 2 | 3 {
  const limit = limitSourceType(id);
  if (limit !== null) return limit;
  if (FIXED_TYPE1_IDS.includes(id)) return 1;
  if (FIXED_TYPE3_IDS.includes(id) || COMPUTED_TYPE3.includes(id)) return 3;
  return 2;
}
