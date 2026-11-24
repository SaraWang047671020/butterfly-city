// Life_Controller (play-loop task 5.3): Character_Numbers of the player run and of real history against a hand
// calculation, Life_Decisions never touch the game session (Requirement 3A.6), the store round trip, and the
// rejections (game complete, decision not available, living with family outside the family city).
import { describe, expect, it } from 'vitest';
import type { CharacterFiles } from '../../src/data/character-loader.ts';
import type { GameSession } from '../../src/game/core/session.ts';
import { LifeController, type CharacterStorePort } from '../../src/game/life/controller.ts';
import type { Character, LifeEntry } from '../../src/game/life/life-state.ts';
import { readCharacter, writeCharacter } from '../../src/save/character-store.ts';

const look = { body: 'a', hair: 'short', colour: 'teal' };
const character: Character = {
  name: 'Mei',
  origin: 'newtaipei',
  start: { home: '65000030', tenure: 'renting', members: [{ kind: 'self', occupation: 'nurse', workCode: '65000010', pronouns: 'she', look }], married: false },
};

const files = {
  characters: {
    origins: [{ id: 'newtaipei', familyCity: 'New Taipei' }],
    occupations: [{ id: 'nurse', industry: 'Q' }],
    dwellings: [1, 2, 3, 4, 5].map((p) => ({ persons: p, size: [20, 33, 50, 66, 80][p - 1]! })),
    legal: [{ id: 'same-sex-marriage', from: '2019Q2' }],
  },
  wages: { earnings: { Q: { '2015': 50_000 } } },
  homeRent: { schemaVersion: 1, bands: [{ id: 'all', maxArea: null }], premium: {} },
} as unknown as CharacterFiles;

/** A session with two computed quarters; the player rent of Zhonghe is 650 in 2015Q2 (real history: 600). */
function session(next: string = '2015Q3'): GameSession {
  const range = (v: number) => ({ min: v, central: v, max: v });
  return {
    next,
    commute: { codes: ['65000030', '65000010'], minutes: [[0, 38], [38, 0]] },
    computed: {
      central: [{ quarter: '2015Q1' }, { quarter: '2015Q2' }],
      ranges: [
        { quarter: '2015Q1', ranges: { rent: { '65000030': range(600) } } },
        { quarter: '2015Q2', ranges: { rent: { '65000030': range(650) } } },
      ],
    },
  } as unknown as GameSession;
}

function memoryStore(): CharacterStorePort & { saved: unknown } {
  const box: { saved: unknown } & CharacterStorePort = {
    saved: null,
    read: () => null,
    write(r) {
      box.saved = r;
      return true;
    },
  };
  return box;
}

const make = (s: GameSession, store = memoryStore()) =>
  new LifeController({
    files,
    session: () => s,
    subscribeGame: () => () => undefined,
    historyRent: () => 600,
    cityOf: (code) => (code.startsWith('63') ? 'Taipei' : 'New Taipei'),
    store,
  });

describe('LifeController', () => {
  it('computes the player and real numbers of the Displayed_Quarter by hand', () => {
    const lc = make(session());
    lc.createCharacter(character);
    const v = lc.view()!;
    expect(v.quarter).toBe('2015Q2');
    expect(v.numbers.player.rent).toBe(650 * 20); // 13,000 → 26% of 50,000
    expect(v.numbers.player.rentBurden).toBe(26);
    expect(v.numbers.real.rentBurden).toBe(24); // 600 × 20 = 12,000
    expect(v.numbers.previous?.rentBurden).toBe(24); // 2015Q1 player rent 600
    expect(v.numbers.player.commuteMinutes).toBe(38);
  });

  it('adds a decision in the Planning_Quarter and never changes the game session', () => {
    const s = session();
    const before = JSON.stringify(s);
    const lc = make(s);
    lc.createCharacter(character);
    expect(lc.applyLife({ kind: 'move', home: '65000010', tenure: 'renting' })).toEqual({ ok: true });
    expect(lc.view()!.timeline).toEqual([{ quarter: '2015Q3', decision: { kind: 'move', home: '65000010', tenure: 'renting' } }]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('previews the numbers with and without a decision', () => {
    const lc = make(session());
    lc.createCharacter(character);
    const p = lc.previewLife({ kind: 'move', home: '65000030', tenure: 'family' })!;
    expect(p.with.rent).toBe(0);
    expect(p.without.rent).toBe(650 * 20);
  });

  it('rejects a decision when the game is complete, not available, or family outside the family city', () => {
    const done = make(session('complete'));
    done.createCharacter(character);
    expect(done.applyLife({ kind: 'marry' })).toEqual({ ok: false, reason: 'complete' });
    const lc = make(session());
    lc.createCharacter(character);
    expect(lc.applyLife({ kind: 'marry' })).toEqual({ ok: false, reason: 'unavailable' });
    expect(lc.applyLife({ kind: 'move', home: '63000020', tenure: 'family' })).toEqual({ ok: false, reason: 'family-city' });
  });
});

describe('Character_Store', () => {
  it('round-trips the record and ignores a broken value', () => {
    const mem = new Map<string, string>();
    const port = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const timeline: LifeEntry[] = [{ quarter: '2016Q1', decision: { kind: 'marry' } }];
    const choices = [{ quarter: '2016Q1', event: 'marriage', option: 'marry' }];
    expect(writeCharacter(port, { character, timeline, guideDone: true, seed: 42, choices })).toBe(true);
    expect(readCharacter(port)).toEqual({ schemaVersion: 2, character, timeline, guideDone: true, seed: 42, choices });
    // A version 1 record (play-loop) is read with no seed and no choices.
    mem.set('butterflycity.character.v1', JSON.stringify({ schemaVersion: 1, character, timeline, guideDone: false }));
    expect(readCharacter(port)).toEqual({ schemaVersion: 2, character, timeline, guideDone: false, seed: null, choices: [] });
    mem.set('butterflycity.character.v1', '{"schemaVersion":1,"character":null,"timeline":[]}');
    expect(readCharacter(port)).toBeNull();
    expect(readCharacter(null)).toBeNull();
  });
});
