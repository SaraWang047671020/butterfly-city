// life-story: Life_Events, Story_Lines, the Ending and the two text files (Requirements 2, 5, 6, 9.1, 9.4, 9.5). Pure.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isApproved, textAt, textProblems, validateLifeEventFile, validateLifeStoryFile } from '../../src/data/life-text-loader.ts';
import type { City, Eligibility } from '../../src/game/life/applications.ts';
import { jobOffer, LIFE_EVENT_IDS, MIN_GAP, pickEvent, TRIGGERS, type EventContext, type PastEvent } from '../../src/game/life/events.ts';
import type { PersonalLedger } from '../../src/game/life/ledger.ts';
import type { LifeState, Member } from '../../src/game/life/life-state.ts';
import { decadeSummary, endingPart, quarterStory, STORY_KEYS, type QuarterStoryInput, type StoryFormat } from '../../src/game/life/story.ts';
import { fillTemplate } from '../../src/narrative/fill.ts';
import { quarterAt, quarterIndex } from '../../src/simulation/quarter.ts';
import type { QuarterKey } from '../../src/types/data-files.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as unknown;
const eventsRaw = read('data/config/life-events.json');
const storyRaw = read('data/config/life-story.json');
const eventsFile = validateLifeEventFile(eventsRaw);
const storyFile = validateLifeStoryFile(storyRaw, STORY_KEYS);
if (!eventsFile.ok) throw new Error(eventsFile.error);
if (!storyFile.ok) throw new Error(storyFile.error);
const RULES = eventsFile.value.events;
const STORY = storyFile.value;

const look = { body: 'b', hair: 'short', colour: 'teal' };
const self: Member = { kind: 'self', occupation: 'food', workCode: '63000050', pronouns: 'they', look };
const partner: Member = { kind: 'partner', occupation: 'nurse', workCode: '63000050', pronouns: 'she', look };
const start: LifeState = { home: '63000070', tenure: 'renting', members: [self], married: false };

const ledger = (o: Partial<PersonalLedger> = {}): PersonalLedger => ({
  housing: 'renting',
  income: 40000,
  marketRent: 10000,
  subsidy: 0,
  rent: 10000,
  rentBurden: 25,
  transport: null,
  left: 30000,
  commuteMinutes: 25,
  ...o,
});

const ctx = (o: Partial<EventContext> = {}): EventContext => ({
  seed: 7,
  planning: '2016Q1',
  state: start,
  ledgers: [ledger(), ledger(), ledger(), ledger()],
  past: [],
  lastMove: '2015Q1',
  lastJobChange: '2015Q1',
  partnerSince: null,
  eligible: () => false,
  socialRound: false,
  tenancyEnd: null,
  marriageAllowed: true,
  ...o,
});

describe('the two text files (Requirement 9.4)', () => {
  it('are valid and approved in both languages', () => {
    expect(isApproved(eventsRaw)).toBe(true);
    expect(isApproved(storyRaw)).toBe(true);
  });

  it('every text has both languages and the same placeholders', () => {
    expect(textProblems(eventsRaw)).toEqual([]);
    expect(textProblems(storyRaw)).toEqual([]);
  });

  it('the Life_Event_File holds every Life_Event of the code, and each has a first option to keep or stay', () => {
    expect(RULES.map((r) => r.id).sort()).toEqual([...LIFE_EVENT_IDS].sort());
    for (const r of RULES) expect(['none', 'move'].includes(r.options[0]!.effect.kind), r.id).toBe(true);
  });

  it('every story key the selection can produce is in the Life_Story_File', () => {
    for (const k of STORY_KEYS) expect(textAt(STORY, k), k).not.toBeNull();
  });

  it('a placeholder mismatch is reported', () => {
    expect(textProblems({ a: { en: '{name} x', 'zh-Hant': '{nam} x' } })).toHaveLength(1);
  });
});

describe('triggers (Requirement 2.1, 2.2)', () => {
  it('rent pressure: above 30 % for 4 computed quarters, renting', () => {
    const high = Array.from({ length: 4 }, () => ledger({ rentBurden: 35 }));
    expect(TRIGGERS.rentPressure(ctx({ ledgers: high }))).toBe(true);
    expect(TRIGGERS.rentPressure(ctx({ ledgers: [ledger(), ...high.slice(1)] }))).toBe(false);
    expect(TRIGGERS.rentPressure(ctx({ ledgers: high, state: { ...start, tenure: 'family' } }))).toBe(false);
  });

  it('long commute: above 60 minutes for 4 quarters', () => {
    expect(TRIGGERS.longCommute(ctx({ ledgers: Array.from({ length: 4 }, () => ledger({ commuteMinutes: 75 })) }))).toBe(true);
    expect(TRIGGERS.longCommute(ctx())).toBe(false);
  });

  it('the pass goes on sale in 2018Q2, for a Character who commutes', () => {
    expect(TRIGGERS.passLaunch(ctx({ planning: '2018Q2' }))).toBe(true);
    expect(TRIGGERS.passLaunch(ctx({ planning: '2018Q2', ledgers: [ledger({ commuteMinutes: null })] }))).toBe(false);
    expect(TRIGGERS.passLaunch(ctx({ planning: '2018Q3' }))).toBe(false);
  });

  it('applications: only when eligible; social housing in a round or in Q2; the subsidy window in Q3', () => {
    expect(TRIGGERS.socialHousingRound(ctx({ socialRound: true }))).toBe(false);
    expect(TRIGGERS.socialHousingRound(ctx({ socialRound: true, eligible: () => true }))).toBe(true);
    expect(TRIGGERS.socialHousingRound(ctx({ planning: '2016Q2', eligible: () => true }))).toBe(true);
    expect(TRIGGERS.rentSubsidyWindow(ctx({ planning: '2016Q3', eligible: () => true }))).toBe(true);
    expect(TRIGGERS.rentSubsidyWindow(ctx({ planning: '2016Q3', eligible: () => true, state: { ...start, subsidyUntil: '2016Q4' } }))).toBe(false);
  });

  it('forced events: the end of a tenancy and of a subsidy', () => {
    expect(TRIGGERS.tenancyEnd(ctx({ state: { ...start, tenure: 'social', socialSince: '2016Q1' }, tenancyEnd: 'limit' }))).toBe(true);
    expect(TRIGGERS.subsidyEnds(ctx({ planning: '2017Q2', state: { ...start, subsidyUntil: '2017Q2' } }))).toBe(true);
  });

  it('a lease ends 8 quarters after the last move; marriage needs 4 quarters together and the law', () => {
    expect(TRIGGERS.leaseEnd(ctx({ planning: '2017Q1' }))).toBe(true);
    expect(TRIGGERS.leaseEnd(ctx({ planning: '2016Q4' }))).toBe(false);
    const couple = { ...start, members: [self, partner] };
    expect(TRIGGERS.marriage(ctx({ state: couple, partnerSince: '2016Q1', planning: '2017Q1' }))).toBe(true);
    expect(TRIGGERS.marriage(ctx({ state: couple, partnerSince: '2016Q1', planning: '2017Q1', marriageAllowed: false }))).toBe(false);
  });

  it('no trigger reads the Real_Version: the context has no field of it (Requirement 9.5)', () => {
    const src = readFileSync(resolve(ROOT, 'src/game/life/events.ts'), 'utf8');
    const block = src.slice(src.indexOf('export interface EventContext'), src.indexOf('}', src.indexOf('export interface EventContext')));
    expect(block).not.toMatch(/real/i);
  });
});

describe('the pick (Requirement 2.3)', () => {
  it('highest priority first; at most one per quarter', () => {
    const c = ctx({ planning: '2017Q1', ledgers: Array.from({ length: 4 }, () => ledger({ rentBurden: 40 })) });
    expect(pickEvent(RULES, c)).toBe('rentPressure');
    expect(pickEvent(RULES, { ...c, past: [{ quarter: '2017Q1', event: 'partner' }] })).toBeNull();
  });

  it('spacing: a non-forced event waits MIN_GAP quarters; a forced one does not', () => {
    const past: PastEvent[] = [{ quarter: '2016Q4', event: 'partner' }];
    expect(pickEvent(RULES, ctx({ planning: '2017Q1', past }))).toBeNull();
    const forced = ctx({ planning: '2017Q1', past, state: { ...start, tenure: 'social', socialSince: '2015Q2' }, tenancyEnd: 'limit' });
    expect(pickEvent(RULES, forced)).toBe('tenancyEnd');
  });

  it('nothing after the Character left the cities', () => {
    expect(pickEvent(RULES, ctx({ state: { ...start, leftIn: '2016Q1' } }))).toBeNull();
  });

  it('over a decade, about one Life_Event a year: never more than 44 ÷ MIN_GAP + 1', () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(fc.double({ min: 10, max: 50, noNaN: true }), { minLength: 44, maxLength: 44 }), (seed, burdens) => {
        const past: PastEvent[] = [];
        for (let i = 1; i < 44; i++) {
          const planning = quarterAt(i);
          const ledgers = burdens.slice(0, i).map((b) => ledger({ rentBurden: b }));
          const id = pickEvent(RULES, ctx({ seed, planning, ledgers, past: [...past], eligible: () => true }));
          if (id !== null) past.push({ quarter: planning, event: id });
        }
        expect(past.length).toBeLessThanOrEqual(Math.floor(44 / MIN_GAP) + 1);
        for (let k = 1; k < past.length; k++) expect(quarterIndex(past[k]!.quarter) - quarterIndex(past[k - 1]!.quarter)).toBeGreaterThanOrEqual(MIN_GAP);
      }),
      { numRuns: 40 },
    );
  });

  it('is deterministic; the job offer too (Requirement 9.1)', () => {
    const c = ctx({ planning: '2018Q2', eligible: () => true, socialRound: true });
    expect(pickEvent(RULES, c)).toBe(pickEvent(RULES, c));
    const occ = [
      { id: 'food', workCodes: ['63000050'] },
      { id: 'nurse', workCodes: ['63000030', '65000010'] },
    ];
    expect(jobOffer(1, '2018Q2', occ, 'food')).toEqual(jobOffer(1, '2018Q2', occ, 'food'));
    expect(jobOffer(1, '2018Q2', occ, 'food')!.occupation).toBe('nurse');
  });
});

const F: StoryFormat = {
  money: (n) => `NT$${Math.round(n)}`,
  percent: (n) => n.toFixed(1),
  minutes: (n) => String(Math.round(n)),
  count: (n) => String(n),
  odds: (p) => (p * 100).toFixed(1),
  draw: (d) => d.toFixed(3),
  district: (c) => `D${c}`,
  city: (c: City) => c,
  quarter: (q) => q,
  occupation: (id) => id,
  option: (e, o) => `${e}/${o}`,
  rule: (e: Eligibility) => (e.ok ? '' : e.rule),
};

const input = (o: Partial<QuarterStoryInput> = {}): QuarterStoryInput => ({
  name: 'Yu',
  quarter: '2019Q4',
  first: false,
  states: { player: start, real: start },
  ledgers: { player: ledger(), real: ledger() },
  choice: null,
  outcome: null,
  subsidyAmounts: { player: null, real: null },
  rentShare: null,
  size: 26,
  ...o,
});

/** Every part of a story fills in both languages (no missing placeholder value). */
function fillsInBoth(lines: ReturnType<typeof quarterStory>): void {
  for (const line of lines) {
    for (const part of line) {
      const t = textAt(STORY, part.key);
      expect(t, part.key).not.toBeNull();
      expect(() => fillTemplate(part.key, t!.en, part.values)).not.toThrow();
      expect(() => fillTemplate(part.key, t!['zh-Hant'], part.values)).not.toThrow();
    }
  }
}

describe('Story_Lines (Requirement 5.2)', () => {
  it('equal versions: the "same" line and the situation', () => {
    const lines = quarterStory(input(), F);
    expect(lines.map((l) => l.map((p) => p.key))).toEqual([['difference.same'], ['situation.renting']]);
    fillsInBoth(lines);
  });

  it('the first quarter starts the story', () => {
    const lines = quarterStory(input({ first: true, quarter: '2015Q1' }), F);
    expect(lines[0]![0]!.key).toBe('start.renting');
    expect(lines).toHaveLength(2);
    fillsInBoth(lines);
  });

  it('an application: the choice, the odds, the draw and the result in one line, then the difference', () => {
    const outcome = {
      quarter: '2019Q3' as QuarterKey,
      benefit: 'socialHousing' as const,
      city: 'Taipei' as City,
      eligibility: { ok: true } as const,
      draw: 0.087,
      odds: { player: 0.112, real: 0.04 },
      supply: { player: 1240, real: 310 },
      success: { player: true, real: false },
      home: { player: '63000060', real: null },
    };
    const lines = quarterStory(
      input({ choice: { event: 'socialHousingRound', option: 'apply' }, outcome, ledgers: { player: ledger({ rent: 8000, left: 32000 }), real: ledger() } }),
      F,
    );
    expect(lines[0]!.map((p) => p.key)).toEqual(['choice', 'application.odds.socialHousing', 'application.draw', 'application.result.playerOnly.socialHousing']);
    expect(lines[1]![0]).toEqual({ key: 'difference.rentLower', values: { name: 'Yu', rentDiff: 'NT$2000' } });
    expect(lines).toHaveLength(3);
    fillsInBoth(lines);
  });

  it('every produced key is a STORY_KEY, and the result is deterministic', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 30000, noNaN: true }), fc.double({ min: 0, max: 30000, noNaN: true }), fc.boolean(), (a, b, first) => {
        const i = input({ first, ledgers: { player: ledger({ rent: a, left: 40000 - a }), real: ledger({ rent: b, left: 40000 - b }) } });
        const lines = quarterStory(i, F);
        expect(quarterStory(i, F)).toEqual(lines);
        expect(lines.length).toBeGreaterThanOrEqual(1);
        expect(lines.length).toBeLessThanOrEqual(3);
        for (const l of lines) for (const p of l) expect(STORY_KEYS).toContain(p.key);
      }),
    );
  });
});

describe('Ending (Requirement 6)', () => {
  const rows = (burden: number, state: LifeState = start) =>
    Array.from({ length: 44 }, (_, i) => ({ quarter: quarterAt(i), state, ledger: ledger({ rentBurden: burden, rent: 10000, left: 30000 }) }));

  it('sums the decade: rent × 3 per quarter, mean burden, quarters above 30 %', () => {
    const s = decadeSummary(rows(35))!;
    expect(s).toMatchObject({ quarters: 44, totalRent: 1320000, stressQuarters: 44, totalLeft: 3960000, leftIn: null });
    expect(s.meanBurden).toBeCloseTo(35, 10);
    expect(endingPart('Yu', s, F).key).toBe('ending.versions.stressed');
    expect(endingPart('Yu', decadeSummary(rows(20))!, F).key).toBe('ending.versions.renting');
  });

  it('left the cities: counted up to that quarter', () => {
    const r = rows(40).map((x, i) => (i >= 20 ? { ...x, state: { ...start, leftIn: quarterAt(20) } } : x));
    const s = decadeSummary(r)!;
    expect(s.quarters).toBe(20);
    const part = endingPart('Yu', s, F);
    expect(part.key).toBe('ending.versions.left');
    const t = textAt(STORY, part.key)!;
    expect(fillTemplate(part.key, t['zh-Hant'], part.values)).toContain('2020Q1');
  });

  it('social housing and family endings', () => {
    expect(endingPart('Yu', decadeSummary(rows(20, { ...start, tenure: 'social', socialSince: '2020Q1' }))!, F).key).toBe('ending.versions.social');
    expect(endingPart('Yu', decadeSummary(rows(0, { ...start, tenure: 'family' }))!, F).key).toBe('ending.versions.family');
  });
});
