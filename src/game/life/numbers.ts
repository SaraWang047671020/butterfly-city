// Character_Numbers (play-loop Requirement 3.1): the Character's monthly income, rent, rent burden and commute in
// one quarter. Pure: a function of the Life_State, the Wage_File, the dwelling sizes, the district rent per m² of the
// quarter (the player run's central value, or the real history for the comparison) and the commute matrix.
// Pronouns, look and `sameSexInLaw` are not read, so they change no number (Requirement 2.7).
import type { CommuteMatrix } from '../../types/simulation.ts';
import type { LifeState } from './life-state.ts';

export interface NumbersData {
  /** Industry section by occupation id (Character_File). */
  readonly industryOf: ReadonlyMap<string, string>;
  /** Wage_File earnings: industry → year → TWD per month. */
  readonly earnings: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Dwelling size in m² by household size 1 to 5 (Character_File). */
  readonly dwellingSize: ReadonlyMap<number, number>;
  readonly commute: CommuteMatrix;
}

export interface CharacterNumbers {
  readonly persons: number;
  /** m² of the household's home (0 when living with family). */
  readonly size: number;
  /** Sum of the earners' wages, TWD per month; null when a wage is missing. */
  readonly income: number | null;
  /** TWD per month; 0 when living with family; null when the district rent is missing. */
  readonly rent: number | null;
  /** Percent of income; null when income or rent is missing. */
  readonly rentBurden: number | null;
  /** One-way minutes from home to the Character's work district; null when both are the same district. */
  readonly commuteMinutes: number | null;
}

const MAX_PERSONS = 5;

/** Minutes of the commute matrix from `home` to `work`; null without a workplace or in the same district (no trip). */
export function commuteMinutes(m: CommuteMatrix, home: string, work: string | null): number | null {
  if (work === null || work === home) return null;
  const i = m.codes.indexOf(home);
  const j = m.codes.indexOf(work);
  const v = i < 0 || j < 0 ? undefined : m.minutes[i]?.[j];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function characterNumbers(s: LifeState, year: number, rentPerM2: number | null, d: NumbersData): CharacterNumbers {
  const persons = Math.min(MAX_PERSONS, s.members.length);
  const family = s.tenure === 'family';
  const size = family ? 0 : (d.dwellingSize.get(persons) ?? 0);

  let income: number | null = 0;
  for (const m of s.members) {
    if (m.occupation === null) continue;
    const industry = d.industryOf.get(m.occupation);
    const wage = industry === undefined ? undefined : d.earnings[industry]?.[String(year)];
    if (wage === undefined) {
      income = null;
      break;
    }
    income += wage;
  }

  const rent = family ? 0 : rentPerM2 === null ? null : rentPerM2 * size;
  const rentBurden = income === null || income <= 0 || rent === null ? null : (rent / income) * 100;
  const me = s.members.find((m) => m.kind === 'self');
  return { persons, size, income, rent, rentBurden, commuteMinutes: commuteMinutes(d.commute, s.home, me?.workCode ?? null) };
}
