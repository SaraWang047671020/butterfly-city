// Stub-tool extensibility test (task 13.2, Requirements 16.3 and 16.4).
// A fourth Policy_Tool rule with one city field and one effect parameter is added through
// `options.registry`, without any change to engine.ts, lag.ts, budget.ts, migration.ts or explain.ts.

import { describe, expect, it } from 'vitest';
import { run } from '../../src/simulation/engine.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import { quarterIndex } from '../../src/simulation/quarter.ts';
import type {
  AreaKey,
  CauseLinks,
  ParameterSpec,
  PolicyTimeline,
  RuleRegistry,
  ToolRule,
  ToolSetting,
} from '../../src/types/simulation.ts';
import {
  buildBaseline,
  buildCommuteMatrix,
  buildParams,
  buildRealTrack,
  scalar,
} from './fixtures/index.ts';

const CITY_KEYS: readonly string[] = ['Taipei', 'New Taipei'];
const LAG_ID = 'stubTool.lag';
const EFFECT_ID = 'stubTool.rentPerUnit';
const LAG = 2;
const RENT_PER_UNIT = 0.5;
const REAL_LEVEL = 10;
const PLAYER_LEVEL = 15;
const START_INDEX = 20; // 2020Q1

function level(setting: ToolSetting, area: AreaKey): number {
  return setting['level']?.[area] ?? 0;
}

const stubRule: ToolRule = {
  id: 'stubTool',
  level: 'city',
  effect: 'flow',
  fields: [{ id: 'level', area: 'city', limitScope: 'quarter' }],
  trackOnlyFields: [],
  lagParameterId: LAG_ID,
  modifiable: ['rent'],
  parameters(): readonly ParameterSpec[] {
    return [
      { id: LAG_ID, role: 'lag', check: { kind: 'integer', min: 0, max: 40 } },
      { id: EFFECT_ID, role: 'effect', check: { kind: 'finite' } },
    ];
  },
  checkSetting() {
    return null;
  },
  difference(player, real) {
    const out: Record<AreaKey, number> = {};
    for (const city of CITY_KEYS) out[city] = level(player, city) - level(real, city);
    return out;
  },
  charge() {
    return { real: 0, difference: 0 };
  },
  effects(active, _t, ctx) {
    const rent: Record<string, number> = {};
    for (const d of ctx.baseline.districts) {
      const delta = Object.hasOwn(active, d.city) ? (active[d.city] ?? 0) : 0;
      rent[d.code] = delta * (ctx.params[EFFECT_ID]?.kind === 'scalar' ? ctx.params[EFFECT_ID].value : 0);
    }
    const links: CauseLinks = { parameterIds: [EFFECT_ID, LAG_ID], sourceIds: [] };
    return { deltas: { rent }, links: { rent: links } };
  },
};

const registry: RuleRegistry = {
  tools: [...RULE_REGISTRY.tools, stubRule],
  indicators: RULE_REGISTRY.indicators,
};

const baseline = buildBaseline({ quarters: 44 });
const commute = buildCommuteMatrix();
const params = buildParams({
  overrides: {
    [LAG_ID]: scalar(LAG, { unit: 'quarters' }),
    [EFFECT_ID]: scalar(RENT_PER_UNIT, { unit: 'TWD per m2 per month per unit' }),
    'limit.stubTool.level.lowerFactor': scalar(0, { unit: 'factor' }),
    'limit.stubTool.level.upperFactor': scalar(2, { unit: 'factor' }),
  },
});

function withStub(track: PolicyTimeline, levelAt: (q: number) => number): PolicyTimeline {
  return track.map((setting) => {
    const value = levelAt(quarterIndex(setting.quarter));
    return {
      quarter: setting.quarter,
      tools: {
        ...setting.tools,
        stubTool: { level: { Taipei: value, 'New Taipei': value } },
      },
    };
  });
}

const realTrack = withStub(buildRealTrack({ quarters: 44 }), () => REAL_LEVEL);

describe('stub tool added through options.registry', () => {
  it('keeps the zero-delta identity with the stub registered', () => {
    const withStubRun = run(realTrack, [], params, baseline, realTrack, commute, '2025Q4', { registry });
    expect(withStubRun.ok).toBe(true);
    if (!withStubRun.ok) return;
    expect(withStubRun.states).toHaveLength(44);
    const plain = run(
      buildRealTrack({ quarters: 44 }),
      [],
      params,
      baseline,
      buildRealTrack({ quarters: 44 }),
      commute,
      '2025Q4',
    );
    if (!plain.ok) throw new Error('baseline run failed');

    withStubRun.states.forEach((s, q) => {
      for (const [id, byDistrict] of Object.entries(plain.states[q]?.values ?? {})) {
        for (const [code, value] of Object.entries(byDistrict)) {
          expect(s.values[id]?.[code] === value).toBe(true);
        }
      }
      for (const breakdown of Object.values(s.causes['rent'] ?? {})) {
        const stub = breakdown.causes.find((c) => c.id === 'stubTool');
        expect(stub?.kind).toBe('tool');
        expect(stub?.contribution === 0).toBe(true);
      }
    });
  });

  it('shows the stub Policy_Delta as a Cause of rent with the expected value', () => {
    const player = withStub(
      buildRealTrack({ quarters: 44 }),
      (q) => (q >= START_INDEX ? PLAYER_LEVEL : REAL_LEVEL),
    );
    const result = run(player, [], params, baseline, realTrack, commute, '2025Q4', { registry });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expected = (PLAYER_LEVEL - REAL_LEVEL) * RENT_PER_UNIT;
    result.states.forEach((s, q) => {
      for (const d of baseline.districts) {
        const breakdown = s.causes['rent']?.[d.code];
        expect(breakdown).toBeDefined();
        if (breakdown === undefined) continue;
        const ids = breakdown.causes.filter((c) => c.kind === 'tool').map((c) => c.id);
        expect(ids).toEqual(['socialHousing', 'commuterPass', 'rentSubsidy', 'stubTool']);

        const stub = breakdown.causes.find((c) => c.id === 'stubTool');
        const want = q >= START_INDEX + LAG ? expected : 0;
        expect(stub?.contribution).toBeCloseTo(want, 9);
        if (q >= START_INDEX + LAG) {
          expect(stub?.parameterIds).toEqual([LAG_ID, EFFECT_ID]);
          expect(stub?.parameters.map((p) => p.parameterId)).toEqual([LAG_ID, EFFECT_ID]);
        }

        // The Causes still sum to the reported value.
        const sum = breakdown.causes.reduce((acc, c) => acc + c.contribution, 0);
        expect(sum).toBeCloseTo(breakdown.value, 6);
        const baseRent = baseline.indicators['rent']?.[d.code]?.[q] ?? Number.NaN;
        expect(s.values['rent']?.[d.code]).toBeCloseTo(baseRent + want + otherToolRent(breakdown), 6);
      }
    });
  });

  it('applies the stub through the Lag_Pipeline', () => {
    const player = withStub(
      buildRealTrack({ quarters: 44 }),
      (q) => (q >= START_INDEX ? PLAYER_LEVEL : REAL_LEVEL),
    );
    const result = run(player, [], params, baseline, realTrack, commute, '2020Q2', { registry });
    if (!result.ok) throw new Error('run failed');
    const pending = result.states[START_INDEX + 1]?.lagPipeline.filter((e) => e.tool === 'stubTool') ?? [];
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((e) => e.value === PLAYER_LEVEL - REAL_LEVEL)).toBe(true);
  });
});

/** Sum of the other tools' rent Causes, so the rent value check isolates the stub. */
function otherToolRent(breakdown: { readonly causes: readonly { readonly kind: string; readonly id: string; readonly contribution: number }[] }): number {
  return breakdown.causes
    .filter((c) => c.kind === 'tool' && c.id !== 'stubTool')
    .reduce((acc, c) => acc + c.contribution, 0);
}
