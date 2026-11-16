// Annual-to-quarterly interpolation: piecewise linear, slope limited (minmod), mean preserving.
import type { Quarter } from "../lib/time.ts";

/** Distance in years from mid-year to the centre of quarter k (k = 1..4). */
const OFFSETS = [-3 / 8, -1 / 8, 1 / 8, 3 / 8] as const;

/**
 * Converts annual values to 4 quarterly values per year.
 *
 * Q_k(y) = A(y) + s(y) * c_k, where s(y) is the minmod slope: 0 when a neighbouring year is
 * missing (first or last year) or when the two one-sided differences do not share a strict sign
 * (turning points, flat runs); otherwise sign(d-) * min(|d-|, |d+|).
 *
 * The four quarters average to A(y), and each quarter stays within the range spanned by the
 * annual values of its own and adjacent years. Values are not rounded.
 */
export function annualToQuarterly(series: ReadonlyMap<number, number>): Map<Quarter, number> {
  for (const [year, value] of series) {
    if (!Number.isInteger(year)) throw new Error(`annualToQuarterly: year must be an integer, got ${year}`);
    if (!Number.isFinite(value)) throw new Error(`annualToQuarterly: value for ${year} is not finite`);
  }
  const out = new Map<Quarter, number>();
  const years = [...series.keys()].sort((a, b) => a - b);
  for (const y of years) {
    const a = series.get(y) as number;
    const prev = series.get(y - 1);
    const next = series.get(y + 1);
    let slope = 0;
    if (prev !== undefined && next !== undefined) {
      const dm = a - prev;
      const dp = next - a;
      if (dm * dp > 0) slope = Math.sign(dm) * Math.min(Math.abs(dm), Math.abs(dp));
    }
    OFFSETS.forEach((c, i) => {
      out.set(`${y}Q${(i + 1) as 1 | 2 | 3 | 4}`, a + slope * c);
    });
  }
  return out;
}
