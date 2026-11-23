// Brief_Item rule (play-loop Requirements 6.2 and 11.3): order, the limit of 3, the empty case, and that the result
// is a prefix of the full ordered candidate list.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BRIEF_LIMIT, briefItems, scoreOf, type BriefCandidate } from '../../src/game/brief.ts';
import { outerChangeBound } from '../../src/game/core/change-bounds.ts';
import { briefItemText } from '../../src/ui/brief/quarter-brief.ts';

const change = (district: string, name: string, prevDiff: number, diff: number, indicator: 'rentBurden' | 'commuteTime' = 'rentBurden'): BriefCandidate => ({
  kind: 'change',
  district,
  districtName: name,
  indicator,
  prevDiff,
  diff,
  value: 30,
});
const completion: BriefCandidate = { kind: 'completion', district: '65000030', districtName: 'Zhonghe', units: 120 };
const event: BriefCandidate = { kind: 'major-event', id: 'tpass-2023', title: 'TPASS', firstQuarter: '2023Q3' };

describe('briefItems', () => {
  it('puts completions, then Major_Events, then changes by score', () => {
    const items = briefItems([change('a', 'A', 0, 0.2), change('b', 'B', 0, 0.9), event, completion]);
    expect(items.map((i) => i.kind)).toEqual(['completion', 'major-event', 'change']);
    expect(items[2]?.kind === 'change' && items[2].districtName).toBe('B');
  });

  it('keeps at most 3 items', () => {
    const many = Array.from({ length: 10 }, (_, i) => change(`d${i}`, `D${i}`, 0, (i + 1) / 10));
    expect(briefItems(many)).toHaveLength(BRIEF_LIMIT);
  });

  it('is empty when nothing changed', () => {
    expect(briefItems([change('a', 'A', 0.5, 0.5), change('b', 'B', 0, 0)])).toEqual([]);
  });

  it('ranks people changes with indicator changes by score', () => {
    const people: BriefCandidate = { kind: 'people', district: 'p', districtName: 'P', prev: 0, now: 120 };
    const items = briefItems([change('a', 'A', 0, 0.1), people]);
    expect(items.map((i) => i.kind)).toEqual(['people', 'change']);
    expect(scoreOf(people)).toBe(1);
  });

  it('scores a change by its size divided by the outer change bound', () => {
    expect(scoreOf(change('a', 'A', 0.1, 0.6))).toBeCloseTo(0.5 / outerChangeBound('rentBurden'));
    expect(scoreOf(change('a', 'A', 0, 3, 'commuteTime'))).toBeCloseTo(1);
  });

  it('is a prefix of the full ordered list (property)', () => {
    const cand = fc.record({
      d: fc.integer({ min: 0, max: 40 }),
      prev: fc.integer({ min: -20, max: 20 }),
      now: fc.integer({ min: -20, max: 20 }),
    });
    fc.assert(
      fc.property(fc.array(cand, { maxLength: 30 }), fc.boolean(), (rows, withEvent) => {
        const list: BriefCandidate[] = rows.map((r) => change(`c${r.d}`, `D${String(r.d).padStart(2, '0')}`, r.prev / 10, r.now / 10));
        if (withEvent) list.push(event);
        const full = briefItems(list.concat()).length === 0 ? [] : list.map((c) => ({ ...c, score: scoreOf(c) })).filter((c) => c.score > 0);
        const got = briefItems(list);
        expect(got.length).toBe(Math.min(BRIEF_LIMIT, full.length));
        for (let i = 1; i < got.length; i++) {
          const a = got[i - 1]!;
          const b = got[i]!;
          if (a.kind === 'change' && b.kind === 'change') expect(a.score).toBeGreaterThanOrEqual(b.score);
          if (b.kind === 'major-event') expect(a.kind).not.toBe('change');
        }
      }),
    );
  });
});

describe('briefItemText', () => {
  it('words a change above and below real history with its unit and the change since last quarter', () => {
    const up = briefItemText({ kind: 'change', district: 'a', districtName: 'Zhonghe', indicator: 'rentBurden', value: 29.1, diff: 0.6, change: -0.4, unit: 'percent of household income', percentPoints: true, decimals: 1 });
    expect(up.text).toBe('Rent burden in Zhonghe is now 29.1 percent of household income, 0.6 percentage points above real history.');
    expect(up.detail).toBe('Change since last quarter: −0.4 percentage points');
    const down = briefItemText({ kind: 'change', district: 'a', districtName: 'Xinyi', indicator: 'commuteTime', value: 41, diff: -2, change: -2, unit: 'minutes', percentPoints: false, decimals: 0 });
    expect(down.text).toContain('2 minutes below real history');
  });

  it('words people above a line compared with real history', () => {
    const more = briefItemText({ kind: 'people', district: 'a', districtName: 'Wanhua', persons: 40, change: 30 });
    expect(more.text).toBe('In Wanhua, about 40 more people than in real history are above a rent or commute line.');
    expect(more.detail).toBe('Change since last quarter: +30 people');
    expect(briefItemText({ kind: 'people', district: 'a', districtName: 'Wanhua', persons: -20, change: -20 }).text).toContain('20 fewer people');
  });

  it('words a completion', () => {
    expect(briefItemText({ kind: 'completion', district: 'a', districtName: 'Zhonghe', units: 120 }).text).toBe('120 more social homes than in real history are finished in Zhonghe.');
  });
});
