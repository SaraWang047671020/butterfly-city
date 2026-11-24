import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COST_SCHEDULE_ID, SHARE_BOTH_ID } from '../../scripts/pipeline/params/derived.ts';
import { engineIdSet } from '../../scripts/pipeline/params/engine-ids.ts';
import { FIXED_TYPE1_IDS, FIXED_TYPE3_IDS } from '../../scripts/pipeline/params/fixed-table.ts';
import { DISTRICTS } from '../../scripts/lib/districts.ts';
import { validateParamsFile, EXPECTED_SOURCE_TYPE_COUNTS } from '../../src/data/validate-params.ts';
import type { ValidationContext } from '../../src/data/validate.ts';

type Json = any;

const COMPUTED_TYPE3 = [
  'migration.threshold',
  'migration.share',
  'migration.exitShare',
  SHARE_BOTH_ID,
  COST_SCHEDULE_ID,
];

const real: Json = JSON.parse(readFileSync('public/data/params.json', 'utf8'));
const ids = Object.keys(real.parameters);

function typeOf(id: string): 1 | 2 | 3 {
  if (FIXED_TYPE1_IDS.includes(id)) return 1;
  if (FIXED_TYPE3_IDS.includes(id) || COMPUTED_TYPE3.includes(id)) return 3;
  return 2;
}

const sourceTypes: Record<string, 1 | 2 | 3> = Object.fromEntries(ids.map((id) => [id, typeOf(id)]));

const ctx: ValidationContext = {
  districtCodes: DISTRICTS.map((d) => d.code),
  quarters: [],
  indicatorIds: [],
  policySeriesIds: [],
  engineIdSet: [...engineIdSet()],
  sourceTypes,
};

const clone = (): Json => JSON.parse(JSON.stringify(real));
const rules = (x: unknown, c: ValidationContext = ctx): string[] => validateParamsFile(x, c).map((e) => e.rule);

describe('the committed params.json', () => {
  it('has 74 ids and source types 8 / 54 / 12', () => {
    expect(ids).toHaveLength(74);
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const id of ids) counts[typeOf(id)] += 1;
    expect(counts).toEqual({ 1: 8, 2: 54, 3: 12 });
    expect(EXPECTED_SOURCE_TYPE_COUNTS).toEqual({ 1: 8, 2: 54, 3: 12 });
  });

  it('has status counts 8 verified, 53 secondary, 13 gap', () => {
    const status: Record<string, number> = {};
    for (const e of Object.values<Json>(real.parameters)) status[e.status] = (status[e.status] ?? 0) + 1;
    expect(status).toEqual({ verified: 8, secondary: 53, gap: 13 });
  });

  it('passes the validator with no error', () => {
    expect(validateParamsFile(real, ctx)).toEqual([]);
  });
});

describe('validateParamsFile, one defect each', () => {
  it('rejects a non-object', () => {
    expect(rules(null)).toEqual(['type']);
  });

  it('rejects a wrong schemaVersion', () => {
    const f = clone();
    f.schemaVersion = 2;
    expect(validateParamsFile(f, ctx).map((e) => e.path)).toEqual(['$.schemaVersion']);
  });

  it('rejects an unexpected top-level key', () => {
    const f = clone();
    f.extra = 1;
    expect(validateParamsFile(f, ctx).map((e) => e.path)).toEqual(['$.extra']);
  });

  it('requires the parameters field', () => {
    const f = clone();
    delete f.parameters;
    expect(rules(f)).toEqual(['required']);
  });

  it('rejects a parameters array', () => {
    const f = clone();
    f.parameters = [];
    expect(rules(f)).toEqual(['type']);
  });

  it('reports an id the engine needs and the file lacks', () => {
    const f = clone();
    delete f.parameters['ghost.size'];
    const errs = validateParamsFile(f, ctx);
    expect(errs.some((e) => e.rule === 'id-set' && e.message.includes('ghost.size'))).toBe(true);
  });

  it('reports an id the engine does not read', () => {
    const f = clone();
    f.parameters['zzz.extra'] = f.parameters['ghost.size'];
    const errs = validateParamsFile(f, ctx);
    expect(errs.some((e) => e.rule === 'id-set' && e.message.includes('zzz.extra'))).toBe(true);
  });

  it('reports ids out of code-point order', () => {
    const f = clone();
    f.parameters = Object.fromEntries(Object.entries(f.parameters).reverse());
    expect(rules(f)).toContain('order');
  });

  it('reports an entry that is not an object', () => {
    const f = clone();
    f.parameters['ghost.size'] = 5;
    const errs = validateParamsFile(f, ctx);
    expect(errs.some((e) => e.rule === 'type' && e.path.includes('ghost.size'))).toBe(true);
  });

  it('reports an empty unit', () => {
    const f = clone();
    f.parameters['ghost.size'].unit = ' ';
    expect(validateParamsFile(f, ctx).some((e) => e.rule === 'entry' && e.message.includes('unit-empty'))).toBe(true);
  });

  it('reports a shareBoth above its bound', () => {
    const f = clone();
    f.parameters[SHARE_BOTH_ID].value = 0.99;
    expect(rules(f)).toContain('special');
  });

  it('reports an id without a source type', () => {
    const st = { ...sourceTypes };
    delete st['ghost.size'];
    expect(rules(real, { ...ctx, sourceTypes: st })).toContain('source-type');
  });

  it('reports a source type count that differs from 8 / 54 / 12', () => {
    const type2 = ids.find((id) => typeOf(id) === 2) as string;
    const st = { ...sourceTypes, [type2]: 1 as const };
    const errs = validateParamsFile(real, { ...ctx, sourceTypes: st });
    expect(errs.some((e) => e.rule === 'source-type')).toBe(true);
  });
});

describe('validateParamsFile without engineIdSet and sourceTypes (web app loader)', () => {
  const { engineIdSet: _e, sourceTypes: _s, ...bare } = ctx;

  it('gives zero errors for a valid file', () => {
    expect(validateParamsFile(real, bare)).toEqual([]);
  });

  it('skips the id-set, source-type and type-count checks', () => {
    const f = clone();
    delete f.parameters['ghost.size'];
    f.parameters['zzz.extra'] = real.parameters['ghost.size'];
    f.parameters = Object.fromEntries(Object.entries(f.parameters).sort(([a], [b]) => (a < b ? -1 : 1)));
    const found = rules(f, bare);
    expect(found).not.toContain('id-set');
    expect(found).not.toContain('source-type');
  });
});
