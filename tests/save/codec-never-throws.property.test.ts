// Feature: game-ui, Property 4: Decode never throws

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeSaveCode, encodeSave, SAVE_CODE_PREFIX } from '../../src/save/codec.ts';
import { encodeUtf8Base64url } from '../../src/save/base64url.ts';
import { SAVE_CTX, saveArb } from './arbitraries.ts';

const RUNS = { numRuns: 200 };

/** Runs decode over every input; returns the first violation or null (no per-value expect). */
function firstViolation(inputs: readonly string[]): string | null {
  for (const text of inputs) {
    try {
      const r = decodeSaveCode(text, SAVE_CTX);
      if (r.ok) {
        // A decoded save must itself be a valid, re-encodable save.
        const again = decodeSaveCode(encodeSave(r.save), SAVE_CTX);
        if (!again.ok) return `accepted but not re-decodable: ${text.slice(0, 80)}`;
      }
    } catch (e) {
      return `threw ${String(e)} on: ${text.slice(0, 80)}`;
    }
  }
  return null;
}

describe('Property 4: decode never throws', () => {
  it(
    'never throws for arbitrary strings, prefixed junk, and encoded JSON values',
    () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 300 }),
          fc.string({ maxLength: 300 }),
          fc.jsonValue(),
          (raw, junk, value) => {
            const inputs = [
              raw,
              SAVE_CODE_PREFIX + junk,
              SAVE_CODE_PREFIX + encodeUtf8Base64url(JSON.stringify(value)),
            ];
            return firstViolation(inputs) === null;
          },
        ),
        RUNS,
      );
    },
    120_000,
  );

  it(
    'rejects every encoded JSON value that is not a valid Save, and accepts valid Saves',
    () => {
      fc.assert(
        fc.property(fc.jsonValue(), saveArb, (value, save) => {
          const bad = decodeSaveCode(
            SAVE_CODE_PREFIX + encodeUtf8Base64url(JSON.stringify(value)),
            SAVE_CTX,
          );
          const good = decodeSaveCode(encodeSave(save), SAVE_CTX);
          return !bad.ok && good.ok;
        }),
        RUNS,
      );
      expect(decodeSaveCode('', SAVE_CTX).ok).toBe(false);
    },
    120_000,
  );
});
