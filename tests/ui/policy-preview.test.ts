// Policy_Cards and Policy_Dialog helpers (play-loop Requirements 5 and 11.4): the Quick_Preview cost is the
// difference of the two checkBudget results of the view model, the slider value follows the draft inside the limits,
// and the card status counts only real differences.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ConstructionRowView, FieldView } from '../../src/types/view.ts';
import { addQuarters, cardStatus, quickPreview, sliderValue } from '../../src/ui/policy/preview.ts';

const ref = { parameterId: 'p', value: 8, unit: 'quarters', citation: null, url: null, status: 'verified' as const, estimatedMethod: null, assumption: null };

function field(over: Partial<FieldView> = {}): FieldView {
  return {
    key: 'socialHousing|unitsStarted|63000020',
    tool: 'socialHousing',
    field: 'unitsStarted',
    area: '63000020',
    countField: true,
    editable: 'yes',
    real: { value: 200, estimated: false },
    player: 200,
    unit: 'units per quarter',
    unitCost: null,
    lag: ref,
    limits: { lower: 0, upper: 400, scope: 'city-year', lowerRef: null, upperRef: null },
    cityYearTotal: null,
    remainingCeiling: 0,
    draft: null,
    applyEnabled: false,
    setToRealEnabled: false,
    ...over,
  } as FieldView;
}

describe('addQuarters', () => {
  it('moves across years', () => {
    expect(addQuarters('2016Q3', 8)).toBe('2018Q3');
    expect(addQuarters('2016Q4', 1)).toBe('2017Q1');
    expect(addQuarters('2016Q1', 0)).toBe('2016Q1');
  });
});

describe('quickPreview', () => {
  it('is null without a draft or with a rejected draft', () => {
    expect(quickPreview(field(), null, '2016Q3')).toBeNull();
    const rejected = field({ draft: { text: '999', check: { status: 'budget', problem: { reason: 'annual-budget', year: 2016, budget: 1, over: 1 } } } });
    expect(quickPreview(rejected, null, '2016Q3')).toBeNull();
  });

  it('cost is the committed spending with the edit minus the committed spending without it (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 0, max: 1e9 }), (v, before, after) => {
        const f = field({ draft: { text: String(v), check: { status: 'ok', budget: { year: 2016, annualBudget: 2e9, committed: after, remaining: 2e9 - after } } } });
        const p = quickPreview(f, { year: 2016, annualBudget: 2e9, committed: before, remaining: 2e9 - before }, '2016Q3');
        expect(p?.cost).toBe(after - before);
        expect(p?.change).toBe(v - 200);
        expect(p?.ready).toBe('2018Q3');
      }),
    );
  });

  it('compares with the same quarter without the edit when the controller gives it', () => {
    const f = field({
      draft: {
        text: '201',
        check: {
          status: 'ok',
          budget: { year: 2015, annualBudget: 9e8, committed: 351_013_661, remaining: 0 },
          budgetBefore: { year: 2015, annualBudget: 9e8, committed: 350_999_564, remaining: 0 },
        },
      },
    });
    // The panel figures (committed so far, 0 before any quarter) must not be used when budgetBefore exists.
    expect(quickPreview(f, { year: 2015, annualBudget: 9e8, committed: 0, remaining: 9e8 }, '2015Q1')?.cost).toBe(14_097);
  });

  it('gives no cost when the budget figures are of another year', () => {
    const f = field({ draft: { text: '300', check: { status: 'ok', budget: { year: 2017, annualBudget: 1, committed: 1, remaining: 0 } } } });
    expect(quickPreview(f, { year: 2016, annualBudget: 1, committed: 0, remaining: 1 }, '2016Q4')?.cost).toBeNull();
  });
});

describe('sliderValue', () => {
  it('follows a numeric draft and stays inside the limits (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (v) => {
        const s = sliderValue(field({ draft: { text: String(v), check: { status: 'invalid-format', expected: 'integer' } } }));
        expect(s).toBe(Math.min(400, Math.max(0, v)));
      }),
    );
  });

  it('uses the player value when the draft is not a number', () => {
    expect(sliderValue(field({ player: 250, draft: { text: 'abc', check: { status: 'invalid-format', expected: 'integer' } } }))).toBe(250);
  });
});

describe('cardStatus', () => {
  const tool = (fields: FieldView[]) => ({ kind: 'active' as const, id: 'rentSubsidy' as const, fields });
  it('says real track when every value equals real', () => {
    expect(cardStatus(tool([field({ tool: 'rentSubsidy' })]), [])).toEqual({ kind: 'real' });
  });
  it('counts fields that differ from real', () => {
    expect(cardStatus(tool([field({ player: 300 }), field({ player: 200 })]), [])).toEqual({ kind: 'changed', n: 1 });
  });
  it('says no pass product when no field can be edited for that reason', () => {
    expect(cardStatus(tool([field({ editable: 'no-pass-product' })]), [])).toEqual({ kind: 'no-pass' });
  });
  it('counts social housing districts from construction and from an applied change', () => {
    const sh = { kind: 'active' as const, id: 'socialHousing' as const, fields: [field({ player: 320 })] };
    const row: ConstructionRowView = { district: '65000030', districtName: 'Zhonghe', committed: '2016Q3', effect: '2018Q3', difference: 120, lag: 8, progress: 1, afterEnd: false };
    expect(cardStatus(sh, [row])).toEqual({ kind: 'sites', n: 2 });
  });
});
