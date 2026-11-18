// Movement of vehicles and pedestrians on the Street_Grid (city-3d 4.5). Pure.
import type { Rand } from './random.ts';
import { hasStreet, parseEdge, SPACING, type StreetGrid } from './street-grid.ts';

export interface Mover {
  /** Node the mover left. */
  i: number;
  j: number;
  /** Direction, one of (±1, 0) or (0, ±1). */
  di: number;
  dj: number;
  /** Fraction of the edge travelled, 0 ≤ t < 1. */
  t: number;
  /** World units per second. */
  readonly speed: number;
  /** Offset to the right of the heading, in world units (negative: left side). */
  readonly lane: number;
}

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** A mover on a random edge of the grid, in a random direction. The grid must have at least one edge. */
export function spawn(grid: StreetGrid, rand: Rand, speed: number, lane: number): Mover {
  const e = parseEdge(grid.list[Math.floor(rand() * grid.list.length)]!);
  const forward = rand() < 0.5;
  const t = rand();
  if (e.horizontal) return { i: forward ? e.i : e.i + 1, j: e.j, di: forward ? 1 : -1, dj: 0, t, speed, lane };
  return { i: e.i, j: forward ? e.j : e.j + 1, di: 0, dj: forward ? 1 : -1, t, speed, lane };
}

/** Moves on by dt seconds. At a node: straight with probability 0.6 if possible, else another street; back only at a dead end. */
export function advance(m: Mover, dt: number, grid: StreetGrid, rand: Rand): void {
  m.t += (m.speed * dt) / SPACING;
  while (m.t >= 1) {
    m.t -= 1;
    m.i += m.di;
    m.j += m.dj;
    const options = DIRS.filter(([di, dj]) => !(di === -m.di && dj === -m.dj) && hasStreet(grid, m.i, m.j, di, dj));
    const straight = options.find(([di, dj]) => di === m.di && dj === m.dj);
    const back: readonly [number, number] = [-m.di, -m.dj];
    const next = straight !== undefined && rand() < 0.6 ? straight : (options[Math.floor(rand() * options.length)] ?? back);
    m.di = next[0];
    m.dj = next[1];
  }
}

export interface Pose {
  readonly x: number;
  readonly z: number;
  /** Rotation about the y axis that turns the model's +x axis to the heading. */
  readonly heading: number;
}

/** World position with the lane offset to the right of the heading (traffic drives on the right). */
export function poseOf(m: Mover): Pose {
  return {
    x: (m.i + m.di * m.t) * SPACING - m.dj * m.lane,
    z: (m.j + m.dj * m.t) * SPACING + m.di * m.lane,
    heading: Math.atan2(-m.dj, m.di),
  };
}

/** The edge key the mover is on. */
export function edgeOf(m: Mover): string {
  if (m.di !== 0) return `h${m.di > 0 ? m.i : m.i - 1},${m.j}`;
  return `v${m.i},${m.dj > 0 ? m.j : m.j - 1}`;
}
