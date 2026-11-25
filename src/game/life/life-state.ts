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
  /** `social`: living in social housing (life-story Requirement 3.4), on one track only. */
  readonly tenure: 'renting' | 'family' | 'social' | 'sublease';
  readonly members: readonly Member[];
  readonly married: boolean;
  /** life-story: the quarter the household moved into social housing (tenure `social` only). */
  readonly socialSince?: QuarterKey;
  /** housing-tools: the quarter the household moved into a sublease home (tenure `sublease` only). */
  readonly subleaseSince?: QuarterKey;
  /** life-story: the household receives the rent subsidy up to and including this quarter. */
  readonly subsidyUntil?: QuarterKey;
  /** life-story: the quarter of the marriage (newlywed multiplier of the rent subsidy). */
  readonly marriedIn?: QuarterKey;
  /** life-story: the Character buys the monthly commuter pass. */
  readonly pass?: boolean;
  /** life-story: the quarter the Character left Taipei and New Taipei (the story ends). */
  readonly leftIn?: QuarterKey;
}

/** The decisions of the "My life" dialog (play-loop Requirement 3A.2). */
export type MyLifeDecision =
  | { readonly kind: 'move'; readonly home: string; readonly tenure: 'renting' | 'family' }
  | { readonly kind: 'changeJob'; readonly occupation: string; readonly workCode: string }
  | { readonly kind: 'partnerIn'; readonly partner: Omit<Member, 'kind'> }
  | { readonly kind: 'partnerOut' }
  | { readonly kind: 'marry' }
  | { readonly kind: 'childJoins'; readonly look: Look; readonly pronouns: PronounId }
  | { readonly kind: 'parentJoins'; readonly look: Look; readonly pronouns: PronounId }
  | { readonly kind: 'parentLeaves' };

export type Benefit = 'socialHousing' | 'rentSubsidy' | 'sublease';

export const BENEFITS: readonly Benefit[] = ['socialHousing', 'rentSubsidy', 'sublease'];

/** The Benefit named by a Life_Event option (`effect.benefit`); social housing when it names none. */
export const benefitOf = (x: unknown): Benefit => (x === 'rentSubsidy' || x === 'sublease' ? x : 'socialHousing');

/**
 * Decisions of the life-story spec. `apply`, `buyPass` and `leave` come from Life_Events and apply to both tracks;
 * `apply` changes nothing by itself: its outcome is decided per track (applications.ts), and a success adds
 * `enterSocial` or `subsidy` to that track's timeline from the next quarter (tracks.ts).
 */
export type StoryDecision =
  | { readonly kind: 'apply'; readonly benefit: Benefit }
  | { readonly kind: 'buyPass' }
  | { readonly kind: 'leave' }
  | { readonly kind: 'enterSocial'; readonly home: string }
  | { readonly kind: 'enterSublease'; readonly home: string }
  | { readonly kind: 'subsidy'; readonly until: QuarterKey };

export type LifeDecision = MyLifeDecision | StoryDecision;

/** Kinds of the "My life" dialog. */
export type LifeDecisionKind = MyLifeDecision['kind'];

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

/** A move or leaving the cities ends social housing and the rent subsidy (life-story design, "Life_Events"). */
function withoutBenefits(s: LifeState): LifeState {
  const { socialSince: _social, subsidyUntil: _subsidy, subleaseSince: _sublease, ...rest } = s;
  return rest;
}

/** The Life_State after one decision in `quarter`. A decision that does not apply (for example partnerOut without a partner) changes nothing. */
export function applyDecision(s: LifeState, d: LifeDecision, quarter?: QuarterKey): LifeState {
  switch (d.kind) {
    case 'move':
      return { ...withoutBenefits(s), home: d.home, tenure: d.tenure };
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
      if (!s.members.some((m) => m.kind === 'partner')) return s;
      return quarter === undefined ? { ...s, married: true } : { ...s, married: true, marriedIn: quarter };
    case 'childJoins':
      return { ...s, members: [...s.members, { kind: 'child', occupation: null, workCode: null, pronouns: d.pronouns, look: d.look }] };
    case 'parentJoins':
      if (s.members.some((m) => m.kind === 'parent')) return s;
      return { ...s, members: [...s.members, { kind: 'parent', occupation: null, workCode: null, pronouns: d.pronouns, look: d.look }] };
    case 'parentLeaves':
      return { ...s, members: s.members.filter((m) => m.kind !== 'parent') };
    case 'apply':
      return s;
    case 'buyPass':
      return { ...s, pass: true };
    case 'leave':
      return quarter === undefined ? withoutBenefits(s) : { ...withoutBenefits(s), leftIn: quarter };
    case 'enterSocial':
      if (s.tenure === 'social') return s;
      return { ...withoutBenefits(s), home: d.home, tenure: 'social', ...(quarter === undefined ? {} : { socialSince: quarter }) };
    case 'enterSublease':
      if (s.tenure !== 'renting') return s;
      return { ...withoutBenefits(s), home: d.home, tenure: 'sublease', ...(quarter === undefined ? {} : { subleaseSince: quarter }) };
    case 'subsidy':
      return s.tenure === 'renting' ? { ...s, subsidyUntil: d.until } : s;
  }
}

/** The Life_State of `quarter`: the start state with every entry of the Life_Timeline at or before `quarter`, in order. */
export function lifeStateAt(character: Character, timeline: readonly LifeEntry[], quarter: QuarterKey): LifeState {
  const qi = quarterIndex(quarter);
  let s = character.start;
  for (const e of timeline) if (quarterIndex(e.quarter) <= qi) s = applyDecision(s, e.decision, e.quarter);
  return s;
}

/** The Character's own member. */
export function selfOf(s: LifeState): Member | undefined {
  return self(s);
}
