// Landmarks in the City_View (city-3d Requirement 7): models at their real positions, labels when the camera is close.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GROUND_DEPTH } from '../districts.ts';
import { project } from '../projection.ts';
import type { CityTokens } from '../tokens.ts';
import { buildLandmark, type LandmarkModel } from './models.ts';
import { LANDMARKS, type Landmark } from './table.ts';

/** Label distance of the design: a Landmark label shows when the camera is closer than this (world units). */
export const LANDMARK_LABEL_DISTANCE = 150;

export interface Clearing {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** Areas kept free of illustrative buildings, trees and streets. Pure (no three objects). */
export function landmarkClearings(table: readonly Landmark[] = LANDMARKS): Clearing[] {
  return table.map((l) => {
    const [x, z] = project([l.lon, l.lat]);
    return { x, z, r: l.clearRadius };
  });
}

export interface LandmarkLayer {
  step(time: number, moving: boolean): void;
  /** Shows labels within `maxDistance` of the camera (LANDMARK_LABEL_DISTANCE by default). */
  setLabelVisibility(camera: THREE.Camera, maxDistance?: number): void;
}

export function createLandmarks(scene: THREE.Scene, tokens: CityTokens, table: readonly Landmark[] = LANDMARKS): LandmarkLayer {
  const items: { model: LandmarkModel; label: CSS2DObject; position: THREE.Vector3 }[] = table.map((l) => {
    const model = buildLandmark(l.model, tokens);
    const [x, z] = project([l.lon, l.lat]);
    model.group.position.set(x, GROUND_DEPTH, z);
    model.group.rotation.y = (l.rotation * Math.PI) / 180;
    model.group.name = l.id;
    scene.add(model.group);
    const el = document.createElement('div');
    el.className = 'city-landmark-label';
    el.textContent = l.name;
    const label = new CSS2DObject(el);
    label.position.set(x, GROUND_DEPTH + model.top + 4, z);
    scene.add(label);
    return { model, label, position: new THREE.Vector3(x, GROUND_DEPTH, z) };
  });
  return {
    step(time, moving) {
      if (!moving) return;
      for (const it of items) it.model.animate?.(time);
    },
    setLabelVisibility(camera, maxDistance = LANDMARK_LABEL_DISTANCE) {
      for (const it of items) (it.label.element as HTMLElement).hidden = camera.position.distanceTo(it.position) > maxDistance;
    },
  };
}
