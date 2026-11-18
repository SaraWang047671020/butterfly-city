// Keyboard focus order of the districts in the City_View (city-3d 5.4): ascending District_Code, wrapping.

/** The code after `current` in ascending order (`step` +1) or before it (`step` −1); the first or last when none. */
export function stepFocus(codes: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (codes.length === 0) return null;
  const sorted = [...codes].sort();
  if (current === null) return step === 1 ? sorted[0]! : sorted[sorted.length - 1]!;
  const at = sorted.indexOf(current);
  if (at < 0) return sorted[0]!;
  return sorted[(at + step + sorted.length) % sorted.length]!;
}
