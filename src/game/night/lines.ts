// Ghost_Lines (night-ghosts Requirement 5A). Pure: the pick of a scripted line for a ghost and a moment, seeded so that
// the same game repeats the same lines. Kind C places and Memorial_Points have no lines (Requirement 5A.4).
import { hashSeed, mulberry32 } from '../random.ts';

export const MOMENTS = ['meet', 'ask', 'met', 'notMet', 'idle'] as const;
export type Moment = (typeof MOMENTS)[number];

/** One line set: several lines per moment; each line is a template id or text the caller fills. */
export type LineSet<T> = Readonly<Record<Moment, readonly T[]>>;

/** The line of `set` for a moment; `key` makes the pick stable for one occasion (for example the quarter). */
export function pickLine<T>(set: LineSet<T>, moment: Moment, seed: number, key: string): T | null {
  const lines = set[moment];
  if (lines.length === 0) return null;
  return lines[Math.floor(mulberry32(hashSeed(`${seed}:line:${moment}:${key}`))() * lines.length)]!;
}
