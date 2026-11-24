// Prototype for city-3d task 11 (street detail near the Avatar). Pure placement: arcades (騎樓), shop signs and
// street lights around a point, from the illustrative buildings and the Street_Grid. Every item is an axis-aligned
// box, so the renderer needs no rotation. Deterministic: an item depends on its building or street edge only, not on
// where the Avatar stands. Not production code; never imported by src/.
import { mulberry32, hashSeed } from '../src/ui/city/random.ts';
import { edgeKey, ROAD_HALF_WIDTH, SPACING, type StreetGrid } from '../src/ui/city/street-grid.ts';

export interface DetailBuilding {
  readonly x: number;
  readonly z: number;
  readonly hw: number;
  readonly hd: number;
  /** Current height, after the Price_Index scale. */
  readonly height: number;
}

export type DetailKind = 'shop' | 'slab' | 'column' | 'sign' | 'band' | 'pole' | 'arm' | 'lamp';

export interface DetailBox {
  readonly kind: DetailKind;
  readonly x: number;
  readonly y: number; // centre
  readonly z: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  /** Index into the sign or shop colour list. */
  readonly colour: number;
}

export interface Detail {
  readonly boxes: readonly DetailBox[];
  /** Light pools on the ground under the street lights. */
  readonly glows: readonly { readonly x: number; readonly z: number }[];
}

/** Ground floor height and arcade sizes, in world units (one upper floor of the window grid is about 0.9). */
export const SHOP_HEIGHT = 1.5;
const SLAB = 0.22;
const ARCADE_MAX = 1.3;
const ARCADE_MIN = 0.6;
const FACE_GAP_MAX = 3;
const COLUMN_STEP = 1.4;
// On the kerb: the arcade ends at least 0.15 before the road edge, so the poles stand clear of the columns.
const LAMP_OFFSET = ROAD_HALF_WIDTH - 0.15;
// Below the lowest sign (SHOP_HEIGHT + SLAB + 0.6), so an arm never runs into one.
const LAMP_HEIGHT = 2.2;
export const SIGN_COLOURS = 6;
export const SHOP_COLOURS = 2;

interface Face {
  /** Normal axis and direction. */
  readonly axis: 'x' | 'z';
  readonly dir: 1 | -1;
  /** Coordinate of the face on the normal axis. */
  readonly at: number;
  /** Centre and half length along the face. */
  readonly mid: number;
  readonly half: number;
  /** Free ground between the face and the road edge. */
  readonly gap: number;
}

/** Faces of a building that look onto a street of the grid within FACE_GAP_MAX. */
export function streetFaces(b: DetailBuilding, grid: StreetGrid): Face[] {
  const faces: Face[] = [];
  for (const axis of ['x', 'z'] as const) {
    for (const dir of [1, -1] as const) {
      const c = axis === 'x' ? b.x : b.z;
      const h = axis === 'x' ? b.hw : b.hd;
      const along = axis === 'x' ? b.z : b.x;
      const at = c + dir * h;
      const line = dir === 1 ? Math.ceil(at / SPACING) * SPACING : Math.floor(at / SPACING) * SPACING;
      const gap = Math.abs(line - at) - ROAD_HALF_WIDTH;
      if (gap < 0 || gap > FACE_GAP_MAX) continue;
      // The street along the face: a 'v' edge (along z) for an x face, an 'h' edge (along x) for a z face.
      const k = Math.floor(along / SPACING);
      const key = axis === 'x' ? edgeKey(line / SPACING, k, false) : edgeKey(k, line / SPACING, true);
      if (!grid.edges.has(key)) continue;
      faces.push({ axis, dir, at, mid: along, half: axis === 'x' ? b.hd : b.hw, gap });
    }
  }
  return faces;
}

/** A box given in face coordinates: `out` from the face (normal), `u` along it, `y` up. */
function faceBox(f: Face, kind: DetailKind, out: number, u: number, y: number, sOut: number, sU: number, sy: number, colour: number): DetailBox {
  const n = f.at + f.dir * out;
  const a = f.mid + u;
  return f.axis === 'x'
    ? { kind, x: n, y, z: a, sx: sOut, sy, sz: sU, colour }
    : { kind, x: a, y, z: n, sx: sU, sy, sz: sOut, colour };
}

function buildingDetail(b: DetailBuilding, grid: StreetGrid, out: DetailBox[]): void {
  if (b.height < SHOP_HEIGHT + 0.8) return;
  const rand = mulberry32(hashSeed(`${Math.round(b.x * 100)},${Math.round(b.z * 100)}`));
  for (const f of streetFaces(b, grid)) {
    const len = f.half * 2;
    // Shopfront: a lit panel over the ground floor of the face.
    out.push(faceBox(f, 'shop', 0.03, 0, SHOP_HEIGHT / 2, 0.06, len * 0.94, SHOP_HEIGHT, Math.floor(rand() * SHOP_COLOURS)));
    const depth = Math.min(ARCADE_MAX, f.gap - 0.15);
    const arcade = depth >= ARCADE_MIN;
    if (arcade) {
      // The covered walkway: a slab over the pavement and a row of columns at its outer edge.
      out.push(faceBox(f, 'slab', depth / 2, 0, SHOP_HEIGHT + SLAB / 2, depth, len, SLAB, 0));
      const n = Math.max(2, Math.round(len / COLUMN_STEP) + 1);
      for (let i = 0; i < n; i++) {
        const u = -f.half + 0.1 + ((len - 0.2) * i) / (n - 1);
        out.push(faceBox(f, 'column', depth - 0.1, u, SHOP_HEIGHT / 2, 0.18, 0.18, SHOP_HEIGHT, 0));
      }
    }
    const edge = arcade ? depth : 0;
    // A horizontal sign band above the shopfront on half the faces.
    if (rand() < 0.5) {
      out.push(faceBox(f, 'band', edge + 0.05, 0, SHOP_HEIGHT + SLAB + 0.25, 0.1, len * 0.8, 0.4, Math.floor(rand() * SIGN_COLOURS)));
    }
    // Vertical signs standing out from the face, between the first and the top floor.
    const room = b.height - (SHOP_HEIGHT + SLAB + 0.6);
    const count = room < 1 ? 0 : rand() < 0.35 ? 0 : rand() < 0.6 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const h = Math.min(room, 1.2 + rand() * 2.4);
      const u = (count === 1 ? (rand() - 0.5) * 0.6 : i === 0 ? -0.5 : 0.5) * f.half;
      const sOut = 0.45;
      out.push(faceBox(f, 'sign', edge + sOut / 2, u, SHOP_HEIGHT + SLAB + 0.6 + h / 2, sOut, 0.12, h, Math.floor(rand() * SIGN_COLOURS)));
    }
  }
}

/** Two street lights on each street edge, on alternating sides, away from the crossings. */
function edgeLamps(key: string, out: DetailBox[], glows: { x: number; z: number }[]): void {
  const horizontal = key.startsWith('h');
  const [i, j] = key.slice(1).split(',').map(Number) as [number, number];
  const rand = mulberry32(hashSeed(key));
  const first = rand() < 0.5 ? 1 : -1;
  for (const [t, side] of [
    [0.3, first],
    [0.7, -first],
  ] as const) {
    // Along the edge from node (i, j); the side is ±LAMP_OFFSET across it.
    const ax = horizontal ? (i + t) * SPACING : i * SPACING + side * LAMP_OFFSET;
    const az = horizontal ? j * SPACING + side * LAMP_OFFSET : (j + t) * SPACING;
    out.push({ kind: 'pole', x: ax, y: LAMP_HEIGHT / 2, z: az, sx: 0.08, sy: LAMP_HEIGHT, sz: 0.08, colour: 0 });
    // The arm reaches over the road toward the street centre.
    const reach = 0.7;
    const cx = horizontal ? ax : ax - side * reach / 2;
    const cz = horizontal ? az - side * reach / 2 : az;
    out.push({ kind: 'arm', x: cx, y: LAMP_HEIGHT, z: cz, sx: horizontal ? 0.06 : reach, sy: 0.06, sz: horizontal ? reach : 0.06, colour: 0 });
    const lx = horizontal ? ax : ax - side * reach;
    const lz = horizontal ? az - side * reach : az;
    out.push({ kind: 'lamp', x: lx, y: LAMP_HEIGHT - 0.06, z: lz, sx: 0.3, sy: 0.08, sz: 0.3, colour: 0 });
    glows.push({ x: lx, z: lz });
  }
}

/** The street detail of every building and street edge whose centre lies within `radius` of (x, z). */
export function detailNear(buildings: readonly DetailBuilding[], grid: StreetGrid, x: number, z: number, radius: number): Detail {
  const boxes: DetailBox[] = [];
  const glows: { x: number; z: number }[] = [];
  for (const b of buildings) {
    if (Math.hypot(b.x - x, b.z - z) <= radius) buildingDetail(b, grid, boxes);
  }
  const i0 = Math.floor((x - radius) / SPACING) - 1;
  const i1 = Math.ceil((x + radius) / SPACING) + 1;
  const j0 = Math.floor((z - radius) / SPACING) - 1;
  const j1 = Math.ceil((z + radius) / SPACING) + 1;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      for (const h of [true, false]) {
        const key = edgeKey(i, j, h);
        if (!grid.edges.has(key)) continue;
        const mx = h ? (i + 0.5) * SPACING : i * SPACING;
        const mz = h ? j * SPACING : (j + 0.5) * SPACING;
        if (Math.hypot(mx - x, mz - z) <= radius) edgeLamps(key, boxes, glows);
      }
    }
  }
  return { boxes, glows };
}
