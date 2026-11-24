// Personal_Ledger (life-story Requirement 4.1): the Character's monthly money in one quarter on one track. Pure.
// income − rent (after the rent subsidy, or at the social housing rent) − transport (the commuter pass after its
// subsidy, WHEN the Character buys one and a pass is sold) = money left. Later specs add lines (Requirement 4.6).
import { quarterIndex } from '../../simulation/quarter.ts';
import type { QuarterKey } from '../../types/data-files.ts';
import { subsidyMultiplier, type ApplicationSupply, type City } from './applications.ts';
import type { LifeState } from './life-state.ts';
import type { CharacterNumbers } from './numbers.ts';

export interface LedgerInputs {
  readonly state: LifeState;
  readonly quarter: QuarterKey;
  /** Character_Numbers of the state on this track: income and the market rent of the home. */
  readonly numbers: CharacterNumbers;
  readonly city: City | null;
  readonly supply: ApplicationSupply;
  /** The track's rent subsidy amount per household of the city, TWD per month; null when missing. */
  readonly subsidyAmount: number | null;
  /** The track's commuter pass price minus its subsidy, TWD per month; null or 0 when no pass is sold. */
  readonly passNet: number | null;
}

export interface PersonalLedger {
  readonly housing: LifeState['tenure'];
  readonly income: number | null;
  /** Market rent of the home (play-loop Requirement 3.1). */
  readonly marketRent: number | null;
  /** Rent subsidy received this month (0 without one). */
  readonly subsidy: number;
  /** Rent paid. */
  readonly rent: number | null;
  readonly rentBurden: number | null;
  /** Null when the Character has no pass or no pass is sold (single fares are not modelled). */
  readonly transport: number | null;
  readonly left: number | null;
  readonly commuteMinutes: number | null;
}

/** Whether the household receives the rent subsidy in `quarter`. */
export const subsidyActive = (s: LifeState, quarter: QuarterKey): boolean =>
  s.tenure === 'renting' && s.subsidyUntil !== undefined && quarterIndex(quarter) <= quarterIndex(s.subsidyUntil);

export function personalLedger(i: LedgerInputs): PersonalLedger {
  const { state, numbers } = i;
  const market = numbers.rent;
  let rent: number | null;
  let subsidy = 0;
  if (state.tenure === 'family') rent = 0;
  else if (market === null) rent = null;
  else if (state.tenure === 'social') rent = market * (i.city === null ? 1 : i.supply.socialHousing.rentShare[i.city]);
  else {
    if (subsidyActive(state, i.quarter) && i.subsidyAmount !== null) {
      subsidy = Math.min(market, i.subsidyAmount * subsidyMultiplier(i.supply, state, i.quarter));
    }
    rent = market - subsidy;
  }
  const transport = state.pass === true && i.passNet !== null && i.passNet > 0 ? i.passNet : null;
  const income = numbers.income;
  const left = income === null || rent === null ? null : income - rent - (transport ?? 0);
  const rentBurden = income === null || income <= 0 || rent === null ? null : (rent / income) * 100;
  return { housing: state.tenure, income, marketRent: market, subsidy, rent, rentBurden, transport, left, commuteMinutes: numbers.commuteMinutes };
}
