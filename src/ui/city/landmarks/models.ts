// Simplified Landmark models built in code from primitive shapes (city-3d Requirement 7.2). Not survey data.
// Each model stands on y = 0 with its front toward +z; sizes are game scale, like the rest of the City_View.
import * as THREE from 'three';
import type { CityTokens } from '../tokens.ts';
import { buildArchetype } from './archetypes.ts';
import type { LandmarkModelId } from './table.ts';

export interface LandmarkModel {
  readonly group: THREE.Group;
  /** Height of the label above the ground. */
  readonly top: number;
  /** Per-frame animation (the Ferris wheel turns); `time` in seconds. */
  readonly animate?: (time: number) => void;
}

interface Kit {
  readonly mat: (token: string, glow?: number) => THREE.MeshStandardMaterial;
  readonly box: (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => THREE.Mesh;
}

function kit(tokens: CityTokens): Kit {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (token: string, glow = 0.12) => {
    const key = `${token}|${glow}`;
    let m = cache.get(key);
    if (m === undefined) {
      const c = tokens.color(token);
      m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.2, emissive: c.clone().multiplyScalar(glow) });
      cache.set(key, m);
    }
    return m;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  return { mat, box };
}

/** A four-sided hip roof of footprint w × d and height h, base at y. */
function hipRoof(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): THREE.Mesh {
  const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  geo.rotateY(Math.PI / 4);
  geo.scale(w, h, d);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  return mesh;
}

/** A square frustum (4 sides) from bottom half-size b to top half-size t. */
function frustum(b: number, t: number, h: number, y: number, m: THREE.Material): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(t * Math.SQRT2, b * Math.SQRT2, h, 4, 1);
  geo.rotateY(Math.PI / 4);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.y = y + h / 2;
  mesh.castShadow = true;
  return mesh;
}

function tower101(k: Kit): LandmarkModel {
  const g = new THREE.Group();
  const glass = k.mat('--city-landmark-glass', 0.5);
  const band = k.mat('--city-landmark-glass-light', 2);
  g.add(k.box(10, 4, 10, 0, 0, 0, glass));
  g.add(frustum(3.3, 2.7, 16, 4, glass));
  // Eight stacked sections that widen upward.
  for (let i = 0; i < 8; i++) {
    const y = 20 + i * 6;
    g.add(frustum(2.4, 3.2, 6, y, glass));
    g.add(frustum(2.45, 2.45, 0.25, y, band));
  }
  g.add(frustum(2.2, 1.6, 4, 68, glass));
  g.add(frustum(1.2, 0.9, 3, 72, band));
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 12, 8), k.mat('--city-landmark-steel', 0.6));
  spire.position.y = 81;
  g.add(spire);
  return { group: g, top: 90 };
}

function palace(k: Kit, w: number, d: number, x: number, z: number, body: number, roofTiers: number): THREE.Group {
  const g = new THREE.Group();
  const stone = k.mat('--city-landmark-stone', 0.15);
  const red = k.mat('--city-landmark-red', 0.2);
  const roof = k.mat('--city-landmark-roof-gold', 0.25);
  g.add(k.box(w + 2, 1.5, d + 2, x, 0, z, stone));
  g.add(k.box(w, body, d, x, 1.5, z, red));
  let y = 1.5 + body;
  for (let t = 0; t < roofTiers; t++) {
    const s = 1 - t * 0.35;
    g.add(hipRoof((w + 3) * s, 2.2, (d + 3) * s, x, y, z, roof));
    if (t < roofTiers - 1) {
      g.add(k.box(w * s * 0.6, 2, d * s * 0.6, x, y + 1.2, z, red));
      y += 3;
    }
  }
  return g;
}

function grandHotel(k: Kit): LandmarkModel {
  const g = new THREE.Group();
  const red = k.mat('--city-landmark-red', 0.2);
  const roof = k.mat('--city-landmark-roof-gold', 0.3);
  const light = k.mat('--city-landmark-light', 1.4);
  g.add(k.box(22, 9, 6, 0, 0, 0, red));
  for (let i = -4; i <= 4; i++) g.add(k.box(1, 7, 0.2, i * 2.3, 1, 3.05, light));
  g.add(hipRoof(25, 3, 9, 0, 9, 0, roof));
  g.add(palace(k, 7, 5, 0, 0, 3, 2).translateY(10.5));
  return { group: g, top: 22 };
}

function theaterConcertHall(k: Kit): LandmarkModel {
  const g = new THREE.Group();
  g.add(palace(k, 9, 7, -10, 0, 6, 2));
  g.add(palace(k, 9, 7, 10, 0, 6, 2));
  g.add(k.box(11, 0.3, 16, 0, 0, 0, k.mat('--city-landmark-stone', 0.1)));
  return { group: g, top: 16 };
}

function presidentialOffice(k: Kit): LandmarkModel {
  const g = new THREE.Group();
  const brick = k.mat('--city-landmark-brick', 0.18);
  const stone = k.mat('--city-landmark-stone', 0.2);
  g.add(k.box(26, 7, 5, 0, 0, 0, brick));
  g.add(k.box(4, 7, 10, -11, 0, -2.5, brick));
  g.add(k.box(4, 7, 10, 11, 0, -2.5, brick));
  for (let x = -12; x <= 12; x += 3) g.add(k.box(0.4, 7, 0.3, x, 0, 2.6, stone));
  g.add(k.box(4, 14, 4, 0, 7, 0, brick));
  g.add(k.box(4.4, 0.6, 4.4, 0, 14, 0, stone));
  g.add(k.box(2.4, 3, 2.4, 0, 21, 0, brick));
  g.add(hipRoof(3, 2.5, 3, 0, 24, 0, k.mat('--city-landmark-roof-dark', 0.1)));
  return { group: g, top: 29 };
}

function mainStation(k: Kit): LandmarkModel {
  const g = new THREE.Group();
  const stone = k.mat('--city-landmark-stone', 0.18);
  const light = k.mat('--city-landmark-light', 1.2);
  g.add(k.box(16, 8, 12, 0, 0, 0, stone));
  g.add(k.box(14, 1, 0.2, 0, 5.5, 6.05, light));
  g.add(hipRoof(18, 4, 14, 0, 8, 0, k.mat('--city-landmark-roof-dark', 0.15)));
  return { group: g, top: 15 };
}

function ferrisWheel(k: Kit): LandmarkModel {
  const g = new THREE.Group();
  const steel = k.mat('--city-landmark-steel', 0.5);
  const light = k.mat('--city-landmark-light', 1.6);
  g.add(k.box(14, 7, 10, 0, 0, 0, k.mat('--city-landmark-stone', 0.15)));
  const radius = 8;
  const hubY = 7 + radius + 1.5;
  g.add(k.box(0.6, hubY - 7, 0.6, -1, 7, 0, steel));
  g.add(k.box(0.6, hubY - 7, 0.6, 1, 7, 0, steel));
  const wheel = new THREE.Group();
  wheel.position.set(0, hubY, 0);
  wheel.rotation.y = Math.PI / 2;
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(radius, 0.18, 6, 48), light));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(radius, 0.1, 0.1), steel);
    spoke.position.set(Math.cos(a) * radius * 0.5, Math.sin(a) * radius * 0.5, 0);
    spoke.rotation.z = a;
    wheel.add(spoke);
  }
  const cabins: THREE.Mesh[] = [];
  for (let i = 0; i < 24; i++) {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.7), light);
    wheel.add(cabin);
    cabins.push(cabin);
  }
  const place = (turn: number) => {
    cabins.forEach((c, i) => {
      const a = (i / cabins.length) * Math.PI * 2 + turn;
      c.position.set(Math.cos(a) * radius, Math.sin(a) * radius - 0.5, 0);
    });
  };
  place(0);
  g.add(wheel);
  return { group: g, top: hubY + radius + 3, animate: (t) => place(t * 0.05) };
}

function longshanTemple(k: Kit): LandmarkModel {
  const g = new THREE.Group();
  const red = k.mat('--city-landmark-red', 0.25);
  const roof = k.mat('--city-landmark-roof-gold', 0.35);
  g.add(k.box(11, 1, 9, 0, 0, 0, k.mat('--city-landmark-stone', 0.1)));
  g.add(k.box(9, 3.5, 7, 0, 1, 0, red));
  g.add(hipRoof(11, 2, 9, 0, 4.5, 0, roof));
  // Swallowtail ridge: two tips that curve up at the ends of the ridge.
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 0.4), roof);
    tip.position.set(side * 3.6, 6.9, 0);
    tip.rotation.z = side * 0.5;
    g.add(tip);
  }
  g.add(palace(k, 4, 3, 0, -2.5, 2, 1).translateY(5.5));
  return { group: g, top: 12 };
}

function loversBridge(k: Kit): LandmarkModel {
  const g = new THREE.Group();
  const steel = k.mat('--city-landmark-steel', 0.6);
  g.add(k.box(20, 0.5, 2, 0, 2.5, 0, steel));
  g.add(k.box(1, 2.5, 1.6, -9.5, 0, 0, steel));
  g.add(k.box(1, 2.5, 1.6, 9.5, 0, 0, steel));
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.5, 13, 0.5), steel);
  mast.position.set(-3, 8.5, 0);
  mast.rotation.z = 0.35;
  g.add(mast);
  const top = new THREE.Vector3(-5.2, 14.6, 0);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) pts.push(top, new THREE.Vector3(-1 + i * 1.4, 3, 0));
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: k.mat('--city-landmark-light').color })));
  return { group: g, top: 17 };
}

function banqiaoStation(k: Kit): LandmarkModel {
  const g = new THREE.Group();
  const glass = k.mat('--city-landmark-glass', 0.3);
  const band = k.mat('--city-landmark-glass-light', 1.1);
  g.add(k.box(18, 6, 14, 0, 0, 0, k.mat('--city-landmark-stone', 0.15)));
  g.add(k.box(10, 22, 10, 0, 6, 0, glass));
  for (let y = 9; y < 28; y += 4) g.add(k.box(10.1, 0.25, 10.1, 0, y, 0, band));
  return { group: g, top: 31 };
}

export function buildLandmark(id: LandmarkModelId, tokens: CityTokens): LandmarkModel {
  const k = kit(tokens);
  switch (id) {
    case 'tower101':
      return tower101(k);
    case 'grandHotel':
      return grandHotel(k);
    case 'theaterConcertHall':
      return theaterConcertHall(k);
    case 'presidentialOffice':
      return presidentialOffice(k);
    case 'mainStation':
      return mainStation(k);
    case 'ferrisWheel':
      return ferrisWheel(k);
    case 'longshanTemple':
      return longshanTemple(k);
    case 'loversBridge':
      return loversBridge(k);
    case 'banqiaoStation':
      return banqiaoStation(k);
    default:
      return buildArchetype(id, tokens);
  }
}
