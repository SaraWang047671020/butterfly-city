/** Assembles public/data/commute-matrix.json (Requirement 24.1): exactly the keys `codes` and `minutes`. */
import type { CommuteMatrixFile } from '../../../src/types/data-files.ts';
import type { CommuteMatrixResult } from './model.ts';

export function buildCommuteFile(result: CommuteMatrixResult): CommuteMatrixFile {
  return {
    codes: [...result.codes],
    minutes: result.minutes.map((row) => [...row]),
  };
}
