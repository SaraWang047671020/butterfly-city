/** `Math.round` (halves round up) with `-0` turned into `0`. */
export function roundHalfUp(x: number): number {
  const r = Math.round(x);
  return r === 0 ? 0 : r;
}

/** Returns `x` itself when it lies inside the range, so no new float is created. */
export function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/**
 * Largest-remainder split of a non-negative integer `total` into non-negative
 * integers proportional to `weights`. Ties go to the lower index. When all weights
 * are zero, or `weights` is empty, every part is 0.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  const parts: number[] = new Array<number>(n).fill(0);
  let sum = 0;
  for (const w of weights) sum += w;
  if (n === 0 || !(sum > 0) || total <= 0) return parts;

  const remainders: number[] = new Array<number>(n).fill(0);
  let assigned = 0;
  for (let i = 0; i < n; i++) {
    const exact = (total * (weights[i] ?? 0)) / sum;
    const whole = Math.floor(exact);
    parts[i] = whole;
    remainders[i] = exact - whole;
    assigned += whole;
  }
  let left = total - assigned;
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r !== a.r ? b.r - a.r : a.i - b.i));
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length) {
    const entry = order[k];
    if (entry === undefined) break;
    parts[entry.i] = (parts[entry.i] ?? 0) + 1;
    left--;
  }
  return parts;
}

export interface ScheduleShare {
  readonly offset: number;
  readonly share: number;
}

export interface ScheduleCharge {
  readonly offset: number;
  readonly amount: number;
}

/**
 * Splits a whole-TWD `total` into whole-TWD charges. Every charge but the last is
 * `roundHalfUp(total × share)`; the last is `total` minus the others, so the charges
 * sum exactly to `total`. A negative total gives non-positive charges.
 */
export function splitBySchedule(total: number, schedule: readonly ScheduleShare[]): ScheduleCharge[] {
  const charges: ScheduleCharge[] = [];
  let used = 0;
  const last = schedule.length - 1;
  schedule.forEach((entry, i) => {
    const amount = i === last ? total - used : roundHalfUp(total * entry.share);
    used += amount;
    charges.push({ offset: entry.offset, amount: amount === 0 ? 0 : amount });
  });
  return charges;
}
