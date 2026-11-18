// Simplified Landmark archetypes for the district landmarks (city-3d Requirement 7.2). Built in code from primitives;
// each model stands on y = 0 with its front toward +z. Game scale, not survey data.
import * as THREE from 'three';
import type { CityTokens } from '../tokens.ts';
import type { LandmarkModel } from './models.ts';

export type ArchetypeId =
  | 'temple'
  | 'templeWhite'
  | 'earthGodTemple'
  | 'oldStreet'
  | 'hillVillage'
  | 'courtyardHouse'
  | 'palaceMuseum'
  | 'museum'
  | 'pyramidMuseum'
  | 'bathhouse'
  | 'arena'
  | 'stadium'
  | 'hall'
  | 'smallStation'
  | 'park'
  | 'lakeBridge'
  | 'zoo'
  | 'suspensionBridge'
  | 'girderBridge'
  | 'dam'
  | 'lighthouse'
  | 'lighthouseBanded'
  | 'waterfall'
  | 'rocks';

interface Kit {
  readonly m: (token: string, glow?: number, opts?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
  readonly box: (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => THREE.Mesh;
  readonly cyl: (rt: number, rb: number, h: number, x: number, y: number, z: number, mat: THREE.Material, seg?: number) => THREE.Mesh;
  readonly roof: (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => THREE.Mesh;
}

function kit(tokens: CityTokens): Kit {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const m = (token: string, glow = 0.12, opts: THREE.MeshStandardMaterialParameters = {}) => {
    const key = `${token}|${glow}|${JSON.stringify(opts)}`;
    let mat = cache.get(key);
    if (mat === undefined) {
      const c = tokens.color(token);
      mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.1, emissive: c.clone().multiplyScalar(glow), ...opts });
      cache.set(key, mat);
    }
    return mat;
  };
  const place = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  return {
    m,
    box: (w, h, d, x, y, z, mat) => place(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y + h / 2, z),
    cyl: (rt, rb, h, x, y, z, mat, seg = 16) => place(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat), x, y + h / 2, z),
    roof: (w, h, d, x, y, z, mat) => {
      const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(w, h, d);
      return place(new THREE.Mesh(geo, mat), x, y + h / 2, z);
    },
  };
}

function temple(k: Kit, body: string, roof: string, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const stone = k.m('--city-landmark-stone', 0.1);
  const walls = k.m(body, 0.22);
  const tiles = k.m(roof, 0.3);
  g.add(k.box(12, 1, 10, 0, 0, 0, stone));
  g.add(k.box(10, 3.5, 7, 0, 1, 0, walls));
  g.add(k.roof(12.5, 2.2, 9.5, 0, 4.5, 0, tiles));
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 0.4), tiles);
    tip.position.set(side * 4, 6.8, 0);
    tip.rotation.z = side * 0.5;
    g.add(tip);
  }
  g.add(k.box(5, 2, 4, 0, 6.5, -1.5, walls));
  g.add(k.roof(6.5, 1.8, 5.5, 0, 8.5, -1.5, tiles));
  g.add(k.box(1.2, 4, 1.2, -6.5, 0, 4, k.m('--city-landmark-light', 1.4))); // lantern posts
  g.add(k.box(1.2, 4, 1.2, 6.5, 0, 4, k.m('--city-landmark-light', 1.4)));
  g.scale.setScalar(scale);
  return g;
}

function shophouses(k: Kit, count: number, hill: boolean): THREE.Group {
  const g = new THREE.Group();
  const brick = k.m('--city-landmark-brick', 0.2);
  const stone = k.m('--city-landmark-stone', 0.2);
  const lantern = k.m('--city-taillight', 1.6);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 3.4;
    const y = hill ? Math.abs(x) * 0.35 : 0;
    const h = 4 + ((i * 7) % 3);
    for (const side of [-1, 1]) {
      g.add(k.box(3.2, h, 3, x, y, side * 3.5, i % 2 === 0 ? brick : stone));
      g.add(k.box(3.3, 0.8, 0.4, x, y + h, side * 2.1, stone)); // facade parapet
      g.add(k.cyl(0.3, 0.3, 0.5, x, y + 2.6, side * 1.7, lantern, 8));
    }
  }
  return g;
}

function bridgeDeck(k: Kit, length: number, width: number, y: number, mat: THREE.Material): THREE.Mesh {
  return k.box(length, 0.5, width, 0, y, 0, mat);
}

function water(k: Kit, w: number, d: number): THREE.Mesh {
  return k.box(w, 0.2, d, 0, 0, 0, k.m('--city-water', 0.4, { roughness: 0.2, metalness: 0.6 }));
}

function tree(k: Kit, x: number, z: number, s: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(1, 2.4, 6).translate(0, 1.2, 0), k.m('--city-tree', 0.15));
  mesh.position.set(x, 0, z);
  mesh.scale.setScalar(s);
  return mesh;
}

export function buildArchetype(id: ArchetypeId, tokens: CityTokens): LandmarkModel {
  const k = kit(tokens);
  const g = new THREE.Group();
  const stone = k.m('--city-landmark-stone', 0.18);
  const steel = k.m('--city-landmark-steel', 0.5);
  const glass = k.m('--city-landmark-glass', 0.4);
  const light = k.m('--city-landmark-light', 1.5);
  switch (id) {
    case 'temple':
      g.add(temple(k, '--city-landmark-red', '--city-landmark-roof-gold'));
      return { group: g, top: 11 };
    case 'templeWhite':
      g.add(temple(k, '--city-landmark-stone', '--city-landmark-green-tile', 1.2));
      return { group: g, top: 13 };
    case 'earthGodTemple': {
      g.add(temple(k, '--city-landmark-red', '--city-landmark-roof-gold', 0.8));
      const gold = k.m('--city-landmark-roof-gold', 0.6);
      g.add(k.cyl(1.6, 2.4, 9, 9, 0, -2, gold, 12)); // the large statue, seated figure as a stepped form
      g.add(k.box(5, 3, 3, 9, 0, -0.5, gold));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 8), gold).translateX(9).translateY(10.4).translateZ(-2));
      return { group: g, top: 14 };
    }
    case 'oldStreet':
      g.add(shophouses(k, 6, false));
      return { group: g, top: 9 };
    case 'hillVillage':
      g.add(shophouses(k, 6, true));
      g.add(k.box(6, 5, 4, -14, 5, -6, k.m('--city-landmark-roof-dark', 0.1))); // mine building
      return { group: g, top: 14 };
    case 'courtyardHouse': {
      const red = k.m('--city-landmark-brick', 0.22);
      const tiles = k.m('--city-landmark-roof-dark', 0.15);
      g.add(k.box(16, 0.4, 14, 0, 0, 0, stone));
      g.add(k.box(14, 3.5, 3, 0, 0.4, -5, red)); // main hall
      g.add(k.roof(15, 1.8, 4.5, 0, 3.9, -5, tiles));
      for (const side of [-1, 1]) {
        g.add(k.box(3, 3, 8, side * 5.5, 0.4, 1.5, red)); // side wings
        g.add(k.roof(4.2, 1.4, 9, side * 5.5, 3.4, 1.5, tiles));
      }
      return { group: g, top: 8 };
    }
    case 'palaceMuseum': {
      const walls = k.m('--city-landmark-stone', 0.25);
      const roof = k.m('--city-landmark-green-tile', 0.3);
      g.add(k.box(36, 2, 18, 0, 0, 0, stone)); // terraces
      g.add(k.box(30, 7, 12, 0, 2, -1, walls));
      g.add(k.roof(33, 3, 15, 0, 9, -1, roof));
      g.add(k.box(12, 3, 8, 0, 11.5, -1, walls));
      g.add(k.roof(14, 2.6, 10, 0, 14.5, -1, roof));
      for (let x = -12; x <= 12; x += 3) g.add(k.box(0.3, 5, 0.3, x, 2, 5.1, light));
      return { group: g, top: 20 };
    }
    case 'museum':
      g.add(k.box(18, 6, 12, 0, 0, 0, stone));
      g.add(k.box(8, 9, 8, -3, 0, -1, glass));
      g.add(k.box(18.2, 0.4, 0.3, 0, 4, 6.05, light));
      return { group: g, top: 13 };
    case 'pyramidMuseum': {
      const pyr = new THREE.Mesh(new THREE.ConeGeometry(8, 9, 4).rotateY(Math.PI / 4).translate(0, 4.5, 0), glass);
      g.add(pyr);
      for (let i = 0; i < 7; i++) g.add(k.box(1, 2 + (i % 3), 1, -12 + i * 4, 0, 9, k.m('--city-landmark-steel', 0.3))); // sculptures
      return { group: g, top: 13 };
    }
    case 'bathhouse': {
      const brick = k.m('--city-landmark-brick', 0.22);
      const wood = k.m('--city-landmark-wood', 0.2);
      g.add(k.box(12, 3, 7, 0, 0, 0, brick));
      g.add(k.box(12, 3, 7, 0, 3, 0, wood));
      g.add(k.roof(13.5, 2.5, 8.5, 0, 6, 0, k.m('--city-landmark-roof-dark', 0.15)));
      return { group: g, top: 11 };
    }
    case 'arena': {
      g.add(k.cyl(14, 15, 9, 0, 0, 0, stone, 32));
      g.add(k.cyl(13.5, 14, 1.5, 0, 9, 0, glass, 32));
      g.add(k.box(12, 5, 0.4, 0, 2.5, 14.6, k.m('--city-landmark-glass-light', 1.8))); // LED screen
      return { group: g, top: 14 };
    }
    case 'stadium': {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(15, 12, 6, 32, 1, true), stone);
      ring.position.y = 3;
      g.add(ring);
      g.add(k.cyl(12, 12, 0.2, 0, 0, 0, k.m('--city-landmark-grass', 0.3), 32));
      for (const a of [0.8, 2.4, 3.9, 5.5]) g.add(k.box(1, 14, 1, Math.cos(a) * 15, 0, Math.sin(a) * 15, steel));
      for (const a of [0.8, 2.4, 3.9, 5.5]) g.add(k.box(3, 1.5, 1, Math.cos(a) * 15, 14, Math.sin(a) * 15, light));
      return { group: g, top: 18 };
    }
    case 'hall':
      g.add(k.box(30, 8, 16, 0, 0, 0, glass));
      g.add(k.box(12, 22, 12, 12, 0, -2, glass));
      for (let y = 4; y < 22; y += 4) g.add(k.box(12.1, 0.3, 12.1, 12, y, -2, k.m('--city-landmark-glass-light', 1.6)));
      return { group: g, top: 26 };
    case 'smallStation': {
      g.add(k.box(12, 4, 6, 0, 0, 0, stone));
      g.add(k.roof(13, 2.2, 7, 0, 4, 0, k.m('--city-landmark-roof-dark', 0.15)));
      g.add(k.box(18, 0.6, 3, 0, 0, 6, stone)); // platform
      g.add(k.box(6, 0.4, 0.2, 0, 3, 3.05, light));
      return { group: g, top: 9 };
    }
    case 'park': {
      g.add(k.box(24, 0.2, 18, 0, 0, 0, k.m('--city-landmark-grass', 0.25)));
      g.add(k.box(8, 0.25, 6, -5, 0, 2, k.m('--city-water', 0.4, { roughness: 0.2, metalness: 0.6 })));
      for (const x of [-6, 6]) g.add(k.cyl(0.25, 0.25, 3, x + 8, 0, -4, k.m('--city-landmark-red', 0.2), 8));
      g.add(k.roof(5, 1.6, 4, 8, 3, -4, k.m('--city-landmark-roof-gold', 0.3)));
      for (let i = 0; i < 10; i++) g.add(tree(k, -10 + (i % 5) * 5, -7 + Math.floor(i / 5) * 14, 1 + (i % 3) * 0.3));
      return { group: g, top: 7 };
    }
    case 'lakeBridge': {
      g.add(water(k, 26, 16));
      const arc = new THREE.Mesh(new THREE.TorusGeometry(6, 0.5, 8, 24, Math.PI), k.m('--city-landmark-stone', 0.5));
      arc.position.y = 0.2;
      g.add(arc);
      g.add(k.box(3, 0.3, 2, 0, 6.2, 0, k.m('--city-landmark-stone', 0.5)));
      g.add(k.cyl(0.4, 0.4, 0.5, -6, 0.2, 0, light, 8));
      g.add(k.cyl(0.4, 0.4, 0.5, 6, 0.2, 0, light, 8));
      return { group: g, top: 10 };
    }
    case 'zoo': {
      g.add(k.box(26, 0.2, 18, 0, 0, 0, k.m('--city-landmark-grass', 0.25)));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass);
      g.add(dome);
      g.add(k.box(8, 4, 1, 0, 0, 9, k.m('--city-landmark-wood', 0.25))); // gate
      g.add(k.box(9, 1, 1.4, 0, 4, 9, k.m('--city-landmark-roof-gold', 0.4)));
      for (let i = 0; i < 8; i++) g.add(tree(k, -11 + i * 3, -7, 1.2));
      return { group: g, top: 11 };
    }
    case 'suspensionBridge': {
      g.add(water(k, 30, 14));
      g.add(bridgeDeck(k, 24, 1.6, 2, steel));
      for (const x of [-11, 11]) g.add(k.box(0.8, 7, 2, x, 0, 0, steel));
      const pts: THREE.Vector3[] = [];
      for (const z of [-0.8, 0.8]) {
        for (let i = 0; i <= 20; i++) {
          const x = -11 + i * 1.1;
          const y = 2.5 + 4.5 * Math.pow(x / 11, 2);
          if (i > 0) pts.push(pts[pts.length - 1]!.clone());
          pts.push(new THREE.Vector3(x, y, z));
        }
        pts.pop();
      }
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: light.color })));
      return { group: g, top: 10 };
    }
    case 'girderBridge': {
      g.add(water(k, 30, 10));
      g.add(bridgeDeck(k, 30, 4, 3, stone));
      for (let x = -12; x <= 12; x += 6) g.add(k.box(1, 3, 3, x, 0, 0, stone));
      for (let x = -14; x <= 14; x += 4) g.add(k.box(0.2, 1.5, 0.2, x, 3.5, 2, light));
      return { group: g, top: 7 };
    }
    case 'dam': {
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 12, 24, 1, true, -0.6, 1.2), stone);
      wall.position.set(0, 6, 14);
      g.add(wall);
      g.add(k.box(22, 0.3, 14, 0, 9, -4, k.m('--city-water', 0.4, { roughness: 0.2, metalness: 0.6 })));
      return { group: g, top: 15 };
    }
    case 'lighthouse':
    case 'lighthouseBanded': {
      const white = k.m('--city-landmark-steel', 0.4);
      const dark = k.m('--city-landmark-roof-dark', 0.1);
      g.add(k.box(8, 1.5, 8, 0, 0, 0, stone));
      for (let i = 0; i < 5; i++) g.add(k.cyl(1.8 - i * 0.12, 1.9 - i * 0.12, 2.6, 0, 1.5 + i * 2.6, 0, id === 'lighthouseBanded' && i % 2 === 1 ? dark : white, 8));
      g.add(k.cyl(1.3, 1.3, 1.6, 0, 14.5, 0, light, 8));
      g.add(k.cyl(0, 1.5, 1.4, 0, 16.1, 0, dark, 8));
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(2.5, 26, 16, 1, true).rotateZ(Math.PI / 2).translate(13, 15.3, 0),
        new THREE.MeshBasicMaterial({ color: light.color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
      );
      const pivot = new THREE.Group();
      pivot.add(beam);
      g.add(pivot);
      return { group: g, top: 19, animate: (t) => (pivot.rotation.y = t * 0.6) };
    }
    case 'waterfall': {
      const rock = k.m('--city-landmark-rock', 0.15);
      g.add(k.box(22, 14, 6, 0, 0, -6, rock));
      g.add(k.box(8, 12, 0.6, 0, 1.5, -2.7, k.m('--city-landmark-water', 0.9, { transparent: true, opacity: 0.85 })));
      g.add(water(k, 18, 10).translateZ(3));
      for (let i = 0; i < 6; i++) g.add(tree(k, -10 + i * 4, -9, 1.3));
      return { group: g, top: 18 };
    }
    case 'rocks': {
      const rock = k.m('--city-landmark-rock', 0.2);
      for (let i = 0; i < 9; i++) {
        const x = -12 + (i % 5) * 6;
        const z = -4 + Math.floor(i / 5) * 8;
        g.add(k.cyl(0.5, 0.9, 2.5 + (i % 3), x, 0, z, rock, 8));
        const cap = new THREE.Mesh(new THREE.SphereGeometry(1.6 + (i % 2) * 0.6, 10, 6), rock);
        cap.scale.y = 0.7;
        cap.position.set(x, 3 + (i % 3), z);
        g.add(cap);
      }
      return { group: g, top: 8 };
    }
  }
}
