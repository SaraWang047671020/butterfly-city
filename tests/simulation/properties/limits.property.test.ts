import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { EngineError, ParameterTable, PolicyTimeline, RuleContext } from '../../../src/types/simulation.ts';
import { checkLimit, emptyLedger, planBudget } from '../../../src/simulation/budget.ts';
import { run } from '../../../src/simulation/engine.ts';
import { quarterAt } from '../../../src/simulation/quarter.ts';
import { RULE_REGISTRY } from '../../../src/simulation/registry.ts';
import { arbEngineInputs } from '../arbitraries.ts';
import type { EngineInputs } from '../arbitraries.ts';
import { CITIES, cityOf, districtsOf, scalar } from '../fixtures/index.ts';
import type { ParameterEntry } from '../fixtures/index.ts';

// Feature: simulation-engine, Property 5: Tool limits and ceilings
// **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.7, 18.9**

type City = (typeof CITIES)[number];

interface FieldSpec {
  readonly tool: string;
  readonly field: string;
  readonly scope: 'quarter' | 'city-year';
  readonly integer: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  { tool: 'socialHousing', field: 'unitsStarted', scope: 'city-year', integer: true },
  { tool: 'commuterPass', field: 'subsidy', scope: 'quarter', integer: true },
  { tool: 'rentSubsidy', field: 'households', scope: 'quarter', integer: true },
  { tool: 'rentSubsidy', field: 'amount', scope: 'quarter', integer: false },
];

const unit = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

// ---------------------------------------------------------------------------
// Reference formulas, written independently of `budget.ts`
// ---------------------------------------------------------------------------

function val(params: ParameterTable, id: string): number | undefined {
  const e = params[id];
  return e !== undefined && e.kind === 'scalar' ? e.value : undefined;
}

function realAt(track: PolicyTimeline, q: number, f: FieldSpec, area: string): number {
  return track[q]?.tools[f.tool]?.[f.field]?.[area] ?? 0;
}

/** Real city-year total of a district-level field over the quarters present in the track. */
function realYearSum(track: PolicyTimeline, f: FieldSpec, city: City, yearIndex: number): number {
  let sum = 0;
  for (let q = yearIndex * 4; q < Math.min(track.length, yearIndex * 4 + 4); q++) {
    for (const code of districtsOf(city)) sum += realAt(track, q, f, code);
  }
  return sum;
}

interface RefLimit {
  readonly lower: number;
  readonly upper: number;
  readonly lowerId: string;
  readonly upperId: string;
}

function refLimits(params: ParameterTable, track: PolicyTimeline, f: FieldSpec, area: string, q: number): RefLimit {
  const base = `limit.${f.tool}.${f.field}`;
  const v = f.scope === 'quarter' ? realAt(track, q, f, area) : realYearSum(track, f, area as City, Math.floor(q / 4));
  const min = val(params, `${base}.min`);
  const lowerId = min !== undefined ? `${base}.min` : `${base}.lowerFactor`;
  const lower = min ?? (val(params, `${base}.lowerFactor`) ?? Number.NaN) * v;
  if (f.tool === 'commuterPass') {
    const upperId = `commuterPass.price.${area}.${quarterAt(q)}`;
    return { lower, upper: val(params, upperId) ?? 0, lowerId, upperId };
  }
  const max = val(params, `${base}.max`);
  if (max !== undefined) return { lower, upper: max, lowerId, upperId: `${base}.max` };
  const upperId = `${base}.upperFactor`;
  const upper = Math.max((val(params, upperId) ?? Number.NaN) * v, val(params, `${base}.upperMin`) ?? 0);
  return { lower, upper, lowerId, upperId };
}

// ---------------------------------------------------------------------------
// Limit and ceiling variants applied to generated parameter tables
// ---------------------------------------------------------------------------

const arbSeed = fc.record({
  fields: fc.array(
    fc.record({
      lower: fc.constantFrom(0, 0, 0, 0, 0.5, 1),
      upper: fc.constantFrom(1, 1.5, 2, 3),
      upperMin: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
      absMin: fc.option(unit, { nil: undefined }),
      absMax: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
    }),
    { minLength: 4, maxLength: 4 },
  ),
  ceilTool: fc.integer({ min: 0, max: 2 }),
  ceilYear: fc.integer({ min: 0, max: 3 }),
  ceilExtra: fc.option(fc.integer({ min: 0, max: 5_000_000 }), { nil: undefined }),
});

function realValues(track: PolicyTimeline, f: FieldSpec): number[] {
  const out: number[] = [];
  const years = Math.ceil(track.length / 4);
  for (const city of CITIES) {
    if (f.scope === 'city-year') {
      for (let y = 0; y < years; y++) out.push(realYearSum(track, f, city, y));
    } else {
      for (let q = 0; q < track.length; q++) out.push(realAt(track, q, f, city));
    }
  }
  return out;
}

function applyVariant(
  inputs: EngineInputs,
  seed: {
    readonly fields: readonly {
      readonly lower: number;
      readonly upper: number;
      readonly upperMin: number | undefined;
      readonly absMin: number | undefined;
      readonly absMax: number | undefined;
    }[];
    readonly ceilTool: number;
    readonly ceilYear: number;
    readonly ceilExtra: number | undefined;
  },
): ParameterTable {
  const params: Record<string, ParameterEntry> = { ...inputs.params } as Record<string, ParameterEntry>;
  FIELDS.forEach((f, i) => {
    const s = seed.fields[i];
    if (s === undefined) return;
    const base = `limit.${f.tool}.${f.field}`;
    params[`${base}.lowerFactor`] = scalar(s.lower, { unit: 'factor' });
    if (f.tool === 'commuterPass') return;
    params[`${base}.upperFactor`] = scalar(s.upper, { unit: 'factor' });
    if (s.upperMin !== undefined) params[`${base}.upperMin`] = scalar(s.upperMin, { unit: 'count' });
    const real = realValues(inputs.realTrack, f);
    if (s.absMin !== undefined) params[`${base}.min`] = scalar(Math.floor(Math.min(...real) * s.absMin), { unit: 'count' });
    if (s.absMax !== undefined) params[`${base}.max`] = scalar(Math.ceil(Math.max(...real)) + s.absMax, { unit: 'count' });
  });
  if (seed.ceilExtra !== undefined) {
    const tools = RULE_REGISTRY.tools;
    const tool = tools[seed.ceilTool % tools.length];
    if (tool !== undefined) {
      const plan = planBudget(inputs.realTrack, params as ParameterTable, tools);
      let spend = 0;
      for (const slots of plan.realCharges[tool.id] ?? []) {
        for (let s = seed.ceilYear * 4; s < seed.ceilYear * 4 + 4; s++) spend += slots[s] ?? 0;
      }
      params[`budget.ceiling.${tool.id}.${2015 + seed.ceilYear}`] = scalar(spend + seed.ceilExtra, { unit: 'TWD' });
    }
  }
  return params as ParameterTable;
}

function contextOf(inputs: EngineInputs, params: ParameterTable): RuleContext {
  return { params, baseline: inputs.baseline, realTrack: inputs.realTrack, commute: inputs.commute };
}

const arbInputs = arbEngineInputs();

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Property 5: Tool limits and ceilings', () => {
  it('checkLimit matches the reference formula for factors, upperMin, absolute min and max, pass price and city-year totals', () => {
    fc.assert(
      fc.property(arbEngineInputs({ playerMode: 'equal-to-real' }), arbSeed, (inputs, seed) => {
        const params = applyVariant(inputs, seed);
        const tools = RULE_REGISTRY.tools;
        const ledger = emptyLedger(planBudget(inputs.realTrack, params, tools));
        const ctx = contextOf(inputs, params);
        const n = inputs.realTrack.length;
        for (const f of FIELDS) {
          const areas: string[] = f.scope === 'city-year' ? [...CITIES, ...CITIES.map((c) => districtsOf(c)[0] ?? '')] : [...CITIES];
          for (let q = 0; q < n; q++) {
            for (const area of areas) {
              const info = checkLimit(f.tool, f.field, area, quarterAt(q), ledger, params, tools, ctx);
              const refArea = f.scope === 'city-year' ? (cityOf(area) ?? area) : area;
              const ref = refLimits(params, inputs.realTrack, f, f.scope === 'city-year' && !CITIES.includes(area as City) ? refArea : area, q);
              expect(info.lower).toBe(ref.lower);
              expect(info.upper).toBe(ref.upper);
              expect(info.lowerParameterId).toBe(ref.lowerId);
              expect(info.upperParameterId).toBe(ref.upperId);
              expect(info.lowerSource).toEqual(params[ref.lowerId]?.source ?? null);
              expect(info.upperSource).toEqual(params[ref.upperId]?.source ?? null);
              expect(info.scope).toBe(f.scope);
              const ceilingParam = val(params, `budget.ceiling.${f.tool}.${2015 + Math.floor(q / 4)}`);
              const expectedCeiling = ceilingParam ?? ledger.plan.annualBudget[Math.floor(q / 4)] ?? 0;
              expect(info.ceiling).toBe(expectedCeiling);
              expect(info.remainingCeiling).toBe(expectedCeiling);
            }
          }
        }
      }),
      { numRuns: 100, endOnFailure: true },
    );
  }, 120_000);

  it('run is rejected with a limit, budget or ceiling error, or every accepted value, tool-year and year stays within its limit', () => {
    let accepted = 0;
    let cases = 0;
    const allowed = new Set(['limit-exceeded', 'budget-exceeded', 'ceiling-exceeded', 'households-exceed-renters', 'stock-negative']);
    fc.assert(
      fc.property(arbInputs, arbSeed, (base, seed) => {
        cases++;
        const params = applyVariant(base, seed);
        const target = base.target as QuarterKey;
        const result = run(base.policies, base.events, params, base.baseline, base.realTrack, base.commute, target);
        if (!result.ok) {
          const e: EngineError = result.error;
          expect(allowed.has(e.code), `${e.code}: ${e.message}`).toBe(true);
          if (e.code === 'limit-exceeded') {
            const { tool, field, area, period, value, side, limit, parameterId } = e.details;
            const f = FIELDS.find((x) => x.tool === tool && x.field === field);
            expect(f).toBeDefined();
            if (f === undefined) return;
            const q = f.scope === 'quarter' ? base.realTrack.findIndex((s) => s.quarter === period) : (Number(period) - 2015) * 4;
            const ref = refLimits(params, base.realTrack, f, String(area), q);
            if (side === 'upper') {
              expect(Number(value)).toBeGreaterThan(Number(limit));
              expect(limit).toBe(ref.upper);
              expect(parameterId).toBe(ref.upperId);
            } else {
              expect(Number(value)).toBeLessThan(Number(limit));
              expect(limit).toBe(ref.lower);
              expect(parameterId).toBe(ref.lowerId);
            }
          } else if (e.code === 'ceiling-exceeded' || e.code === 'budget-exceeded') {
            expect(Number(e.details['over'])).toBeGreaterThanOrEqual(1);
            expect(Number(e.details['committed'])).toBeGreaterThan(Number(e.details['ceiling'] ?? e.details['annualBudget']));
          }
          return;
        }
        accepted++;
        const n = base.realTrack.length;
        result.states.forEach((state, i) => {
          // Every player value lies within the reference limits.
          for (const f of FIELDS) {
            if (f.scope === 'quarter') {
              for (const city of CITIES) {
                const v = base.policies[i]?.tools[f.tool]?.[f.field]?.[city] ?? 0;
                const ref = refLimits(params, base.realTrack, f, city, i);
                expect(v).toBeLessThanOrEqual(ref.upper);
                expect(v).toBeGreaterThanOrEqual(ref.lower);
              }
            } else {
              const yearIndex = Math.floor(i / 4);
              for (const city of CITIES) {
                let total = 0;
                for (let q = yearIndex * 4; q <= i; q++) {
                  for (const code of districtsOf(city)) total += base.policies[q]?.tools[f.tool]?.[f.field]?.[code] ?? 0;
                }
                const ref = refLimits(params, base.realTrack, f, city, i);
                expect(total).toBeLessThanOrEqual(ref.upper);
                if (state.quarter.endsWith('Q4')) expect(total).toBeGreaterThanOrEqual(ref.lower);
              }
            }
          }
          // Ceilings and the annual budget.
          const plan = state.ledger.plan;
          for (let y = 0; y < 11; y++) {
            let total = 0;
            for (const tool of RULE_REGISTRY.tools) {
              let spent = 0;
              for (let s = y * 4; s < y * 4 + 4; s++) spent += state.ledger.committed[tool.id]?.[s] ?? 0;
              total += spent;
              const ceiling = val(params, `budget.ceiling.${tool.id}.${2015 + y}`) ?? plan.annualBudget[y] ?? 0;
              expect(plan.ceilings[tool.id]?.[y]).toBe(ceiling);
              expect(spent).toBeLessThanOrEqual(ceiling);
            }
            expect(total).toBeLessThanOrEqual(plan.annualBudget[y] ?? 0);
          }
        });
        expect(result.states.length).toBe(n);
      }),
      { numRuns: 100, endOnFailure: true },
    );
    expect(cases).toBeGreaterThanOrEqual(100);
    expect(accepted).toBeGreaterThanOrEqual(20);
  }, 120_000);

  it('a value one step outside a limit is rejected with the limit named, never clipped; a value on the limit is not a limit error', () => {
    const arbPick = fc.record({
      kind: fc.integer({ min: 0, max: 3 }),
      side: fc.constantFrom('upper' as const, 'lower' as const),
      over: fc.constantFrom(0, 1),
      qf: unit,
      af: unit,
      lowerFactor: fc.constantFrom(0.5, 1),
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 6 }).chain((n) => arbEngineInputs({ quarters: n, playerMode: 'equal-to-real' })),
        arbSeed,
        arbPick,
        (base, seed, pick) => {
          const f = FIELDS[pick.kind] as FieldSpec;
          const track = base.realTrack;
          const n = track.length;
          const params: Record<string, ParameterEntry> = { ...applyVariant(base, seed) } as Record<string, ParameterEntry>;
          const fbase = `limit.${f.tool}.${f.field}`;
          if (pick.side === 'lower') {
            params[`${fbase}.lowerFactor`] = scalar(pick.lowerFactor, { unit: 'factor' });
            delete params[`${fbase}.min`];
          }
          const table = params as ParameterTable;
          const policies = structuredClone(base.policies) as unknown as {
            quarter: QuarterKey;
            tools: Record<string, Record<string, Record<string, number>>>;
          }[];
          const set = (q: number, area: string, v: number): void => {
            const target = policies[q]?.tools[f.tool]?.[f.field];
            if (target !== undefined) target[area] = v;
          };
          const at = (q: number, area: string): number => policies[q]?.tools[f.tool]?.[f.field]?.[area] ?? 0;

          let expectedArea: string;
          let expectedPeriod: string;
          let expectedValue: number;
          let ref: RefLimit;
          let expectedSide: 'upper' | 'lower';

          if (f.scope === 'quarter') {
            const q = Math.min(n - 1, Math.floor(pick.qf * n));
            const city = CITIES[Math.min(1, Math.floor(pick.af * 2))] as City;
            ref = refLimits(table, track, f, city, q);
            expectedArea = city;
            expectedPeriod = quarterAt(q);
            expectedSide = pick.side;
            if (pick.side === 'upper') {
              if (f.tool === 'commuterPass') fc.pre(ref.upper > 0);
              expectedValue = (f.integer ? Math.floor(ref.upper) : ref.upper) + pick.over;
            } else {
              fc.pre(ref.lower > 0);
              expectedValue = f.integer
                ? Math.ceil(ref.lower) - pick.over
                : pick.over === 1
                  ? ref.lower > 1
                    ? ref.lower - 1
                    : ref.lower / 2
                  : ref.lower;
            }
            set(q, city, expectedValue);
          } else {
            const city = CITIES[Math.min(1, Math.floor(pick.af * 2))] as City;
            const codes = districtsOf(city);
            expectedArea = city;
            expectedSide = pick.side;
            if (pick.side === 'upper') {
              const years = Math.ceil(n / 4);
              const y = Math.min(years - 1, Math.floor(pick.qf * years));
              const q = Math.min(y * 4 + 3, n - 1);
              ref = refLimits(table, track, f, city, q);
              let running = 0;
              for (let k = y * 4; k <= q; k++) for (const c of codes) running += at(k, c);
              const d = codes[Math.min(codes.length - 1, Math.floor(pick.af * codes.length))] as string;
              expectedValue = Math.floor(ref.upper) + pick.over;
              set(q, d, at(q, d) + expectedValue - running);
              expectedPeriod = String(2015 + y);
            } else {
              ref = refLimits(table, track, f, city, 3);
              fc.pre(ref.lower > 0);
              for (let k = 0; k < 4; k++) for (const c of codes) set(k, c, 0);
              expectedValue = pick.over === 1 ? 0 : Math.ceil(ref.lower);
              set(3, codes[0] as string, expectedValue);
              expectedPeriod = '2015';
            }
          }

          const result = run(policies, base.events, table, base.baseline, track, base.commute, base.target as QuarterKey);
          const outside = pick.side === 'upper' ? pick.over === 1 : pick.over === 1;
          if (outside) {
            expect(result.ok).toBe(false);
            if (result.ok) return;
            if (f.tool === 'commuterPass' && expectedSide === 'upper') {
              // The pass price is also the Requirement 5.2 bound, which stage 0 checks before the Policy_Limits.
              expect(result.error.code, result.error.message).toBe('policy-value-invalid');
              return;
            }
            expect(result.error.code, result.error.message).toBe('limit-exceeded');
            expect(result.error.details).toMatchObject({
              tool: f.tool,
              field: f.field,
              area: expectedArea,
              period: expectedPeriod,
              side: expectedSide,
              limit: expectedSide === 'upper' ? ref.upper : ref.lower,
              parameterId: expectedSide === 'upper' ? ref.upperId : ref.lowerId,
            });
            expect(result.error.details['value']).toBeCloseTo(expectedValue, 6);
          } else if (!result.ok) {
            expect(result.error.code, result.error.message).not.toBe('limit-exceeded');
          }
        },
      ),
      { numRuns: 60, endOnFailure: true },
    );
  }, 120_000);
});
