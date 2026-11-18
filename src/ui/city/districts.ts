// District_Ground, outlines and labels (city-3d 3.1, 3.2, 4.1, 5.5).
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { CityStaticDistrict } from '../../types/view.ts';
import type { PolygonXZ } from './geometry.ts';
import { project } from './projection.ts';
import type { CityTokens } from './tokens.ts';

export const GROUND_DEPTH = 2;

export interface DistrictMesh {
  readonly code: string;
  readonly areaKm2: number;
  readonly polygons: readonly PolygonXZ[];
  readonly center: THREE.Vector3;
  readonly ground: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly label: CSS2DObject;
  /** Thin outline (unselected). */
  readonly outline: THREE.Group;
  /** Thick solid outline (selected) and dashed outline (focused). */
  readonly selectedOutline: THREE.Group;
  readonly focusOutline: THREE.Group;
}

export type DistrictState = { readonly selected: boolean; readonly focused: boolean; readonly hovered: boolean };

function hatchTexture(tokens: CityTokens): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const g = c.getContext('2d');
  if (g !== null) {
    g.fillStyle = `#${tokens.color('--color-nodata-fill').getHexString()}`;
    g.fillRect(0, 0, 16, 16);
    g.strokeStyle = `#${tokens.color('--color-nodata-mark').getHexString()}`;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 16);
    g.lineTo(16, 0);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.25, 0.25);
  return t;
}

function outlineOf(polys: readonly PolygonXZ[], y: number, material: THREE.LineBasicMaterial | THREE.LineDashedMaterial): THREE.Group {
  const group = new THREE.Group();
  for (const poly of polys) {
    const pts = (poly[0] ?? []).map(([x, z]) => new THREE.Vector3(x, y, z));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material);
    if (material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
    group.add(line);
  }
  return group;
}

export interface DistrictLayer {
  readonly meshes: readonly DistrictMesh[];
  readonly byCode: ReadonlyMap<string, DistrictMesh>;
  readonly hatch: THREE.Texture;
  setColour(code: string, colour: THREE.Color | null): void;
  setState(code: string, s: DistrictState): void;
  setLabelVisibility(cameraDistance: number): void;
}

export function createDistricts(scene: THREE.Scene, districts: readonly CityStaticDistrict[], tokens: CityTokens): DistrictLayer {
  const hatch = hatchTexture(tokens);
  const thin = new THREE.LineBasicMaterial({ color: tokens.color('--city-outline'), transparent: true, opacity: 0.35 });
  const thick = new THREE.LineBasicMaterial({ color: tokens.color('--city-outline-selected'), linewidth: 3 });
  const dashed = new THREE.LineDashedMaterial({ color: tokens.color('--color-focus'), dashSize: 6, gapSize: 4 });

  const meshes: DistrictMesh[] = districts.map((d) => {
    const polygons: PolygonXZ[] = d.polygons.map((poly) => poly.map((ring) => ring.map((p) => project(p))));
    const shapes = polygons.map((poly) => {
      const shape = new THREE.Shape((poly[0] ?? []).map(([x, z]) => new THREE.Vector2(x, -z)));
      for (const hole of poly.slice(1)) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
      return shape;
    });
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: GROUND_DEPTH, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const ground = new THREE.Mesh(geo, material);
    ground.receiveShadow = true;
    ground.userData['code'] = d.code;
    scene.add(ground);

    const outline = outlineOf(polygons, GROUND_DEPTH + 0.2, thin);
    const selectedOutline = outlineOf(polygons, GROUND_DEPTH + 0.3, thick);
    const focusOutline = outlineOf(polygons, GROUND_DEPTH + 0.4, dashed);
    selectedOutline.visible = false;
    focusOutline.visible = false;
    scene.add(outline, selectedOutline, focusOutline);

    const [cx, cz] = project(d.centroid);
    const el = document.createElement('div');
    el.className = 'city-label';
    el.textContent = d.name;
    const label = new CSS2DObject(el);
    label.position.set(cx, GROUND_DEPTH + 12, cz);
    scene.add(label);
    return {
      code: d.code,
      areaKm2: d.areaKm2,
      polygons,
      center: new THREE.Vector3(cx, GROUND_DEPTH, cz),
      ground,
      material,
      label,
      outline,
      selectedOutline,
      focusOutline,
    };
  });
  const byCode = new Map(meshes.map((m) => [m.code, m]));

  return {
    meshes,
    byCode,
    hatch,
    setColour(code, colour) {
      const m = byCode.get(code);
      if (m === undefined) return;
      if (colour === null) {
        m.material.color.setRGB(1, 1, 1);
        m.material.map = hatch;
        m.material.emissive.setRGB(0, 0, 0);
      } else {
        m.material.map = null;
        m.material.color.copy(colour);
        m.material.emissive.copy(colour).multiplyScalar(0.25);
      }
      m.material.needsUpdate = true;
    },
    setState(code, s) {
      const m = byCode.get(code);
      if (m === undefined) return;
      m.material.emissiveIntensity = s.selected ? 3 : s.focused || s.hovered ? 2.2 : 1;
      m.selectedOutline.visible = s.selected;
      m.focusOutline.visible = s.focused;
    },
    setLabelVisibility(distance) {
      for (const m of meshes) (m.label.element as HTMLElement).hidden = !(distance < 700 || m.areaKm2 > 40);
    },
  };
}
