// Cars, scooters with riders and walking pedestrians on the Street_Grid (city-3d 4.5).
// Low-poly models merged from primitives. Per-vertex attributes: aTint (takes the instance colour), aGlow (lights),
// aLimb (walking swing, animated in the vertex shader).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GROUND_DEPTH } from './districts.ts';
import type { Rand } from './random.ts';
import { advance, poseOf, spawn, type Mover } from './routing.ts';
import type { StreetGrid } from './street-grid.ts';
import { ROAD_HALF_WIDTH, SPACING } from './street-grid.ts';
import type { CityTokens } from './tokens.ts';

interface Part {
  readonly g: THREE.BufferGeometry;
  readonly c: THREE.Color;
  readonly tint?: number;
  readonly glow?: number;
  readonly limb?: number;
}

function model(parts: readonly Part[], scale = 1): THREE.BufferGeometry {
  const geos = parts.map(({ g, c, tint = 0, glow = 0, limb = 0 }) => {
    const flat = g.index ? g.toNonIndexed() : g;
    const n = flat.attributes['position']!.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
    flat.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
    flat.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
    flat.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
    flat.deleteAttribute('uv');
    return flat;
  });
  const out = mergeGeometries(geos);
  if (out === null) throw new Error('City_View: model geometry could not be merged');
  out.scale(scale, scale, scale);
  return out;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const ball = (r: number, x: number, y: number, z: number) => new THREE.SphereGeometry(r, 8, 6).translate(x, y, z);
const wheel = (r: number, w: number, x: number, z: number) =>
  new THREE.CylinderGeometry(r, r, w, 10).rotateX(Math.PI / 2).translate(x, r, z);

export function buildModels(t: CityTokens) {
  const white = new THREE.Color(1, 1, 1);
  const tyre = t.color('--city-tyre');
  const glass = t.color('--city-glass');
  const head = t.color('--city-headlight');
  const tail = t.color('--city-taillight');
  const car = model([
    { g: box(1.6, 0.34, 0.74, 0, 0.3, 0), c: white, tint: 1 },
    { g: box(0.86, 0.28, 0.68, -0.06, 0.6, 0), c: glass },
    { g: box(0.8, 0.05, 0.64, -0.08, 0.76, 0), c: white, tint: 1 },
    { g: box(0.06, 0.08, 0.16, 0.8, 0.34, 0.24), c: head, glow: 3 },
    { g: box(0.06, 0.08, 0.16, 0.8, 0.34, -0.24), c: head, glow: 3 },
    { g: box(0.05, 0.07, 0.16, -0.8, 0.36, 0.25), c: tail, glow: 2.5 },
    { g: box(0.05, 0.07, 0.16, -0.8, 0.36, -0.25), c: tail, glow: 2.5 },
    { g: wheel(0.15, 0.1, 0.5, 0.36), c: tyre },
    { g: wheel(0.15, 0.1, 0.5, -0.36), c: tyre },
    { g: wheel(0.15, 0.1, -0.5, 0.36), c: tyre },
    { g: wheel(0.15, 0.1, -0.5, -0.36), c: tyre },
  ]);
  const scooter = model([
    { g: wheel(0.13, 0.07, 0.33, 0), c: tyre },
    { g: wheel(0.13, 0.07, -0.3, 0), c: tyre },
    { g: box(0.62, 0.16, 0.22, 0, 0.26, 0), c: white, tint: 1 },
    { g: box(0.08, 0.34, 0.2, 0.3, 0.42, 0), c: white, tint: 1 },
    { g: box(0.04, 0.04, 0.34, 0.3, 0.6, 0), c: t.color('--city-handlebar') },
    { g: box(0.05, 0.07, 0.08, 0.35, 0.5, 0), c: head, glow: 3 },
    { g: box(0.04, 0.05, 0.1, -0.32, 0.36, 0), c: tail, glow: 2.5 },
    { g: box(0.2, 0.32, 0.24, -0.05, 0.58, 0), c: t.color('--city-rider') },
    { g: box(0.24, 0.1, 0.22, 0.02, 0.38, 0), c: t.color('--city-rider-legs') },
    { g: ball(0.11, -0.02, 0.84, 0), c: white, tint: 1 },
  ]);
  const pants = t.color('--city-pants');
  const person = model(
    [
      { g: box(0.09, 0.4, 0.09, 0, 0.2, 0.06), c: pants, limb: 1 },
      { g: box(0.09, 0.4, 0.09, 0, 0.2, -0.06), c: pants, limb: -1 },
      { g: box(0.13, 0.32, 0.25, 0, 0.56, 0), c: white, tint: 1 },
      { g: box(0.07, 0.28, 0.07, 0, 0.55, 0.165), c: white, tint: 1, limb: -2 },
      { g: box(0.07, 0.28, 0.07, 0, 0.55, -0.165), c: white, tint: 1, limb: 2 },
      { g: ball(0.085, 0, 0.82, 0), c: t.color('--city-skin') },
      { g: ball(0.09, -0.012, 0.85, 0), c: t.color('--city-hair') },
    ],
    0.85,
  );
  return { car, scooter, person };
}

/** Hair styles of the Character_File appearance (play-loop Requirement 2). */
export type HairStyle = 'short' | 'medium' | 'long' | 'tied' | 'none';

/**
 * The Avatar: the person model with the look chosen in Character_Creation (play-loop task 6.3, extended after the
 * user found that the walking figure did not look like the chosen Character). Skin and hair use the same tokens as
 * the 2D preview (--look-skin, --look-hair); the hair shape follows the preview: a cap (short), to the chin (medium),
 * down the back (long), a cap with a bun at the back (tied), or none. The person faces +x; z is sideways. The
 * clothing colour is the instance colour (tint) and the body width is set by the Walker.
 */
export function avatarModel(t: CityTokens, hair: string): THREE.BufferGeometry {
  const pants = t.color('--city-pants');
  const white = new THREE.Color(1, 1, 1);
  const skin = t.color('--look-skin');
  const h = t.color('--look-hair');
  const cap = { g: ball(0.09, -0.012, 0.85, 0), c: h };
  const hairParts: Record<HairStyle, Part[]> = {
    short: [cap],
    medium: [cap, { g: box(0.11, 0.13, 0.195, -0.035, 0.785, 0), c: h }],
    long: [cap, { g: box(0.1, 0.32, 0.2, -0.045, 0.69, 0), c: h }],
    tied: [cap, { g: ball(0.05, -0.11, 0.84, 0), c: h }],
    none: [],
  };
  return model(
    [
      { g: box(0.09, 0.4, 0.09, 0, 0.2, 0.06), c: pants, limb: 1 },
      { g: box(0.09, 0.4, 0.09, 0, 0.2, -0.06), c: pants, limb: -1 },
      { g: box(0.13, 0.32, 0.25, 0, 0.56, 0), c: white, tint: 1 },
      { g: box(0.07, 0.28, 0.07, 0, 0.55, 0.165), c: white, tint: 1, limb: -2 },
      { g: box(0.07, 0.28, 0.07, 0, 0.55, -0.165), c: white, tint: 1, limb: 2 },
      { g: ball(0.085, 0, 0.82, 0), c: skin },
      ...(hairParts[hair as HairStyle] ?? hairParts.short),
    ],
    0.85,
  );
}

export function moverMaterial(time: { value: number }, walk: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.25, vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms['uTime'] = time;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aTint; attribute float aGlow; attribute float aLimb; uniform float uTime; varying float vGlow; varying vec3 vRaw;',
      )
      .replace(
        '#include <color_vertex>',
        'vColor = color * mix(vec3(1.0), instanceColor.xyz, aTint); vRaw = color; vGlow = aGlow;',
      )
      .replace(
        '#include <begin_vertex>',
        walk
          ? `vec3 transformed = vec3(position);
          if (aLimb != 0.0) {
            float pivot = abs(aLimb) > 1.5 ? 0.58 : 0.34;
            float a = sin(uTime * 7.0 + float(gl_InstanceID) * 1.7) * 0.5 * sign(aLimb);
            vec2 p = vec2(transformed.x, transformed.y - pivot);
            transformed.xy = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a) + pivot);
          }`
          : '#include <begin_vertex>',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow; varying vec3 vRaw;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vRaw * vGlow + diffuseColor.rgb * 0.18;');
  };
  return mat;
}

export interface TrafficLayer {
  /** Moves every mover by dt seconds and updates the instances. */
  step(dt: number, time: number): void;
  /** Share (0–1) of the movers drawn (Quality_Level). */
  setShare(share: number): void;
}

export function createTraffic(scene: THREE.Scene, grid: StreetGrid, tokens: CityTokens, rand: Rand): TrafficLayer {
  const n = grid.list.length;
  const time = { value: 0 };
  const roadTiles = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: tokens.color('--city-road'), roughness: 0.6, metalness: 0.3 }),
    Math.max(1, n),
  );
  const tmp = new THREE.Object3D();
  grid.list.forEach((key, k) => {
    const [i, j] = key.slice(1).split(',').map(Number) as [number, number];
    if (key.startsWith('h')) {
      tmp.position.set((i + 0.5) * SPACING, GROUND_DEPTH + 0.05, j * SPACING);
      tmp.scale.set(SPACING + ROAD_HALF_WIDTH * 2, 1, ROAD_HALF_WIDTH * 2);
    } else {
      tmp.position.set(i * SPACING, GROUND_DEPTH + 0.05, (j + 0.5) * SPACING);
      tmp.scale.set(ROAD_HALF_WIDTH * 2, 1, SPACING + ROAD_HALF_WIDTH * 2);
    }
    tmp.updateMatrix();
    roadTiles.setMatrixAt(k, tmp.matrix);
  });
  roadTiles.count = n;
  roadTiles.receiveShadow = true;
  scene.add(roadTiles);

  const m = buildModels(tokens);
  const groups: { movers: Mover[]; mesh: THREE.InstancedMesh }[] = [];
  const add = (count: number, geo: THREE.BufferGeometry, walk: boolean, palette: THREE.Color[], make: () => Mover) => {
    const movers = n === 0 ? [] : Array.from({ length: count }, make);
    const mesh = new THREE.InstancedMesh(geo, moverMaterial(time, walk), Math.max(1, movers.length));
    mesh.count = movers.length;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < movers.length; i++) mesh.setColorAt(i, palette[Math.floor(rand() * palette.length)]!);
    scene.add(mesh);
    groups.push({ movers, mesh });
  };
  add(Math.min(2500, Math.round(n * 0.9)), m.car, false, tokens.list('--city-car-', 6), () => spawn(grid, rand, 7 + rand() * 4, 0.6));
  add(Math.min(3000, Math.round(n * 1.1)), m.scooter, false, tokens.list('--city-scooter-', 6), () =>
    spawn(grid, rand, 6 + rand() * 5, 1.05),
  );
  add(Math.min(3500, Math.round(n * 1.3)), m.person, true, tokens.list('--city-shirt-', 6), () =>
    spawn(grid, rand, 0.6 + rand() * 0.6, rand() < 0.5 ? 1.75 : -1.75),
  );

  let share = 1;
  const step = (dt: number, t: number) => {
    time.value = t;
    for (const g of groups) {
      const count = Math.round(g.movers.length * share);
      g.mesh.count = count;
      for (let k = 0; k < count; k++) {
        const mv = g.movers[k]!;
        advance(mv, dt, grid, rand);
        const p = poseOf(mv);
        tmp.position.set(p.x, GROUND_DEPTH, p.z);
        tmp.rotation.set(0, p.heading, 0);
        tmp.scale.set(1, 1, 1);
        tmp.updateMatrix();
        g.mesh.setMatrixAt(k, tmp.matrix);
      }
      g.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  step(0, 0);
  return {
    step,
    setShare(s) {
      share = s;
      step(0, time.value);
    },
  };
}
