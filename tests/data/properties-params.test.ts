// Property tests for the Params_File validator (Properties 38 and 39) in the data-pipeline spec.
//
// Oracle for Property 38: the valid file is the committed public/data/params.json (140 ids, real district
// codes). Each case injects one typed defect into a deep copy and names the JSON path at which
// `validateParamsFile` must report it. The undamaged file must produce no error.

import { limitSourceType } from '../../scripts/pipeline/params/limits.ts';
import fs from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import { validateParamsFile } from '../../src/data/validate-params.ts';
import { validateCommuteMatrix } from '../../src/data/validate.ts';
import type { ValidationContext, ValidationError } from '../../src/data/validate.ts';
import { serializeJson } from '../../scripts/pipeline/serialize.ts';
import { FIXED_TYPE1_IDS, FIXED_TYPE3_IDS } from '../../scripts/pipeline/params/fixed-table.ts';
import { MIGRATION_EXIT_SHARE_ID, MIGRATION_SHARE_ID, MIGRATION_THRESHOLD_ID } from '../../scripts/pipeline/params/migration-anchors.ts';
import { COST_SCHEDULE_ID, SHARE_BOTH_ID } from '../../scripts/pipeline/params/derived.ts';
import { roundTo } from '../../scripts/pipeline/numeric.ts';
import { decimalsOf } from '../../scripts/pipeline/params/params-file.ts';
import type { Json } from './helpers.ts';

const NUM_RUNS = 100;
const TIMEOUT_MS = 120_000;
const JOB_PREFIX = 'commute.jobShare.';

const real: Json = JSON.parse(fs.readFileSync('public/data/params.json', 'utf8'));
const realIds: string[] = Object.keys(real.parameters);
const districtCodes = realIds.filter((id) => id.startsWith(JOB_PREFIX)).map((id) => id.slice(JOB_PREFIX.length));
const type3 = new Set<string>([...FIXED_TYPE3_IDS, MIGRATION_EXIT_SHARE_ID, MIGRATION_SHARE_ID, MIGRATION_THRESHOLD_ID, SHARE_BOTH_ID, COST_SCHEDULE_ID]);
const sourceTypes: Record<string, 1 | 2 | 3> = {};
for (const id of realIds) sourceTypes[id] = limitSourceType(id) ?? (FIXED_TYPE1_IDS.includes(id) ? 1 : type3.has(id) ? 3 : 2);

const ctx: ValidationContext = {
  districtCodes,
  quarters: [],
  indicatorIds: [],
  policySeriesIds: [],
  engineIdSet: realIds,
  sourceTypes,
};

const keyPath = (id: string): string => `$.parameters[${JSON.stringify(id)}]`;
const copy = (): Json => JSON.parse(JSON.stringify(real));
const entriesWhere = (pred: (e: Json) => boolean): string[] => realIds.filter((id) => pred(real.parameters[id]));
const sortedParams = (p: Json): Json =>
  Object.fromEntries(Object.entries(p).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const withStatus = (...s: string[]) => entriesWhere((e) => s.includes(e.status));
const SECONDARY_OR_GAP = withStatus('secondary', 'gap');
const GAPS = withStatus('gap');
const ALL = realIds;
const SCALARS_RANGE = entriesWhere((e) => e.kind === 'scalar' && e.range !== undefined);
const SCHEDULES = entriesWhere((e) => e.kind === 'schedule');
const JOB_IDS = realIds.filter((id) => id.startsWith(JOB_PREFIX));

/** A defect: applies itself to `file` (mutating it) and returns the path where it must be reported. */
type Defect = (file: Json, pick: number) => string;
const choose = (list: readonly string[], pick: number): string => list[pick % list.length] as string;

const DEFECTS: readonly Defect[] = [
  // id removed
  (f, n) => {
    const id = choose(ALL, n);
    delete f.parameters[id];
    return keyPath(id);
  },
  // id added
  (f, n) => {
    const id = `zz.extra${n}`;
    f.parameters = sortedParams({ ...f.parameters, [id]: { ...f.parameters[choose(ALL, n)] } });
    return keyPath(id);
  },
  // missing unit
  (f, n) => {
    const id = choose(ALL, n);
    delete f.parameters[id].unit;
    return keyPath(id);
  },
  // missing source.citation
  (f, n) => {
    const id = choose(ALL, n);
    f.parameters[id].source.citation = '';
    return keyPath(id);
  },
  // missing source.url
  (f, n) => {
    const id = choose(ALL, n);
    delete f.parameters[id].source.url;
    return keyPath(id);
  },
  // unknown status
  (f, n) => {
    const id = choose(ALL, n);
    f.parameters[id].status = 'probably';
    return keyPath(id);
  },
  // secondary or gap without estimated.method
  (f, n) => {
    const id = choose(SECONDARY_OR_GAP, n);
    delete f.parameters[id].estimated.method;
    return keyPath(id);
  },
  // gap without assumption
  (f, n) => {
    const id = choose(GAPS, n);
    delete f.parameters[id].assumption;
    return keyPath(id);
  },
  // range with low > value
  (f, n) => {
    const id = choose(SCALARS_RANGE, n);
    const e = f.parameters[id];
    e.range.low = e.value + 1;
    e.range.high = e.value + 2;
    return keyPath(id);
  },
  // range with value > high
  (f, n) => {
    const id = choose(SCALARS_RANGE, n);
    const e = f.parameters[id];
    e.range.low = e.value - 2;
    e.range.high = e.value - 1;
    return keyPath(id);
  },
  // schedule shares do not sum to 1
  (f, n) => {
    const id = choose(SCHEDULES, n);
    f.parameters[id].shares[0] += 0.5;
    return keyPath(id);
  },
  // socialHousing.lag method without NLMA
  (f) => {
    f.parameters['socialHousing.lag'].estimated.method = 'Assumed from a general planning delay.';
    return keyPath('socialHousing.lag');
  },
  // range on ghost.rentThreshold
  (f) => {
    const e = f.parameters['ghost.rentThreshold'];
    e.range = { low: e.value - 1, high: e.value + 1, lowSource: e.source, highSource: e.source };
    return keyPath('ghost.rentThreshold');
  },
  // shareBoth above its bound
  (f) => {
    f.parameters[SHARE_BOTH_ID].value = 0.5;
    return keyPath(SHARE_BOTH_ID);
  },
  // job shares do not sum to 1
  (f, n) => {
    f.parameters[choose(JOB_IDS, n)].value += 0.1;
    return '$.parameters';
  },
];

const hasPath = (errors: readonly ValidationError[], path: string): boolean => errors.some((e) => e.path === path);

describe('Property 38: the parameter validator reports every injected defect at its path', () => {
  it('reports no error for the undamaged file', () => {
    expect(validateParamsFile(copy(), ctx)).toEqual([]);
  });

  it('reports at least one error at the path of any single injected defect', () => {
    const failures: string[] = [];
    fc.assert(
      fc.property(fc.nat(DEFECTS.length - 1), fc.nat(10_000), (kind, pick) => {
        const file = copy();
        const path = (DEFECTS[kind] as Defect)(file, pick);
        const errors = validateParamsFile(file, ctx);
        if (!hasPath(errors, path)) failures.push(`defect ${kind} pick ${pick}: no error at ${path}`);
        return failures.length === 0;
      }),
      { numRuns: NUM_RUNS * 3 },
    );
    expect(failures).toEqual([]);
  }, TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// Property 39: params and commute matrix files round-trip through the canonical serializer
// ---------------------------------------------------------------------------------------------

const realMatrix: Json = JSON.parse(fs.readFileSync('public/data/commute-matrix.json', 'utf8'));
const sortedCodes: string[] = [...districtCodes].sort();
const matrixCtx: ValidationContext = { ...ctx, districtCodes: sortedCodes };
const N = sortedCodes.length;

/** Scalars with a range whose value may move anywhere inside [low, high] without breaking another rule. */
const VARIABLE_IDS = SCALARS_RANGE.filter((id) => id !== SHARE_BOTH_ID && !id.startsWith(JOB_PREFIX));

/** Value fraction in [0, 1] per variable scalar, mapped into its range, rounded to the id's decimals, clamped to [low, high]. */
const paramsArb = fc
  .array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: VARIABLE_IDS.length, maxLength: VARIABLE_IDS.length })
  .map((fractions) => {
    const file = copy();
    VARIABLE_IDS.forEach((id, i) => {
      const e = file.parameters[id];
      const v = roundTo(e.range.low + (e.range.high - e.range.low) * (fractions[i] as number), decimalsOf(id));
      e.value = Math.min(e.range.high, Math.max(e.range.low, v));
    });
    return file;
  });

/** Symmetric-free random matrix: cells are tenths of minutes, diagonal zero, codes from the real districts. */
const matrixArb = fc
  .array(fc.integer({ min: 0, max: 3000 }), { minLength: N * N, maxLength: N * N })
  .map((tenths) => ({
    codes: [...sortedCodes],
    minutes: sortedCodes.map((_, i) => sortedCodes.map((__, j) => (i === j ? 0 : (tenths[i * N + j] as number) / 10))),
  }));

describe('Property 39: params and commute matrix files round-trip', () => {
  it('the committed commute matrix is valid under the test context', () => {
    expect(validateCommuteMatrix(realMatrix, matrixCtx)).toEqual([]);
  });

  it('a Params_File serializes, parses, validates with zero errors and deep-equals the original', () => {
    const failures: string[] = [];
    fc.assert(
      fc.property(paramsArb, (file) => {
        const back = JSON.parse(serializeJson(file));
        const errors = validateParamsFile(back, ctx);
        if (errors.length > 0) failures.push(`validation: ${JSON.stringify(errors[0])}`);
        else if (!isDeepStrictEqual(back, file)) failures.push('round-trip differs');
        return failures.length === 0;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(failures).toEqual([]);
  }, TIMEOUT_MS);

  it('a Commute_Matrix_File serializes, parses, validates with zero errors and deep-equals the original', () => {
    const failures: string[] = [];
    fc.assert(
      fc.property(matrixArb, (file) => {
        const back = JSON.parse(serializeJson(file));
        const errors = validateCommuteMatrix(back, matrixCtx);
        if (errors.length > 0) failures.push(`validation: ${JSON.stringify(errors[0])}`);
        else if (!isDeepStrictEqual(back, file)) failures.push('round-trip differs');
        return failures.length === 0;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(failures).toEqual([]);
  }, TIMEOUT_MS);

  it('the matrix validator reports non-zero diagonal, negative or non-finite cells, wrong shape and wrong codes', () => {
    const failures: string[] = [];
    fc.assert(
      fc.property(fc.nat(5), fc.nat(N - 1), fc.nat(N - 1), (kind, i, j) => {
        const m = JSON.parse(JSON.stringify(realMatrix));
        let path: string;
        if (kind === 0) {
          m.minutes[i][i] = 1.5;
          path = `$.minutes[${i}][${i}]`;
        } else if (kind === 1) {
          const jj = j === i ? (j + 1) % N : j;
          m.minutes[i][jj] = -0.5;
          path = `$.minutes[${i}][${jj}]`;
        } else if (kind === 2) {
          m.minutes[i][j] = null; // JSON form of a non-finite cell
          path = `$.minutes[${i}][${j}]`;
        } else if (kind === 3) {
          m.minutes.pop();
          path = '$.minutes';
        } else if (kind === 4) {
          m.minutes[i].pop();
          path = `$.minutes[${i}]`;
        } else {
          m.codes[i] = '99999999';
          path = '$.codes';
        }
        if (!hasPath(validateCommuteMatrix(m, matrixCtx), path)) failures.push(`kind ${kind} i ${i} j ${j}: no error at ${path}`);
        return failures.length === 0;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(failures).toEqual([]);
  }, TIMEOUT_MS);
});
