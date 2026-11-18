import fc from 'fast-check';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { decodeSaveCode, encodeSave } from '../../src/save/codec.ts';
import { SAVE_CTX, saveArb } from './arbitraries.ts';

describe('Save_Code round trip', () => {
  // Feature: game-ui, Property 2: Save_Code round trip
  // **Validates: Requirements 13.3, 13.4, 11.8, 19.3**
  it(
    'decodeSaveCode(encodeSave(save)) returns the same Save, timeline order included',
    () => {
      let counterexample: unknown = null;
      fc.assert(
        fc.property(saveArb, (save) => {
          const result = decodeSaveCode(encodeSave(save), SAVE_CTX);
          const good = result.ok && isDeepStrictEqual(result.save, save);
          if (!good && counterexample === null) counterexample = result.ok ? 'differs' : result.error;
          return good;
        }),
        { numRuns: 200 },
      );
      expect(counterexample).toBeNull();
    },
    120_000,
  );
});
