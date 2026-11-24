// Life_Controller (play-loop Requirements 2, 3, 3A): the player's Character next to the Game_Controller. It reads the
// game session (Displayed_Quarter, Planning_Quarter, the player run's rent) and keeps the Character, the Life_Timeline
// and the guide flag in the Character_Store. It never changes the session, an Engine input or the Save (3A.6).
// Deviation from the design (which put these actions on the Game_Controller): a separate controller keeps the
// game-ui controller and its UiActions unchanged.
import { homePremiumOf, type CharacterFiles } from '../../data/character-loader.ts';
import type { LifeEventFile } from '../../data/life-text-loader.ts';
import { quarterIndex } from '../../simulation/quarter.ts';
import type { QuarterKey } from '../../types/data-files.ts';
import type { AreaKey } from '../../types/simulation.ts';
import { playerValue, realValue } from '../core/policy.ts';
import type { GameSession } from '../core/session.ts';
import { hashSeed } from '../random.ts';
import type { ApplicationSupply, City, Track } from './applications.ts';
import { availability, familyTenureAllowed, type Availability } from './availability.ts';
import type { LifeEventId } from './events.ts';
import type { PersonalLedger } from './ledger.ts';
import { applyDecision, lifeStateAt, type Character, type LifeDecision, type LifeEntry, type LifeState, type MyLifeDecision } from './life-state.ts';
import { characterNumbers, type CharacterNumbers, type NumbersData } from './numbers.ts';
import {
  buildStoryModel,
  decisionsOf,
  previewDecisions,
  type ChoicePayload,
  type StoryChoice,
  type StoryInputs,
  type StoryModel,
  type WorldPort,
} from './story-model.ts';

/** Persistence of the Character record (src/save/character-store.ts through main.ts). */
export interface CharacterStorePort {
  read(): {
    readonly character: unknown;
    readonly timeline: readonly unknown[];
    readonly guideDone: boolean;
    readonly seed?: number | null;
    readonly choices?: readonly unknown[];
  } | null;
  /** `character` null forgets the Character and its Life_Timeline. */
  write(record: {
    readonly character: Character | null;
    readonly timeline: readonly LifeEntry[];
    readonly guideDone: boolean;
    readonly seed: number | null;
    readonly choices: readonly StoryChoice[];
  }): boolean;
}

/** The life-story Data_Files and history (life-story task 4.1); null when they did not load: no Life_Events, no story. */
export interface StoryDeps {
  readonly supply: ApplicationSupply;
  readonly events: LifeEventFile;
  /** Real social housing completions and stock of a district in quarter index `qi` (history.json); null when missing. */
  readonly historySocial: (code: string, qi: number) => { readonly completions: number | null; readonly stock: number | null };
}

export type ChooseResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'no-event' | 'unavailable' | 'payload' };

export interface LifeControllerDeps {
  readonly files: CharacterFiles;
  readonly session: () => Readonly<GameSession> | null;
  readonly subscribeGame: (listener: () => void) => () => void;
  /** Real history rent per m² of a district in quarter index `qi` (history.json); null when missing. */
  readonly historyRent: (code: string, qi: number) => number | null;
  /** City of a district ("Taipei", "New Taipei"). */
  readonly cityOf: (code: string) => string | null;
  readonly store: CharacterStorePort;
  readonly story?: StoryDeps | null;
  /** A new seed for a new Character (tests pass a fixed one). */
  readonly newSeed?: () => number;
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
  /** The life story (life-story spec); null without the story files. */
  readonly story: StoryModel | null;
}

export type ApplyLifeResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'no-character' | 'complete' | 'unavailable' | 'family-city' };

const yearOf = (q: QuarterKey): number => Number(q.slice(0, 4));

export class LifeController {
  private character: Character | null = null;
  private timeline: LifeEntry[] = [];
  private guide = false;
  private seed: number | null = null;
  private choices: StoryChoice[] = [];
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
      homePremium: homePremiumOf(f.homeRent),
    };
    const stored = deps.store.read();
    if (stored !== null) {
      // Shape was checked by the store; the game layer trusts its own records.
      this.character = stored.character as Character;
      this.timeline = [...(stored.timeline as LifeEntry[])];
      this.guide = stored.guideDone;
      this.seed = stored.seed ?? null;
      this.choices = [...((stored.choices ?? []) as StoryChoice[])];
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
    this.choices = [];
    this.seed = (this.deps.newSeed ?? (() => Math.floor(Math.random() * 2 ** 31)))();
    this.persist();
    this.publish();
  }

  /** Forgets the Character (the next new game asks again). The guide flag is kept. */
  clearCharacter(): void {
    this.character = null;
    this.timeline = [];
    this.choices = [];
    this.seed = null;
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
  applyLife(decision: MyLifeDecision): ApplyLifeResult {
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
      story: s === null ? null : this.storyModel(s),
    };
  }

  /** The seed of the story: the stored one, or, for a record of version 1, one derived from the Character. */
  private storySeed(): number {
    return this.seed ?? hashSeed(JSON.stringify(this.character));
  }

  private storyInputs(s: Readonly<GameSession>): StoryInputs | null {
    const story = this.deps.story;
    const c = this.character;
    if (story == null || c === null) return null;
    return {
      character: c,
      timeline: this.timeline,
      choices: this.choices,
      seed: this.storySeed(),
      supply: story.supply,
      events: story.events.events,
      world: this.world(s, story),
    };
  }

  private storyModel(s: Readonly<GameSession>): StoryModel | null {
    const i = this.storyInputs(s);
    return i === null ? null : buildStoryModel(i);
  }

  /** Whether a Life_Event is triggered for the Planning_Quarter of `s` (Fast-forward stops, life-story 7.3). */
  lifeEventAhead(s: Readonly<GameSession>): boolean {
    if (this.character === null) return false;
    return this.storyModel(s)?.pending != null;
  }

  /** Both versions in the Planning_Quarter with these decisions (the pickers of a Life_Event). */
  previewChoice(decisions: readonly LifeDecision[]): Readonly<Record<Track, PersonalLedger>> | null {
    const s = this.deps.session();
    const i = s === null ? null : this.storyInputs(s);
    return i === null ? null : previewDecisions(i, decisions);
  }

  /** Answers the pending Life_Event (life-story Requirement 2.6): its decisions and the choice are kept. */
  choose(event: LifeEventId, option: string, payload: ChoicePayload = {}): ChooseResult {
    const s = this.deps.session();
    const model = s === null ? null : this.storyModel(s);
    const pending = model?.pending ?? null;
    if (pending === null || pending.event.id !== event) return { ok: false, reason: 'no-event' };
    const o = pending.options.find((x) => x.id === option);
    if (o === undefined || !o.available) return { ok: false, reason: 'unavailable' };
    const state = lifeStateAt(this.character!, this.timeline, pending.quarter);
    const decisions = decisionsOf(o.option, state, payload, pending.facts.offer);
    if (decisions === null) return { ok: false, reason: 'payload' };
    for (const decision of decisions) this.timeline.push({ quarter: pending.quarter, decision });
    this.choices.push({ quarter: pending.quarter, event, option });
    this.persist();
    this.publish();
    return { ok: true };
  }

  private world(s: Readonly<GameSession>, story: StoryDeps): WorldPort {
    const computed = (s.computed?.central ?? []).map((c) => c.quarter);
    const planning: QuarterKey | null = s.next === 'complete' ? null : s.next;
    const last = computed[computed.length - 1] ?? null;
    const rangesAt = (q: QuarterKey) => s.computed?.ranges.find((r) => r.quarter === q)?.ranges;
    const playerStock = (code: string, qi: number): number | null => {
      const q = computed[qi];
      const v = q === undefined ? undefined : rangesAt(q)?.['socialHousingStock']?.[code]?.central;
      return typeof v === 'number' ? v : null;
    };
    const cityByCode = new Map((s.baseline?.districts ?? []).map((d) => [d.code, d.city as City]));
    const origin = this.deps.files.characters.origins.find((o) => o.id === this.character?.origin);
    return {
      computed,
      planning,
      numbers: (state, q, t) => {
        const qq = computed.includes(q) || last === null ? q : last;
        return this.numbersOf(state, Number(q.slice(0, 4)), this.rentAt(state.home, qq, t === 'player' && last !== null ? 'player' : 'real'));
      },
      social: (code, qi, t) => {
        const real = story.historySocial(code, qi);
        const realOut = { completions: real.completions ?? 0, stock: real.stock ?? 0 };
        if (t === 'real' || qi >= computed.length) return realOut;
        const now = playerStock(code, qi);
        if (now === null) return realOut;
        const before = qi === 0 ? (story.historySocial(code, -1).stock ?? now - realOut.completions) : playerStock(code, qi - 1);
        return { completions: Math.max(0, now - (before ?? now)), stock: now };
      },
      districtsOf: (city) => (s.baseline?.districts ?? []).filter((d) => d.city === city).map((d) => d.code),
      policy: (tool, field, city, q, t) => {
        const target = { tool, field, area: city as AreaKey };
        return t === 'player' ? playerValue(s.realTrack, s.diffs, target, q) : realValue(s.realTrack, target, q);
      },
      passPrice: (city, q) => {
        const p = s.params?.[`commuterPass.price.${city}.${q}`];
        return p !== undefined && p.kind === 'scalar' ? p.value : null;
      },
      cityOf: (code) => cityByCode.get(code) ?? (this.deps.cityOf(code) as City | null),
      marriageAllowed: (state, q) => availability(state, q, this.deps.files.characters.legal).find((a) => a.kind === 'marry')?.ok === true,
      familyCity: origin?.familyCity ?? null,
      occupations: this.deps.files.characters.occupations.map((o) => ({ id: o.id, workCodes: o.workCodes })),
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
    this.deps.store.write({
      character: this.character,
      timeline: this.timeline,
      guideDone: this.guide,
      seed: this.character === null ? null : this.storySeed(),
      choices: this.choices,
    });
  }

  private publish(): void {
    const v = this.view();
    for (const l of [...this.listeners]) l(v);
  }
}
