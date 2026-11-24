// Life_State, availability and Character_Numbers (play-loop Requirements 11.2, 11.2a).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { availability, familyTenureAllowed } from '../../src/game/life/availability.ts';
import { applyDecision, lifeStateAt, type Character, type LifeDecision, type LifeEntry, type LifeState, type Look, type Member, type PronounId } from '../../src/game/life/life-state.ts';
import { characterNumbers, commuteMinutes, type NumbersData } from '../../src/game/life/numbers.ts';
import type { QuarterKey } from '../../src/types/data-files.ts';

const look: Look = { body: 'a', hair: 'short', colour: 'teal' };
const me = (occupation: string | null = 'nurse', workCode: string | null = '65000010'): Member => ({ kind: 'self', occupation, workCode, pronouns: 'she', look });
const start = (over: Partial<LifeState> = {}): LifeState => ({ home: '65000030', tenure: 'renting', members: [me()], married: false, ...over });
const character: Character = { name: 'Mei', origin: 'newtaipei', start: start() };

const data: NumbersData = {
  industryOf: new Map([
    ['nurse', 'Q'],
    ['retail', 'G'],
  ]),
  earnings: { Q: { '2015': 50_000, '2016': 51_000 }, G: { '2015': 40_000, '2016': 41_000 } },
  dwellingSize: new Map([
    [1, 20],
    [2, 33],
    [3, 50],
    [4, 66],
    [5, 80],
  ]),
  commute: { codes: ['65000030', '65000010'], minutes: [[0, 38], [38, 0]] },
};
const LEGAL = [{ id: 'same-sex-marriage', from: '2019Q2' as QuarterKey }];

describe('characterNumbers', () => {
  it('matches a hand calculation for a renter', () => {
    const n = characterNumbers(start(), 2015, 600, data);
    // rent 600 TWD per m² × 20 m² = 12,000; income 50,000; burden 24%; Zhonghe → Banqiao 38 minutes
    expect(n).toEqual({ persons: 1, size: 20, income: 50_000, rent: 12_000, rentBurden: 24, commuteMinutes: 38 });
  });

  it('pays no rent while living with family', () => {
    const n = characterNumbers(start({ tenure: 'family' }), 2015, 600, data);
    expect(n.rent).toBe(0);
    expect(n.rentBurden).toBe(0);
  });

  it('adds the partner as an earner and sizes the home for the household', () => {
    const s = applyDecision(start(), { kind: 'partnerIn', partner: { occupation: 'retail', workCode: '63000020', pronouns: 'he', look } });
    const n = characterNumbers(s, 2016, 600, data);
    expect(n.income).toBe(92_000);
    expect(n.rent).toBe(600 * 33);
  });

  it('gives no burden when a wage year is missing', () => {
    expect(characterNumbers(start(), 2030, 600, data).rentBurden).toBeNull();
  });

  it('has no trip when home and work are the same district', () => {
    expect(commuteMinutes(data.commute, '65000030', '65000030')).toBeNull();
  });

  it('pronouns, look and sameSexInLaw change no number (property)', () => {
    const pronoun = fc.constantFrom<PronounId>('she', 'he', 'they');
    const lk = fc.record({ body: fc.string(), hair: fc.string(), colour: fc.string() });
    fc.assert(
      fc.property(pronoun, lk, pronoun, lk, fc.boolean(), fc.integer({ min: 100, max: 2000 }), (p1, l1, p2, l2, same, rent) => {
        const a: LifeState = { ...start(), members: [{ ...me(), pronouns: p1, look: l1 }, { kind: 'partner', occupation: 'retail', workCode: '63000020', pronouns: p2, look: l2, sameSexInLaw: same }] };
        const b: LifeState = { ...start(), members: [me(), { kind: 'partner', occupation: 'retail', workCode: '63000020', pronouns: 'he', look, sameSexInLaw: false }] };
        expect(characterNumbers(a, 2015, rent, data)).toEqual(characterNumbers(b, 2015, rent, data));
      }),
    );
  });
});

describe('lifeStateAt', () => {
  const entries: LifeEntry[] = [
    { quarter: '2016Q1', decision: { kind: 'partnerIn', partner: { occupation: 'retail', workCode: '63000020', pronouns: 'they', look } } },
    { quarter: '2017Q3', decision: { kind: 'marry' } },
    { quarter: '2018Q2', decision: { kind: 'partnerOut' } },
  ];

  it('applies the entries up to the quarter, in order', () => {
    expect(lifeStateAt(character, entries, '2015Q4').members).toHaveLength(1);
    expect(lifeStateAt(character, entries, '2017Q3').married).toBe(true);
    const after = lifeStateAt(character, entries, '2018Q2');
    expect(after.members).toHaveLength(1);
    expect(after.married).toBe(false); // partnerOut clears the marriage
  });

  it('equals applying the decisions one by one (property)', () => {
    const decision = fc.constantFrom<LifeDecision>(
      { kind: 'move', home: '63000030', tenure: 'renting' },
      { kind: 'changeJob', occupation: 'retail', workCode: '63000020' },
      { kind: 'partnerIn', partner: { occupation: 'nurse', workCode: '65000010', pronouns: 'she', look } },
      { kind: 'partnerOut' },
      { kind: 'marry' },
      { kind: 'childJoins', look, pronouns: 'they' },
      { kind: 'parentJoins', look, pronouns: 'he' },
      { kind: 'parentLeaves' },
    );
    fc.assert(
      fc.property(fc.array(decision, { maxLength: 12 }), (ds) => {
        const tl: LifeEntry[] = ds.map((d, i) => ({ quarter: `${2015 + Math.floor(i / 4)}Q${(i % 4) + 1}` as QuarterKey, decision: d }));
        const folded = ds.reduce((st, d, i) => applyDecision(st, d, tl[i]!.quarter), character.start);
        expect(lifeStateAt(character, tl, '2025Q4')).toEqual(folded);
      }),
    );
  });
});

describe('availability', () => {
  const withPartner = (sameSexInLaw: boolean): LifeState =>
    applyDecision(start(), { kind: 'partnerIn', partner: { occupation: 'retail', workCode: '63000020', pronouns: 'they', look, sameSexInLaw } });
  const marry = (s: LifeState, q: QuarterKey) => availability(s, q, LEGAL).find((a) => a.kind === 'marry');

  it('makes same-sex marriage unavailable in 2019Q1 and available from 2019Q2', () => {
    expect(marry(withPartner(true), '2019Q1')).toEqual({ kind: 'marry', ok: false, reason: 'legal', legalId: 'same-sex-marriage' });
    expect(marry(withPartner(true), '2019Q2')).toEqual({ kind: 'marry', ok: true });
  });

  it('never blocks a different-sex marriage by date', () => {
    expect(marry(withPartner(false), '2015Q1')).toEqual({ kind: 'marry', ok: true });
  });

  it('needs a partner to marry or to move out, and allows one parent', () => {
    const a = availability(start(), '2015Q1', LEGAL);
    expect(a.find((x) => x.kind === 'marry')).toMatchObject({ ok: false, reason: 'noPartner' });
    expect(a.find((x) => x.kind === 'partnerOut')).toMatchObject({ ok: false, reason: 'noPartner' });
    const withParent = applyDecision(start(), { kind: 'parentJoins', look, pronouns: 'she' });
    expect(availability(withParent, '2015Q1', LEGAL).find((x) => x.kind === 'parentJoins')).toMatchObject({ ok: false, reason: 'hasParent' });
  });

  it('allows living with family only in the family city', () => {
    expect(familyTenureAllowed('Taipei', 'Taipei')).toBe(true);
    expect(familyTenureAllowed('Taipei', 'New Taipei')).toBe(false);
    expect(familyTenureAllowed(null, 'Taipei')).toBe(false);
  });
});
