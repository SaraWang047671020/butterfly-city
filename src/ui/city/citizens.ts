// Citizen_Encounters in Walk_Mode (city-3d Requirement 8, phase 4, task 10): the story-layer Personas stand in
// their home district next to its metro station; walking up to one lets the player read the Persona's story.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GROUND_DEPTH } from './districts.ts';
import type { CityTokens } from './tokens.ts';
import { buildModels, moverMaterial } from './traffic.ts';

export interface CityCitizen {
  readonly id: string;
  readonly name: string;
  readonly homeCode: string;
  /** The text to show when the player talks to the citizen: the intro and the filled story lines of this quarter. */
  readonly story: () => { readonly paragraphs: readonly string[] };
}

export const TALK_DISTANCE = 4;
const LABEL_DISTANCE = 30;
const SCALE = 1.4;

export interface CitizenLayer {
  /** The citizen within TALK_DISTANCE of (x, z), nearest first; null when none. */
  near(x: number, z: number): CityCitizen | null;
  setVisible(v: boolean): void;
  step(time: number, moving: boolean, camera: THREE.Camera): void;
  readonly positions: readonly { readonly x: number; readonly z: number }[];
}

/** `spot(homeCode)` gives the free ground point where the citizen of that district stands. */
export function createCitizens(
  scene: THREE.Scene,
  citizens: readonly CityCitizen[],
  spot: (homeCode: string, index: number) => readonly [number, number],
  tokens: CityTokens,
): CitizenLayer {
  const time = { value: 0 };
  const mesh = new THREE.InstancedMesh(buildModels(tokens).person, moverMaterial(time, true), Math.max(1, citizens.length));
  mesh.count = citizens.length;
  mesh.frustumCulled = false;
  const tmp = new THREE.Object3D();
  const items = citizens.map((c, i) => {
    const [x, z] = spot(c.homeCode, i);
    tmp.position.set(x, GROUND_DEPTH, z);
    tmp.rotation.set(0, Math.PI / 2, 0);
    tmp.scale.setScalar(SCALE);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
    mesh.setColorAt(i, tokens.color('--city-citizen'));
    const el = document.createElement('div');
    el.className = 'city-citizen-label';
    el.textContent = c.name;
    const label = new CSS2DObject(el);
    label.position.set(x, GROUND_DEPTH + 3.2, z);
    scene.add(label);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.1, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: tokens.color('--city-citizen'), transparent: true, opacity: 0.8 }),
    );
    halo.position.set(x, GROUND_DEPTH + 0.08, z);
    scene.add(halo);
    return { c, x, z, label, halo, at: new THREE.Vector3(x, GROUND_DEPTH, z) };
  });
  scene.add(mesh);
  let visible = false;
  const apply = () => {
    mesh.visible = visible;
    for (const it of items) {
      it.halo.visible = visible;
      it.label.visible = visible;
    }
  };
  apply();
  return {
    positions: items.map((it) => ({ x: it.x, z: it.z })),
    near(x, z) {
      let best: CityCitizen | null = null;
      let bestD = TALK_DISTANCE;
      for (const it of items) {
        const d = Math.hypot(it.x - x, it.z - z);
        if (d <= bestD) {
          best = it.c;
          bestD = d;
        }
      }
      return best;
    },
    setVisible(v) {
      visible = v;
      apply();
    },
    step(t, moving, camera) {
      if (moving) time.value = t * 0.15; // a slow idle sway of the arms
      for (const it of items) (it.label.element as HTMLElement).hidden = !visible || camera.position.distanceTo(it.at) > LABEL_DISTANCE;
    },
  };
}
