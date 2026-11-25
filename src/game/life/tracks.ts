// The two versions of the Character (life-story design, "Overview"): the Player_Version and the Real_Version share
// the Life_Timeline (every choice applies to both) and differ only in the outcome of Applications. This module
// resolves the Applications of a timeline and gives each track its own timeline: the shared entries plus, after a
// success on that track, `enterSocial` or `subsidy` from the next quarter. Pure.
import { nextQuarter, quarterIndex } from '../../simulation/quarter.ts';
import type { QuarterKey } from '../../types/data-files.ts';
import {
  eligibility,
  realOdds,
  sharedDraw,
  subsidyUntil,
  succeeds,
  trackOdds,
  type ApplicationSupply,
  type City,
  type Eligibility,
  type Track,
} from './applications.ts';
import { lifeStateAt, type Benefit, type Character, type LifeEntry, type LifeState } from './life-state.ts';

export const TRACKS: readonly Track[] = ['player', 'real'];

/** The supply each track gives an Application: from the Engine (player) or from history and the policy track (real). */
export interface SupplyView {
  /** Social housing units let, or rent subsidy households, in `city` in `quarter` on `track`. */
  supply(benefit: Benefit, city: City, quarter: QuarterKey, track: Track): number;
  /** Mean quarterly real supply of the city over the game (used WHEN the real supply of the quarter is 0). */
  meanSupplyReal(benefit: Benefit, city: City): number;
  /** The district of `city` where a new sublease tenant moves on `track` (seeded, weighted by the homes of the city). */
  subleaseDistrict(city: City, quarter: QuarterKey, track: Track): string;
  /** The district of `city` where a new social housing tenant moves on `track` (most completions in `quarter`). */
  socialDistrict(city: City, quarter: QuarterKey, track: Track): string;
}

export interface TrackContext {
  readonly supply: ApplicationSupply;
  readonly view: SupplyView;
  readonly seed: number;
  readonly cityOf: (code: string) => City | null;
  /** Household income per month in `quarter` (play-loop Requirement 3.1); null when a wage is missing. */
  readonly incomeMonth: (state: LifeState, quarter: QuarterKey) => number | null;
}

export interface ApplicationOutcome {
  readonly quarter: QuarterKey;
  readonly benefit: Benefit;
  readonly city: City;
  readonly eligibility: Eligibility;
  readonly draw: number;
  readonly odds: Readonly<Record<Track, number>>;
  readonly supply: Readonly<Record<Track, number>>;
  readonly success: Readonly<Record<Track, boolean>>;
  /** Social housing and sublease: the district each track moves to on success. */
  readonly home: Readonly<Record<Track, string | null>>;
}

export interface ResolvedTracks {
  readonly outcomes: readonly ApplicationOutcome[];
  readonly timelines: Readonly<Record<Track, readonly LifeEntry[]>>;
}

/** Resolves every `apply` entry of the timeline, in order, and builds the timeline of each track. */
export function resolveTracks(character: Character, timeline: readonly LifeEntry[], ctx: TrackContext): ResolvedTracks {
  const outcomes: ApplicationOutcome[] = [];
  const timelines: Record<Track, LifeEntry[]> = { player: [], real: [] };
  const ordered = [...timeline].sort((a, b) => quarterIndex(a.quarter) - quarterIndex(b.quarter));
  for (const entry of ordered) {
    for (const t of TRACKS) timelines[t].push(entry);
    const d = entry.decision;
    if (d.kind !== 'apply') continue;
    const q = entry.quarter;
    const states = {
      player: lifeStateAt(character, timelines.player, q),
      real: lifeStateAt(character, timelines.real, q),
    };
    // Eligibility and the city come from the Player_Version (Requirement 2.2: a Life_Event reads the Player_Version).
    const city = ctx.cityOf(states.player.home);
    if (city === null) continue;
    const me = states.player;
    const elig = eligibility(ctx.supply, d.benefit, { city, incomeMonth: ctx.incomeMonth(me, q), persons: me.members.length, state: me }, q);
    const year = Number(q.slice(0, 4));
    const real = realOdds(ctx.supply, d.benefit, city, year);
    const supply = {
      player: ctx.view.supply(d.benefit, city, q, 'player'),
      real: ctx.view.supply(d.benefit, city, q, 'real'),
    };
    const mean = ctx.view.meanSupplyReal(d.benefit, city);
    const odds = {
      player: trackOdds(real, supply.player, supply.real, mean),
      real: trackOdds(real, supply.real, supply.real, mean),
    };
    const draw = sharedDraw(ctx.seed, d.benefit, q);
    const success = { player: false, real: false };
    const home: Record<Track, string | null> = { player: null, real: null };
    for (const t of TRACKS) {
      const s = states[t];
      // A track that already has the benefit, or a household that is not eligible, gains nothing.
      const open = d.benefit === 'socialHousing' ? s.tenure !== 'social' : s.tenure === 'renting';
      success[t] = elig.ok && open && succeeds(draw, odds[t]);
      if (!success[t]) continue;
      const from = nextQuarter(q);
      if (d.benefit === 'socialHousing') {
        home[t] = ctx.view.socialDistrict(city, q, t);
        timelines[t].push({ quarter: from, decision: { kind: 'enterSocial', home: home[t]! } });
      } else if (d.benefit === 'sublease') {
        home[t] = ctx.view.subleaseDistrict(city, q, t);
        timelines[t].push({ quarter: from, decision: { kind: 'enterSublease', home: home[t]! } });
      } else {
        timelines[t].push({ quarter: from, decision: { kind: 'subsidy', until: subsidyUntil(from) } });
      }
    }
    outcomes.push({ quarter: q, benefit: d.benefit, city, eligibility: elig, draw, odds, supply, success, home });
  }
  return { outcomes, timelines };
}

/** The Life_State of a track in `quarter`. */
export function trackState(character: Character, resolved: ResolvedTracks, track: Track, quarter: QuarterKey): LifeState {
  return lifeStateAt(character, resolved.timelines[track], quarter);
}
