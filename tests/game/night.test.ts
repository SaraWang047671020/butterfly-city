// night-ghosts: Day_Timer, Missions and the night (Requirements 3, 4, 5, 13.1). Pure.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { checkMission, missionOffer, type MissionRules, type MissionWorld } from '../../src/game/night/missions.ts';
import { MISSION_GHOSTS, missionGhosts, nextDay, nightOf, SWALLOW_AT } from '../../src/game/night/night.ts';
import { announceAt, clock, DEFAULT_LENGTH, extend, MIN_LENGTH, newDay, pause, resume, tick, turnOff } from '../../src/game/night/timer.ts';
import { quarterAt } from '../../src/simulation/quarter.ts';

const RULES: MissionRules = {
  startHomes: { factor: 1.1, minExtra: 50 },
  subsidise: { factor: 1.1 },
  passSupport: { extra: 100 },
  fewerAbove: { share: 0.01 },
  metroRiders: { factor: 1.02 },
};

const DISTRICTS = [
  { code: '63000070', city: 'Taipei' },
  { code: '63000030', city: 'Taipei' },
  { code: '65000010', city: 'New Taipei' },
];

/** A world where the player's values are the real ones times `f` (policy) and `g` (MRT); ghostDiff is `diff`. */
function world(f = 1, g = 1, diff = 0, tools: MissionWorld['activeTools'] = ['socialHousing', 'rentSubsidy', 'commuterPass']): MissionWorld {
  const real = { unitsStarted: 200, households: 9000, subsidy: 0 } as Record<string, number>;
  return {
    activeTools: tools,
    districts: DISTRICTS,
    givers: [
      { scene: '5.2', kind: 'A', district: '63000030', city: 'Taipei', theme: 'transit' },
      { scene: '4.3', kind: 'B', district: '63000070', city: 'Taipei', theme: 'rent' },
    ],
    policy: (_tool, field, _area, _q, t) => (real[field] ?? 0) * (t === 'player' ? f : 1) + (t === 'player' && field === 'subsidy' ? (f - 1) * 1000 : 0),
    mrtEntries: (_c, _q, t) => 1_000_000 * (t === 'player' ? g : 1),
    ghostDiff: () => diff,
    population: () => 200_000,
  };
}

describe('Day_Timer (Requirement 3)', () => {
  it('a new game starts at 5 minutes and counts down to Next quarter', () => {
    let t = newDay(DEFAULT_LENGTH, 0, false);
    expect(t).toEqual({ length: 300, left: 300, running: true, off: false });
    const r = tick(t, 299);
    expect(r.expired).toBe(false);
    t = r.timer;
    const end = tick(t, 5);
    expect(end).toEqual({ timer: { length: 300, left: 0, running: false, off: false }, expired: true });
    expect(tick(end.timer, 1).expired).toBe(false);
  });

  it('pause, more time and off (WCAG 2.2.1)', () => {
    const t = newDay(300, 0, false);
    expect(tick(pause(t), 100).timer.left).toBe(300);
    expect(tick(resume(pause(t)), 100).timer.left).toBe(200);
    expect(extend(t).left).toBe(420);
    expect(tick(turnOff(t), 1000)).toEqual({ timer: turnOff(t), expired: false });
  });

  it('Mission_Ghosts shorten the next day, never below the minimum; off means no shortening', () => {
    fc.assert(
      fc.property(fc.constantFrom(180, 300, 480), fc.integer({ min: 0, max: 50 }), (len, groups) => {
        const t = newDay(len, groups, false);
        expect(t.length).toBeGreaterThanOrEqual(Math.min(len, MIN_LENGTH));
        expect(t.length).toBeLessThanOrEqual(len);
        expect(newDay(len, groups, true).length).toBe(len);
      }),
    );
    expect(newDay(300, 1, false).length).toBe(270);
  });

  it('shows minutes and seconds; announces at 1 minute and 30 seconds only', () => {
    expect(clock(252)).toBe('4:12');
    expect(clock(0)).toBe('0:00');
    expect(announceAt(61, 60)).toBe(60);
    expect(announceAt(31, 30)).toBe(30);
    expect(announceAt(45, 44)).toBeNull();
  });
});

describe('Mission_Offer (Requirement 4.1, 4.2)', () => {
  it('3 Missions of at least 2 types, one easy and one hard, never from a Kind C giver', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 43 }), (seed, i) => {
        const offer = missionOffer(RULES, world(), seed, quarterAt(i));
        expect(offer).toHaveLength(3);
        expect(new Set(offer.map((m) => m.type)).size).toBeGreaterThanOrEqual(2);
        expect(offer.some((m) => m.difficulty === 'easy')).toBe(true);
        expect(offer.some((m) => m.difficulty === 'hard')).toBe(true);
        for (const m of offer) expect(['model', 'A', 'B']).toContain(m.giver.kind);
      }),
    );
  });

  it('is deterministic; the easy type rotates so every Active_Tool appears within a year', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 40 }), (seed, i) => {
        const q = quarterAt(i);
        expect(missionOffer(RULES, world(), seed, q)).toEqual(missionOffer(RULES, world(), seed, q));
        const tools = new Set([0, 1, 2, 3].flatMap((k) => missionOffer(RULES, world(), seed, quarterAt(i + k)).map((m) => m.tool)));
        expect(tools).toEqual(new Set(['socialHousing', 'rentSubsidy', 'commuterPass']));
      }),
    );
  });

  it('offers only the tools that are active', () => {
    const offer = missionOffer(RULES, world(1, 1, 0, ['socialHousing']), 1, '2017Q1');
    for (const m of offer) expect(['startHomes', 'fewerAbove', 'metroRiders']).toContain(m.type);
  });

  it('targets: real × 1.1 and at least real + 50 homes; real + NT$100 pass subsidy; 1 % of the people', () => {
    const offer = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((s) => missionOffer(RULES, world(), s, '2018Q1'));
    for (const m of offer) {
      if (m.type === 'startHomes') expect(m.target).toBe(250);
      if (m.type === 'subsidise') expect(m.target).toBe(9900);
      if (m.type === 'passSupport') expect(m.target).toBe(100);
      if (m.type === 'fewerAbove') expect(m.target).toBe(2000);
      if (m.type === 'metroRiders') expect(m.target).toBe(1_020_000);
    }
  });
});

describe('checking a Mission (Requirement 4.4)', () => {
  const offerOf = (type: string) => {
    for (let s = 0; s < 200; s++) {
      const m = missionOffer(RULES, world(), s, '2018Q1').find((x) => x.type === type);
      if (m !== undefined) return m;
    }
    throw new Error(type);
  };

  it('met at or above the target, not met below; real history is never enough for an easy Mission', () => {
    const homes = offerOf('startHomes');
    expect(checkMission(world(1), homes).met).toBe(false);
    expect(checkMission(world(1.25), homes).met).toBe(true);
    const fewer = offerOf('fewerAbove');
    expect(checkMission(world(1, 1, -1999), fewer).met).toBe(false);
    expect(checkMission(world(1, 1, -2000), fewer)).toMatchObject({ met: true, value: 2000 });
    const metro = offerOf('metroRiders');
    expect(checkMission(world(1, 1.03), metro).met).toBe(true);
  });
});

describe('the night (Requirement 5)', () => {
  const result = (met: boolean, area = '63000070') => ({ mission: { area } as never, value: 0, met });

  it('a Mission not met adds 3 Mission_Ghosts to its district, or 1 to each of the 3 most haunted districts of a city', () => {
    expect(missionGhosts(result(true), () => [], () => 0)).toEqual([]);
    expect(missionGhosts(null, () => [], () => 0)).toEqual([]);
    expect(missionGhosts(result(false), () => [], () => 0)).toEqual([{ district: '63000070', count: MISSION_GHOSTS }]);
    const city = missionGhosts(result(false, 'Taipei'), () => ['a', 'b', 'c', 'd'], (d) => ({ a: 1, b: 5, c: 5, d: 9 })[d] ?? 0);
    expect(city).toEqual([
      { district: 'd', count: 1 },
      { district: 'b', count: 1 },
      { district: 'c', count: 1 },
    ]);
  });

  it('a district is swallowed at the threshold; the two kinds stay apart', () => {
    const n = nightOf(['x', 'y'], (d) => (d === 'x' ? SWALLOW_AT - 3 : 1), [{ district: 'x', count: 3 }]);
    expect(n).toEqual([
      { district: 'x', modelGhosts: SWALLOW_AT - 3, missionGhosts: 3, swallowed: true },
      { district: 'y', modelGhosts: 1, missionGhosts: 0, swallowed: false },
    ]);
  });

  it('the next day is shorter only after a Mission not met', () => {
    expect(nextDay(300, result(false), false).length).toBe(270);
    expect(nextDay(300, result(true), false).length).toBe(300);
    expect(nextDay(300, result(false), true).length).toBe(300);
  });
});

import { pickLine } from '../../src/game/night/lines.ts';
import { canAddToHeritage, complete, findStep, lookOf, nextStep } from '../../src/game/night/scenes.ts';

describe('Ghost_Lines (Requirement 5A.1)', () => {
  it('picks a line per moment, the same for the same occasion', () => {
    const set = { meet: ['a', 'b', 'c'], ask: ['x'], met: [], notMet: ['n'], idle: ['i'] };
    expect(pickLine(set, 'met', 1, 'q')).toBeNull();
    expect(pickLine(set, 'ask', 1, 'q')).toBe('x');
    fc.assert(
      fc.property(fc.integer(), fc.string(), (seed, key) => {
        expect(pickLine(set, 'meet', seed, key)).toBe(pickLine(set, 'meet', seed, key));
      }),
    );
  });
});

describe('scenes (Requirements 6 to 9)', () => {
  it('ghosts of Kind A and B and the signs of Kind C appear at night only; a Memorial_Point is only a plaque', () => {
    expect(lookOf('A', 'day', false)).toEqual({ ghost: false, signs: false, plaque: false, investigate: false });
    expect(lookOf('A', 'night', false)).toMatchObject({ ghost: true, investigate: false });
    expect(lookOf('B', 'night', false)).toMatchObject({ ghost: true, investigate: true });
    expect(lookOf('C', 'night', false)).toEqual({ ghost: false, signs: true, plaque: false, investigate: true });
    expect(lookOf('C', 'day', true).plaque).toBe(true);
    expect(lookOf('memorial', 'night', false)).toEqual({ ghost: false, signs: false, plaque: true, investigate: false });
  });

  it('an Investigation unlocks step by step; the Heritage_Plan opens at its end', () => {
    const s = { id: '1.11', kind: 'C' as const, steps: ['place', 'event', 'people', 'today'] };
    let p: { found: readonly string[] } = { found: [] };
    expect(findStep(s, p, 'event')).toBe(p);
    for (const step of s.steps) {
      expect(canAddToHeritage(s, p)).toBe(false);
      expect(nextStep(s, p)).toBe(step);
      p = findStep(s, p, step);
    }
    expect(complete(s, p)).toBe(true);
    expect(canAddToHeritage(s, p)).toBe(true);
    expect(canAddToHeritage({ id: 'x', kind: 'A', steps: [] }, { found: [] })).toBe(false);
  });
});
