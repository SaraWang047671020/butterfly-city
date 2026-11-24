// life-story: Applications, the two tracks and the Personal_Ledger (Requirements 3, 4, 9.1 to 9.3). Pure.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { validateApplicationSupply } from '../../src/data/life-story-loader.ts';
import {
  eligibility,
  incomeMultiple,
  realOdds,
  sharedDraw,
  subsidyMultiplier,
  subsidyUntil,
  succeeds,
  tenancyEnds,
  trackOdds,
  valueAtYear,
  type ApplicationSupply,
  type City,
} from '../../src/game/life/applications.ts';
import { personalLedger } from '../../src/game/life/ledger.ts';
import type { Character, LifeEntry, LifeState, Member } from '../../src/game/life/life-state.ts';
import { resolveTracks, trackState, type SupplyView, type TrackContext } from '../../src/game/life/tracks.ts';
import type { CharacterNumbers } from '../../src/game/life/numbers.ts';
import { quarterAt } from '../../src/simulation/quarter.ts';
import type { QuarterKey } from '../../src/types/data-files.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const raw = JSON.parse(readFileSync(resolve(ROOT, 'data/config/application-supply.json'), 'utf8')) as unknown;
const parsed = validateApplicationSupply(raw);
if (!parsed.ok) throw new Error(parsed.error);
const S: ApplicationSupply = parsed.value;

const look = { body: 'b', hair: 'short', colour: 'teal' };
const self: Member = { kind: 'self', occupation: 'food', workCode: '63000050', pronouns: 'they', look };
const start: LifeState = { home: '63000070', tenure: 'renting', members: [self], married: false };
const character: Character = { name: 'Yu', origin: 'elsewhere', start };
const taipei = (code: string): City | null => (code.startsWith('63') ? 'Taipei' : code.startsWith('65') ? 'New Taipei' : null);

describe('Application_Supply_File', () => {
  it('the committed file is valid', () => {
    expect(parsed.ok).toBe(true);
  });

  it('rejects an odds value above 1 and an unknown source', () => {
    const bad = structuredClone(raw) as { socialHousing: { realOdds: { Taipei: { byYear: Record<string, number>; sources: string[] } } } };
    bad.socialHousing.realOdds.Taipei.byYear['2018'] = 4.73;
    expect(validateApplicationSupply(bad).ok).toBe(false);
    const bad2 = structuredClone(raw) as typeof bad;
    bad2.socialHousing.realOdds.Taipei.sources = ['nope'];
    expect(validateApplicationSupply(bad2).ok).toBe(false);
  });
});

describe('values per year', () => {
  it('interpolates between known years and holds the nearest value outside them', () => {
    const t = { '2018': 100, '2020': 200 };
    expect(valueAtYear(t, 2019)).toBe(150);
    expect(valueAtYear(t, 2015)).toBe(100);
    expect(valueAtYear(t, 2025)).toBe(200);
  });

  it('real odds: the published year, else the fallback (not interpolated)', () => {
    expect(realOdds(S, 'socialHousing', 'Taipei', 2019)).toBe(0.04);
    expect(realOdds(S, 'socialHousing', 'Taipei', 2020)).toBe(0.065);
    expect(realOdds(S, 'rentSubsidy', 'New Taipei', 2024)).toBe(0.7306);
  });

  it('the rent subsidy income multiple changes in 2020Q1 and 2022Q3', () => {
    expect(incomeMultiple(S, '2019Q4')).toBe(1.5);
    expect(incomeMultiple(S, '2020Q1')).toBe(2.5);
    expect(incomeMultiple(S, '2022Q2')).toBe(2.5);
    expect(incomeMultiple(S, '2022Q3')).toBe(3);
  });
});

describe('odds and the Shared_Draw (Requirement 9.3)', () => {
  const pos = fc.double({ min: 1, max: 5000, noNaN: true });
  const prob = fc.double({ min: 0.001, max: 1, noNaN: true });

  it('equal supply gives the real odds', () => {
    fc.assert(fc.property(prob, pos, pos, (r, s, m) => {
      expect(trackOdds(r, s, s, m)).toBeCloseTo(r, 12);
    }));
  });

  it('more supply never lowers the odds', () => {
    fc.assert(
      fc.property(prob, pos, pos, pos, pos, (r, a, b, real, mean) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(trackOdds(r, hi, real, mean)).toBeGreaterThanOrEqual(trackOdds(r, lo, real, mean));
      }),
    );
  });

  it('a success at lower odds is a success at higher odds', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.999, noNaN: true }), prob, prob, (d, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        if (succeeds(d, lo)) expect(succeeds(d, hi)).toBe(true);
      }),
    );
  });

  it('no real supply in the quarter: the real odds are 0 and the player is compared with the mean', () => {
    expect(trackOdds(0.05, 0, 0, 100)).toBe(0);
    expect(trackOdds(0.05, 200, 0, 100)).toBeCloseTo(0.1, 12);
  });

  it('the Shared_Draw is deterministic and in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 43 }), (seed, i) => {
        const q = quarterAt(i);
        const d = sharedDraw(seed, 'socialHousing', q);
        expect(d).toBe(sharedDraw(seed, 'socialHousing', q));
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(1);
      }),
    );
  });
});

describe('eligibility (Requirement 3.1)', () => {
  const h = (state: LifeState, incomeMonth: number, city: City = 'Taipei') => ({ city, incomeMonth, persons: state.members.length, state });

  it('social housing: household income below the city limit of the year', () => {
    expect(eligibility(S, 'socialHousing', h(start, 35000), '2019Q3').ok).toBe(true); // 420,000 < 1,530,000
    const r = eligibility(S, 'socialHousing', h(start, 140000), '2019Q3'); // 1,680,000
    expect(r).toEqual({ ok: false, rule: 'income', limit: 1530000, value: 1680000 });
  });

  it('rent subsidy: a single person in Taipei could not apply before 2019', () => {
    expect(eligibility(S, 'rentSubsidy', h(start, 20000), '2018Q3')).toEqual({ ok: false, rule: 'singleUnder40' });
    expect(eligibility(S, 'rentSubsidy', h(start, 20000), '2019Q3').ok).toBe(true); // 20,000 < 1.5 × 16,580
    expect(eligibility(S, 'rentSubsidy', h(start, 20000, 'New Taipei'), '2018Q3').ok).toBe(true); // no age rule; 20,000 < 1.5 × 14,385
    expect(eligibility(S, 'rentSubsidy', h(start, 22000, 'New Taipei'), '2018Q3').ok).toBe(false); // 22,000 > 21,577.5
  });

  it('rent subsidy: only while renting privately', () => {
    expect(eligibility(S, 'rentSubsidy', h({ ...start, tenure: 'family' }, 10000), '2023Q3')).toEqual({ ok: false, rule: 'tenure' });
  });
});

describe('periods and multipliers', () => {
  it('a rent subsidy lasts 4 quarters', () => {
    expect(subsidyUntil('2019Q4')).toBe('2020Q3');
  });

  it('the multipliers start in 2022Q3; the largest that applies is used', () => {
    expect(subsidyMultiplier(S, start, '2022Q2')).toBe(1);
    expect(subsidyMultiplier(S, start, '2022Q3')).toBe(1.2);
    const child: Member = { kind: 'child', occupation: null, workCode: null, pronouns: 'they', look };
    const partner: Member = { kind: 'partner', occupation: 'nurse', workCode: '63000050', pronouns: 'she', look };
    const fam: LifeState = { ...start, members: [self, partner, child, child], married: true, marriedIn: '2023Q1' };
    expect(subsidyMultiplier(S, fam, '2023Q2')).toBe(1.6);
  });

  it('social housing ends after 24 quarters, or at a 12-quarter renewal above the income limit', () => {
    const social: LifeState = { ...start, tenure: 'social', socialSince: '2016Q1' };
    const hh = (incomeMonth: number) => ({ city: 'Taipei' as City, incomeMonth, persons: 1, state: social });
    expect(tenancyEnds(S, hh(30000), '2018Q4')).toBeNull(); // renewal, still eligible
    expect(tenancyEnds(S, hh(200000), '2018Q4')).toBe('income');
    expect(tenancyEnds(S, hh(30000), '2021Q4')).toBe('limit');
  });
});

/** A supply view where both tracks get `real` × `factor` (player) and `real` (real), per quarter index. */
function view(real: (i: number) => number, factor: number): SupplyView {
  const idx = (q: QuarterKey) => (Number(q.slice(0, 4)) - 2015) * 4 + Number(q.slice(5)) - 1;
  return {
    supply: (_b, _c, q, t) => real(idx(q)) * (t === 'player' ? factor : 1),
    meanSupplyReal: () => 300,
    socialDistrict: (_c, _q, t) => (t === 'player' ? '63000060' : '63000050'),
  };
}

const ctxOf = (v: SupplyView, seed: number): TrackContext => ({ supply: S, view: v, seed, cityOf: taipei, incomeMonth: () => 30000 });

const applyTimeline = fc.array(
  fc.record({ i: fc.integer({ min: 0, max: 42 }), benefit: fc.constantFrom('socialHousing' as const, 'rentSubsidy' as const) }),
  { maxLength: 8 },
);
const toTimeline = (xs: { i: number; benefit: 'socialHousing' | 'rentSubsidy' }[]): LifeEntry[] =>
  xs.map((x) => ({ quarter: quarterAt(x.i), decision: { kind: 'apply', benefit: x.benefit } }));

describe('the two tracks', () => {
  it('equal supply on both tracks gives equal versions in every quarter (Requirement 9.2)', () => {
    fc.assert(
      fc.property(applyTimeline, fc.integer(), (xs, seed) => {
        const r = resolveTracks(character, toTimeline(xs), ctxOf(view(() => 400, 1), seed));
        for (const o of r.outcomes) expect(o.success.player).toBe(o.success.real);
        for (let i = 0; i < 44; i++) {
          const q = quarterAt(i);
          const p = trackState(character, r, 'player', q);
          const real = trackState(character, r, 'real', q);
          // Only the allocated district may differ; with equal supply both tracks succeed together.
          expect(p.tenure).toBe(real.tenure);
          expect(p.subsidyUntil).toBe(real.subsidyUntil);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('with more supply in the player city, every real success is a player success (Shared_Draw)', () => {
    fc.assert(
      fc.property(applyTimeline, fc.integer(), fc.double({ min: 1, max: 6, noNaN: true }), (xs, seed, factor) => {
        const r = resolveTracks(character, toTimeline(xs), ctxOf(view(() => 400, factor), seed));
        for (const o of r.outcomes) {
          expect(o.odds.player).toBeGreaterThanOrEqual(o.odds.real);
          if (o.success.real && o.eligibility.ok) {
            // The player track may already hold the benefit from an earlier success; otherwise it succeeds too.
            const before = trackState(character, r, 'player', o.quarter);
            const open = o.benefit === 'socialHousing' ? before.tenure !== 'social' : before.tenure === 'renting';
            if (open) expect(o.success.player).toBe(true);
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('a success moves the track into social housing from the next quarter, on that track only', () => {
    // Real supply 0 in every quarter: the real track never succeeds; huge player supply: the player track always does.
    const r = resolveTracks(character, toTimeline([{ i: 18, benefit: 'socialHousing' }]), ctxOf(view(() => 0, 1), 1));
    expect(r.outcomes[0]!.success).toEqual({ player: false, real: false });
    const v: SupplyView = { supply: (_b, _c, _q, t) => (t === 'player' ? 1e6 : 0), meanSupplyReal: () => 300, socialDistrict: () => '63000060' };
    const r2 = resolveTracks(character, toTimeline([{ i: 18, benefit: 'socialHousing' }]), ctxOf(v, 1));
    expect(r2.outcomes[0]!.success).toEqual({ player: true, real: false });
    expect(trackState(character, r2, 'player', quarterAt(18)).tenure).toBe('renting');
    expect(trackState(character, r2, 'player', quarterAt(19))).toMatchObject({ tenure: 'social', home: '63000060', socialSince: quarterAt(19) });
    expect(trackState(character, r2, 'real', quarterAt(19)).tenure).toBe('renting');
  });

  it('is deterministic (Requirement 9.1)', () => {
    fc.assert(
      fc.property(applyTimeline, fc.integer(), fc.double({ min: 0.2, max: 4, noNaN: true }), (xs, seed, f) => {
        const c = ctxOf(view((i) => 100 + i * 10, f), seed);
        expect(resolveTracks(character, toTimeline(xs), c)).toEqual(resolveTracks(character, toTimeline(xs), c));
      }),
      { numRuns: 30 },
    );
  });
});

describe('Personal_Ledger (Requirement 4.1)', () => {
  const nums = (rent: number | null, income: number | null = 40000): CharacterNumbers =>
    ({ persons: 1, size: 26, income, rent, rentBurden: null, commuteMinutes: 22 }) as CharacterNumbers;
  const base = { quarter: '2023Q1' as QuarterKey, city: 'Taipei' as City, supply: S, subsidyAmount: 5000, passNet: 1200 };

  it('renting: rent, no pass, money left', () => {
    const l = personalLedger({ ...base, state: start, numbers: nums(16000) });
    expect(l).toMatchObject({ rent: 16000, subsidy: 0, transport: null, left: 24000 });
    expect(l.rentBurden).toBeCloseTo(40, 10);
  });

  it('social housing pays the city share of the market rent', () => {
    const l = personalLedger({ ...base, state: { ...start, tenure: 'social', socialSince: '2022Q1' }, numbers: nums(16000) });
    expect(l.rent).toBeCloseTo(13600, 6);
  });

  it('the subsidy times its multiplier lowers the rent, never below 0; the pass is a line when bought and sold', () => {
    const s: LifeState = { ...start, subsidyUntil: '2023Q2', pass: true };
    const l = personalLedger({ ...base, state: s, numbers: nums(16000) });
    expect(l.subsidy).toBe(6000); // 5,000 × 1.2 (single)
    expect(l).toMatchObject({ rent: 10000, transport: 1200, left: 28800 });
    expect(personalLedger({ ...base, state: s, numbers: nums(4000) }).rent).toBe(0);
    expect(personalLedger({ ...base, state: s, numbers: nums(16000), passNet: 0 }).transport).toBeNull();
    expect(personalLedger({ ...base, quarter: '2023Q3', state: s, numbers: nums(16000) }).subsidy).toBe(0);
  });

  it('family: no rent', () => {
    expect(personalLedger({ ...base, state: { ...start, tenure: 'family' }, numbers: nums(16000) }).rent).toBe(0);
  });

  it('equal inputs give equal ledgers', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 60000, noNaN: true }), fc.double({ min: 1, max: 200000, noNaN: true }), (rent, income) => {
        const a = personalLedger({ ...base, state: start, numbers: nums(rent, income) });
        expect(personalLedger({ ...base, state: start, numbers: nums(rent, income) })).toEqual(a);
      }),
    );
  });
});
