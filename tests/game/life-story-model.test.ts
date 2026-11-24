// life-story task 4.1: the story model over a fake world (Requirements 2, 3, 6, 7.2, 9.1, 9.2). Pure.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { validateApplicationSupply } from '../../src/data/life-story-loader.ts';
import { validateLifeEventFile } from '../../src/data/life-text-loader.ts';
import type { City, Track } from '../../src/game/life/applications.ts';
import type { Character, LifeEntry, LifeState } from '../../src/game/life/life-state.ts';
import type { CharacterNumbers } from '../../src/game/life/numbers.ts';
import { buildStoryModel, decisionsOf, needsPayload, type StoryChoice, type StoryInputs, type WorldPort } from '../../src/game/life/story-model.ts';
import { quarterAt, quarterIndex } from '../../src/simulation/quarter.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as unknown;
const supply = validateApplicationSupply(read('data/config/application-supply.json'));
const events = validateLifeEventFile(read('data/config/life-events.json'));
if (!supply.ok) throw new Error(supply.error);
if (!events.ok) throw new Error(events.error);
const SUPPLY = supply.value;
const EVENTS = events.value.events;

const look = { body: 'b', hair: 'short', colour: 'teal' };
const start: LifeState = {
  home: '63000070',
  tenure: 'renting',
  members: [{ kind: 'self', occupation: 'food', workCode: '63000050', pronouns: 'they', look }],
  married: false,
};
const character: Character = { name: 'Yu', origin: 'elsewhere', start };

interface WorldOpts {
  readonly computed: number;
  /** Player supply factor of social housing and rent subsidy households (1: equal to real history). */
  readonly factor?: number;
  readonly rent?: number;
  readonly income?: number;
}

/** A world of two Taipei districts; the player track multiplies the real social housing and subsidy supply. */
function world(o: WorldOpts): WorldPort {
  const f = o.factor ?? 1;
  const computed = Array.from({ length: o.computed }, (_, i) => quarterAt(i));
  return {
    computed,
    planning: o.computed >= 44 ? null : quarterAt(o.computed),
    numbers: (state: LifeState): CharacterNumbers => {
      const income = o.income ?? 40000;
      const rent = state.tenure === 'family' ? 0 : (o.rent ?? 15000);
      return { persons: state.members.length, size: 26, income, rent, rentBurden: (rent / income) * 100, commuteMinutes: 25 } as CharacterNumbers;
    },
    social: (_code, qi, t) => ({ completions: qi % 4 === 0 ? 100 * (t === 'player' ? f : 1) : 0, stock: 1000 + qi * 30 * (t === 'player' ? f : 1) }),
    districtsOf: (city: City) => (city === 'Taipei' ? ['63000060', '63000070'] : []),
    policy: (tool, field, _city, _q, t: Track) => {
      if (tool === 'rentSubsidy' && field === 'households') return 9000 * (t === 'player' ? f : 1);
      if (tool === 'rentSubsidy' && field === 'amount') return 5000;
      return 0;
    },
    passPrice: (_c, q) => (quarterIndex(q) >= quarterIndex('2018Q2') ? 1280 : 0),
    cityOf: (code) => (code.startsWith('63') ? 'Taipei' : null),
    marriageAllowed: () => true,
    familyCity: null,
    occupations: [
      { id: 'food', workCodes: ['63000050'] },
      { id: 'nurse', workCodes: ['63000030'] },
    ],
  };
}

const inputs = (w: WorldPort, timeline: LifeEntry[] = [], choices: StoryChoice[] = [], seed = 3): StoryInputs => ({
  character,
  timeline,
  choices,
  seed,
  supply: SUPPLY,
  events: EVENTS,
  world: w,
});

describe('story model', () => {
  it('equal supply on both tracks: both versions are equal in every computed quarter (Requirement 9.2)', () => {
    const entry = fc.record({
      i: fc.integer({ min: 0, max: 42 }),
      d: fc.constantFrom(
        { kind: 'apply', benefit: 'socialHousing' } as const,
        { kind: 'apply', benefit: 'rentSubsidy' } as const,
        { kind: 'buyPass' } as const,
        { kind: 'move', home: '63000060', tenure: 'renting' } as const,
      ),
    });
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 8 }), fc.integer(), (xs, seed) => {
        const tl = xs.map((x) => ({ quarter: quarterAt(x.i), decision: x.d })) as LifeEntry[];
        const m = buildStoryModel(inputs(world({ computed: 44 }), tl, [], seed));
        m.rows.player.forEach((r, k) => {
          expect(r.ledger).toEqual(m.rows.real[k]!.ledger);
          expect(r.state.tenure).toBe(m.rows.real[k]!.state.tenure);
        });
      }),
      { numRuns: 40 },
    );
  });

  it('is deterministic (Requirement 9.1)', () => {
    const tl: LifeEntry[] = [{ quarter: '2019Q3', decision: { kind: 'apply', benefit: 'socialHousing' } }];
    const a = buildStoryModel(inputs(world({ computed: 30, factor: 3 }), tl));
    expect(buildStoryModel(inputs(world({ computed: 30, factor: 3 }), tl))).toEqual(a);
  });

  it('a rent burden above 30 % for 4 quarters asks the rentPressure Life_Event with what each option allows', () => {
    // 15,000 of 40,000 = 37.5 % in every quarter; 4 computed quarters, planning 2016Q1.
    const m = buildStoryModel(inputs(world({ computed: 4 })));
    expect(m.pending?.event.id).toBe('rentPressure');
    const byId = new Map(m.pending!.options.map((o) => [o.id, o]));
    expect(byId.get('keep')).toMatchObject({ available: true });
    expect(byId.get('keep')!.preview!.player.rentBurden).toBeCloseTo(37.5, 10);
    // A single person in Taipei could not apply for the rent subsidy before 2019 (Application_Supply_File).
    expect(byId.get('subsidy')).toMatchObject({ available: false, block: 'ineligible' });
    expect(byId.get('family')).toMatchObject({ available: false, block: 'family' });
    expect(byId.get('leave')!.available).toBe(true);
    expect(byId.get('cheaper')!.preview).toBeNull(); // needs a district
  });

  it('after the choice is recorded, no Life_Event is asked again in that quarter', () => {
    const choices: StoryChoice[] = [{ quarter: '2016Q1', event: 'rentPressure', option: 'keep' }];
    expect(buildStoryModel(inputs(world({ computed: 4 }), [], choices)).pending).toBeNull();
  });

  it('leaving the cities ends the story: an Ending, no Life_Event', () => {
    const tl: LifeEntry[] = [{ quarter: '2016Q1', decision: { kind: 'leave' } }];
    const m = buildStoryModel(inputs(world({ computed: 6 }), tl, [{ quarter: '2016Q1', event: 'rentPressure', option: 'leave' }]));
    expect(m.pending).toBeNull();
    expect(m.ending?.player.leftIn).toBe('2016Q1');
    expect(m.ending?.player.quarters).toBe(4);
  });

  it('an application shows the odds of both tracks; more player supply gives higher odds', () => {
    // Income 15,000: eligible for social housing (180,000 a year); Q2 has the yearly social housing round.
    const m = buildStoryModel(inputs(world({ computed: 5, factor: 4, income: 15000, rent: 3000 })));
    expect(m.pending?.event.id).toBe('socialHousingRound');
    const apply = m.pending!.options.find((o) => o.id === 'apply')!;
    expect(apply.available).toBe(true);
    expect(apply.odds!.odds.player).toBeGreaterThan(apply.odds!.odds.real);
    expect(apply.odds!.supply.player).toBeGreaterThan(apply.odds!.supply.real);
  });

  it('a successful application is a story input of its quarter with the result of both tracks', () => {
    const tl: LifeEntry[] = [{ quarter: '2016Q2', decision: { kind: 'apply', benefit: 'socialHousing' } }];
    const m = buildStoryModel(inputs(world({ computed: 8, factor: 1e6, income: 15000 }), tl));
    const input = m.inputs.find((x) => x.quarter === '2016Q2')!;
    expect(input.outcome?.success).toEqual({ player: true, real: input.outcome!.success.real });
    expect(m.rows.player.find((r) => r.quarter === '2016Q3')!.state.tenure).toBe('social');
  });

  it('the first computed quarter is the start of the story', () => {
    const m = buildStoryModel(inputs(world({ computed: 2 })));
    expect(m.inputs[0]!.first).toBe(true);
    expect(m.inputs[1]!.first).toBe(false);
  });
});

describe('options and their decisions', () => {
  const ev = (id: string) => EVENTS.find((e) => e.id === id)!;
  const opt = (eid: string, oid: string) => ev(eid).options.find((o) => o.id === oid)!;

  it('options that need a district, a job or a partner need a payload', () => {
    expect(needsPayload(opt('leaseEnd', 'move'))).toBe(true);
    expect(needsPayload(opt('leaseEnd', 'family'))).toBe(true);
    expect(needsPayload(opt('longCommute', 'job'))).toBe(true);
    expect(needsPayload(opt('partner', 'moveIn'))).toBe(true);
    expect(needsPayload(opt('leaseEnd', 'renew'))).toBe(false);
    expect(needsPayload(opt('tenancyEnd', 'sameDistrict'))).toBe(false);
  });

  it('maps options to Life_Decisions', () => {
    expect(decisionsOf(opt('leaseEnd', 'renew'), start, {}, null)).toEqual([]);
    expect(decisionsOf(opt('leaseEnd', 'move'), start, {}, null)).toBeNull();
    expect(decisionsOf(opt('leaseEnd', 'move'), start, { home: '63000060' }, null)).toEqual([{ kind: 'move', home: '63000060', tenure: 'renting' }]);
    expect(decisionsOf(opt('tenancyEnd', 'sameDistrict'), start, {}, null)).toEqual([{ kind: 'move', home: '63000070', tenure: 'renting' }]);
    expect(decisionsOf(opt('socialHousingRound', 'apply'), start, {}, null)).toEqual([{ kind: 'apply', benefit: 'socialHousing' }]);
    expect(decisionsOf(opt('subsidyEnds', 'apply'), start, {}, null)).toEqual([{ kind: 'apply', benefit: 'rentSubsidy' }]);
    expect(decisionsOf(opt('jobOffer', 'accept'), start, {}, { occupation: 'nurse', workCode: '63000030' })).toEqual([
      { kind: 'changeJob', occupation: 'nurse', workCode: '63000030' },
    ]);
    expect(decisionsOf(opt('passLaunch', 'buy'), start, {}, null)).toEqual([{ kind: 'buyPass' }]);
    expect(decisionsOf(opt('rentPressure', 'leave'), start, {}, null)).toEqual([{ kind: 'leave' }]);
  });
});

