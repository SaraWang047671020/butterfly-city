// Story_Facts for one Persona and the Displayed_Quarter (story-layer Requirement 4, task 4). Implemented by Claude Code.
// Numbers come from the Engine run of the player (Result_Ranges) and from the Real_Policy_Track, which by the
// zero-delta identity equals the real history rent. The formula lives in src/simulation/persona.ts.
import type { CitizenFile, IncomeSpread, Persona } from '../data/story-loader.ts';
import type { StoryState } from '../narrative/select.ts';
import { personaRentBurden } from '../simulation/persona.ts';
import type { CommuteMatrix, ParameterTable, QuarterRanges, ResultRange } from '../types/simulation.ts';
import type { QuarterKey } from '../types/data-files.ts';

export interface StoryInputs {
  readonly persona: Persona;
  readonly citizens: CitizenFile;
  readonly spread: IncomeSpread;
  readonly params: ParameterTable;
  readonly commute: CommuteMatrix;
  /** History value of an indicator for a district and quarter index (rent, householdIncome); null when missing. */
  readonly history: (indicator: 'rent' | 'householdIncome', code: string, qi: number) => number | null;
  /** Result_Ranges of the player run, one entry per computed quarter from 2015Q1. */
  readonly ranges: readonly QuarterRanges[];
  /** Index of the Displayed_Quarter in `ranges`. */
  readonly displayed: number;
  readonly quarters: readonly QuarterKey[];
  /** Number formatting of game-ui Requirement 6.10 (en-US, given decimals). */
  readonly format: (x: number, decimals: number) => string;
}

export interface StoryFacts {
  readonly state: StoryState;
  /** Formatted Story_Values; an absent key means "no value" (Requirement 4.8). */
  readonly values: Readonly<Record<string, string>>;
  /** Ending values, only when all 44 quarters are computed (Requirement 4.6). */
  readonly endingValues: Readonly<Record<string, string>> | null;
}

const PERCENT_DECIMALS = 1;
const MINUTE_DECIMALS = 0;

function scalar(params: ParameterTable, id: string): { value: number; low: number | null } | null {
  const p = params[id];
  if (p === undefined || p.kind !== 'scalar') return null;
  return { value: p.value, low: p.range?.low ?? null };
}

function commuteMinutes(m: CommuteMatrix, home: string, work: string | null): number | null {
  if (work === null) return null;
  const i = m.codes.indexOf(home);
  const j = m.codes.indexOf(work);
  const v = i < 0 || j < 0 ? undefined : m.minutes[i]?.[j];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function buildStoryFacts(x: StoryInputs): StoryFacts | null {
  const p = x.persona;
  const sigma = x.spread.sigma[p.homeCode];
  const rentGhost = scalar(x.params, 'ghost.rentThreshold');
  const commuteGhost = scalar(x.params, 'ghost.commuteThreshold');
  const ghostSize = scalar(x.params, 'ghost.size');
  const rentRisk = x.citizens.thresholds.rentRisk.value;
  const month = x.citizens.thresholds.commuteMonth;
  if (x.displayed < 0 || x.displayed >= x.ranges.length) return null;

  const burdenAt = (rentPerM2: number | null, qi: number): number | null => {
    const income = x.history('householdIncome', p.homeCode, qi);
    if (rentPerM2 === null || income === null || income <= 0 || sigma === undefined) return null;
    return personaRentBurden({ rentPerM2, dwellingSize: p.dwellingSize, householdIncome: income, sigma, incomePercentile: p.incomePercentile });
  };
  const playerRange = (qi: number): ResultRange | null => {
    const r = x.ranges[qi]?.ranges['rent']?.[p.homeCode];
    if (r === undefined) return null;
    const min = burdenAt(r.min, qi);
    const central = burdenAt(r.central, qi);
    const max = burdenAt(r.max, qi);
    return min === null || central === null || max === null ? null : { min: Math.min(min, max), central, max: Math.max(min, max) };
  };
  const realBurden = (qi: number): number | null => burdenAt(x.history('rent', p.homeCode, qi), qi);

  const minutes = commuteMinutes(x.commute, p.homeCode, p.workCode);
  const ghostAt = (burden: number | null): boolean =>
    (burden !== null && rentGhost !== null && burden > rentGhost.value) || (minutes !== null && commuteGhost !== null && minutes > commuteGhost.value);

  const qi = x.displayed;
  const now = playerRange(qi);
  const real = realBurden(qi);
  const f = x.format;
  const values: Record<string, string> = { name: p.name, homeDistrict: p.homeDistrict, rentRiskThreshold: f(rentRisk, 0) };
  if (p.workDistrict !== null) values['workDistrict'] = p.workDistrict;
  if (rentGhost !== null) values['rentGhostThreshold'] = f(rentGhost.value, 0);
  if (commuteGhost !== null) values['commuteGhostThreshold'] = f(commuteGhost.value, 0);
  if (commuteGhost?.low !== null && commuteGhost?.low !== undefined) values['commuteRiskThreshold'] = f(commuteGhost.low, 0);
  if (ghostSize !== null) values['ghostSize'] = f(ghostSize.value, 0);
  if (now !== null) {
    values['rentBurden'] = f(now.central, PERCENT_DECIMALS);
    values['rentBurdenLow'] = f(now.min, PERCENT_DECIMALS);
    values['rentBurdenHigh'] = f(now.max, PERCENT_DECIMALS);
  }
  if (real !== null) values['rentBurdenReal'] = f(real, PERCENT_DECIMALS);
  if (now !== null && real !== null) values['rentBurdenDiff'] = f(Math.abs(now.central - real), PERCENT_DECIMALS);
  if (minutes !== null) {
    values['commuteMinutes'] = f(minutes, MINUTE_DECIMALS);
    values['commuteHoursMonth'] = f((minutes * month.tripsPerDay * month.workdaysPerMonth) / 60, 0);
  }

  // Ghost crossing of the real history, first quarter at or before the Displayed_Quarter.
  let realFirst: number | null = null;
  for (let i = 0; i <= qi; i++) {
    if (ghostAt(realBurden(i))) {
      realFirst = i;
      break;
    }
  }
  if (realFirst !== null) values['realQuarter'] = x.quarters[realFirst] ?? '';

  const centralNow = now?.central ?? null;
  const ghostNow = ghostAt(centralNow);
  const ghostBefore = qi > 0 ? ghostAt(playerRange(qi - 1)?.central ?? null) : ghostNow;
  const sameText = now !== null && real !== null && f(now.central, PERCENT_DECIMALS) === f(real, PERCENT_DECIMALS);
  const state: StoryState = {
    rent:
      centralNow !== null && rentGhost !== null && centralNow > rentGhost.value ? 'ghost' : centralNow !== null && centralNow > rentRisk ? 'atRisk' : 'below',
    commute:
      p.workCode === null
        ? 'none'
        : minutes !== null && commuteGhost !== null && minutes > commuteGhost.value
          ? 'ghost'
          : minutes !== null && commuteGhost?.low != null && minutes > commuteGhost.low
            ? 'atRisk'
            : 'below',
    comparison: sameText || now === null || real === null ? 'same' : now.central < real ? 'lower' : 'higher',
    showRange: now !== null && f(now.min, PERCENT_DECIMALS) !== f(now.max, PERCENT_DECIMALS),
    stateChange: ghostNow === ghostBefore ? null : ghostNow ? 'becameGhost' : 'leftGhost',
    showBecameGhostReal: realFirst !== null && !ghostNow,
  };

  let endingValues: Record<string, string> | null = null;
  if (x.ranges.length >= x.quarters.length && x.quarters.length > 0) {
    let atRisk = 0;
    let atRiskReal = 0;
    let ghost = 0;
    let ghostReal = 0;
    let complete = true;
    for (let i = 0; i < x.quarters.length; i++) {
      const pl = playerRange(i)?.central ?? null;
      const re = realBurden(i);
      if (pl === null || re === null) complete = false;
      if (pl !== null && pl > rentRisk) atRisk++;
      if (re !== null && re > rentRisk) atRiskReal++;
      if (ghostAt(pl)) ghost++;
      if (ghostAt(re)) ghostReal++;
    }
    endingValues = { name: p.name, homeDistrict: p.homeDistrict, rentRiskThreshold: f(rentRisk, 0) };
    if (complete) {
      endingValues['quartersAtRisk'] = f(atRisk, 0);
      endingValues['quartersAtRiskReal'] = f(atRiskReal, 0);
      endingValues['quartersGhost'] = f(ghost, 0);
      endingValues['quartersGhostReal'] = f(ghostReal, 0);
    }
    if (minutes !== null) {
      // The commute is the matrix value in both runs (design), so the two averages are equal.
      endingValues['commuteAvg'] = f(minutes, MINUTE_DECIMALS);
      endingValues['commuteAvgReal'] = f(minutes, MINUTE_DECIMALS);
    }
  }
  return { state, values, endingValues };
}
