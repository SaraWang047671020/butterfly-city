// Example tests for the commuter pass rule (task 4.4; Requirements 17.8, 5.3, 5.4, 5.10).
// Pass price 1,280 from 2023Q1 (fixture). Expected values are hand-computed literals.

import { describe, expect, it } from 'vitest';
import { commuterPassRule } from '../../../src/simulation/rules/commuter-pass.ts';
import type { RuleContext, ToolSetting } from '../../../src/types/simulation.ts';
import {
  buildBaseline,
  buildCommuteMatrix,
  buildParams,
  buildRealTrack,
  scalar,
} from '../fixtures/index.ts';

const TAIPEI_DISTRICT = '63000010';
const NEW_TAIPEI_DISTRICT = '65000010';

function context(realSubsidy = 0): RuleContext {
  return {
    params: buildParams({ overrides: { 'commuterPass.lag': scalar(0, { unit: 'quarters' }) } }),
    baseline: buildBaseline({ mrtEntries: () => 1_000_000 }),
    realTrack: buildRealTrack({ subsidy: realSubsidy }),
    commute: buildCommuteMatrix(),
  };
}

function setting(subsidy: number, passesSold = 100_000): ToolSetting {
  return {
    subsidy: { Taipei: subsidy, 'New Taipei': subsidy },
    passesSold: { Taipei: passesSold, 'New Taipei': passesSold },
  };
}

describe('commuter pass rule', () => {
  it('raises MRT entries by 18,750 for a subsidy of 80 against a real subsidy of 0', () => {
    const ctx = context();
    // 1,000,000 x -0.3 x (-80 / 1,280) = 18,750
    const out = commuterPassRule.effects({ Taipei: 80, 'New Taipei': 0 }, '2023Q1', ctx);
    expect(out.deltas['mrtEntries']?.[TAIPEI_DISTRICT]).toBeCloseTo(18_750, 6);
    expect(out.deltas['mrtEntries']?.[NEW_TAIPEI_DISTRICT]).toBeCloseTo(0, 9);
    expect(out.commuteCostDelta?.[TAIPEI_DISTRICT]).toBe(80);
    expect(out.commuteCostDelta?.[NEW_TAIPEI_DISTRICT]).toBe(0);
  });

  it('charges the adjusted pass count: 80 x 101,875 x 3 per city', () => {
    const ctx = context();
    // rho = -0.0625, adjusted passes = 100,000 x (1 + -0.3 x -0.0625) = 101,875
    const c = commuterPassRule.charge(setting(80), ctx.realTrack[32]?.tools['commuterPass'] ?? {}, '2023Q1', ctx);
    expect(c.real).toBe(0);
    expect(c.difference).toBe(2 * 80 * 101_875 * 3);
  });

  it('is inactive before the pass has a price', () => {
    const ctx = context();
    const real = ctx.realTrack[31]?.tools['commuterPass'] ?? {};
    expect(commuterPassRule.checkSetting(setting(0), real, '2022Q4', ctx)).toBeNull();
    expect(commuterPassRule.checkSetting(setting(80), real, '2022Q4', ctx)).not.toBeNull();
    expect(commuterPassRule.difference(setting(0), real, '2022Q4', ctx)).toEqual({
      Taipei: 0,
      'New Taipei': 0,
    });
    expect(commuterPassRule.charge(setting(0), real, '2022Q4', ctx)).toEqual({ real: 0, difference: 0 });
  });

  it('reports real-net-price-zero when the real subsidy equals the price', () => {
    const ctx = context(1280);
    const real = ctx.realTrack[32]?.tools['commuterPass'] ?? {};
    const error = commuterPassRule.checkSetting(setting(0), real, '2023Q1', ctx);
    expect(error?.code).toBe('real-net-price-zero');
  });

  it('accepts a subsidy up to the price and rejects one above it', () => {
    const ctx = context();
    const real = ctx.realTrack[32]?.tools['commuterPass'] ?? {};
    expect(commuterPassRule.checkSetting(setting(1280), real, '2023Q1', ctx)).toBeNull();
    expect(commuterPassRule.checkSetting(setting(1281), real, '2023Q1', ctx)).not.toBeNull();
  });
});
