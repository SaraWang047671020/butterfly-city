import fc from 'fast-check';
import { describe, expect as vitestExpect, it } from 'vitest';
import { CAUSE_TOLERANCE } from '../../../src/simulation/constants.ts';
import { run } from '../../../src/simulation/engine.ts';
import { RULE_REGISTRY } from '../../../src/simulation/registry.ts';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { Cause, SimState } from '../../../src/types/simulation.ts';
import { arbEngineInputs } from '../arbitraries.ts';
import type { EngineInputs } from '../arbitraries.ts';

const GHOST_INDICATOR = 'ghostCount';
const GHOST_GROUPS = [
  'ghost-rent-housed',
  'ghost-rent-spillover',
  'ghost-rent-subsidy',
  'ghost-commute',
  'ghost-overlap',
  'ghost-displaced',
];

/**
 * Minimal matcher with the same call shape as vitest's `expect` for the matchers used below. Thousands of
 * assertions run per generated input, and vitest's own `expect` is too slow for that.
 */
function expect(actual: unknown, message = '') {
  const fail = (what: string): never => {
    throw new Error(`${message} expected ${String(actual)} ${what}`);
  };
  return {
    toBe(expected: unknown): void {
      if (!Object.is(actual, expected)) fail(`to be ${String(expected)}`);
    },
    toEqual(expected: unknown): void {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) vitestExpect(actual, message).toEqual(expected);
    },
    toBeDefined(): void {
      if (actual === undefined) fail('to be defined');
    },
    toHaveLength(n: number): void {
      if ((actual as { length: number }).length !== n) fail(`to have length ${n}`);
    },
    toBeGreaterThan(n: number): void {
      if (!((actual as number) > n)) fail(`to be > ${n}`);
    },
    toBeGreaterThanOrEqual(n: number): void {
      if (!((actual as number) >= n)) fail(`to be >= ${n}`);
    },
    toBeLessThanOrEqual(n: number): void {
      if (!((actual as number) <= n)) fail(`to be <= ${n}`);
    },
  };
}

/** Checks every Cause_Breakdown of one state; returns the number of breakdowns checked. */
function checkState(state: SimState, inputs: EngineInputs): number {
  const toolIds = RULE_REGISTRY.tools.map((t) => t.id);
  const eventIds = inputs.events.map((e) => e.id);
  const districts = inputs.baseline.districts.map((d) => d.code);
  const quarter = state.quarter as QuarterKey;
  let checked = 0;

  for (const ind of state.indicators) {
    for (const code of districts) {
      const bd = state.causes[ind.id]?.[code];
      expect(bd, `${ind.id} ${code} ${quarter}`).toBeDefined();
      if (bd === undefined) continue;
      checked += 1;
      const where = `${ind.id} ${code} ${quarter}`;
      const value = state.values[ind.id]?.[code] as number;
      expect(bd.value, where).toBe(value);
      expect(bd.indicator).toBe(ind.id);
      expect(bd.district).toBe(code);
      expect(bd.quarter).toBe(quarter);

      const causes: readonly Cause[] = bd.causes;
      // Structure (13.2, 10.6).
      const kinds = causes.map((c) => c.kind);
      expect(kinds[0], where).toBe('baseline');
      expect(kinds.filter((k) => k === 'baseline')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'bound'), where).toHaveLength(1);
      expect(kinds[kinds.length - 1], where).toBe('bound');
      if (ind.id === GHOST_INDICATOR) {
        expect(causes.slice(1, -1).map((c) => c.id), where).toEqual(GHOST_GROUPS);
        expect(causes.slice(1, -1).every((c) => c.kind === 'ghost-group')).toBe(true);
      } else {
        const middle = causes.slice(1, -1);
        const tools = middle.filter((c) => c.kind === 'tool');
        expect(tools.map((c) => c.id), where).toEqual(toolIds);
        const events = middle.filter((c) => c.kind === 'event');
        // Event Causes are unique and follow event-list order.
        const positions = events.map((c) => eventIds.indexOf(c.id));
        expect(positions.every((p) => p >= 0), where).toBe(true);
        expect(positions, where).toEqual([...new Set(positions)].sort((a, b) => a - b));
        expect(middle.filter((c) => c.kind === 'migration'), where).toHaveLength(1);
        expect(middle.length, where).toBe(tools.length + events.length + 1);
        const order = middle.map((c) => c.kind);
        expect(order, where).toEqual([...order].sort((a, b) => rank(a) - rank(b)));
      }

      // Finite contributions (13.9) and sums (13.3, 13.5).
      let total = 0;
      let rest = 0;
      for (const c of causes) {
        expect(Number.isFinite(c.contribution), where).toBe(true);
        total += c.contribution;
        if (c.kind !== 'baseline') rest += c.contribution;
      }
      const baseline = causes[0]?.contribution as number;
      const tol = CAUSE_TOLERANCE * Math.max(1, Math.abs(value));
      expect(Math.abs(total - value), where).toBeLessThanOrEqual(tol);
      expect(Math.abs(rest - (value - baseline)), where).toBeLessThanOrEqual(tol);

      // Bound_Adjustment sign (13.6).
      const bound = causes[causes.length - 1]?.contribution as number;
      if (ind.kind === 'bounded') {
        expect(value >= 0 && value <= 100, where).toBe(true);
        if (bound < 0) expect(value, where).toBe(100);
        if (bound > 0) expect(value, where).toBe(0);
      } else if (ind.kind === 'non-negative') {
        expect(value, where).toBeGreaterThanOrEqual(0);
        if (bound > 0) expect(value, where).toBe(0);
      } else {
        expect(Number.isInteger(value), where).toBe(true);
        expect(value, where).toBeGreaterThanOrEqual(0);
        // Other counts round to the nearest integer (|bound| <= 0.5); the Ghost count rounds down, so its
        // Bound_Adjustment lies in (-1, 0] plus the floor tolerance (Requirement 12.4, 10.1).
        const limit = ind.id === GHOST_INDICATOR ? 1 : 0.5;
        expect(Math.abs(bound), where).toBeLessThanOrEqual(limit + tol + 1e9 * Number.EPSILON * Math.max(1, Math.abs(value)));
      }

      // Links that are present point at known ids (13.7). Non-empty links and the metadata are asserted by
      // Property 9 (cause-links.property.test.ts).
      for (const c of causes) {
        if (c.kind === 'bound') continue;
        for (const id of c.parameterIds) expect(Object.hasOwn(inputs.params, id), `${where} ${id}`).toBe(true);
        for (const id of c.sourceIds) expect(inputs.baseline.sourceIds.includes(id), `${where} ${id}`).toBe(true);
      }
    }
  }
  return checked;
}

function rank(kind: string): number {
  return kind === 'tool' ? 0 : kind === 'event' ? 1 : 2;
}

describe('cause breakdown sums', () => {
  // Feature: simulation-engine, Property 8: Cause breakdowns are complete and sum to the value
  // **Validates: Requirements 2.1, 12.3, 12.4, 12.5, 12.7, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.11**
  it('Property 8: breakdowns are complete, ordered and sum to every reported value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'real-style' | 'synthetic'>('real-style', 'synthetic').chain((eventMode) =>
          arbEngineInputs({ eventMode }),
        ),
        (inputs) => {
          const result = run(
            inputs.policies,
            inputs.events,
            inputs.params,
            inputs.baseline,
            inputs.realTrack,
            inputs.commute,
            inputs.target as QuarterKey,
          );
          // Some valid-looking inputs are rejected (budget, stock); only accepted runs are checked.
          fc.pre(result.ok);
          if (!result.ok) return;
          expect(result.states.length).toBeGreaterThan(0);
          for (const state of result.states) {
            expect(checkState(state, inputs)).toBe(state.indicators.length * inputs.baseline.districts.length);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
