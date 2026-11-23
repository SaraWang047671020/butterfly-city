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

/** Change bounds live in src/game/core/change-bounds.ts (shared with the Quarter_Brief rule). */
export { CHANGE_BOUNDS } from '../../game/core/change-bounds.ts';
import { CHANGE_BOUNDS } from '../../game/core/change-bounds.ts';

/** Token of the change class of a difference; null (not simulated) gives the "no value" token. */
export function changeToken(indicator: MapIndicatorId, difference: number | null): string {
  if (difference === null || !Number.isFinite(difference)) return NO_VALUE_TOKEN;
  const k = classOf(difference, CHANGE_BOUNDS[indicator]);
  // About no change stays dark so that the districts a policy moves stand out.
  return k === 3 ? '--city-change-neutral' : `--color-div-${k}`;
}
