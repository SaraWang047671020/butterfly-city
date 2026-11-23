// Change-from-real-history bounds (city-3d change mode, user feedback 2026-11-23), shared by the City_View colours
// and the Quarter_Brief rule (play-loop Requirement 6.2). Display classes only, symmetric around 0, in the
// indicator's unit (percentage points for percent indicators).
import type { MapIndicatorId } from '../../types/save.ts';

/** Inner bounds of the 7 change classes (class 3 = about no change). */
export const CHANGE_BOUNDS: Readonly<Record<MapIndicatorId, readonly number[]>> = {
  rentBurden: [-1, -0.3, -0.05, 0.05, 0.3, 1],
  priceToIncome: [-1, -0.3, -0.05, 0.05, 0.3, 1],
  commuteTime: [-3, -1, -0.1, 0.1, 1, 3],
  populationChange: [-1, -0.3, -0.05, 0.05, 0.3, 1],
  lowUseHousingRate: [-1, -0.3, -0.05, 0.05, 0.3, 1],
};

/** The outer change bound of an indicator: the size of a change that fills the strongest change class. */
export function outerChangeBound(indicator: MapIndicatorId): number {
  return Math.max(...CHANGE_BOUNDS[indicator].map(Math.abs));
}

/**
 * Outer change bound of the people above a rent or commute line (Ghost difference in persons): 120 persons, the
 * most the City_View draws above one district (12 figures of 10 persons, city-3d Requirement 6).
 */
export const PEOPLE_CHANGE_BOUND = 120;
