// Butterfly City 3D prototype (not production code; not part of any spec yet).
// Reads the real public/data files and draws the 41 districts as a night city.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { geoMercator } from 'd3-geo';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Ring = [number, number][];
interface District { code: string; city: string; name: string; areaKm2: number; centroid: [number, number]; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: any } }
interface Rec { value: number | null; estimated: boolean; dataPeriod?: string }
interface Indicator { id: string; unit: string; series: Record<string, Rec[]> }

const BASE = import.meta.env.BASE_URL;
const [dFile, hFile] = await Promise.all([
  fetch(`${BASE}data/districts.json`).then((r) => r.json()),
  fetch(`${BASE}data/history.json`).then((r) => r.json()),
]);
const districts: District[] = dFile.districts;
const quarters: string[] = hFile.quarters;
const ind = new Map<string, Indicator>((hFile.indicators as Indicator[]).map((i) => [i.id, i]));
const series = (id: string, code: string): Rec[] => ind.get(id)?.series[code] ?? [];

// ---------- projection: 1 world unit = 100 m ----------
const proj = geoMercator().center([121.6, 25.0]).scale(6371000 / 100).translate([0, 0]);
const P = (lonlat: [number, number]): [number, number] => proj(lonlat) as [number, number];
const polygons = (d: District): Ring[][] => (d.geometry.type === 'Polygon' ? [d.geometry.coordinates] : d.geometry.coordinates);

// ---------- seeded random ----------
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20151);

function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!; const [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- renderer, scene, camera ----------
const stage = document.getElementById('stage')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
stage.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
stage.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a18);
scene.fog = new THREE.FogExp2(0x0a0e22, 0.0016);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 6000);
camera.position.set(0, 900, 900);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.46;
controls.minDistance = 30;
controls.maxDistance = 1400;

scene.add(new THREE.HemisphereLight(0x8090d0, 0x101020, 1.1));
const moon = new THREE.DirectionalLight(0xaab8ff, 1.1);
moon.position.set(-400, 600, -300);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -500, right: 500, top: 500, bottom: -500, far: 2000 });
scene.add(moon);
const moonBall = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ color: 0xf3f0d8, fog: false }));
moonBall.position.set(-1600, 900, -2200);
scene.add(moonBall);

{ // stars
  const n = 1800, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = rand() * Math.PI * 2, ph = rand() * Math.PI * 0.45, r = 3500;
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd6ff, size: 3, sizeAttenuation: false, fog: false })));
}
const water = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: 0x0b1430, roughness: 0.35, metalness: 0.6 }));
water.rotation.x = -Math.PI / 2; water.position.y = -2;
scene.add(water);

// ---------- districts ----------
interface DView { d: District; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; center: THREE.Vector3; label: CSS2DObject; density: number }
const views: DView[] = [];
const SLAB = 2;
for (const d of districts) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x223, roughness: 0.9, emissive: 0x000000 });
  const shapes: THREE.Shape[] = [];
  const borders = new THREE.Group();
  for (const poly of polygons(d)) {
    const outer = poly[0]!.map(P);
    const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const hole of poly.slice(1)) shape.holes.push(new THREE.Path(hole.map(P).map(([x, z]) => new THREE.Vector2(x, -z))));
    shapes.push(shape);
    const pts = outer.map(([x, z]) => new THREE.Vector3(x, SLAB + 0.2, z));
    borders.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.35 })));
  }
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: SLAB, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.code = d.code;
  scene.add(mesh, borders);
  const [cx, cz] = P(d.centroid);
  const el = document.createElement('div'); el.className = 'label'; el.textContent = d.name;
  const label = new CSS2DObject(el); label.position.set(cx, SLAB + 12, cz); scene.add(label);
  const pop = series('population', d.code)[0]?.value ?? 0;
  views.push({ d, mesh, mat, center: new THREE.Vector3(cx, SLAB, cz), label, density: pop / d.areaKm2 });
}

// ---------- buildings and trees (instanced) ----------
interface Bld { v: number; h0: number; g: number }
const blds: Bld[] = [];
const bMatrices: THREE.Matrix4[] = [];
const treeM: THREE.Matrix4[] = [];
const tmp = new THREE.Object3D();
// Street grid: S world units between streets (1.3 km is not real; it is a game scale), used in districts above URBAN persons per km².
const S = 13, ROAD_HW = 1.4, URBAN = 2500;
const gridDist = (a: number) => { const m = ((a % S) + S) % S; return Math.min(m, S - m); };
views.forEach((v, vi) => {
  const pop = series('population', v.d.code)[0]?.value ?? 0;
  const count = Math.round(pop / 1400);
  const rings = polygons(v.d).map((poly) => poly[0]!.map(P));
  const all = rings.flat();
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minZ = Math.min(...all.map((p) => p[1])), maxZ = Math.max(...all.map((p) => p[1]));
  const inside = (x: number, z: number) => rings.some((r) => inRing(x, z, r));
  // Buildings cluster toward the district centre, so mountain districts keep a small town and open forest.
  const spread = Math.max(maxX - minX, maxZ - minZ) * (v.density > 5000 ? 0.6 : 0.18);
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 60) {
    tries++;
    const x = v.center.x + (rand() + rand() + rand() - 1.5) * spread;
    const z = v.center.z + (rand() + rand() + rand() - 1.5) * spread;
    if (!inside(x, z)) continue;
    const w = 2.2 + rand() * 2.4, dpt = 2.2 + rand() * 2.4;
    // Keep the street grid free in urban districts.
    if (v.density > URBAN && (gridDist(x) < w / 2 + ROAD_HW + 0.3 || gridDist(z) < dpt / 2 + ROAD_HW + 0.3)) continue;
    const h0 = (2 + Math.pow(rand(), 3.5) * 24) * (0.5 + Math.min(v.density, 40000) / 50000);
    tmp.position.set(x, SLAB, z); tmp.rotation.set(0, 0, 0); tmp.scale.set(w, h0, dpt); tmp.updateMatrix();
    bMatrices.push(tmp.matrix.clone()); blds.push({ v: vi, h0, g: 0.55 + rand() * 0.45 });
    placed++;
  }
  const trees = Math.min(1400, Math.round(v.d.areaKm2 * (v.density < 3000 ? 9 : 1.5)));
  for (let t = 0, k = 0; t < trees && k < trees * 8; k++) {
    const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
    if (!inside(x, z)) continue;
    if (v.density > URBAN && (gridDist(x) < ROAD_HW + 1 || gridDist(z) < ROAD_HW + 1)) continue;
    const s = 1.5 + rand() * 2.5;
    tmp.position.set(x, SLAB, z); tmp.scale.set(s, s * (1.6 + rand()), s); tmp.updateMatrix();
    treeM.push(tmp.matrix.clone()); t++;
  }
});

const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
const bMat = new THREE.MeshStandardMaterial({ color: 0x8890b8, roughness: 0.7, metalness: 0.15 });
const winUniform = { value: 1 };
bMat.onBeforeCompile = (sh) => {
  sh.uniforms.uWin = winUniform;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vONrm;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 wpos = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wpos = instanceMatrix * wpos;
      #endif
      vWPos = (modelMatrix * wpos).xyz; vONrm = normal;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uWin; varying vec3 vWPos; varying vec3 vONrm;
      float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float side = 1.0 - step(0.5, abs(vONrm.y));
        float u = abs(vONrm.x) > 0.5 ? vWPos.z : vWPos.x;
        float fy = fract(vWPos.y * 1.1), fu = fract(u * 1.4);
        float win = step(0.4, fy) * step(fy, 0.72) * step(0.3, fu) * step(fu, 0.7);
        float lit = step(1.0 - 0.28 * uWin, h3(floor(vec3(u * 1.4, vWPos.y * 1.1, vWPos.x + vWPos.z))));
        float near = 1.0 - smoothstep(120.0, 420.0, length(vViewPosition));
        totalEmissiveRadiance += diffuseColor.rgb * 0.3;
        totalEmissiveRadiance += near * mix(vec3(1.0, 0.7, 0.35), vec3(0.75, 0.85, 1.0), h3(floor(vWPos * 0.37))) * 1.1 * win * side * lit;
      }`);
};
const buildings = new THREE.InstancedMesh(boxGeo, bMat, bMatrices.length);
bMatrices.forEach((m, i) => { buildings.setMatrixAt(i, m); buildings.setColorAt(i, new THREE.Color(0x888888)); });
buildings.castShadow = true; buildings.receiveShadow = true;

// ---------- streets, traffic and pedestrians ----------
const urbanRings = views.filter((v) => v.density > URBAN).map((v) => polygons(v.d).map((poly) => poly[0]!.map(P)));
const isUrban = (x: number, z: number) => urbanRings.some((rs) => rs.some((r) => inRing(x, z, r)));
const edgeKey = (i: number, j: number, h: boolean) => `${h ? 'h' : 'v'}${i},${j}`;
const edges = new Set<string>();
const roadTiles: THREE.Matrix4[] = [];
{
  const all = urbanRings.flat(2);
  const i0 = Math.floor(Math.min(...all.map((p) => p[0])) / S), i1 = Math.ceil(Math.max(...all.map((p) => p[0])) / S);
  const j0 = Math.floor(Math.min(...all.map((p) => p[1])) / S), j1 = Math.ceil(Math.max(...all.map((p) => p[1])) / S);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    if (isUrban((i + 0.5) * S, j * S)) { edges.add(edgeKey(i, j, true)); tmp.position.set((i + 0.5) * S, SLAB + 0.05, j * S); tmp.scale.set(S + ROAD_HW * 2, 1, ROAD_HW * 2); tmp.updateMatrix(); roadTiles.push(tmp.matrix.clone()); }
    if (isUrban(i * S, (j + 0.5) * S)) { edges.add(edgeKey(i, j, false)); tmp.position.set(i * S, SLAB + 0.05, (j + 0.5) * S); tmp.scale.set(ROAD_HW * 2, 1, S + ROAD_HW * 2); tmp.updateMatrix(); roadTiles.push(tmp.matrix.clone()); }
  }
}
const tileGeo = new THREE.PlaneGeometry(1, 1); tileGeo.rotateX(-Math.PI / 2);
const roads = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.6, metalness: 0.3 }), roadTiles.length);
roadTiles.forEach((m, i) => roads.setMatrixAt(i, m));
roads.receiveShadow = true;
scene.add(roads);

// Neighbours of a grid node along existing street edges.
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const hasEdge = (i: number, j: number, di: number, dj: number) =>
  di !== 0 ? edges.has(edgeKey(di > 0 ? i : i - 1, j, true)) : edges.has(edgeKey(i, dj > 0 ? j : j - 1, false));
interface Mover { i: number; j: number; di: number; dj: number; t: number; speed: number; lane: number; y: number; sx: number; sy: number; sz: number }
const edgeList = [...edges];
function spawn(speed: number, lane: number, y: number, sx: number, sy: number, sz: number): Mover {
  const k = edgeList[Math.floor(rand() * edgeList.length)]!;
  const [a, b] = k.slice(1).split(',').map(Number) as [number, number];
  const h = k[0] === 'h', fwd = rand() < 0.5;
  const m: Mover = h ? { i: fwd ? a : a + 1, j: b, di: fwd ? 1 : -1, dj: 0, t: rand(), speed, lane, y, sx, sy, sz }
                     : { i: a, j: fwd ? b : b + 1, di: 0, dj: fwd ? 1 : -1, t: rand(), speed, lane, y, sx, sy, sz };
  return m;
}
function advance(m: Mover, dt: number) {
  m.t += (m.speed * dt) / S;
  while (m.t >= 1) {
    m.t -= 1; m.i += m.di; m.j += m.dj;
    const opts = DIRS.filter(([di, dj]) => !(di === -m.di && dj === -m.dj) && hasEdge(m.i, m.j, di, dj));
    const straight = opts.find(([di, dj]) => di === m.di && dj === m.dj);
    const next = straight && rand() < 0.6 ? straight : opts[Math.floor(rand() * opts.length)] ?? [-m.di, -m.dj];
    m.di = next[0]; m.dj = next[1];
  }
}
function place(m: Mover, out: THREE.Matrix4) {
  // Right-hand lane offset: perpendicular to the heading.
  const x = (m.i + m.di * m.t) * S - m.dj * m.lane, z = (m.j + m.dj * m.t) * S + m.di * m.lane;
  tmp.position.set(x, SLAB + m.y, z);
  tmp.rotation.set(0, Math.atan2(-m.dj, m.di), 0);
  tmp.scale.set(m.sx, m.sy, m.sz);
  tmp.updateMatrix(); out.copy(tmp.matrix);
}
const nE = edgeList.length;
// Low-poly models built from merged primitives. Per-vertex attributes:
//   color: base colour; aTint: 1 = takes the instance colour (paint, shirt, helmet), 0 = fixed (glass, tyres, skin);
//   aGlow: emissive strength (head and tail lights); aLimb: walking swing (people only).
type Part = { g: THREE.BufferGeometry; c: number; tint?: number; glow?: number; limb?: number };
function model(parts: Part[], scale = 1): THREE.BufferGeometry {
  const geos = parts.map(({ g, c, tint = 0, glow = 0, limb = 0 }) => {
    const n = g.attributes.position!.count, col = new THREE.Color(c);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => [col.r, col.g, col.b][i % 3]!), 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
    g.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  });
  const out = mergeGeometries(geos)!; out.scale(scale, scale, scale); return out;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const ball = (r: number, x: number, y: number, z: number, seg = 6) => new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)).translate(x, y, z);
const wheel = (r: number, w: number, x: number, z: number) => new THREE.CylinderGeometry(r, r, w, 10).rotateX(Math.PI / 2).translate(x, r, z);
const TYRE = 0x111114, GLASS = 0x1c2433, HEAD = 0xfff1c4, TAIL = 0xff3030;
const carGeo = model([
  { g: box(1.6, 0.34, 0.74, 0, 0.3, 0), c: 0xffffff, tint: 1 },               // body
  { g: box(0.86, 0.28, 0.68, -0.06, 0.6, 0), c: GLASS },                       // cabin glass
  { g: box(0.8, 0.05, 0.64, -0.08, 0.76, 0), c: 0xffffff, tint: 1 },          // roof
  { g: box(0.06, 0.08, 0.16, 0.8, 0.34, 0.24), c: HEAD, glow: 3 },
  { g: box(0.06, 0.08, 0.16, 0.8, 0.34, -0.24), c: HEAD, glow: 3 },
  { g: box(0.05, 0.07, 0.16, -0.8, 0.36, 0.25), c: TAIL, glow: 2.5 },
  { g: box(0.05, 0.07, 0.16, -0.8, 0.36, -0.25), c: TAIL, glow: 2.5 },
  ...[[0.5, 0.36], [0.5, -0.36], [-0.5, 0.36], [-0.5, -0.36]].map(([x, z]) => ({ g: wheel(0.15, 0.1, x!, z!), c: TYRE })),
]);
const scooterGeo = model([
  { g: wheel(0.13, 0.07, 0.33, 0), c: TYRE }, { g: wheel(0.13, 0.07, -0.3, 0), c: TYRE },
  { g: box(0.62, 0.16, 0.22, 0, 0.26, 0), c: 0xffffff, tint: 1 },             // body
  { g: box(0.08, 0.34, 0.2, 0.3, 0.42, 0), c: 0xffffff, tint: 1 },            // front shield
  { g: box(0.04, 0.04, 0.34, 0.3, 0.6, 0), c: 0x333333 },                      // handlebar
  { g: box(0.05, 0.07, 0.08, 0.35, 0.5, 0), c: HEAD, glow: 3 },
  { g: box(0.04, 0.05, 0.1, -0.32, 0.36, 0), c: TAIL, glow: 2.5 },
  { g: box(0.2, 0.32, 0.24, -0.05, 0.58, 0), c: 0x2a2f3d },                    // rider jacket
  { g: box(0.24, 0.1, 0.22, 0.02, 0.38, 0), c: 0x22252e },                     // rider legs
  { g: ball(0.11, -0.02, 0.84, 0, 8), c: 0xffffff, tint: 1 },                  // helmet
]);
const SKIN = 0xd9b08c, PANTS = 0x2a2d38, HAIR = 0x1a1410;
const personGeo = model([
  { g: box(0.09, 0.4, 0.09, 0, 0.2, 0.06), c: PANTS, limb: 1 },
  { g: box(0.09, 0.4, 0.09, 0, 0.2, -0.06), c: PANTS, limb: -1 },
  { g: box(0.13, 0.32, 0.25, 0, 0.56, 0), c: 0xffffff, tint: 1 },             // shirt
  { g: box(0.07, 0.28, 0.07, 0, 0.55, 0.165), c: 0xffffff, tint: 1, limb: -2 }, // arms
  { g: box(0.07, 0.28, 0.07, 0, 0.55, -0.165), c: 0xffffff, tint: 1, limb: 2 },
  { g: ball(0.085, 0, 0.82, 0, 8), c: SKIN },
  { g: ball(0.09, -0.012, 0.85, 0, 8), c: HAIR },
], 0.85);
const uTime = { value: 0 };
const movers = {
  cars: Array.from({ length: Math.min(2500, Math.round(nE * 0.9)) }, () => spawn(7 + rand() * 4, 0.6, 0, 1, 1, 1)),
  scooters: Array.from({ length: Math.min(3000, Math.round(nE * 1.1)) }, () => spawn(6 + rand() * 5, 1.05, 0, 1, 1, 1)),
  people: Array.from({ length: Math.min(3500, Math.round(nE * 1.3)) }, () => spawn(0.6 + rand() * 0.6, rand() < 0.5 ? 1.75 : -1.75, 0, 1, 1, 1)),
};
const moverMesh = (geo: THREE.BufferGeometry, n: number, colors: number[], walk: boolean) => {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.25, vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint; attribute float aGlow; attribute float aLimb; uniform float uTime; varying float vGlow; varying vec3 vRaw;')
      .replace('#include <color_vertex>', 'vColor = color * mix(vec3(1.0), instanceColor.xyz, aTint); vRaw = color; vGlow = aGlow;')
      .replace('#include <begin_vertex>', walk ? `vec3 transformed = vec3(position);
        if (aLimb != 0.0) {
          float pivot = abs(aLimb) > 1.5 ? 0.58 : 0.34;
          float a = sin(uTime * 7.0 + float(gl_InstanceID) * 1.7) * 0.5 * sign(aLimb);
          vec2 p = vec2(transformed.x, transformed.y - pivot);
          transformed.xy = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a) + pivot);
        }` : '#include <begin_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow; varying vec3 vRaw;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vRaw * vGlow + diffuseColor.rgb * 0.18;');
  };
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  for (let i = 0; i < n; i++) mesh.setColorAt(i, new THREE.Color(colors[Math.floor(rand() * colors.length)]!));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  return mesh;
};
const carMesh = moverMesh(carGeo, movers.cars.length, [0xf2f2f2, 0xbfc4cc, 0xffd23f, 0xffd23f, 0xb83a3a, 0x3a64b8, 0x2b2b30], false);
const scooterMesh = moverMesh(scooterGeo, movers.scooters.length, [0xf2f2f2, 0x9fb7d6, 0xe05a5a, 0x5ac08a, 0xf0c050, 0x333333], false);
const peopleMesh = moverMesh(personGeo, movers.people.length, [0xe9e4dc, 0x8ab0d8, 0xd88aa0, 0x9cc48a, 0xe0b060, 0x6a6f8a], true);
const mtx = new THREE.Matrix4();
function stepTraffic(dt: number) {
  const groups: [Mover[], THREE.InstancedMesh][] = [[movers.cars, carMesh], [movers.scooters, scooterMesh], [movers.people, peopleMesh]];
  for (const [list, mesh] of groups) {
    for (let k = 0; k < list.length; k++) { advance(list[k]!, dt); place(list[k]!, mtx); mesh.setMatrixAt(k, mtx); }
    mesh.instanceMatrix.needsUpdate = true;
  }
}
stepTraffic(0);
scene.add(buildings);

const coneGeo = new THREE.ConeGeometry(0.5, 1, 6); coneGeo.translate(0, 0.5, 0);
const forest = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0x2f5a44, roughness: 1, emissive: 0x0c1a12 }), treeM.length);
treeM.forEach((m, i) => forest.setMatrixAt(i, m));
scene.add(forest);

// ---------- ghosts ----------
function ghostTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 64; c.height = 80;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 30, 4, 32, 36, 40);
  grad.addColorStop(0, 'rgba(220,235,255,0.95)'); grad.addColorStop(1, 'rgba(160,190,255,0.0)');
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(8, 72); g.lineTo(8, 32); g.arc(32, 32, 24, Math.PI, 0); g.lineTo(56, 72);
  for (let i = 0; i < 4; i++) g.quadraticCurveTo(50 - i * 12, 62, 44 - i * 12, 72);
  g.fill();
  g.fillStyle = 'rgba(10,14,40,0.9)';
  g.beginPath(); g.ellipse(24, 34, 3.5, 5, 0, 0, Math.PI * 2); g.ellipse(40, 34, 3.5, 5, 0, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
}
const gTex = ghostTexture();
interface Ghost { s: THREE.Sprite; base: THREE.Vector3; phase: number; v: number }
const ghosts: Ghost[] = [];
function latestLowUse(code: string, qi: number): number | null {
  const s = series('lowUseHousingRate', code);
  for (let i = qi; i >= 0; i--) if (s[i]?.value != null) return s[i]!.value;
  for (let i = qi; i < s.length; i++) if (s[i]?.value != null) return s[i]!.value;
  return null;
}
views.forEach((v, vi) => {
  for (let k = 0; k < 6; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.set(11, 14, 1);
    const base = v.center.clone().add(new THREE.Vector3((rand() - 0.5) * 30, 40 + rand() * 30, (rand() - 0.5) * 30));
    s.position.copy(base); s.visible = false; scene.add(s);
    ghosts.push({ s, base, phase: rand() * Math.PI * 2, v: vi });
  }
});

// ---------- indicator colouring ----------
const RAMP = ['#3A70BA', '#2A98B0', '#4DBB8C', '#B5D866', '#F1D35A', '#F0953F', '#D9468F']; // --color-seq-0..6 of the game-ui Design_Proposal
type IndId = 'rent' | 'salePrice' | 'lowUseHousingRate' | 'popChange';
const UNITS: Record<IndId, string> = { rent: 'TWD/m²', salePrice: 'TWD/m²', lowUseHousingRate: '%', popChange: '%' };
function valueOf(id: IndId, code: string, qi: number): number | null {
  if (id === 'popChange') {
    const s = series('population', code); const a = s[0]?.value, b = s[qi]?.value;
    return a && b != null ? ((b - a) / a) * 100 : null;
  }
  if (id === 'lowUseHousingRate') return latestLowUse(code, qi);
  return series(id, code)[qi]?.value ?? null;
}
// Fixed class bounds over all quarters (quantiles), so colours compare across time.
const bounds = new Map<IndId, number[]>();
for (const id of ['rent', 'salePrice', 'lowUseHousingRate', 'popChange'] as IndId[]) {
  const all: number[] = [];
  for (const v of views) for (let q = 0; q < quarters.length; q++) { const x = valueOf(id, v.d.code, q); if (x != null) all.push(x); }
  all.sort((a, b) => a - b);
  bounds.set(id, [1, 2, 3, 4, 5, 6].map((k) => all[Math.floor((all.length - 1) * (k / 7))]!));
}
const classOf = (id: IndId, x: number) => bounds.get(id)!.filter((b) => x >= b).length;
const fmt = (x: number) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en') : x.toFixed(1));

let indicator: IndId = 'rent';
let qi = 0;
let selected: DView | null = null;
let hovered: DView | null = null;
const heightTarget = new Float32Array(views.length).fill(1);
const heightNow = new Float32Array(views.length).fill(1);

function refresh() {
  document.getElementById('quarter')!.textContent = quarters[qi]!;
  for (const [vi, v] of views.entries()) {
    const x = valueOf(indicator, v.d.code, qi);
    if (x == null) { v.mat.color.set(0x3a3d4a); v.mat.emissive.set(0x000000); }
    else { const c = new THREE.Color(RAMP[classOf(indicator, x)]); v.mat.color.copy(c); v.mat.emissive.copy(c).multiplyScalar(0.25); }
    const p0 = series('salePrice', v.d.code)[0]?.value, p = series('salePrice', v.d.code)[qi]?.value;
    heightTarget[vi] = p0 && p ? Math.min(1.8, p / p0) : 1;
    const lu = latestLowUse(v.d.code, qi) ?? 0;
    const gb = bounds.get('lowUseHousingRate')!; const nGhost = lu >= gb[5]! ? 4 : lu >= gb[4]! ? 2 : 0;
    ghosts.filter((g) => g.v === vi).forEach((g, k) => (g.s.visible = k < nGhost));
  }
  const cc = new THREE.Color();
  for (let i = 0; i < blds.length; i++) { const bl = blds[i]!; cc.copy(views[bl.v]!.mat.color).lerp(new THREE.Color(0x9aa0b8), 0.25).multiplyScalar(bl.g * 1.5); buildings.setColorAt(i, cc); }
  if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
  const b = bounds.get(indicator)!;
  const lg = document.getElementById('legend')!;
  lg.innerHTML = RAMP.map((c, i) => `<span class="sw" style="background:${c}" title="${i === 0 ? '< ' + fmt(b[0]!) : i === 6 ? '≥ ' + fmt(b[5]!) : fmt(b[i - 1]!) + '–' + fmt(b[i]!)}"></span>`).join('') +
    `<span>&nbsp;${fmt(b[0]!)} … ${fmt(b[5]!)} ${UNITS[indicator]}</span>`;
  showInfo();
}
function showInfo() {
  const box = document.getElementById('info')!;
  if (!selected) { box.style.display = 'none'; return; }
  const c = selected.d.code;
  box.style.display = 'block';
  document.getElementById('info-name')!.textContent = `${selected.d.name}, ${selected.d.city}`;
  const row = (k: string, x: number | null, u: string) => `<dt>${k}</dt><dd>${x == null ? 'No data' : fmt(x) + ' ' + u}</dd>`;
  document.getElementById('info-list')!.innerHTML =
    row('Population', series('population', c)[qi]?.value ?? null, '') +
    row('Rent', valueOf('rent', c, qi), 'TWD/m²/mo') +
    row('Sale price', valueOf('salePrice', c, qi), 'TWD/m²') +
    row('Low-use housing', latestLowUse(c, qi), '%') +
    row('Population change', valueOf('popChange', c, qi), '%') +
    `<dt>Quarter</dt><dd>${quarters[qi]}</dd>`;
}

// ---------- interaction ----------
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const pick = (e: PointerEvent): DView | null => {
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(views.map((v) => v.mesh))[0];
  return hit ? views.find((v) => v.mesh === hit.object) ?? null : null;
};
let downAt = { x: 0, y: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener('pointermove', (e) => {
  const v = pick(e);
  if (hovered && hovered !== selected) hovered.mat.emissiveIntensity = 1;
  hovered = v; if (v) v.mat.emissiveIntensity = 2.5;
  renderer.domElement.style.cursor = v ? 'pointer' : 'grab';
});
let fly: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number } | null = null;
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  const v = pick(e);
  if (selected) selected.mat.emissiveIntensity = 1;
  selected = v;
  if (v) {
    v.mat.emissiveIntensity = 3;
    const dir = camera.position.clone().sub(controls.target).normalize();
    const dist = Math.max(90, Math.sqrt(v.d.areaKm2) * 18);
    fly = { from: controls.target.clone(), to: v.center.clone(), camFrom: camera.position.clone(), camTo: v.center.clone().add(dir.multiplyScalar(dist)), t: 0 };
  }
  showInfo();
});

const slider = document.getElementById('slider') as HTMLInputElement;
slider.addEventListener('input', () => { qi = Number(slider.value); refresh(); });
(document.getElementById('indicator') as HTMLSelectElement).addEventListener('change', (e) => { indicator = (e.target as HTMLSelectElement).value as IndId; refresh(); });
let playing: number | null = null;
document.getElementById('play')!.addEventListener('click', (e) => {
  const b = e.target as HTMLButtonElement;
  if (playing != null) { clearInterval(playing); playing = null; b.textContent = 'Play'; return; }
  if (qi >= quarters.length - 1) qi = -1;
  b.textContent = 'Pause';
  playing = window.setInterval(() => {
    qi++; slider.value = String(qi); refresh();
    if (qi >= quarters.length - 1) { clearInterval(playing!); playing = null; b.textContent = 'Play'; }
  }, 700);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight);
});

// ---------- loop ----------
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const intro = { t: reduced ? 1 : 0 };
const focus = new THREE.Vector3(...((p) => [p[0], 0, p[1]] as const)(P([121.53, 25.05]))); controls.target.copy(focus);
const camStart = focus.clone().add(new THREE.Vector3(0, 1300, 1400)), camEnd = focus.clone().add(new THREE.Vector3(-40, 170, 230));
(window as any).__city = { camera, controls };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clock = new THREE.Clock();
const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
refresh();
setTimeout(() => (document.getElementById('intro')!.style.opacity = '0'), reduced ? 0 : 900);
// Harness options for the City_Design_Proposal screenshots: ?bare hides the prototype HUD, ?q=<0..43> sets the quarter,
// ?select=<code> selects a district, ?ind=<indicator> sets the indicator.
{
  const qs = new URLSearchParams(location.search);
  if (qs.has('bare')) {
    for (const id of ['hud', 'bar', 'intro', 'info']) document.getElementById(id)!.style.visibility = 'hidden';
    intro.t = 1; camera.position.copy(camEnd);
  }
  if (qs.has('ind')) indicator = qs.get('ind') as IndId;
  if (qs.has('q')) { qi = Number(qs.get('q')); slider.value = String(qi); }
  const sel = views.find((v) => v.d.code === qs.get('select'));
  if (sel) { selected = sel; sel.mat.emissiveIntensity = 3; controls.target.copy(sel.center); camera.position.copy(sel.center).add(new THREE.Vector3(-30, 150, 200)); }
  refresh();
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05), time = clock.elapsedTime;
  if (intro.t < 1) { intro.t = Math.min(1, intro.t + dt / 4); camera.position.lerpVectors(camStart, camEnd, ease(intro.t)); }
  else if (intro.t === 1 && !fly) { /* free orbit */ }
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / (reduced ? 0.01 : 1.4)); const k = ease(fly.t);
    controls.target.lerpVectors(fly.from, fly.to, k); camera.position.lerpVectors(fly.camFrom, fly.camTo, k);
    if (fly.t >= 1) fly = null;
  }
  // Buildings grow or shrink toward the price-driven height of the displayed quarter.
  let dirty = false;
  for (let i = 0; i < views.length; i++) {
    const d = heightTarget[i]! - heightNow[i]!;
    if (Math.abs(d) > 1e-3) { heightNow[i] = heightNow[i]! + d * Math.min(1, dt * (reduced ? 60 : 4)); dirty = true; }
  }
  if (dirty) {
    for (let i = 0; i < blds.length; i++) {
      bMatrices[i]!.decompose(pos, quat, scl);
      scl.y = blds[i]!.h0 * heightNow[blds[i]!.v]!;
      buildings.setMatrixAt(i, m4.compose(pos, quat, scl));
    }
    buildings.instanceMatrix.needsUpdate = true;
  }
  uTime.value = time;
  if (!reduced) stepTraffic(dt);
  for (const g of ghosts) {
    if (!g.s.visible) continue;
    const a = reduced ? 0 : time * 0.8 + g.phase;
    g.s.position.set(g.base.x + Math.sin(a * 0.7) * 6, g.base.y + Math.sin(a) * 3, g.base.z + Math.cos(a * 0.6) * 6);
    (g.s.material as THREE.SpriteMaterial).opacity = 0.55 + 0.35 * Math.sin(a * 1.7);
  }
  const camDist = camera.position.distanceTo(controls.target);
  for (const v of views) (v.label.element as HTMLElement).style.opacity = String(camDist < 700 || v.d.areaKm2 > 40 ? 1 : 0);
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
});
