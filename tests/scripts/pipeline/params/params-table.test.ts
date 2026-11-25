import { describe, expect, it } from 'vitest';
import { DataError } from '../../../../scripts/pipeline/errors.ts';
import {
  COST_SCHEDULE_ID,
  SHARE_BOTH_ID,
  SUBLEASE_SCHEDULE_ID,
  deriveCostSchedule,
  deriveShareBoth,
} from '../../../../scripts/pipeline/params/derived.ts';
import { OMITTED_OPTIONAL_IDS, idSetDiff } from '../../../../scripts/pipeline/params/engine-ids.ts';
import { assembleParams, type ParamsBuild } from '../../../../scripts/pipeline/params/params-file.ts';
import {
  parseCommuterPassProducts,
  parseHoldingTaxRates,
  parseSubleasePhases,
} from '../../../../scripts/pipeline/parsers/policy-tables.ts';
import {
  COMMUTER_PASS_TABLE,
  fsCommittedReader,
  HOLDING_TAX_TABLE,
  SUBLEASE_TABLE,
} from '../../../../scripts/pipeline/policy/step.ts';
import { renderSourcesDoc } from '../../../../scripts/pipeline/sources-doc.ts';
import type { ScalarParameter } from '../../../../src/types/simulation.ts';
import { validDistrictsFile, validHistoryFile, validPolicyTrackFile } from '../../../data/helpers.ts';

const src = { citation: 'Test source (2020)', url: 'https://example.org/s' };

function scalar(value: number, extra: Partial<ScalarParameter> = {}): ScalarParameter {
  return { kind: 'scalar', value, unit: 'share', status: 'verified', source: src, ...extra };
}

function fixtureEntries(): Map<string, ScalarParameter> {
  return new Map([
    ['ghost.shareRent', scalar(0.4)],
    ['ghost.shareCommuteWithin', scalar(0.7, { range: { low: 0.6, high: 0.8, lowSource: src, highSource: src } })],
    ['socialHousing.lag', scalar(4, { unit: 'quarters' })],
    ['sublease.unitCost', scalar(163950, { unit: 'TWD per home matched' })],
  ]);
}

describe('idSetDiff', () => {
  const engine = new Set(['a', 'b', 'c']);

  it('is empty for equal sets', () => {
    expect(idSetDiff(['c', 'a', 'b'], engine)).toEqual({ missing: [], extra: [] });
  });

  it('lists a missing id', () => {
    expect(idSetDiff(['a', 'b'], engine)).toEqual({ missing: ['c'], extra: [] });
  });

  it('lists an extra id', () => {
    expect(idSetDiff(['a', 'b', 'c', 'z'], engine)).toEqual({ missing: [], extra: ['z'] });
  });

  it('reports an Omitted_Optional_Id present in the table as extra', () => {
    const omitted = OMITTED_OPTIONAL_IDS[0] as string;
    expect(idSetDiff(['a', 'b', 'c', omitted], engine)).toEqual({ missing: [], extra: [omitted] });
  });
});

describe('deriveShareBoth', () => {
  it('is shareRent times (1 - shareCommuteWithin) for independent shares', () => {
    const e = deriveShareBoth(fixtureEntries());
    expect(e.value).toBeCloseTo(0.12, 12);
    expect(e.status).toBe('gap');
  });

  it('throws when the product is above min(shareRent, 1 - high)', () => {
    const m = fixtureEntries();
    // high 0.2 gives bound min(0.4, 0.8) = 0.4; the product 0.4 * 0.3 = 0.12 passes. Use a range high above value instead.
    m.set('ghost.shareCommuteWithin', scalar(0.7, { range: { low: 0.7, high: 0.95, lowSource: src, highSource: src } }));
    expect(() => deriveShareBoth(m)).toThrow(DataError);
  });
});

describe('deriveCostSchedule', () => {
  it('gives equal shares over offsets 0 to lag - 1 that sum to 1', () => {
    const e = deriveCostSchedule(fixtureEntries());
    expect(e.offsets).toEqual([0, 1, 2, 3]);
    expect(e.shares).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('lets the last share absorb the rounding for lag 3', () => {
    const m = fixtureEntries();
    m.set('socialHousing.lag', scalar(3, { unit: 'quarters' }));
    const e = deriveCostSchedule(m);
    expect(e.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(e.shares[2]).toBeCloseTo(1 / 3, 12);
  });

  it('rejects a non-integer lag', () => {
    const m = fixtureEntries();
    m.set('socialHousing.lag', scalar(2.5));
    expect(() => deriveCostSchedule(m)).toThrow(DataError);
  });
});

describe('assembleParams', () => {
  const inputs = { part1: fixtureEntries(), fixedType3: {}, anchors: {} };
  const engineOk = new Set([
    'ghost.shareRent',
    'ghost.shareCommuteWithin',
    'socialHousing.lag',
    'sublease.unitCost',
    SHARE_BOTH_ID,
    COST_SCHEDULE_ID,
    SUBLEASE_SCHEDULE_ID,
  ]);

  it('derives, sorts and returns the table when the id set matches', () => {
    const b = assembleParams(inputs, engineOk);
    expect(Object.keys(b.file.parameters)).toEqual([...engineOk].sort());
    expect(b.sourceTypes.get(SHARE_BOTH_ID)).toBe(3);
  });

  it('throws params-id-set listing a missing id', () => {
    try {
      assembleParams(inputs, new Set([...engineOk, 'ghost.other']));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DataError);
      expect((e as DataError).details).toEqual(['missing: ghost.other']);
      expect((e as DataError).message).toContain('params-id-set');
    }
  });

  it('throws params-id-set listing an extra id', () => {
    const engine = new Set(engineOk);
    engine.delete(COST_SCHEDULE_ID);
    try {
      assembleParams(inputs, engine);
      expect.unreachable();
    } catch (e) {
      expect((e as DataError).details).toEqual([`extra: ${COST_SCHEDULE_ID}`]);
    }
  });
});

describe('SOURCES.md section 12 on a small fixture', () => {
  it('renders counts, the id table, omitted ids and the gap rows', () => {
    const build: ParamsBuild = assembleParams(
      { part1: fixtureEntries(), fixedType3: {}, anchors: {} },
      new Set([
        'ghost.shareRent',
        'ghost.shareCommuteWithin',
        'socialHousing.lag',
        'sublease.unitCost',
        SHARE_BOTH_ID,
        COST_SCHEDULE_ID,
        SUBLEASE_SCHEDULE_ID,
      ]),
    );
    const text = renderSourcesDoc({
      districtsFile: validDistrictsFile(),
      historyFile: validHistoryFile(),
      policyTrackFile: validPolicyTrackFile(),
      holdingTaxRates: parseHoldingTaxRates(fsCommittedReader(HOLDING_TAX_TABLE), HOLDING_TAX_TABLE),
      commuterPassProducts: parseCommuterPassProducts(fsCommittedReader(COMMUTER_PASS_TABLE), COMMUTER_PASS_TABLE),
      subleasePhases: parseSubleasePhases(fsCommittedReader(SUBLEASE_TABLE), SUBLEASE_TABLE),
      params: build,
    });
    const section = text.slice(text.indexOf('## 12. Parameter table'));
    expect(section).toContain('## 12. Parameter table');
    expect(section).toContain('holds 7 parameter ids');
    expect(section).toContain('(3 ids)');
    expect(section).toContain('### Omitted optional ids');
    for (const id of OMITTED_OPTIONAL_IDS) expect(section).toContain(id);
    expect(section).toContain('not research results');
    const gap = section.slice(section.indexOf('### Gap parameters'));
    expect(gap).toContain(SHARE_BOTH_ID);
    expect(gap).toContain(COST_SCHEDULE_ID);
    expect(gap).not.toContain('ghost.shareRent');
  });
});
