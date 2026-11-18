// Indicator_Class bounds and classification. Pure data and functions: no DOM, no SVG, no d3-geo.
// Shared by the 2D legend and the 3D City_View. Bounds: Design_Proposal section 5 (provisional approval 2026-11-18).
// commuteTime bounds are provisional; recheck with real engine output in Phase D.

import { CLASS_INDICATOR_IDS, INDICATOR_CLASSES } from '../../types/indicator-classes.ts';
import type { ClassIndicatorId, IndicatorClassSpec } from '../../types/indicator-classes.ts';

// The table lives in src/types so that src/game can read the legend bounds without importing src/ui.
export { CLASS_INDICATOR_IDS, INDICATOR_CLASSES };
export type { ClassIndicatorId, IndicatorClassSpec };

/** Number of bounds <= value. A value exactly on a bound belongs to the class above it. */
export function classIndexOf(value: number, bounds: readonly number[]): number {
  let n = 0;
  for (const b of bounds) {
    if (b <= value) n += 1;
  }
  return n;
}

/** Class index 0..bounds.length, or null for a null or non-finite value ("No data", never class 0). */
export function classify(indicator: ClassIndicatorId, value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return classIndexOf(value, INDICATOR_CLASSES[indicator].bounds);
}

/** Token name of a class colour, e.g. `--color-seq-3`. Null class: the no-data token. */
export function classColorToken(indicator: ClassIndicatorId, index: number | null): string {
  if (index === null) return '--color-nodata-fill';
  const prefix = INDICATOR_CLASSES[indicator].scale === 'sequential' ? 'seq' : 'div';
  return `--color-${prefix}-${index}`;
}
