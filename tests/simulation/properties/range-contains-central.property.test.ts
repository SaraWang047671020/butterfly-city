import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import { run, runRange } from '../../../src/simulation/engine.ts';
import { quarterAt } from '../../../src/simulation/quarter.ts';
import { arbEngineInputs, type EngineInputs, type PlayerMode } from '../arbitraries.ts';

const GHOST = 'ghostCount';

function call(inp: EngineInputs) {
  return runRange(inp.policies, inp.events, inp.params, inp.baseline, inp.realTrack, inp.commute, inp.target as QuarterKey);
}

/** Player modes that the budget check accepts in most generated cases (largest-accepted overspends). */
const MOSTLY_ACCEPTED: readonly PlayerMode[] = ['all-zero', 'equal-to-real', 'reallocation', 'helping-direction', 'in-limit'];

const arbInputs = fc
  .constantFrom(...MOSTLY_ACCEPTED)
  .chain((playerMode) => arbEngineInputs({ playerMode, eventMode: 'real-style' }));

describe('Property 24: The Result_Range contains the central result', () => {
  it('has min <= central <= max for every indicator, district and quarter, and central is the central run', () => {
    // **Validates: Requirements 19.1, 19.3, 19.4, 19.6, 19.8**
    fc.assert(
      fc.property(arbInputs, (inp) => {
        const result = call(inp);
        if (!result.ok) {
          // 19.1: a rejection names the Scenario and carries no Sim_States.
          expect(['central', 'low', 'high']).toContain(result.scenario);
          expect('central' in result).toBe(false);
        }
        // Valid-looking inputs can still be rejected (budget, stock); only accepted runs are checked.
        fc.pre(result.ok);
        if (!result.ok) return;
        const n = inp.baseline.quarters.length;
        expect(result.central).toHaveLength(n);
        expect(result.low).toHaveLength(n);
        expect(result.high).toHaveLength(n);
        expect(result.ranges).toHaveLength(n);

        const plain = run(inp.policies, inp.events, inp.params, inp.baseline, inp.realTrack, inp.commute, inp.target as QuarterKey);
        expect(plain.ok).toBe(true);
        if (!plain.ok) return;

        let bad = 0;
        let cells = 0;
        result.ranges.forEach((qr, q) => {
          if (qr.quarter !== quarterAt(q)) bad += 1;
          const central = result.central[q];
          const low = result.low[q];
          const high = result.high[q];
          const plainState = plain.states[q];
          for (const [ind, byDistrict] of Object.entries(qr.ranges)) {
            for (const [code, r] of Object.entries(byDistrict)) {
              cells += 1;
              const c = central?.values[ind]?.[code];
              const l = low?.values[ind]?.[code];
              const h = high?.values[ind]?.[code];
              if (c === undefined || l === undefined || h === undefined) {
                bad += 1;
                continue;
              }
              if (!(r.min <= r.central && r.central <= r.max)) bad += 1;
              if (r.central !== c || r.min !== Math.min(l, c, h) || r.max !== Math.max(l, c, h)) bad += 1;
              if (plainState?.values[ind]?.[code] !== c) bad += 1;
            }
          }
        });
        expect(cells).toBeGreaterThan(0);
        expect(bad).toBe(0);
      }),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);

  it('returns the Cause_Breakdowns of the central Scenario and deep-equal results on repeated calls', () => {
    // **Validates: Requirements 19.4, 19.7**
    fc.assert(
      fc.property(arbInputs, (inp) => {
        const a = call(inp);
        const b = call(inp);
        expect(a).toEqual(b);
        fc.pre(a.ok);
        if (!a.ok) return;
        const last = a.central[a.central.length - 1];
        expect(last).toBeDefined();
        if (last === undefined) return;
        let mismatched = 0;
        for (const [ind, byDistrict] of Object.entries(last.causes)) {
          for (const [code, bd] of Object.entries(byDistrict)) {
            if (bd.value !== a.ranges[a.ranges.length - 1]?.ranges[ind]?.[code]?.central) mismatched += 1;
          }
        }
        expect(mismatched).toBe(0);
      }),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);

  it('zero delta: min === central === max for every indicator except the Ghost count, and central equals the Baseline', () => {
    // **Validates: Requirements 19.5**
    fc.assert(
      fc.property(arbEngineInputs({ playerMode: 'equal-to-real' as PlayerMode, eventMode: 'real-style' }), (inp) => {
        const result = call(inp);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        let bad = 0;
        let ghostCells = 0;
        result.ranges.forEach((qr, q) => {
          for (const [ind, byDistrict] of Object.entries(qr.ranges)) {
            for (const [code, r] of Object.entries(byDistrict)) {
              if (ind === GHOST) {
                ghostCells += 1;
                if (!(r.min <= r.central && r.central <= r.max)) bad += 1;
                continue;
              }
              if (r.min !== r.central || r.central !== r.max) bad += 1;
              const base = inp.baseline.indicators[ind]?.[code]?.[q];
              if (typeof base === 'number' && r.central !== base) bad += 1;
            }
          }
        });
        expect(ghostCells).toBeGreaterThan(0);
        expect(bad).toBe(0);
      }),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);
});

