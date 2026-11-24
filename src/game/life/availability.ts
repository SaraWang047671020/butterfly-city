// Which Life_Decisions the player can make in the Planning_Quarter (play-loop Requirement 3A.2, 3A.3). Pure.
// The legal rule: marriage of a couple of the same sex in law is available from the `from` quarter of the
// `same-sex-marriage` legal fact of the Character_File (2019Q2, in force 2019-05-24); before it the dialog shows the
// legal fact in place of the action. Pronouns never decide this (a Character or a partner may use "they").
import type { QuarterKey } from '../../types/data-files.ts';
import { quarterIndex } from '../../simulation/quarter.ts';
import type { LifeDecisionKind, LifeState } from './life-state.ts';

export const MAX_CHILDREN = 3;
export const SAME_SEX_MARRIAGE = 'same-sex-marriage';

export type UnavailableReason = 'noPartner' | 'hasPartner' | 'married' | 'maxChildren' | 'noParent' | 'hasParent' | 'legal';

export type Availability =
  | { readonly kind: LifeDecisionKind; readonly ok: true }
  | { readonly kind: LifeDecisionKind; readonly ok: false; readonly reason: UnavailableReason; readonly legalId?: string };

export const DECISION_ORDER: readonly LifeDecisionKind[] = ['move', 'changeJob', 'partnerIn', 'partnerOut', 'marry', 'childJoins', 'parentJoins', 'parentLeaves'];

/** The availability of every Life_Decision, in DECISION_ORDER. */
export function availability(s: LifeState, planning: QuarterKey, legal: readonly { readonly id: string; readonly from: QuarterKey }[]): Availability[] {
  const partner = s.members.find((m) => m.kind === 'partner');
  const children = s.members.filter((m) => m.kind === 'child').length;
  const parent = s.members.some((m) => m.kind === 'parent');
  const ok = (kind: LifeDecisionKind): Availability => ({ kind, ok: true });
  const no = (kind: LifeDecisionKind, reason: UnavailableReason, legalId?: string): Availability =>
    legalId === undefined ? { kind, ok: false, reason } : { kind, ok: false, reason, legalId };
  return DECISION_ORDER.map((kind) => {
    switch (kind) {
      case 'move':
      case 'changeJob':
        return ok(kind);
      case 'partnerIn':
        return partner === undefined ? ok(kind) : no(kind, 'hasPartner');
      case 'partnerOut':
        return partner !== undefined ? ok(kind) : no(kind, 'noPartner');
      case 'marry': {
        if (partner === undefined) return no(kind, 'noPartner');
        if (s.married) return no(kind, 'married');
        if (partner.sameSexInLaw === true) {
          const fact = legal.find((l) => l.id === SAME_SEX_MARRIAGE);
          if (fact === undefined || quarterIndex(planning) < quarterIndex(fact.from)) return no(kind, 'legal', SAME_SEX_MARRIAGE);
        }
        return ok(kind);
      }
      case 'childJoins':
        return children < MAX_CHILDREN ? ok(kind) : no(kind, 'maxChildren');
      case 'parentJoins':
        return parent ? no(kind, 'hasParent') : ok(kind);
      case 'parentLeaves':
        return parent ? ok(kind) : no(kind, 'noParent');
    }
  });
}

/** Whether the tenure "living with family" is allowed in a district of `city` for an origin with `familyCity`. */
export function familyTenureAllowed(familyCity: string | null, city: string): boolean {
  return familyCity !== null && familyCity === city;
}
