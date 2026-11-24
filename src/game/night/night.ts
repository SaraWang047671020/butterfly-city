// The night of a quarter (night-ghosts Requirement 5, design "Night"). Pure. A picked Mission not met adds
// Mission_Ghosts (a game element, counted apart from the Model_Ghosts of the simulation); a district whose Model_Ghosts
// and Mission_Ghosts pass a threshold is "swallowed" (darkened and foggy, locally); each group of Mission_Ghosts shortens
// the next day. Kind B, Kind C and Memorial_Points never count toward any of it (Requirement 5.6).
import { newDay, type DayTimer } from './timer.ts';
import type { MissionResult } from './missions.ts';

export const MISSION_GHOSTS = 3;
export const SWALLOW_AT = 8;

export interface MissionGhost {
  readonly district: string;
  readonly count: number;
}

/**
 * The Mission_Ghosts of a quarter: 3 in the Mission's district, or, for a city Mission, 1 in each of the 3 districts of
 * that city with the most Model_Ghosts (ties by District_Code). None WHEN the Mission was met or none was picked.
 */
export function missionGhosts(
  result: MissionResult | null,
  districtsOfCity: (city: string) => readonly string[],
  modelGhosts: (district: string) => number,
): MissionGhost[] {
  if (result === null || result.met) return [];
  const area = result.mission.area;
  const city = districtsOfCity(area);
  if (city.length === 0) return [{ district: area, count: MISSION_GHOSTS }];
  return [...city]
    .sort((a, b) => modelGhosts(b) - modelGhosts(a) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MISSION_GHOSTS)
    .map((district) => ({ district, count: 1 }));
}

export interface DistrictNight {
  readonly district: string;
  readonly modelGhosts: number;
  readonly missionGhosts: number;
  readonly swallowed: boolean;
}

/** The night of every district: the two kinds of ghosts apart, and whether the night swallows it. */
export function nightOf(districts: readonly string[], modelGhosts: (district: string) => number, mission: readonly MissionGhost[]): DistrictNight[] {
  return districts.map((district) => {
    const m = mission.filter((g) => g.district === district).reduce((a, g) => a + g.count, 0);
    const g = Math.max(0, modelGhosts(district));
    return { district, modelGhosts: g, missionGhosts: m, swallowed: g + m >= SWALLOW_AT };
  });
}

/** The Day_Timer of the next day: one group of Mission_Ghosts per Mission not met (Requirement 5.5). */
export function nextDay(chosenLength: number, result: MissionResult | null, off: boolean): DayTimer {
  return newDay(chosenLength, result !== null && !result.met ? 1 : 0, off);
}
