// Street detail near the Avatar (city-3d Requirement 14, approved 2026-11-24 with
// docs/design-proposal/street-detail-proposal.html): arcades (騎樓), shop signs and street lights. Pure: every item is
// an axis-aligned box placed from the illustrative buildings and the Street_Grid. An item depends only on its building
// (position and current height) or its street edge, never on where the Avatar stands, so walking back shows the same
// street. Signs carry abstract glyph blocks only (neutrality.md: no text, names or brands).
import type { BoxFootprint } from './collision.ts';
import { hashSeed, mulberry32 } from './random.ts';
import { edgeKey, ROAD_HALF_WIDTH, SPACING, type StreetGrid } from './street-grid.ts';

export interface DetailBuilding {
  readonly x: number;
  readonly z: number;
  readonly hw: number;
  readonly hd: number;
}

export type DetailKind = 'shop' | 'slab' | 'column' | 'sign' | 'band' | 'pole' | 'arm' | 'lamp';
export const DETAIL_KINDS: readonly DetailKind[] = ['shop', 'slab', 'column', 'sign', 'band', 'pole', 'arm', 'lamp'];

export interface DetailBox {
  readonly kind: DetailKind;
  readonly x: number;
  /** Centre height above the ground. */
  readonly y: number;
  readonly z: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  /** Index into the sign colours (sign, band) or the shop colours (shop); 0 otherwise. */
  readonly colour: number;
}

export interface Detail {
  readonly boxes: readonly DetailBox[];
  /** Light pools on the ground under the street lights. */
  readonly glows: readonly { readonly x: number; readonly z: number }[];
  /** Footprints the Avatar cannot pass (user decision B2, 2026-11-24): arcade columns and lamp poles. */
  readonly obstacles: readonly BoxFootprint[];
}

/** Ground floor (shopfront) height and the arcade slab, in world units; one upper floor of the window grid is about 0.9. */
export const SHOP_HEIGHT = 1.5;
export const SLAB = 0.22;
/** The lowest sign starts here; the lamp arms stay below it. */
export const SIGN_BASE = SHOP_HEIGHT + SLAB + 0.6;
export const LAMP_HEIGHT = 2.2;
/** The arcade ends at least this far before the road edge; the lamp poles stand on the kerb in that strip. */
export const KERB = 0.15;
export const LAMP_OFFSET = ROAD_HALF_WIDTH - KERB;
export const COLUMN_SIZE = 0.18;
export const POLE_SIZE = 0.08;
export const SIGN_COLOURS = 6;
export const SHOP_COLOURS = 2;
const ARCADE_MAX = 1.3;
const ARCADE_MIN = 0.6;
const FACE_GAP_MAX = 3;
const COLUMN_STEP = 1.4;
const SIGN_OUT = 0.45;
const ARM_REACH = 0.7;
/** A building lower than this gets no street detail (the shopfront and the slab must stay below the roof). */
const MIN_HEIGHT = SHOP_HEIGHT + SLAB + 0.6;

export interface Face {
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

/** Faces of a building that look onto a street of the grid, with at most FACE_GAP_MAX of ground before the road. */
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
      const key = axis === 'x' ? edgeKey(Math.round(line / SPACING), k, false) : edgeKey(k, Math.round(line / SPACING), true);
      if (!grid.edges.has(key)) continue;
      faces.push({ axis, dir, at, mid: along, half: axis === 'x' ? b.hd : b.hw, gap });
    }
  }
  return faces;
}

/** A box given in face coordinates: `out` from the face along its normal, `u` along the face, `y` up. */
function faceBox(f: Face, kind: DetailKind, out: number, u: number, y: number, sOut: number, sU: number, sy: number, colour: number): DetailBox {
  const n = f.at + f.dir * out;
  const a = f.mid + u;
  return f.axis === 'x' ? { kind, x: n, y, z: a, sx: sOut, sy, sz: sU, colour } : { kind, x: a, y, z: n, sx: sU, sy, sz: sOut, colour };
}

/** Arcade, shopfront and signs of one building at its current height. */
export function buildingDetail(b: DetailBuilding, height: number, grid: StreetGrid, out: DetailBox[]): void {
  if (height < MIN_HEIGHT) return;
  const rand = mulberry32(hashSeed(`${Math.round(b.x * 100)},${Math.round(b.z * 100)}`));
  for (const f of streetFaces(b, grid)) {
    const len = f.half * 2;
    // Shopfront: a lit panel over the ground floor of the face.
    out.push(faceBox(f, 'shop', 0.03, 0, SHOP_HEIGHT / 2, 0.06, len * 0.94, SHOP_HEIGHT, Math.floor(rand() * SHOP_COLOURS)));
    const depth = Math.min(ARCADE_MAX, f.gap - KERB);
    const arcade = depth >= ARCADE_MIN;
    if (arcade) {
      // The covered walkway: a slab over the pavement and a row of columns at its outer edge.
      out.push(faceBox(f, 'slab', depth / 2, 0, SHOP_HEIGHT + SLAB / 2, depth, len, SLAB, 0));
      const n = Math.max(2, Math.round(len / COLUMN_STEP) + 1);
      for (let i = 0; i < n; i++) {
        const u = -f.half + 0.1 + ((len - 0.2) * i) / (n - 1);
        out.push(faceBox(f, 'column', depth - COLUMN_SIZE / 2, u, SHOP_HEIGHT / 2, COLUMN_SIZE, COLUMN_SIZE, SHOP_HEIGHT, 0));
      }
    }
    const edge = arcade ? depth : 0;
    // A horizontal sign band above the shopfront on about half the faces.
    const band = rand() < 0.5;
    const bandColour = Math.floor(rand() * SIGN_COLOURS);
    if (band) out.push(faceBox(f, 'band', edge + 0.05, 0, SHOP_HEIGHT + SLAB + 0.25, 0.1, len * 0.8, 0.4, bandColour));
    // Vertical signs standing out from the face, between the first floor and the roof.
    const room = height - SIGN_BASE;
    const pick = rand();
    const count = room < 1 ? 0 : pick < 0.35 ? 0 : pick < 0.74 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const h = Math.min(room, 1.2 + rand() * 2.4);
      const u = (count === 1 ? (rand() - 0.5) * 0.6 : i === 0 ? -0.5 : 0.5) * f.half;
      out.push(faceBox(f, 'sign', edge + SIGN_OUT / 2, u, SIGN_BASE + h / 2, SIGN_OUT, 0.12, h, Math.floor(rand() * SIGN_COLOURS)));
    }
  }
}

export interface Circle {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** Two street lights on a street edge, on alternating sides, away from the crossings and from the `avoid` circles. */
export function edgeLamps(key: string, avoid: readonly Circle[], out: DetailBox[], glows: { x: number; z: number }[]): void {
  const horizontal = key.startsWith('h');
  const [i, j] = key.slice(1).split(',').map(Number) as [number, number];
  const rand = mulberry32(hashSeed(key));
  const first = rand() < 0.5 ? 1 : -1;
  for (const [t, side] of [
    [0.3, first],
    [0.7, -first],
  ] as const) {
    const ax = horizontal ? (i + t) * SPACING : i * SPACING + side * LAMP_OFFSET;
    const az = horizontal ? j * SPACING + side * LAMP_OFFSET : (j + t) * SPACING;
    // The lamp head reaches over the road; the whole light keeps clear of the avoid circles (metro stations).
    const lx = horizontal ? ax : ax - side * ARM_REACH;
    const lz = horizontal ? az - side * ARM_REACH : az;
    if (avoid.some((c) => Math.hypot(ax - c.x, az - c.z) < c.r + 1 || Math.hypot(lx - c.x, lz - c.z) < c.r + 1)) continue;
    out.push({ kind: 'pole', x: ax, y: LAMP_HEIGHT / 2, z: az, sx: POLE_SIZE, sy: LAMP_HEIGHT, sz: POLE_SIZE, colour: 0 });
    const cx = (ax + lx) / 2;
    const cz = (az + lz) / 2;
    out.push({ kind: 'arm', x: cx, y: LAMP_HEIGHT, z: cz, sx: horizontal ? 0.06 : ARM_REACH, sy: 0.06, sz: horizontal ? ARM_REACH : 0.06, colour: 0 });
    out.push({ kind: 'lamp', x: lx, y: LAMP_HEIGHT - 0.06, z: lz, sx: 0.3, sy: 0.08, sz: 0.3, colour: 0 });
    glows.push({ x: lx, z: lz });
  }
}

/** Cell index of the buildings, so that a query looks at the buildings near a point only. */
export interface BuildingIndex {
  near(x: number, z: number, radius: number): number[];
}

const CELL = 16;

export function indexBuildings(buildings: readonly DetailBuilding[]): BuildingIndex {
  const cells = new Map<string, number[]>();
  buildings.forEach((b, i) => {
    const k = `${Math.floor(b.x / CELL)},${Math.floor(b.z / CELL)}`;
    const list = cells.get(k);
    if (list === undefined) cells.set(k, [i]);
    else list.push(i);
  });
  return {
    near(x, z, radius) {
      const out: number[] = [];
      for (let i = Math.floor((x - radius) / CELL); i <= Math.floor((x + radius) / CELL); i++) {
        for (let j = Math.floor((z - radius) / CELL); j <= Math.floor((z + radius) / CELL); j++) {
          for (const n of cells.get(`${i},${j}`) ?? []) {
            const b = buildings[n]!;
            if (Math.hypot(b.x - x, b.z - z) <= radius) out.push(n);
          }
        }
      }
      return out.sort((a, b) => a - b);
    },
  };
}

export interface DetailQuery {
  readonly buildings: readonly DetailBuilding[];
  readonly index: BuildingIndex;
  readonly grid: StreetGrid;
  /** Circles kept free of street lights (metro station platforms). */
  readonly avoid: readonly Circle[];
  /** Current height of building `i` (after the Price_Index scale). */
  readonly heightOf: (i: number) => number;
}

/** The street detail of every building and street edge whose centre lies within `radius` of (x, z). */
export function detailNear(q: DetailQuery, x: number, z: number, radius: number): Detail {
  const boxes: DetailBox[] = [];
  const glows: { x: number; z: number }[] = [];
  for (const i of q.index.near(x, z, radius)) buildingDetail(q.buildings[i]!, q.heightOf(i), q.grid, boxes);
  const i0 = Math.floor((x - radius) / SPACING) - 1;
  const i1 = Math.ceil((x + radius) / SPACING) + 1;
  const j0 = Math.floor((z - radius) / SPACING) - 1;
  const j1 = Math.ceil((z + radius) / SPACING) + 1;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      for (const h of [true, false]) {
        const key = edgeKey(i, j, h);
        if (!q.grid.edges.has(key)) continue;
        const mx = h ? (i + 0.5) * SPACING : i * SPACING;
        const mz = h ? j * SPACING : (j + 0.5) * SPACING;
        if (Math.hypot(mx - x, mz - z) <= radius) edgeLamps(key, q.avoid, boxes, glows);
      }
    }
  }
  const obstacles = boxes
    .filter((b) => b.kind === 'column' || b.kind === 'pole')
    .map((b) => ({ x: b.x, z: b.z, hw: b.sx / 2, hd: b.sz / 2 }));
  return { boxes, glows, obstacles };
}

/** The obstacles that leave a circle of `radius` at (x, z) free: a new obstacle never appears on top of the Avatar,
 * so the Avatar can never be trapped (a slide move from a free spot always stays free). */
export function obstaclesClearOf(obstacles: readonly BoxFootprint[], x: number, z: number, radius: number): BoxFootprint[] {
  return obstacles.filter((o) => {
    const dx = Math.max(Math.abs(x - o.x) - o.hw, 0);
    const dz = Math.max(Math.abs(z - o.z) - o.hd, 0);
    return dx * dx + dz * dz >= radius * radius;
  });
}
