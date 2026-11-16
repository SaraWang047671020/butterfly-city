import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParameterProblem, ParameterTable } from '../../../src/types/simulation.ts';
import { run } from '../../../src/simulation/engine.ts';
import { collectParameterSpecs, RULE_REGISTRY } from '../../../src/simulation/registry.ts';
import { arbEngineInputs } from '../arbitraries.ts';
import type { EngineInputs } from '../arbitraries.ts';
import type { ParameterEntry } from '../fixtures/index.ts';

// Feature: simulation-engine, Property 26: Parameter status and estimate rules
// **Validates: Requirements 7.9, 14.10, 14.11, 14.12, 17.12**

const SPEC_IDS = collectParameterSpecs(RULE_REGISTRY).map((s) => s.id);
const OPTIONAL_IDS = collectParameterSpecs(RULE_REGISTRY)
  .filter((s) => s.optional === true)
  .map((s) => s.id);
const LAG_ID = 'socialHousing.lag';

const DEFECTS = [
  'status-removed',
  'status-unknown',
  'secondary-no-estimate',
  'gap-no-estimate',
  'blank-method',
  'gap-no-assumption',
  'lag-no-nlma',
] as const;
type Defect = (typeof DEFECTS)[number];

type Mutable = Record<string, unknown>;

function mutate(entry: ParameterEntry, defect: Defect): ParameterEntry {
  const e: Mutable = { ...entry };
  switch (defect) {
    case 'status-removed':
      delete e['status'];
      break;
    case 'status-unknown':
      e['status'] = 'bogus';
      break;
    case 'secondary-no-estimate':
      e['status'] = 'secondary';
      delete e['estimated'];
      break;
    case 'gap-no-estimate':
      e['status'] = 'gap';
      e['assumption'] = 'Generated assumption.';
      delete e['estimated'];
      break;
    case 'blank-method':
      e['estimated'] = { method: '  ' };
      break;
    case 'gap-no-assumption':
      e['status'] = 'gap';
      e['estimated'] = { method: 'Generated NLMA method.' };
      delete e['assumption'];
      break;
    case 'lag-no-nlma':
      e['estimated'] = { method: 'Generated method without the note.' };
      break;
  }
  return e as unknown as ParameterEntry;
}

/** Independent restatement of the metadata rules for one entry. */
function expectedProblems(id: string, entry: ParameterEntry): Set<ParameterProblem> {
  const e = entry as unknown as {
    status?: unknown;
    estimated?: { method?: unknown };
    assumption?: unknown;
  };
  const out = new Set<ParameterProblem>();
  const s = e.status;
  if (s === undefined) out.add('status-missing');
  else if (!['verified', 'check', 'secondary', 'gap'].includes(s as string)) out.add('status-unknown');
  const method = e.estimated?.method;
  const blank = typeof method !== 'string' || method.trim() === '';
  if (e.estimated === undefined) {
    if (s === 'secondary' || s === 'gap') out.add('estimated-missing');
  } else if (blank) out.add('estimated-method-empty');
  if (s === 'gap' && (typeof e.assumption !== 'string' || e.assumption.trim() === '')) {
    out.add('assumption-missing');
  }
  if (id === LAG_ID && !(typeof method === 'string' && method.includes('NLMA'))) {
    out.add('lag-derivation-missing');
  }
  return out;
}

const METADATA_CODES = new Set<string>([
  'status-missing',
  'status-unknown',
  'estimated-missing',
  'estimated-method-empty',
  'assumption-missing',
  'lag-derivation-missing',
]);

const arbDefects = fc.uniqueArray(
  fc.record({
    idIndex: fc.nat({ max: Math.max(0, SPEC_IDS.length - 1) }),
    defect: fc.constantFrom(...DEFECTS),
  }),
  { minLength: 1, maxLength: 3, selector: (d) => d.idIndex },
);

function runWith(inputs: EngineInputs, params: ParameterTable) {
  return run(inputs.policies, inputs.events, params, inputs.baseline, inputs.realTrack, inputs.commute, inputs.target as never);
}

describe('Property 26: Parameter status and estimate rules', () => {
  it('injected status and estimate defects give one parameters-invalid error with exactly the matching issues', () => {
    fc.assert(
      fc.property(arbEngineInputs({ quarters: 1 }), arbDefects, (inputs, defects) => {
        const params: Record<string, ParameterEntry> = { ...inputs.params } as Record<string, ParameterEntry>;
        const expected = new Set<string>();
        for (const { idIndex, defect } of defects) {
          const id = SPEC_IDS[idIndex % SPEC_IDS.length] ?? '';
          const original = params[id];
          if (original === undefined) continue; // optional parameter absent in this table
          const changed = mutate(original, defect);
          params[id] = changed;
          for (const code of expectedProblems(id, changed)) expected.add(`${id}|${code}`);
        }
        const result = runWith(inputs, params as ParameterTable);
        if (expected.size === 0) {
          // every chosen defect left a valid entry (for example a lag note on a table that already met it)
          const bad = !result.ok && result.error.code === 'parameters-invalid';
          expect(bad).toBe(false);
          return;
        }
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('parameters-invalid');
        const actual = new Set(
          (result.error.issues ?? []).map((i) => `${i.parameterId}|${i.problem}`),
        );
        expect(actual).toEqual(expected);
      }),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);

  it('a table meeting every rule is accepted, also without optional parameters and with gap values that carry an assumption', () => {
    fc.assert(
      fc.property(
        arbEngineInputs({ quarters: 1 }),
        fc.subarray(OPTIONAL_IDS),
        fc.subarray(OPTIONAL_IDS),
        (inputs, removed, madeGap) => {
          const params: Record<string, ParameterEntry> = { ...inputs.params } as Record<string, ParameterEntry>;
          for (const id of madeGap) {
            const p = params[id];
            if (p === undefined) continue;
            params[id] = {
              ...p,
              status: 'gap',
              estimated: { method: 'Generated method.' },
              assumption: 'Generated assumption.',
            } as ParameterEntry;
          }
          for (const id of removed) delete params[id];
          const result = runWith(inputs, params as ParameterTable);
          const bad = !result.ok && result.error.code === 'parameters-invalid';
          expect(bad).toBe(false);
          // metadata problems never appear
          if (!result.ok) {
            const meta = (result.error.issues ?? []).filter((i) => METADATA_CODES.has(i.problem));
            expect(meta).toEqual([]);
          }
        },
      ),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);
});
