// Life_State and Life_Timeline of the player's Character (play-loop Requirements 2, 3A). Pure. The Character is
// who the player is at the start of 2015; Life_Decisions change the household, home, tenure and jobs from the
// quarter they take effect. Pronouns, look and `sameSexInLaw` are display or legal facts and change no number.
import type { QuarterKey } from '../../types/data-files.ts';
import { quarterIndex } from '../../simulation/quarter.ts';

export type PronounId = 'she' | 'he' | 'they';

export interface Look {
  readonly body: string;
  readonly hair: string;
  readonly colour: string;
}

export interface Member {
  readonly kind: 'self' | 'partner' | 'child' | 'parent';
  /** Occupation id of the Character_File; null for a member without earnings (child, parent). */
  readonly occupation: string | null;
  readonly workCode: string | null;
  readonly pronouns: PronounId;
  readonly look: Look;
  /** Partner only: the couple is of the same sex in law (decides which marriage law applies; play-loop 3A.3). */
  readonly sameSexInLaw?: boolean;
}

export interface LifeState {
  readonly home: string; // District_Code
  readonly tenure: 'renting' | 'family';
  readonly members: readonly Member[];
  readonly married: boolean;
}

export type LifeDecision =
  | { readonly kind: 'move'; readonly home: string; readonly tenure: 'renting' | 'family' }
  | { readonly kind: 'changeJob'; readonly occupation: string; readonly workCode: string }
  | { readonly kind: 'partnerIn'; readonly partner: Omit<Member, 'kind'> }
  | { readonly kind: 'partnerOut' }
  | { readonly kind: 'marry' }
  | { readonly kind: 'childJoins'; readonly look: Look; readonly pronouns: PronounId }
  | { readonly kind: 'parentJoins'; readonly look: Look; readonly pronouns: PronounId }
  | { readonly kind: 'parentLeaves' };

export type LifeDecisionKind = LifeDecision['kind'];

export interface LifeEntry {
  readonly quarter: QuarterKey;
  readonly decision: LifeDecision;
}

export interface Character {
  readonly name: string;
  readonly origin: string; // origin id of the Character_File
  /** The Character at 2015Q1. */
  readonly start: LifeState;
}

const self = (s: LifeState): Member | undefined => s.members.find((m) => m.kind === 'self');

/** The Life_State after one decision. A decision that does not apply (for example partnerOut without a partner) changes nothing. */
export function applyDecision(s: LifeState, d: LifeDecision): LifeState {
  switch (d.kind) {
    case 'move':
      return { ...s, home: d.home, tenure: d.tenure };
    case 'changeJob': {
      const me = self(s);
      if (me === undefined) return s;
      return { ...s, members: s.members.map((m) => (m === me ? { ...m, occupation: d.occupation, workCode: d.workCode } : m)) };
    }
    case 'partnerIn':
      if (s.members.some((m) => m.kind === 'partner')) return s;
      return { ...s, members: [...s.members, { ...d.partner, kind: 'partner' }] };
    case 'partnerOut':
      return { ...s, members: s.members.filter((m) => m.kind !== 'partner'), married: false };
    case 'marry':
      return s.members.some((m) => m.kind === 'partner') ? { ...s, married: true } : s;
    case 'childJoins':
      return { ...s, members: [...s.members, { kind: 'child', occupation: null, workCode: null, pronouns: d.pronouns, look: d.look }] };
    case 'parentJoins':
      if (s.members.some((m) => m.kind === 'parent')) return s;
      return { ...s, members: [...s.members, { kind: 'parent', occupation: null, workCode: null, pronouns: d.pronouns, look: d.look }] };
    case 'parentLeaves':
      return { ...s, members: s.members.filter((m) => m.kind !== 'parent') };
  }
}

/** The Life_State of `quarter`: the start state with every entry of the Life_Timeline at or before `quarter`, in order. */
export function lifeStateAt(character: Character, timeline: readonly LifeEntry[], quarter: QuarterKey): LifeState {
  const qi = quarterIndex(quarter);
  let s = character.start;
  for (const e of timeline) if (quarterIndex(e.quarter) <= qi) s = applyDecision(s, e.decision);
  return s;
}

/** The Character's own member. */
export function selfOf(s: LifeState): Member | undefined {
  return self(s);
}
