import { UI_STRINGS } from '../strings.ts';
import { formatNumber } from './number.ts';

/**
 * "+x <unit>" or "−x <unit>"; "0 <unit>" when the formatted difference is zero.
 * Percent rows pass the unit "percentage points". A null input gives "no value".
 */
export function formatDifference(
  central: number | null,
  comparison: number | null,
  decimals: number,
  unit: string,
): string {
  if (
    central === null ||
    comparison === null ||
    !Number.isFinite(central) ||
    !Number.isFinite(comparison)
  ) {
    return UI_STRINGS.range.noValue;
  }
  const body = formatNumber(central - comparison, decimals); // "0.0", "−1.2" or "1.2"
  const sign = body.startsWith('\u2212') || !/[1-9]/.test(body) ? '' : '+';
  return `${sign}${body} ${unit}`.trimEnd();
}
