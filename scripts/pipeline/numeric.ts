// Shared numeric helpers for the data pipeline. Results never depend on input order.

/** Orders strings by Unicode code point (not UTF-16 code unit, not locale). */
export function codePointCompare(a: string, b: string): number {
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done === true && y.done === true) return 0;
    if (x.done === true) return -1;
    if (y.done === true) return 1;
    const cx = x.value.codePointAt(0) as number;
    const cy = y.value.codePointAt(0) as number;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Sums a copy sorted ascending, so the result is independent of input order. */
export function stableSum(values: readonly number[]): number {
  let sum = 0;
  for (const v of sortedCopy(values)) sum += v;
  return sum;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("mean: empty input");
  return stableSum(values) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median: empty input");
  const s = sortedCopy(values);
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return s[mid] as number;
  return ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** `sign(x) * round(|x| * 10^d) / 10^d` with `-0` normalised to `0`. `d` is an integer in 0..6. */
export function roundTo(x: number, d: number): number {
  if (!Number.isInteger(d) || d < 0 || d > 6) {
    throw new Error(`roundTo: digits must be an integer in 0..6, got ${d}`);
  }
  const factor = 10 ** d;
  const r = (Math.sign(x) * Math.round(Math.abs(x) * factor)) / factor;
  return r === 0 ? 0 : r;
}

/**
 * Largest-remainder split of a non-negative integer `total` into non-negative integers
 * proportional to `weights`. All-zero weights become equal weights. Ties go to the lower index.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`apportion: total must be a non-negative integer, got ${total}`);
  }
  if (weights.length === 0) throw new Error("apportion: weights must not be empty");
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) {
      throw new Error(`apportion: weights must be finite and non-negative, got ${w}`);
    }
  }
  const w = weights.every((x) => x === 0) ? weights.map(() => 1) : weights;
  const W = stableSum(w);
  const exact = w.map((x) => (total * x) / W);
  const base = exact.map((e) => Math.floor(e));
  const frac = exact.map((e, i) => e - (base[i] as number));
  let L = total - base.reduce((a, b) => a + b, 0);

  if (L > 0) {
    const order = frac
      .map((f, i) => ({ f, i }))
      .sort((a, b) => b.f - a.f || a.i - b.i);
    for (let k = 0; k < L && k < order.length; k++) {
      const idx = (order[k] as { i: number }).i;
      base[idx] = (base[idx] as number) + 1;
    }
  } else if (L < 0) {
    const order = frac
      .map((f, i) => ({ f, i }))
      .filter((o) => (base[o.i] as number) > 0)
      .sort((a, b) => a.f - b.f || a.i - b.i);
    for (let k = 0; k < -L && k < order.length; k++) {
      const idx = (order[k] as { i: number }).i;
      base[idx] = (base[idx] as number) - 1;
    }
  }
  return base;
}

/** Ordinary least squares fit `y = slope * x + intercept`. */
export function linearFit(
  xs: readonly number[],
  ys: readonly number[],
): { slope: number; intercept: number } {
  if (xs.length !== ys.length) throw new Error("linearFit: xs and ys differ in length");
  if (xs.length < 2) throw new Error("linearFit: at least two points are required");
  const mx = mean(xs);
  const my = mean(ys);
  const sxx = stableSum(xs.map((x) => (x - mx) ** 2));
  if (sxx === 0) throw new Error("linearFit: xs have zero variance");
  const sxy = stableSum(xs.map((x, i) => (x - mx) * ((ys[i] as number) - my)));
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** Error function, Abramowitz and Stegun 7.1.26 (absolute error below 1.5e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-a * a));
}

/** Standard normal distribution function Φ(x), through `erf` (absolute error below 1.5e-7). */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
