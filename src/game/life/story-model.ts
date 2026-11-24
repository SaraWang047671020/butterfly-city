// The story model of the Character (life-story tasks 4.1): the two tracks, the Personal_Ledger of each computed
// quarter, the pending Life_Event with what each option does to both versions, the inputs of the Story_Lines and the
// Ending. Pure: everything comes from the Character, the seed, the timeline, the choices and a WorldPort that the
// LifeController builds from the game session and the Data_Files (Requirement 7.2).
import { quarterAt, quarterIndex } from '../../simulation/quarter.ts';
import type { QuarterKey } from '../../types/data-files.ts';
import type { EventOption, LifeEventDef } from '../../data/life-text-loader.ts';
import {
  eligibility,
  realOdds,
  subsidyMultiplier,
  tenancyEnds,
  tenancyQuarters,
  trackOdds,
  valueAtYear,
  incomeMultiple,
  type ApplicationSupply,
  type City,
  type Eligibility,
  type Household,
  type Track,
} from './applications.ts';
import { jobOffer, pickEvent, type LifeEventId, type PastEvent } from './events.ts';
import { personalLedger, type PersonalLedger } from './ledger.ts';
import { applyDecision, type Benefit, type Character, type LifeDecision, type LifeEntry, type LifeState, type Look, type Member, type PronounId } from './life-state.ts';
import type { CharacterNumbers } from './numbers.ts';
import type { DecadeRow, DecadeSummary, QuarterStoryInput } from './story.ts';
import { decadeSummary } from './story.ts';
import { resolveTracks, TRACKS, type ApplicationOutcome, type ResolvedTracks, type SupplyView } from './tracks.ts';

/** What the story model reads from the game: built by the LifeController from the session and the Data_Files. */
export interface WorldPort {
  /** Computed quarters, oldest first. */
  readonly computed: readonly QuarterKey[];
  /** The Planning_Quarter; null when the game is complete. */
  readonly planning: QuarterKey | null;
  /** Character_Numbers of a state in a quarter on a track (a quarter not computed yet uses the last computed one). */
  numbers(state: LifeState, quarter: QuarterKey, track: Track): CharacterNumbers;
  /** Social housing completions and stock of a district in quarter index `qi` on a track. */
  social(code: string, qi: number, track: Track): { readonly completions: number; readonly stock: number };
  districtsOf(city: City): readonly string[];
  /** A Policy_Tool value of a city in a quarter on a track (the player's timeline or the Real_Policy_Track). */
  policy(tool: 'rentSubsidy' | 'commuterPass', field: string, city: City, quarter: QuarterKey, track: Track): number | null;
  /** The commuter pass price of a city in a quarter (Parameter_Table); null or 0 when none is sold. */
  passPrice(city: City, quarter: QuarterKey): number | null;
  cityOf(code: string): City | null;
  /** The law of the quarter allows this household to marry (play-loop 3A.3). */
  marriageAllowed(state: LifeState, quarter: QuarterKey): boolean;
  /** The origin's family city (living with family is allowed there only). */
  readonly familyCity: string | null;
  readonly occupations: readonly { readonly id: string; readonly workCodes: readonly string[] }[];
}

export interface StoryChoice {
  readonly quarter: QuarterKey;
  readonly event: LifeEventId;
  readonly option: string;
}

export interface StoryInputs {
  readonly character: Character;
  readonly timeline: readonly LifeEntry[];
  readonly choices: readonly StoryChoice[];
  readonly seed: number;
  readonly supply: ApplicationSupply;
  readonly events: readonly LifeEventDef[];
  readonly world: WorldPort;
}

export type OptionBlock = 'ineligible' | 'family' | 'law';

export interface OptionView {
  readonly id: string;
  readonly option: EventOption;
  readonly available: boolean;
  readonly block: OptionBlock | null;
  readonly eligibility: Eligibility | null;
  /** Both versions in the Planning_Quarter with this option (null WHEN the option needs a choice of district, job or partner). */
  readonly preview: Readonly<Record<Track, PersonalLedger>> | null;
  /** For an Application: the odds and the supply of each track. */
  readonly odds: { readonly benefit: Benefit; readonly odds: Readonly<Record<Track, number>>; readonly supply: Readonly<Record<Track, number>> } | null;
}

/** Facts the Life_Event texts are filled with (the UI formats them). */
export interface EventFacts {
  readonly district: string;
  readonly work: string | null;
  readonly city: City | null;
  readonly rentBurden: number | null;
  readonly commute: number | null;
  readonly incomeYear: number | null;
  readonly incomePerPerson: number | null;
  /** The income limit of the relevant benefit (social housing: per year; rent subsidy: per person per month). */
  readonly limit: number | null;
  /** Years in social housing (tenancyEnd) or together (marriage). */
  readonly years: number | null;
  readonly reason: 'limit' | 'income' | null;
  readonly subsidyAmount: number | null;
  readonly offer: { readonly occupation: string; readonly workCode: string } | null;
}

export interface PendingEvent {
  readonly quarter: QuarterKey;
  readonly event: LifeEventDef;
  readonly facts: EventFacts;
  readonly options: readonly OptionView[];
}

export interface StoryModel {
  readonly resolved: ResolvedTracks;
  readonly rows: Readonly<Record<Track, readonly DecadeRow[]>>;
  readonly inputs: readonly Omit<QuarterStoryInput, 'name'>[];
  readonly pending: PendingEvent | null;
  readonly ending: Readonly<Record<Track, DecadeSummary>> | null;
}

/** Extra input of an option that needs one: a district, a job, a partner or the look of a new household member. */
export interface ChoicePayload {
  readonly home?: string;
  readonly occupation?: string;
  readonly workCode?: string;
  readonly partner?: Omit<Member, 'kind'>;
  readonly look?: Look;
  readonly pronouns?: PronounId;
}

const prevQ = (q: QuarterKey): number => quarterIndex(q) - 1;
const self = (s: LifeState) => s.members.find((m) => m.kind === 'self');

function supplyView(i: StoryInputs): SupplyView {
  const w = i.world;
  const turnover = i.supply.socialHousing.turnoverQuarters;
  const shSupply = (city: City, qi: number, t: Track): number => {
    if (qi < 0) return 0;
    let total = 0;
    for (const code of w.districtsOf(city)) {
      const s = w.social(code, qi, t);
      total += Math.max(0, s.completions) + Math.max(0, s.stock) / turnover;
    }
    return total;
  };
  const rsSupply = (city: City, q: QuarterKey, t: Track): number => w.policy('rentSubsidy', 'households', city, q, t) ?? 0;
  const means = new Map<string, number>();
  return {
    supply: (b, city, q, t) => (b === 'socialHousing' ? shSupply(city, prevQ(q), t) : rsSupply(city, q, t)),
    meanSupplyReal(b, city) {
      const key = `${b}:${city}`;
      let m = means.get(key);
      if (m === undefined) {
        let total = 0;
        for (let k = 0; k < 44; k++) total += b === 'socialHousing' ? shSupply(city, k - 1, 'real') : rsSupply(city, quarterAt(k), 'real');
        m = total / 44;
        means.set(key, m);
      }
      return m;
    },
    socialDistrict(city, q, t) {
      const qi = prevQ(q);
      const codes = [...w.districtsOf(city)].sort();
      let best = codes[0] ?? '';
      let bestScore = -1;
      for (const code of codes) {
        const s = w.social(code, Math.max(0, qi), t);
        const score = s.completions > 0 ? 1e9 + s.completions : s.stock;
        if (score > bestScore) {
          best = code;
          bestScore = score;
        }
      }
      return best;
    },
  };
}

function ledgerOf(i: StoryInputs, state: LifeState, q: QuarterKey, t: Track): PersonalLedger {
  const w = i.world;
  const city = w.cityOf(state.home);
  const price = city === null ? null : w.passPrice(city, q);
  const sub = city === null ? null : (w.policy('commuterPass', 'subsidy', city, q, t) ?? 0);
  return personalLedger({
    state,
    quarter: q,
    numbers: w.numbers(state, q, t),
    city,
    supply: i.supply,
    subsidyAmount: city === null ? null : w.policy('rentSubsidy', 'amount', city, q, t),
    passNet: price === null || price <= 0 ? null : price - (sub ?? 0),
  });
}

function household(i: StoryInputs, state: LifeState, q: QuarterKey): Household | null {
  const city = i.world.cityOf(state.home);
  if (city === null) return null;
  return { city, incomeMonth: i.world.numbers(state, q, 'player').income, persons: state.members.length, state };
}

function lastOf(timeline: readonly LifeEntry[], before: QuarterKey, kinds: readonly LifeDecision['kind'][]): LifeEntry | undefined {
  const qi = quarterIndex(before);
  return [...timeline].reverse().find((e) => quarterIndex(e.quarter) <= qi && kinds.includes(e.decision.kind));
}

/** The decisions of an option with its payload; null WHEN the payload it needs is missing. */
export function decisionsOf(option: EventOption, state: LifeState, payload: ChoicePayload, offer: EventFacts['offer']): LifeDecision[] | null {
  const e = option.effect;
  const tenure = e['tenure'] === 'family' ? 'family' : 'renting';
  switch (e.kind) {
    case 'none':
      return [];
    case 'move':
      if (e['sameDistrict'] === true) return [{ kind: 'move', home: state.home, tenure: 'renting' }];
      return payload.home === undefined ? null : [{ kind: 'move', home: payload.home, tenure }];
    case 'pickMove':
      return payload.home === undefined ? null : [{ kind: 'move', home: payload.home, tenure }];
    case 'pickJob':
      return payload.occupation === undefined || payload.workCode === undefined ? null : [{ kind: 'changeJob', occupation: payload.occupation, workCode: payload.workCode }];
    case 'changeJob':
      return offer === null ? null : [{ kind: 'changeJob', occupation: offer.occupation, workCode: offer.workCode }];
    case 'apply':
      return [{ kind: 'apply', benefit: e['benefit'] === 'rentSubsidy' ? 'rentSubsidy' : 'socialHousing' }];
    case 'buyPass':
      return [{ kind: 'buyPass' }];
    case 'leave':
      return [{ kind: 'leave' }];
    case 'marry':
      return [{ kind: 'marry' }];
    case 'parentJoins':
      return [{ kind: 'parentJoins', look: payload.look ?? self(state)?.look ?? { body: 'b', hair: 'short', colour: 'slate' }, pronouns: payload.pronouns ?? 'they' }];
    case 'childJoins':
      return [{ kind: 'childJoins', look: payload.look ?? self(state)?.look ?? { body: 'b', hair: 'short', colour: 'teal' }, pronouns: payload.pronouns ?? 'they' }];
    case 'partnerEditor':
      return payload.partner === undefined ? null : [{ kind: 'partnerIn', partner: payload.partner }];
  }
}

/** Whether an option needs input from the player before it can be chosen. */
export const needsPayload = (o: EventOption): boolean =>
  o.effect.kind === 'pickMove' || o.effect.kind === 'pickJob' || o.effect.kind === 'partnerEditor' || (o.effect.kind === 'move' && o.effect['sameDistrict'] !== true);

export function buildStoryModel(i: StoryInputs): StoryModel {
  const w = i.world;
  const resolved = resolveTracks(i.character, i.timeline, {
    supply: i.supply,
    view: supplyView(i),
    seed: i.seed,
    cityOf: w.cityOf,
    incomeMonth: (state, q) => w.numbers(state, q, 'player').income,
  });
  const stateAt = (t: Track, q: QuarterKey): LifeState => {
    const qi = quarterIndex(q);
    let s = i.character.start;
    for (const e of resolved.timelines[t]) if (quarterIndex(e.quarter) <= qi) s = applyDecision(s, e.decision, e.quarter);
    return s;
  };

  const rows: Record<Track, DecadeRow[]> = { player: [], real: [] };
  for (const q of w.computed) for (const t of TRACKS) rows[t].push({ quarter: q, state: stateAt(t, q), ledger: ledgerOf(i, stateAt(t, q), q, t) });

  const inputs = w.computed.map((q, k) => {
    const states = { player: rows.player[k]!.state, real: rows.real[k]!.state };
    const ledgers = { player: rows.player[k]!.ledger, real: rows.real[k]!.ledger };
    const choice = i.choices.find((c) => c.quarter === q) ?? null;
    const outcome: ApplicationOutcome | null = resolved.outcomes.find((o) => o.quarter === q) ?? null;
    const amount = (t: Track): number | null => {
      if (outcome === null || outcome.benefit !== 'rentSubsidy') return null;
      const a = w.policy('rentSubsidy', 'amount', outcome.city, q, t);
      return a === null ? null : a * subsidyMultiplier(i.supply, states[t], q);
    };
    const city = w.cityOf(states.player.home);
    return {
      quarter: q,
      first: k === 0,
      states,
      ledgers,
      choice: choice === null ? null : { event: choice.event, option: choice.option },
      outcome,
      subsidyAmounts: { player: amount('player'), real: amount('real') },
      rentShare: states.player.tenure === 'social' && city !== null ? i.supply.socialHousing.rentShare[city] : null,
      size: w.numbers(states.player, q, 'player').size,
    };
  });

  const playerLeft = rows.player.some((r) => r.state.leftIn !== undefined);
  const complete = w.planning === null || playerLeft;
  const ending = complete && rows.player.length > 0 ? { player: decadeSummary(rows.player)!, real: decadeSummary(rows.real)! } : null;

  return { resolved, rows, inputs, pending: complete ? null : pendingEvent(i, resolved, rows.player, stateAt), ending };
}

function pendingEvent(
  i: StoryInputs,
  resolved: ResolvedTracks,
  playerRows: readonly DecadeRow[],
  stateAt: (t: Track, q: QuarterKey) => LifeState,
): PendingEvent | null {
  const w = i.world;
  const planning = w.planning;
  if (planning === null || w.computed.length === 0) return null;
  const state = stateAt('player', planning);
  const h = household(i, state, planning);
  const eligible = (b: Benefit): boolean => h !== null && eligibility(i.supply, b, h, planning).ok;
  const city = h?.city ?? null;
  const shown = w.computed[w.computed.length - 1]!;
  const socialRound =
    city !== null && w.districtsOf(city).some((code) => w.social(code, quarterIndex(shown), 'player').completions > 0);
  const playerTimeline = resolved.timelines.player;
  const partnerEntry = lastOf(playerTimeline, planning, ['partnerIn']);
  const past: PastEvent[] = i.choices.map((c) => ({ quarter: c.quarter, event: c.event }));
  const ended = h === null ? null : tenancyEnds(i.supply, h, planning);
  const id = pickEvent(i.events, {
    seed: i.seed,
    planning,
    state,
    ledgers: playerRows.map((r) => r.ledger),
    past,
    lastMove: lastOf(playerTimeline, planning, ['move', 'enterSocial'])?.quarter ?? '2015Q1',
    lastJobChange: lastOf(playerTimeline, planning, ['changeJob'])?.quarter ?? '2015Q1',
    partnerSince: state.members.some((m) => m.kind === 'partner') ? (partnerEntry?.quarter ?? '2015Q1') : null,
    eligible,
    socialRound,
    tenancyEnd: ended,
    marriageAllowed: w.marriageAllowed(state, planning),
  });
  if (id === null) return null;
  const event = i.events.find((e) => e.id === id)!;
  const me = self(state);
  const offer = id === 'jobOffer' ? jobOffer(i.seed, planning, w.occupations, me?.occupation ?? null) : null;
  const year = Number(planning.slice(0, 4));
  const last = playerRows[playerRows.length - 1]?.ledger;
  const numbers = w.numbers(state, planning, 'player');
  const limit =
    city === null
      ? null
      : id === 'rentSubsidyWindow' || id === 'subsidyEnds'
        ? incomeMultiple(i.supply, planning) * (valueAtYear(i.supply.rentSubsidy.minimumLivingExpense[city], year) ?? 0)
        : valueAtYear(i.supply.socialHousing.incomeLimit[city], year);
  const tq = tenancyQuarters(state, planning);
  const facts: EventFacts = {
    district: state.home,
    work: me?.workCode ?? null,
    city,
    rentBurden: last?.rentBurden ?? null,
    commute: last?.commuteMinutes ?? null,
    incomeYear: numbers.income === null ? null : numbers.income * 12,
    incomePerPerson: numbers.income === null ? null : numbers.income / Math.max(1, state.members.length),
    limit,
    years: id === 'marriage' && partnerEntry !== undefined ? Math.floor((quarterIndex(planning) - quarterIndex(partnerEntry.quarter)) / 4) : tq === null ? null : Math.round((tq + 1) / 4),
    reason: ended,
    subsidyAmount: city === null ? null : w.policy('rentSubsidy', 'amount', city, planning, 'player'),
    offer,
  };

  const previewOf = (decisions: readonly LifeDecision[]): Record<Track, PersonalLedger> => {
    const out = {} as Record<Track, PersonalLedger>;
    for (const t of TRACKS) {
      let s = stateAt(t, planning);
      for (const d of decisions) s = applyDecision(s, d, planning);
      out[t] = ledgerOf(i, s, planning, t);
    }
    return out;
  };
  const view = supplyView(i);
  const options: OptionView[] = event.options.map((option) => {
    let block: OptionBlock | null = null;
    let elig: Eligibility | null = null;
    const e = option.effect;
    if (e.kind === 'apply') {
      const b: Benefit = e['benefit'] === 'rentSubsidy' ? 'rentSubsidy' : 'socialHousing';
      const asRenter = h === null ? null : { ...h, state: { ...state, tenure: 'renting' as const } };
      elig = asRenter === null ? { ok: false, rule: 'noIncome' } : eligibility(i.supply, b, asRenter, planning);
      if (!elig.ok) block = 'ineligible';
    }
    if (e['tenure'] === 'family' && (w.familyCity === null || city === null || w.familyCity !== city)) block = 'family';
    if (e.kind === 'marry' && !w.marriageAllowed(state, planning)) block = 'law';
    const decisions = needsPayload(option) ? null : decisionsOf(option, state, {}, offer);
    let odds: OptionView['odds'] = null;
    if (e.kind === 'apply' && city !== null) {
      const b: Benefit = e['benefit'] === 'rentSubsidy' ? 'rentSubsidy' : 'socialHousing';
      const supply = { player: view.supply(b, city, planning, 'player'), real: view.supply(b, city, planning, 'real') };
      const real = realOdds(i.supply, b, city, year);
      const mean = view.meanSupplyReal(b, city);
      odds = { benefit: b, supply, odds: { player: trackOdds(real, supply.player, supply.real, mean), real: trackOdds(real, supply.real, supply.real, mean) } };
    }
    return {
      id: option.id,
      option,
      available: block === null,
      block,
      eligibility: elig,
      preview: decisions === null ? null : previewOf(decisions),
      odds,
    };
  });
  return { quarter: planning, event, facts, options };
}

/** Both versions in the Planning_Quarter with a set of decisions (the move and job pickers of a Life_Event). */
export function previewDecisions(i: StoryInputs, decisions: readonly LifeDecision[]): Record<Track, PersonalLedger> | null {
  const planning = i.world.planning;
  if (planning === null) return null;
  const resolved = resolveTracks(i.character, i.timeline, {
    supply: i.supply,
    view: supplyView(i),
    seed: i.seed,
    cityOf: i.world.cityOf,
    incomeMonth: (state, q) => i.world.numbers(state, q, 'player').income,
  });
  const out = {} as Record<Track, PersonalLedger>;
  for (const t of TRACKS) {
    const qi = quarterIndex(planning);
    let s = i.character.start;
    for (const e of resolved.timelines[t]) if (quarterIndex(e.quarter) <= qi) s = applyDecision(s, e.decision, e.quarter);
    for (const d of decisions) s = applyDecision(s, d, planning);
    out[t] = ledgerOf(i, s, planning, t);
  }
  return out;
}
