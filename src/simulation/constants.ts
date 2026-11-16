// Named constants of the simulation engine. Rule files take tolerances and ranges from here.

import type { CityName, QuarterKey } from '../types/data-files.ts';

/** First quarter of the Historical mode. */
export const FIRST_QUARTER: QuarterKey = '2015Q1';

/** Last quarter of the Historical mode. */
export const LAST_QUARTER: QuarterKey = '2025Q4';

/** Number of quarters from FIRST_QUARTER to LAST_QUARTER, inclusive. */
export const QUARTER_COUNT = 44;

/** Number of districts in Taipei and New Taipei. */
export const DISTRICT_COUNT = 41;

/** Largest allowed Lag in quarters. The only Lag bound, for every tool including social housing. */
export const MAX_LAG = 43;

/** Absolute tolerance when checking that shares sum to 1. */
export const SHARE_SUM_TOLERANCE = 1e-9;

/** Relative factor when checking that Cause contributions sum to the indicator delta. */
export const CAUSE_TOLERANCE = 1e-9;

/**
 * Relative tolerance added before the floor of the Ghost count. Floating-point error in
 * `1 - ghost.shareCommuteWithin` can leave an exact multiple of the Ghost size a few ulps below the integer.
 */
export const GHOST_FLOOR_TOLERANCE = 1e-9;

/** Version string printed in the backtest report. */
export const ENGINE_VERSION = '1.0.0';

/** City order used wherever the engine iterates over cities. */
export const CITY_ORDER: readonly CityName[] = ['Taipei', 'New Taipei'];
