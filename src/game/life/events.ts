// Life_Events (life-story Requirement 2, design "Life_Events and triggers"). Pure. Each trigger is a function of the
// Player_Version only (Requirement 2.2): its Life_State in the Planning_Quarter and its Personal_Ledgers of the computed
// quarters. At most one Life_Event per quarter, picked by priority; a non-forced Life_Event comes at least
// MIN_GAP quarters after the previous one and after its own cooldown.
import { quarterIndex } from '../../simulation/quarter.ts';
import type { QuarterKey } from '../../types/data-files.ts';
import { hashSeed, mulberry32 } from '../random.ts';
import type { Benefit, LifeState } from './life-state.ts';
import type { PersonalLedger } from './ledger.ts';

export const LIFE_EVENT_IDS = [
  'tenancyEnd',
  'subsidyEnds',
  'rentPressure',
  'socialHousingRound',
  'rentSubsidyWindow',
  'passLaunch',
  'leaseEnd',
  'longCommute',
  'parentCare',
  'jobOffer',
  'partner',
  'marriage',
  'child',
] as const;
export type LifeEventId = (typeof LIFE_EVENT_IDS)[number];

/** Quarters between two non-forced Life_Events (about one a year over 44 quarters, Requirement 2.3). */
export const MIN_GAP = 4;
/** The rent and commute lines of the story-layer Persona numbers. */
export const RENT_LINE = 30;
export const COMMUTE_LINE = 60;
const PASS_QUARTER: QuarterKey = '2018Q2';

/** The parts of the Life_Event_File the pick reads. */
export interface EventRule {
  readonly id: LifeEventId;
  readonly priority: number;
  readonly forced: boolean;
  readonly cooldownQuarters: number;
  readonly fromYear?: number;
}

export interface PastEvent {
  readonly quarter: QuarterKey;
  readonly event: LifeEventId;
}

export interface EventContext {
  readonly seed: number;
  /** The Planning_Quarter, where the Life_Event is asked. */
  readonly planning: QuarterKey;
  /** The Player_Version in the Planning_Quarter. */
  readonly state: LifeState;
  /** Player_Version ledgers of the computed quarters, oldest first (the last one is the Displayed_Quarter). */
  readonly ledgers: readonly PersonalLedger[];
  /** Life_Events already asked, oldest first. */
  readonly past: readonly PastEvent[];
  /** Quarter of the last move of the Player_Version (home or tenure); 2015Q1 when none. */
  readonly lastMove: QuarterKey;
  /** Quarter of the last job change; 2015Q1 when none. */
  readonly lastJobChange: QuarterKey;
  /** Quarter the partner moved in; null without a partner. */
  readonly partnerSince: QuarterKey | null;
  readonly eligible: (benefit: Benefit) => boolean;
  /** Social housing is let in the Character's city this quarter on the Player_Version (completions last quarter). */
  readonly socialRound: boolean;
  /** The social housing tenancy of the Player_Version ends after this quarter, and why. */
  readonly tenancyEnd: 'limit' | 'income' | null;
  /** The law of the Planning_Quarter allows the couple to marry (play-loop Requirement 3A.3). */
  readonly marriageAllowed: boolean;
}

const gap = (a: QuarterKey, b: QuarterKey): number => quarterIndex(b) - quarterIndex(a);
const yearOf = (q: QuarterKey): number => Number(q.slice(0, 4));

/** The last `n` ledgers all satisfy `test` (and there are at least `n`). */
function lastN(ledgers: readonly PersonalLedger[], n: number, test: (l: PersonalLedger) => boolean): boolean {
  return ledgers.length >= n && ledgers.slice(-n).every(test);
}

type Trigger = (c: EventContext) => boolean;

/** The trigger of each Life_Event, on the Player_Version only (Requirement 2.2). */
export const TRIGGERS: Readonly<Record<LifeEventId, Trigger>> = {
  tenancyEnd: (c) => c.state.tenure === 'social' && c.tenancyEnd !== null,
  subsidyEnds: (c) => c.state.tenure === 'renting' && c.state.subsidyUntil === c.planning,
  rentPressure: (c) => c.state.tenure === 'renting' && lastN(c.ledgers, 4, (l) => l.rentBurden !== null && l.rentBurden > RENT_LINE),
  socialHousingRound: (c) => c.state.tenure === 'renting' && (c.socialRound || c.planning.endsWith('Q2')) && c.eligible('socialHousing'),
  rentSubsidyWindow: (c) =>
    c.state.tenure === 'renting' && c.planning.endsWith('Q3') && c.state.subsidyUntil === undefined && c.eligible('rentSubsidy'),
  passLaunch: (c) => c.planning === PASS_QUARTER && c.state.pass !== true && (c.ledgers[c.ledgers.length - 1]?.commuteMinutes ?? null) !== null,
  leaseEnd: (c) => c.state.tenure === 'renting' && gap(c.lastMove, c.planning) >= 8,
  longCommute: (c) => lastN(c.ledgers, 4, (l) => l.commuteMinutes !== null && l.commuteMinutes > COMMUTE_LINE),
  parentCare: (c) => yearOf(c.planning) >= 2018 && !c.state.members.some((m) => m.kind === 'parent'),
  jobOffer: (c) => gap(c.lastJobChange, c.planning) >= 12,
  partner: (c) => !c.state.members.some((m) => m.kind === 'partner'),
  marriage: (c) => c.partnerSince !== null && !c.state.married && gap(c.partnerSince, c.planning) >= 4 && c.marriageAllowed,
  child: (c) => gap('2015Q1', c.planning) >= 12 && c.state.members.filter((m) => m.kind === 'child').length < 3,
};

/** Events asked only once in a game. */
const ONCE: ReadonlySet<LifeEventId> = new Set(['passLaunch', 'parentCare']);

/**
 * The Life_Event of the Planning_Quarter, or null (Requirement 2.3): the highest priority rule whose trigger holds,
 * whose cooldown has passed, and, unless forced, at least MIN_GAP quarters after the previous Life_Event. Ties of
 * priority are broken by the seed, so the same game always gives the same Life_Event.
 */
export function pickEvent(rules: readonly EventRule[], c: EventContext): LifeEventId | null {
  if (c.state.leftIn !== undefined) return null;
  if (c.past.some((p) => p.quarter === c.planning)) return null;
  const last = c.past[c.past.length - 1];
  const spaced = last === undefined || gap(last.quarter, c.planning) >= MIN_GAP;
  const due = rules.filter((r) => {
    if (r.fromYear !== undefined && yearOf(c.planning) < r.fromYear) return false;
    if (!r.forced && !spaced) return false;
    const prev = [...c.past].reverse().find((p) => p.event === r.id);
    if (prev !== undefined && (ONCE.has(r.id) || gap(prev.quarter, c.planning) < Math.max(1, r.cooldownQuarters))) return false;
    return TRIGGERS[r.id](c);
  });
  if (due.length === 0) return null;
  const top = Math.max(...due.map((r) => r.priority));
  const tied = due.filter((r) => r.priority === top);
  if (tied.length === 1) return tied[0]!.id;
  const rand = mulberry32(hashSeed(`${c.seed}:event:${c.planning}`));
  return tied[Math.floor(rand() * tied.length)]!.id;
}

/** The job offer of a `jobOffer` Life_Event: an occupation other than the current one and one of its work districts. */
export function jobOffer(
  seed: number,
  planning: QuarterKey,
  occupations: readonly { readonly id: string; readonly workCodes: readonly string[] }[],
  current: string | null,
): { readonly occupation: string; readonly workCode: string } | null {
  const others = occupations.filter((o) => o.id !== current && o.workCodes.length > 0);
  if (others.length === 0) return null;
  const rand = mulberry32(hashSeed(`${seed}:job:${planning}`));
  const o = others[Math.floor(rand() * others.length)]!;
  return { occupation: o.id, workCode: o.workCodes[Math.floor(rand() * o.workCodes.length)]! };
}
