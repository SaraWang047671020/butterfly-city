// Draws the street detail of street-detail.ts around the Avatar in Walk_Mode (city-3d Requirement 14, approved
// 2026-11-24): one InstancedMesh of unit boxes per kind, plus the light pools. Rebuilt when the Avatar has moved
// REBUILD_STEP units or the building heights changed. Static: no flicker and no animation (product.md motion rules).
import * as THREE from 'three';
import { boxCollider, type Collider } from './collision.ts';
import { GROUND_DEPTH } from './districts.ts';
import type { QualityLevel } from './scene.ts';
import { DETAIL_KINDS, detailNear, obstaclesClearOf, SHOP_COLOURS, SIGN_COLOURS, type DetailKind, type DetailQuery } from './street-detail.ts';
import type { CityTokens } from './tokens.ts';

/** Radius of the detail around the Avatar per Quality_Level, in world units. */
export const DETAIL_RADIUS: Record<QualityLevel, number> = { high: 42, low: 25 };
const REBUILD_STEP = 10;
const MAX: Record<DetailKind, number> = { shop: 900, slab: 900, column: 6000, sign: 1500, band: 900, pole: 900, arm: 900, lamp: 900 };
const GLOW_SIZE = 4.4;

export interface StreetDetailLayer {
  /** Shows the detail around (x, z), rebuilding it when needed; `avatarRadius` keeps the Avatar out of new obstacles. */
  update(x: number, z: number, avatarRadius: number): void;
  hide(): void;
  /** The heights changed: rebuild at the next update. */
  invalidate(): void;
  setQuality(q: QualityLevel): void;
  /** The columns and lamp poles shown now (user decision B2: they block the Avatar). */
  readonly collider: Collider;
  dispose(): void;
}

const NONE: Collider = { blocked: () => false };

/**
 * A shader patch that gives the fragment shader metric coordinates on each box face (vQ, from 0 to the face size vSz)
 * and the object normal. Each patched material gets its own program key (the default key is the source of
 * onBeforeCompile, which is the same function for every material).
 */
function patch(material: THREE.Material, key: string, fragment: string): void {
  material.customProgramCacheKey = () => `street-detail-${key}`;
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSize; varying vec3 vONrm; varying vec2 vQ; varying vec2 vSz; varying vec2 vOrg;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vONrm = normal;
        #ifdef USE_INSTANCING
          vOrg = instanceMatrix[3].xz;
        #else
          vOrg = vec2(0.0);
        #endif
        vec3 q = (position + 0.5) * aSize;
        bool onX = abs(normal.x) > 0.5;
        bool onZ = abs(normal.z) > 0.5;
        vQ = onX ? q.zy : (onZ ? q.xy : q.xz);
        vSz = onX ? aSize.zy : (onZ ? aSize.xy : aSize.xz);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vONrm; varying vec2 vQ; varying vec2 vSz; varying vec2 vOrg;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n{\n${fragment}\n}`);
  };
}

/** Signs: a dark panel, a lit outline and blocks of abstract glyphs (no text: neutrality.md). */
const SIGN_FRAGMENT = `
  float side = 1.0 - step(0.5, abs(vONrm.y));
  vec2 n = max(vec2(1.0), floor(vSz / 0.34));
  vec2 cell = vSz / n;
  vec2 g = floor(vQ / cell);
  vec2 f = fract(vQ / cell);
  vec2 s = floor((f - 0.16) / 0.68 * 3.0);
  float inGlyph = step(0.16, f.x) * step(f.x, 0.84) * step(0.16, f.y) * step(f.y, 0.84);
  float seed = h2(floor(vOrg * 3.0));
  float stroke = inGlyph * step(0.42, h2(g * 13.0 + s + seed * 31.0));
  vec2 e = min(vQ, vSz - vQ);
  float rim = 1.0 - step(0.045, min(e.x, e.y));
  diffuseColor.rgb *= mix(0.22, 1.0, side * max(stroke, rim)) * 1.25;
`;

/** Shopfronts: lit glass with door and window divisions and a darker counter at the bottom. */
const SHOP_FRAGMENT = `
  float div = step(0.06, fract(vQ.x / 0.75));
  float counter = mix(0.45, 1.0, step(0.28, vQ.y));
  float glow = 0.75 + 0.35 * (vQ.y / max(vSz.y, 0.01));
  diffuseColor.rgb *= div * counter * glow * 1.2;
`;

/** Light pools: a soft round falloff. */
const GLOW_FRAGMENT = `
  float r = length(vQ / vSz - 0.5) * 2.0;
  diffuseColor.a *= pow(1.0 - smoothstep(0.0, 1.0, r), 2.0) * 0.5;
`;

interface Layer {
  readonly mesh: THREE.InstancedMesh;
  readonly size: THREE.InstancedBufferAttribute;
}

export function createStreetDetail(scene: THREE.Scene, query: DetailQuery, tokens: CityTokens, quality: QualityLevel): StreetDetailLayer {
  const signs = tokens.list('--city-sign-', SIGN_COLOURS);
  const shops = tokens.list('--city-shop-', SHOP_COLOURS);
  const disposables: { dispose(): void }[] = [];

  const layer = (material: THREE.Material, max: number, geo: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1)): Layer => {
    const size = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    geo.setAttribute('aSize', size);
    const mesh = new THREE.InstancedMesh(geo, material, max);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances are rewritten around the Avatar; the bounds of the first build go stale
    scene.add(mesh);
    disposables.push(geo, material);
    return { mesh, size };
  };
  const glowing = (key: string, fragment: string) => {
    const m = new THREE.MeshBasicMaterial();
    patch(m, key, fragment);
    return m;
  };
  // The arcade is lit from below by the shopfronts: a little emissive keeps it readable at night.
  const solid = (name: string, glow: number) => {
    const c = tokens.color(name);
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.1, emissive: c, emissiveIntensity: glow });
  };
  const layers: Record<DetailKind, Layer> = {
    shop: layer(glowing('shop', SHOP_FRAGMENT), MAX.shop),
    slab: layer(solid('--city-arcade', 0.35), MAX.slab),
    column: layer(solid('--city-arcade-column', 0.25), MAX.column),
    sign: layer(glowing('sign', SIGN_FRAGMENT), MAX.sign),
    band: layer(glowing('sign', SIGN_FRAGMENT), MAX.band),
    pole: layer(solid('--city-pole', 0), MAX.pole),
    arm: layer(solid('--city-pole', 0), MAX.arm),
    lamp: layer(new THREE.MeshBasicMaterial({ color: tokens.color('--city-lamp') }), MAX.lamp),
  };
  // Every layer gets an instance colour before its first frame, so that its program is built with instance colours.
  for (const kind of DETAIL_KINDS) layers[kind].mesh.setColorAt(0, kind === 'shop' ? shops[0]! : signs[0]!);

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: tokens.color('--city-lamp-glow'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  patch(glowMaterial, 'glow', GLOW_FRAGMENT);
  const glows = layer(glowMaterial, MAX.lamp, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  glows.mesh.renderOrder = 1;

  let radius = DETAIL_RADIUS[quality];
  let withGlows = quality === 'high';
  let collider: Collider = NONE;
  const last = new THREE.Vector2(Infinity, Infinity);
  const tmp = new THREE.Object3D();
  const white = new THREE.Color(1, 1, 1);

  const clear = () => {
    for (const l of Object.values(layers)) l.mesh.count = 0;
    glows.mesh.count = 0;
    collider = NONE;
    last.set(Infinity, Infinity);
  };

  const build = (x: number, z: number, avatarRadius: number) => {
    const d = detailNear(query, x, z, radius);
    const counts = new Map<DetailKind, number>();
    for (const b of d.boxes) {
      const l = layers[b.kind];
      const i = counts.get(b.kind) ?? 0;
      if (i >= MAX[b.kind]) continue;
      counts.set(b.kind, i + 1);
      tmp.position.set(b.x, GROUND_DEPTH + b.y, b.z);
      tmp.scale.set(b.sx, b.sy, b.sz);
      tmp.updateMatrix();
      l.mesh.setMatrixAt(i, tmp.matrix);
      l.size.setXYZ(i, b.sx, b.sy, b.sz);
      l.mesh.setColorAt(i, b.kind === 'shop' ? shops[b.colour]! : b.kind === 'sign' || b.kind === 'band' ? signs[b.colour]! : white);
    }
    for (const kind of DETAIL_KINDS) {
      const l = layers[kind];
      l.mesh.count = counts.get(kind) ?? 0;
      l.mesh.instanceMatrix.needsUpdate = true;
      l.size.needsUpdate = true;
      if (l.mesh.instanceColor !== null) l.mesh.instanceColor.needsUpdate = true;
    }
    const pools = withGlows ? d.glows.slice(0, MAX.lamp) : [];
    pools.forEach((g, i) => {
      tmp.position.set(g.x, GROUND_DEPTH + 0.03, g.z);
      tmp.scale.set(GLOW_SIZE, 1, GLOW_SIZE);
      tmp.updateMatrix();
      glows.mesh.setMatrixAt(i, tmp.matrix);
      glows.size.setXYZ(i, GLOW_SIZE, 0, GLOW_SIZE);
    });
    glows.mesh.count = pools.length;
    glows.mesh.instanceMatrix.needsUpdate = true;
    glows.size.needsUpdate = true;
    // An obstacle that would appear on top of the Avatar is left out, so that the Avatar can never be trapped.
    collider = boxCollider(obstaclesClearOf(d.obstacles, x, z, avatarRadius));
    last.set(x, z);
  };

  return {
    update(x, z, avatarRadius) {
      if (Math.hypot(x - last.x, z - last.y) > REBUILD_STEP) build(x, z, avatarRadius);
    },
    hide: clear,
    invalidate() {
      last.set(Infinity, Infinity);
    },
    setQuality(q) {
      radius = DETAIL_RADIUS[q];
      withGlows = q === 'high';
      last.set(Infinity, Infinity);
    },
    get collider() {
      return collider;
    },
    dispose() {
      for (const l of [...Object.values(layers), glows]) scene.remove(l.mesh);
      for (const d of disposables) d.dispose();
    },
  };
}
