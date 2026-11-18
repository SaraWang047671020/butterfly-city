import type { ResultRange } from '../../types/simulation.ts';
import { fillTemplate, UI_STRINGS } from '../strings.ts';
import { formatNumber } from './number.ts';

export type RangeText =
  | {
      readonly kind: 'range';
      readonly central: string;
      readonly min: string;
      readonly max: string;
      readonly text: string;
    }
  | { readonly kind: 'same'; readonly value: string; readonly text: string }
  | { readonly kind: 'none'; readonly text: string };

/**
 * 'range' when the formatted min, central and max differ; 'same' when all three are equal
 * after formatting; 'none' ("no value") when the range is null or not finite.
 */
export function formatRange(r: ResultRange | null, decimals: number, unit: string): RangeText {
  const noValue = UI_STRINGS.range.noValue;
  if (
    r === null ||
    !Number.isFinite(r.min) ||
    !Number.isFinite(r.central) ||
    !Number.isFinite(r.max)
  ) {
    return { kind: 'none', text: noValue };
  }
  const central = formatNumber(r.central, decimals);
  const min = formatNumber(r.min, decimals);
  const max = formatNumber(r.max, decimals);
  if (central === min && central === max) {
    const text = `${central} ${unit}`.trimEnd() + `, ${UI_STRINGS.range.sameInAll}`;
    return { kind: 'same', value: central, text };
  }
  const text = fillTemplate(UI_STRINGS.range.display, { value: central, unit, min, max });
  return { kind: 'range', central, min, max, text };
}
