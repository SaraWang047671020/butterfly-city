import { UI_STRINGS } from '../strings.ts';

const MINUS = '\u2212';

const formatters = new Map<number, Intl.NumberFormat>();

function formatterFor(decimals: number): Intl.NumberFormat {
  let f = formatters.get(decimals);
  if (f === undefined) {
    f = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true,
    });
    formatters.set(decimals, f);
  }
  return f;
}

/**
 * en-US grouping, fixed decimals, U+2212 minus, never "−0".
 * A null or non-finite value is "no value", never 0.
 */
export function formatNumber(x: number | null, decimals: number): string {
  if (x === null || !Number.isFinite(x)) return UI_STRINGS.range.noValue;
  const text = formatterFor(decimals).format(Math.abs(x));
  const isZero = !/[1-9]/.test(text);
  return x < 0 && !isZero ? MINUS + text : text;
}
