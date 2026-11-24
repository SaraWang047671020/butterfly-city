// Life_Controller (play-loop Requirements 2, 3, 3A): the player's Character next to the Game_Controller. It reads the
// game session (Displayed_Quarter, Planning_Quarter, the player run's rent) and keeps the Character, the Life_Timeline
// and the guide flag in the Character_Store. It never changes the session, an Engine input or the Save (3A.6).
// Deviation from the design (which put these actions on the Game_Controller): a separate controller keeps the
// game-ui controller and its UiActions unchanged.
import type { CharacterFiles } from '../../data/character-loader.ts';
import { quarterIndex } from '../../simulation/quarter.ts';
import type { QuarterKey } from '../../types/data-files.ts';
import type { GameSession } from '../core/session.ts';
import { availability, familyTenureAllowed, type Availability } from './availability.ts';
import { applyDecision, lifeStateAt, type Character, type LifeDecision, type LifeEntry, type LifeState } from './life-state.ts';
import { characterNumbers, type CharacterNumbers, type NumbersData } from './numbers.ts';

/** Persistence of the Character record (src/save/character-store.ts through main.ts). */
export interface CharacterStorePort {
  read(): { readonly character: unknown; readonly timeline: readonly unknown[]; readonly guideDone: boolean } | null;
  /** `character` null forgets the Character and its Life_Timeline. */
  write(record: { readonly character: Character | null; readonly timeline: readonly LifeEntry[]; readonly guideDone: boolean }): boolean;
}

export interface LifeControllerDeps {
  readonly files: CharacterFiles;
  readonly session: () => Readonly<GameSession> | null;
  readonly subscribeGame: (listener: () => void) => () => void;
  /** Real history rent per m² of a district in quarter index `qi` (history.json); null when missing. */
  readonly historyRent: (code: string, qi: number) => number | null;
  /** City of a district ("Taipei", "New Taipei"). */
  readonly cityOf: (code: string) => string | null;
  readonly store: CharacterStorePort;
}

export interface CharacterView {
  readonly character: Character;
  /** Quarter the shown numbers belong to: the Displayed_Quarter, or 2015Q1 before any quarter is computed. */
  readonly quarter: QuarterKey;
  readonly computed: boolean;
  /** Quarter a Life_Decision takes effect; null when the game is complete. */
  readonly planning: QuarterKey | null;
  /** Life_State of the shown quarter and of the Planning_Quarter. */
  readonly life: LifeState;
  readonly planningLife: LifeState;
  readonly numbers: { readonly player: CharacterNumbers; readonly real: CharacterNumbers; readonly previous: CharacterNumbers | null };
  readonly available: readonly Availability[];
  readonly timeline: readonly LifeEntry[];
  readonly guideDone: boolean;
}

export type ApplyLifeResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'no-character' | 'complete' | 'unavailable' | 'family-city' };

const yearOf = (q: QuarterKey): number => Number(q.slice(0, 4));

export class LifeController {
  private character: Character | null = null;
  private timeline: LifeEntry[] = [];
  private guide = false;
  private readonly listeners = new Set<(view: CharacterView | null) => void>();
  private readonly data: Omit<NumbersData, 'commute'>;
  private readonly deps: LifeControllerDeps;

  constructor(deps: LifeControllerDeps) {
    this.deps = deps;
    const f = deps.files;
    this.data = {
      industryOf: new Map(f.characters.occupations.map((o) => [o.id, o.industry])),
      earnings: f.wages.earnings,
      dwellingSize: new Map(f.characters.dwellings.map((d) => [d.persons, d.size])),
    };
    const stored = deps.store.read();
    if (stored !== null) {
      // Shape was checked by the store; the game layer trusts its own records.
      this.character = stored.character as Character;
      this.timeline = [...(stored.timeline as LifeEntry[])];
      this.guide = stored.guideDone;
    }
    deps.subscribeGame(() => this.publish());
  }

  subscribe(listener: (view: CharacterView | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  hasCharacter(): boolean {
    return this.character !== null;
  }

  /** A new Character replaces the old one and its Life_Timeline (a new game, Requirement 2.1). */
  createCharacter(c: Character): void {
    this.character = c;
    this.timeline = [];
    this.persist();
    this.publish();
  }

  /** Forgets the Character (the next new game asks again). The guide flag is kept. */
  clearCharacter(): void {
    this.character = null;
    this.timeline = [];
    this.persist();
    this.publish();
  }

  setGuideDone(): void {
    this.guide = true;
    this.persist();
    this.publish();
  }

  guideDone(): boolean {
    return this.guide;
  }

  /** Character_Numbers of a start state in 2015Q1 with real history rent (Character_Creation, Requirement 2.8). */
  previewStart(start: LifeState): CharacterNumbers {
    return this.numbersOf(start, 2015, this.deps.historyRent(start.home, 0));
  }

  /** Character_Numbers of the Planning_Quarter with and without a decision (Requirement 3A.5); null when none applies. */
  previewLife(decision: LifeDecision): { readonly with: CharacterNumbers; readonly without: CharacterNumbers } | null {
    const v = this.view();
    if (v === null || v.planning === null) return null;
    const rent = (code: string) => this.rentAt(code, v.quarter, 'player');
    const year = yearOf(v.planning);
    const after = applyDecision(v.planningLife, decision);
    return { with: this.numbersOf(after, year, rent(after.home)), without: this.numbersOf(v.planningLife, year, rent(v.planningLife.home)) };
  }

  /** Adds a Life_Decision in the Planning_Quarter (Requirement 3A.4). */
  applyLife(decision: LifeDecision): ApplyLifeResult {
    const v = this.view();
    if (v === null || this.character === null) return { ok: false, reason: 'no-character' };
    if (v.planning === null) return { ok: false, reason: 'complete' };
    const a = v.available.find((x) => x.kind === decision.kind);
    if (a === undefined || !a.ok) return { ok: false, reason: 'unavailable' };
    if (decision.kind === 'move' && decision.tenure === 'family') {
      const origin = this.deps.files.characters.origins.find((o) => o.id === this.character?.origin);
      if (!familyTenureAllowed(origin?.familyCity ?? null, this.deps.cityOf(decision.home) ?? '')) return { ok: false, reason: 'family-city' };
    }
    this.timeline.push({ quarter: v.planning, decision });
    this.persist();
    this.publish();
    return { ok: true };
  }

  view(): CharacterView | null {
    const c = this.character;
    if (c === null) return null;
    const s = this.deps.session();
    const states = s?.computed?.central ?? [];
    const last = states[states.length - 1];
    const quarter: QuarterKey = last?.quarter ?? '2015Q1';
    const computed = last !== undefined;
    const planning: QuarterKey | null = s === null ? '2015Q1' : s.next === 'complete' ? null : s.next;
    const life = lifeStateAt(c, this.timeline, quarter);
    const planningLife = planning === null ? life : lifeStateAt(c, this.timeline, planning);
    const year = yearOf(quarter);
    const player = this.numbersOf(life, year, this.rentAt(life.home, quarter, computed ? 'player' : 'real'));
    const real = this.numbersOf(life, year, this.rentAt(life.home, quarter, 'real'));
    let previous: CharacterNumbers | null = null;
    const prevState = states[states.length - 2];
    if (prevState !== undefined) {
      const pl = lifeStateAt(c, this.timeline, prevState.quarter);
      previous = this.numbersOf(pl, yearOf(prevState.quarter), this.rentAt(pl.home, prevState.quarter, 'player'));
    }
    const legal = this.deps.files.characters.legal;
    return {
      character: c,
      quarter,
      computed,
      planning,
      life,
      planningLife,
      numbers: { player, real, previous },
      available: planning === null ? [] : availability(planningLife, planning, legal),
      timeline: [...this.timeline],
      guideDone: this.guide,
    };
  }

  private numbersOf(life: LifeState, year: number, rentPerM2: number | null): CharacterNumbers {
    const commute = this.deps.session()?.commute ?? { codes: [], minutes: [] };
    return characterNumbers(life, year, rentPerM2, { ...this.data, commute });
  }

  /** Rent per m² of a district: the central player value of a computed quarter, or real history. */
  private rentAt(code: string, quarter: QuarterKey, which: 'player' | 'real'): number | null {
    const qi = quarterIndex(quarter);
    if (which === 'player') {
      const ranges = this.deps.session()?.computed?.ranges.find((r) => r.quarter === quarter);
      const v = ranges?.ranges['rent']?.[code]?.central;
      if (typeof v === 'number') return v;
    }
    return this.deps.historyRent(code, qi);
  }

  private persist(): void {
    this.deps.store.write({ character: this.character, timeline: this.timeline, guideDone: this.guide });
  }

  private publish(): void {
    const v = this.view();
    for (const l of [...this.listeners]) l(v);
  }
}
