// Example tests for validateSave: one per step e to p, the first failing step and path,
// the version message, immutability of the input, and the worst-case code length.

import { describe, expect, it } from 'vitest';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import { MAX_SAVE_CODE_LENGTH, encodeSave } from '../../src/save/codec.ts';
import { VERSION_MISMATCH_REASON, validateSave } from '../../src/save/validate-save.ts';
import type { Save } from '../../src/types/save.ts';
import { CITIES, DISTRICT_CODES } from '../simulation/fixtures/districts.ts';
import { QUARTER_KEYS, SAVE_CTX } from './arbitraries.ts';

interface Choice {
  readonly tool: string;
  readonly field: string;
  readonly area: string;
  readonly integer: boolean;
}

const CHOICES: readonly Choice[] = RULE_REGISTRY.tools.flatMap((rule) =>
  rule.fields.flatMap((f) =>
    (f.area === 'district' ? DISTRICT_CODES : CITIES).map((area) => ({
      tool: rule.id,
      field: f.id,
      area: area as string,
      integer: f.integer === true,
    })),
  ),
);
const REAL = CHOICES.find((c) => !c.integer)!;
const INT = CHOICES.find((c) => c.integer);

const diffs44 = (): number[] => Array.from({ length: 44 }, (_, i) => (i === 0 ? 1.5 : 0));

function validSave(): Record<string, unknown> {
  const entry = (quarter: string) => ({
    kind: 'value', quarter, tool: REAL.tool, field: REAL.field, area: REAL.area, before: 1.5, after: 2.5,
  });
  return {
    schemaVersion: 1,
    engineVersion: 'e1',
    next: '2020Q1',
    policy: [{ tool: REAL.tool, field: REAL.field, area: REAL.area, diffs: diffs44() }],
    timeline: [entry('2015Q1'), entry('2016Q1'), entry('2017Q1'), entry('2018Q1')],
    mapIndicator: 'rentBurden',
    selectedDistrict: null,
    demo: false,
    seed: 7,
  };
}

type Mutator = (s: Record<string, any>) => void;

function check(mutate: Mutator, step: string, path: string): void {
  const save = validSave();
  mutate(save);
  const before = structuredClone(save);
  const error = validateSave(save, SAVE_CTX);
  expect(error).not.toBeNull();
  expect(error?.step).toBe(step);
  expect(error?.path).toBe(path);
  expect(save).toEqual(before);
}

describe('validateSave', () => {
  it('accepts a valid save and leaves it unchanged', () => {
    const save = validSave();
    const before = structuredClone(save);
    expect(validateSave(save, SAVE_CTX)).toBeNull();
    expect(save).toEqual(before);
  });

  it('e: schema version mismatch uses the version message', () => {
    const save = validSave();
    save['schemaVersion'] = 2;
    const error = validateSave(save, SAVE_CTX);
    expect(error).toEqual({ step: 'schema-version', path: 'schemaVersion', reason: VERSION_MISMATCH_REASON });
    expect(error?.reason).toBe('This save code was made by a different version of Butterfly City.');
  });

  it('e: a non-object is a structure failure at the root', () => {
    expect(validateSave([], SAVE_CTX)).toMatchObject({ step: 'structure', path: '$' });
    expect(validateSave(null, SAVE_CTX)).toMatchObject({ step: 'structure', path: '$' });
  });

  it('f: unknown root key', () => check((s) => { s['extra'] = 1; }, 'structure', '$'));
  it('f: policy diffs of the wrong length', () =>
    check((s) => { s['policy'][0].diffs.pop(); }, 'structure', 'policy[0].diffs'));
  it('f: timeline over the entry cap', () =>
    check((s) => { s['timeline'] = Array.from({ length: 501 }, () => s['timeline'][0]); }, 'structure', 'timeline'));

  it('g: wrong type of a diff', () =>
    check((s) => { s['policy'][0].diffs[5] = '1'; }, 'types', 'policy[0].diffs[5]'));
  it('g: wrong type of seed', () => check((s) => { s['seed'] = '7'; }, 'types', 'seed'));

  it('h: invalid next quarter', () => check((s) => { s['next'] = '2026Q1'; }, 'quarters', 'next'));
  it('h: invalid timeline quarter reports timeline[3].quarter', () =>
    check((s) => { s['timeline'][3].quarter = '2030Q1'; }, 'quarters', 'timeline[3].quarter'));

  it('i: timeline entry after the next quarter', () =>
    check((s) => { s['next'] = '2017Q1'; }, 'timeline-order', 'timeline[3].quarter'));

  it('j: unknown tool', () =>
    check((s) => { s['policy'][0].tool = 'nope'; }, 'registry', 'policy[0].tool'));
  it('j: duplicate series', () =>
    check((s) => { s['policy'].push(structuredClone(s['policy'][0])); }, 'registry', 'policy[1]'));
  it('j: real-track entry with a non-null after', () =>
    check((s) => { s['timeline'][1].kind = 'real-track'; }, 'registry', 'timeline[1].after'));
  it.skipIf(INT === undefined)('j: non-integer diff for an integer field', () =>
    check((s) => {
      s['policy'][0] = { tool: INT!.tool, field: INT!.field, area: INT!.area, diffs: diffs44() };
    }, 'registry', 'policy[0].diffs[0]'));

  it('k: area that does not fit the field', () =>
    check((s) => { s['policy'][0].area = 'nowhere'; }, 'districts', 'policy[0].area'));
  it('l: unknown map indicator', () => check((s) => { s['mapIndicator'] = 'x'; }, 'map-indicator', 'mapIndicator'));
  it('m: unknown selected district', () =>
    check((s) => { s['selectedDistrict'] = '0'; }, 'selected-district', 'selectedDistrict'));
  it('n: demo flag not boolean', () => check((s) => { s['demo'] = 1; }, 'demo-flag', 'demo'));
  it('o: seed not an integer', () => check((s) => { s['seed'] = 1.5; }, 'seed', 'seed'));
  it('p: non-finite diff', () =>
    check((s) => { s['policy'][0].diffs[2] = Infinity; }, 'finite', 'policy[0].diffs[2]'));
  it('p: non-finite timeline value', () =>
    check((s) => { s['timeline'][2].after = -Infinity; }, 'finite', 'timeline[2].after'));

  it('reports the first failing step when several apply', () =>
    check((s) => { s['demo'] = 1; s['mapIndicator'] = 'x'; }, 'map-indicator', 'mapIndicator'));
});

describe('worst-case save (G8)', () => {
  it('encodes to at most 200,000 characters', () => {
    const longReal = -1.7976931348623157e308;
    const longInt = -999_999_999_999_999;
    const val = (c: Choice): number => (c.integer ? longInt : longReal);
    const policy = CHOICES.map((c) => ({
      tool: c.tool,
      field: c.field,
      area: c.area,
      diffs: Array.from({ length: 44 }, () => val(c)),
    }));
    const longest = CHOICES.reduce((a, b) =>
      (b.tool + b.field + b.area).length > (a.tool + a.field + a.area).length ? b : a,
    );
    const timeline = Array.from({ length: 500 }, () => ({
      kind: 'value' as const,
      quarter: QUARTER_KEYS[0]!,
      tool: longest.tool,
      field: longest.field,
      area: longest.area,
      before: val(longest),
      after: val(longest),
    }));
    const save = {
      schemaVersion: 1,
      engineVersion: 'v'.repeat(32),
      next: 'complete',
      policy,
      timeline,
      mapIndicator: 'populationChange',
      selectedDistrict: DISTRICT_CODES[0]!,
      demo: true,
      seed: 2 ** 31 - 1,
    } as unknown as Save;
    expect(policy.length).toBeLessThanOrEqual(47);
    expect(encodeSave(save).length).toBeLessThanOrEqual(MAX_SAVE_CODE_LENGTH);
  });
});
