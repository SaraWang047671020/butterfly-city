// Persona_Numbers (story-layer Requirement 4.1). Pure functions; read no file.

/**
 * Standard normal quantile (inverse CDF) for 0 < p < 1, by Acklam's rational approximation
 * (relative error below 1.2e-9).
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile: p must be in (0, 1), got ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  let x: number;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - low) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  return x;
}

/**
 * Rent burden of a Persona in percent of monthly household income:
 * income = householdIncome × exp(sigma × z(incomePercentile / 100)); burden = rentPerM2 × dwellingSize / (income / 12) × 100.
 * A Persona at percentile 50 has the burden of the district median household, as in the ghost rule.
 */
export function personaRentBurden(i: {
  readonly rentPerM2: number;
  readonly dwellingSize: number;
  readonly householdIncome: number;
  readonly sigma: number;
  readonly incomePercentile: number;
}): number {
  const income = i.householdIncome * Math.exp(i.sigma * normalQuantile(i.incomePercentile / 100));
  return ((i.rentPerM2 * i.dwellingSize) / (income / 12)) * 100;
}
