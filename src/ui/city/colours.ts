// Indicator_Class → Token_File custom property (city-3d 3.1, 3.2). Pure; the City_View reads the value from CSS.
import type { MapIndicatorId } from '../../types/save.ts';

export const CLASS_COUNT = 7;
export const NO_VALUE_TOKEN = '--color-nodata-fill';

/** Population change uses the diverging ramp; every other Map_Indicator the sequential ramp. */
export function rampOf(indicator: MapIndicatorId): 'seq' | 'div' {
  return indicator === 'populationChange' ? 'div' : 'seq';
}

/** Custom property name of a class colour, or the "no value" token for a null class. */
export function classToken(indicator: MapIndicatorId, classIndex: number | null): string {
  if (classIndex === null || !Number.isInteger(classIndex)) return NO_VALUE_TOKEN;
  const k = Math.min(CLASS_COUNT - 1, Math.max(0, classIndex));
  return `--color-${rampOf(indicator)}-${k}`;
}

/** Indicator_Class of a value: the number of inner bounds at or below it (game-ui 3.9); null stays null. */
export function classOf(value: number | null, bounds: readonly number[]): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return bounds.filter((b) => value >= b).length;
}

/**
 * Inner bounds of the change-from-real-history classes (7 classes, diverging ramp, class 3 = about no change).
 * Display classes only, symmetric around 0, in the indicator's unit.
 */
export const CHANGE_BOUNDS: Readonly<Record<MapIndicatorId, readonly number[]>> = {
  rentBurden: [-1, -0.3, -0.05, 0.05, 0.3, 1],
  priceToIncome: [-1, -0.3, -0.05, 0.05, 0.3, 1],
  commuteTime: [-3, -1, -0.1, 0.1, 1, 3],
  populationChange: [-1, -0.3, -0.05, 0.05, 0.3, 1],
  lowUseHousingRate: [-1, -0.3, -0.05, 0.05, 0.3, 1],
};

/** Token of the change class of a difference; null (not simulated) gives the "no value" token. */
export function changeToken(indicator: MapIndicatorId, difference: number | null): string {
  if (difference === null || !Number.isFinite(difference)) return NO_VALUE_TOKEN;
  const k = classOf(difference, CHANGE_BOUNDS[indicator]);
  // About no change stays dark so that the districts a policy moves stand out.
  return k === 3 ? '--city-change-neutral' : `--color-div-${k}`;
}
