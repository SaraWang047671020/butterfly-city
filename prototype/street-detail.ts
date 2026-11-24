// Prototype for city-3d task 11 (street detail near the Avatar), kept as the source of the approved design proposal
// screenshots; the production code is src/ui/city/street-detail*.ts (its finer-window patch no longer matches buildings.ts). Runs the City_View harness
// of prototype/city-view.ts and adds, in Walk_Mode, the detail of prototype/street-detail-place.ts around the Avatar
// and finer windows on the buildings near the camera. `?detail=0` or `__detail.set(false)` turns the detail off, for before and
// after screenshots. Not production code; never imported by src/.
import * as THREE from 'three';
import { loadDataFiles } from '../src/data/loader.ts';
import { buildCityStatic } from '../src/game/core/views.ts';
import { GROUND_DEPTH } from '../src/ui/city/districts.ts';
import { landmarkClearings } from '../src/ui/city/landmarks/index.ts';
import { METRO_DATA } from '../src/ui/city/metro/station-data.ts';
import { placeDistrict, type PlacementInput } from '../src/ui/city/placement.ts';
import { project } from '../src/ui/city/projection.ts';
import { buildStreetGrid } from '../src/ui/city/street-grid.ts';
import { readTokens } from '../src/ui/city/tokens.ts';
import { detailNear, SHOP_COLOURS, SIGN_COLOURS, type DetailBuilding, type DetailKind } from './street-detail-place.ts';

const RADIUS = 42;
const REBUILD_STEP = 10;
const MAX = { shop: 900, slab: 900, column: 6000, sign: 1500, band: 900, pole: 900, arm: 900, lamp: 900 } as const;

const qs = new URLSearchParams(location.search);
let enabled = qs.get('detail') !== '0';
const info = document.getElementById('detail')!;

// --- the same placements and Street_Grid as src/ui/city/index.ts
const loaded = await loadDataFiles(
  (url, init) => fetch(url, init),
  import.meta.env.BASE_URL,
  () => {},
  { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as number) },
);
if (!loaded.ok) throw new Error('load failed');
const statics = buildCityStatic(loaded.data).districts;
const clearings = landmarkClearings();
const stationClear = METRO_DATA.stations.map((st) => {
  const [x, z] = project([st.lon, st.lat]);
  return { x, z, r: 2.5 };
});
const inputs: PlacementInput[] = statics.map((d) => ({
  code: d.code,
  polygons: d.polygons.map((poly) => poly.map((ring) => ring.map((p) => project(p)))),
  center: project(d.centroid),
  areaKm2: d.areaKm2,
  population2015: d.population2015,
  clearings: [...clearings, ...stationClear],
}));
const placements = inputs.map(placeDistrict);
const grid = buildStreetGrid(inputs.filter((_, i) => placements[i]!.urban).flatMap((p) => p.polygons), clearings);
const spots = placements.flatMap((p) => p.buildings);

// --- a shader patch that gives a material the world position, the object normal and metric face coordinates
function patch(material: THREE.Material, fragment: string, after = '#include <color_fragment>'): void {
  // The default program key is the source of onBeforeCompile, which is the same for every patched material.
  material.customProgramCacheKey = () => fragment;
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aSize; varying vec3 vWPos; varying vec3 vONrm; varying vec2 vQ; varying vec2 vSz;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        vWPos = (modelMatrix * wp).xyz; vONrm = normal;
        vec3 q = (position + 0.5) * aSize;
        bool onX = abs(normal.x) > 0.5;
        vQ = onX ? q.zy : (abs(normal.z) > 0.5 ? q.xy : q.xz);
        vSz = onX ? aSize.zy : (abs(normal.z) > 0.5 ? aSize.xy : aSize.xz);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos; varying vec3 vONrm; varying vec2 vQ; varying vec2 vSz;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
      )
      .replace(after, `${after}\n{\n${fragment}\n}`);
  };
}

/** Sign faces: a dark panel, a lit outline and blocks of abstract glyphs (no text, no logos: neutrality.md). */
const SIGN_FRAGMENT = `
  float side = 1.0 - step(0.5, abs(vONrm.y));
  vec2 n = max(vec2(1.0), floor(vSz / 0.34));
  vec2 cell = vSz / n;
  vec2 g = floor(vQ / cell);
  vec2 f = fract(vQ / cell);
  vec2 s = floor((f - 0.16) / 0.68 * 3.0);
  float inGlyph = step(0.16, f.x) * step(f.x, 0.84) * step(0.16, f.y) * step(f.y, 0.84);
  float seed = h2(floor(vWPos.xz * 3.0) + g * 7.0);
  float stroke = inGlyph * step(0.42, h2(g * 13.0 + s + seed * 31.0));
  vec2 e = min(vQ, vSz - vQ);
  float rim = 1.0 - step(0.045, min(e.x, e.y));
  float k = mix(0.22, 1.0, side * max(stroke, rim));
  diffuseColor.rgb *= k * 1.25;
`;

/** Shopfronts: lit glass with door and window divisions, a darker counter at the bottom. */
const SHOP_FRAGMENT = `
  float u = fract(vQ.x / 0.75);
  float div = step(0.06, u);
  float counter = mix(0.45, 1.0, step(0.28, vQ.y));
  float glow = 0.75 + 0.35 * (vQ.y / max(vSz.y, 0.01));
  diffuseColor.rgb *= div * counter * glow * 1.2;
`;

/** Light pools: a soft round falloff, added to the ground. */
const GLOW_FRAGMENT = `
  float r = length(vQ / vSz - 0.5) * 2.0;
  diffuseColor.a *= pow(1.0 - smoothstep(0.0, 1.0, r), 2.0) * 0.5;
`;

/** Finer windows near the camera: frames, a mullion, curtains, dark panes with a faint reflection, no windows in the
 * shopfront storey. Replaces the window line of src/ui/city/buildings.ts; the far city is unchanged. */
const WINDOW_LINE = 'totalEmissiveRadiance += near * mix(uWarm, uCool, h3(floor(vWPos * 0.37))) * 1.1 * win * side * lit;';
const FINE_WINDOWS = `
  float fine = 1.0 - smoothstep(25.0, 70.0, length(vViewPosition));
  float wy = (fy - 0.4) / 0.32, wu = (fu - 0.3) / 0.4;
  float pane = step(0.1, wy) * step(wy, 0.9) * step(0.08, wu) * step(wu, 0.92) * step(0.035, abs(wu - 0.5));
  float frameK = mix(1.0, pane, fine);
  float curtain = mix(1.0, 0.7 + 0.45 * wy, fine);
  float upper = mix(1.0, step(${(GROUND_DEPTH + 1.75).toFixed(2)}, vWPos.y), fine);
  vec3 tint = mix(uWarm, uCool, mix(h3(floor(vWPos * 0.37)), h3(floor(vec3(u * 1.4, vWPos.y * 1.1, vWPos.x + vWPos.z)) + 3.1), fine * 0.6));
  totalEmissiveRadiance += near * tint * 1.1 * win * side * lit * frameK * curtain * upper;
  totalEmissiveRadiance += fine * (1.0 - lit) * win * side * pane * upper * uCool * 0.07;
`;

interface Layer {
  readonly mesh: THREE.InstancedMesh;
  readonly size: THREE.InstancedBufferAttribute;
}

function boxLayer(scene: THREE.Scene, material: THREE.Material, max: number, colours: THREE.Color[] | null): Layer {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  geo.setAttribute('aSize', size);
  const mesh = new THREE.InstancedMesh(geo, material, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  if (colours !== null) mesh.setColorAt(0, colours[0]!);
  scene.add(mesh);
  return { mesh, size };
}

function setup(scene: THREE.Scene): (camera: THREE.Camera) => void {
  const tokens = readTokens(document.documentElement);
  const signs = tokens.list('--city-sign-', SIGN_COLOURS);
  const shops = tokens.list('--city-shop-', SHOP_COLOURS);

  // The building layer: the InstancedMesh with one instance per illustrative building.
  let buildingMesh: THREE.InstancedMesh | null = null;
  scene.traverse((o) => {
    if (o instanceof THREE.InstancedMesh && o.count === spots.length && o.geometry instanceof THREE.BoxGeometry) buildingMesh = o;
  });
  const bm = buildingMesh as THREE.InstancedMesh | null;
  const windowMaterial = bm?.material as THREE.MeshStandardMaterial | undefined;
  const plainCompile = windowMaterial?.onBeforeCompile;
  const setFineWindows = (on: boolean) => {
    if (windowMaterial === undefined || plainCompile === undefined) return;
    windowMaterial.onBeforeCompile = (sh, r) => {
      plainCompile.call(windowMaterial, sh, r);
      if (on) sh.fragmentShader = sh.fragmentShader.replace(WINDOW_LINE, FINE_WINDOWS);
    };
    windowMaterial.customProgramCacheKey = () => (on ? 'fine-windows' : 'plain-windows');
    windowMaterial.needsUpdate = true;
  };

  const basic = (fragment: string | null) => {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
    if (fragment !== null) patch(m, fragment);
    return m;
  };
  // The arcade is lit from below by the shopfronts: a little emissive keeps it readable at night.
  const standard = (colour: THREE.Color, glow = 0) =>
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85, metalness: 0.1, emissive: colour, emissiveIntensity: glow });
  const layers: Record<DetailKind, Layer> = {
    shop: boxLayer(scene, basic(SHOP_FRAGMENT), MAX.shop, shops),
    slab: boxLayer(scene, standard(tokens.color('--city-arcade'), 0.35), MAX.slab, null),
    column: boxLayer(scene, standard(tokens.color('--city-arcade-column'), 0.25), MAX.column, null),
    sign: boxLayer(scene, basic(SIGN_FRAGMENT), MAX.sign, signs),
    band: boxLayer(scene, basic(SIGN_FRAGMENT), MAX.band, signs),
    pole: boxLayer(scene, standard(tokens.color('--city-pole')), MAX.pole, null),
    arm: boxLayer(scene, standard(tokens.color('--city-pole')), MAX.arm, null),
    lamp: boxLayer(scene, new THREE.MeshBasicMaterial({ color: tokens.color('--city-lamp') }), MAX.lamp, null),
  };
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: tokens.color('--city-lamp-glow'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  patch(glowMaterial, GLOW_FRAGMENT);
  const glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const glowSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX.lamp * 3), 3);
  glowGeo.setAttribute('aSize', glowSize);
  const glows = new THREE.InstancedMesh(glowGeo, glowMaterial, MAX.lamp);
  glows.count = 0;
  glows.frustumCulled = false;
  glows.renderOrder = 1;
  scene.add(glows);

  let ring: THREE.Mesh | null = null;
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry instanceof THREE.RingGeometry && ring === null) ring = o;
  });

  const tmp = new THREE.Object3D();
  const last = new THREE.Vector2(Infinity, Infinity);
  const heights = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();

  const clear = () => {
    for (const l of Object.values(layers)) l.mesh.count = 0;
    glows.count = 0;
    last.set(Infinity, Infinity);
  };

  const build = (x: number, z: number) => {
    const t0 = performance.now();
    // Current heights (after the Price_Index scale) from the building layer.
    const buildings: DetailBuilding[] = spots.map((s, i) => {
      let height = s.height;
      if (bm !== null) {
        bm.getMatrixAt(i, heights);
        heights.decompose(v, q, sc);
        height = sc.y;
      }
      return { x: s.x, z: s.z, hw: s.width / 2, hd: s.depth / 2, height };
    });
    const d = detailNear(buildings, grid, x, z, RADIUS);
    const counts: Partial<Record<DetailKind, number>> = {};
    for (const b of d.boxes) {
      const l = layers[b.kind];
      const i = counts[b.kind] ?? 0;
      if (i >= l.mesh.instanceMatrix.count) continue;
      counts[b.kind] = i + 1;
      tmp.position.set(b.x, GROUND_DEPTH + b.y, b.z);
      tmp.scale.set(b.sx, b.sy, b.sz);
      tmp.updateMatrix();
      l.mesh.setMatrixAt(i, tmp.matrix);
      l.size.setXYZ(i, b.sx, b.sy, b.sz);
      if (b.kind === 'sign' || b.kind === 'band') l.mesh.setColorAt(i, signs[b.colour]!);
      if (b.kind === 'shop') l.mesh.setColorAt(i, shops[b.colour]!);
    }
    for (const [kind, l] of Object.entries(layers) as [DetailKind, Layer][]) {
      l.mesh.count = counts[kind] ?? 0;
      l.mesh.instanceMatrix.needsUpdate = true;
      l.size.needsUpdate = true;
      if (l.mesh.instanceColor) l.mesh.instanceColor.needsUpdate = true;
    }
    d.glows.forEach((g, i) => {
      if (i >= MAX.lamp) return;
      tmp.position.set(g.x, GROUND_DEPTH + 0.03, g.z);
      tmp.scale.set(4.4, 1, 4.4);
      tmp.updateMatrix();
      glows.setMatrixAt(i, tmp.matrix);
      glowSize.setXYZ(i, 4.4, 0, 4.4);
    });
    glows.count = Math.min(MAX.lamp, d.glows.length);
    glows.instanceMatrix.needsUpdate = true;
    glowSize.needsUpdate = true;
    last.set(x, z);
    info.textContent = `Street detail ${enabled ? 'on' : 'off'} · ${d.boxes.length} boxes, ${d.glows.length} lights · ${(performance.now() - t0).toFixed(1)} ms`;
  };

  let windowsOn: boolean | null = null;
  return () => {
    const r = ring as THREE.Mesh | null;
    const walking = r !== null && r.visible;
    const want = enabled && walking;
    if (want !== windowsOn) {
      windowsOn = want;
      setFineWindows(want);
      if (!want) {
        clear();
        info.textContent = `Street detail ${enabled ? 'on' : 'off'}${walking ? '' : ' · shown in Walk_Mode'}`;
      }
    }
    if (!want || r === null) return;
    if (Math.hypot(r.position.x - last.x, r.position.z - last.y) > REBUILD_STEP) build(r.position.x, r.position.z);
  };
}

// --- hook into the render loop of the City_View without changing it
let tick: ((camera: THREE.Camera) => void) | null = null;
// WebGLRenderer.render is set in the constructor, but it calls scene.onBeforeRender on every frame.
THREE.Scene.prototype.onBeforeRender = function (_renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera) {
  if (!(scene instanceof THREE.Scene)) return;
  tick ??= setup(scene);
  tick(camera);
};
(window as unknown as Record<string, unknown>)['__detail'] = { set: (on: boolean) => (enabled = on) };

await import('./city-view.ts');
