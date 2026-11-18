// Orbit camera, flights and keyboard orbit (city-3d 5.1 to 5.3, 10.1).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Box } from './geometry.ts';

export interface CameraRig {
  readonly controls: OrbitControls;
  /** Flies to look at `target` from a distance; duration 0 cuts. */
  flyTo(target: THREE.Vector3, distance: number, duration: number): void;
  /** Starts the opening flight from high above (skipped when duration is 0). */
  intro(target: THREE.Vector3, duration: number): void;
  /** Keyboard orbit and zoom; returns true when the key was used. */
  key(key: string): boolean;
  update(dt: number): void;
  dispose(): void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const END_OFFSET = new THREE.Vector3(-40, 170, 230);
const START_OFFSET = new THREE.Vector3(0, 1300, 1400);

export function createCamera(camera: THREE.PerspectiveCamera, dom: HTMLElement, bounds: Box): CameraRig {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = 30;
  controls.maxDistance = 1400;

  let flight: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number; duration: number } | null =
    null;
  const start = (to: THREE.Vector3, camTo: THREE.Vector3, duration: number) => {
    if (duration <= 0) {
      controls.target.copy(to);
      camera.position.copy(camTo);
      flight = null;
      return;
    }
    flight = { from: controls.target.clone(), to: to.clone(), camFrom: camera.position.clone(), camTo, t: 0, duration };
  };

  const clampTarget = () => {
    const t = controls.target;
    t.x = Math.min(bounds.maxX, Math.max(bounds.minX, t.x));
    t.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, t.z));
    t.y = Math.max(0, t.y);
  };

  return {
    controls,
    flyTo(target, distance, duration) {
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.copy(END_OFFSET);
      dir.normalize().multiplyScalar(distance);
      start(target, target.clone().add(dir), duration);
    },
    intro(target, duration) {
      camera.position.copy(target.clone().add(START_OFFSET));
      controls.target.copy(target);
      start(target, target.clone().add(END_OFFSET), duration);
      if (duration <= 0) camera.position.copy(target.clone().add(END_OFFSET));
    },
    key(key) {
      const offset = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      const turn = Math.PI / 24;
      if (key === 'ArrowLeft') sph.theta -= turn;
      else if (key === 'ArrowRight') sph.theta += turn;
      else if (key === 'ArrowUp') sph.phi = Math.max(0.15, sph.phi - turn);
      else if (key === 'ArrowDown') sph.phi = Math.min(controls.maxPolarAngle, sph.phi + turn);
      else if (key === '+' || key === '=') sph.radius = Math.max(controls.minDistance, sph.radius * 0.85);
      else if (key === '-' || key === '_') sph.radius = Math.min(controls.maxDistance, sph.radius / 0.85);
      else return false;
      flight = null;
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      return true;
    },
    update(dt) {
      if (flight !== null) {
        flight.t = Math.min(1, flight.t + dt / flight.duration);
        const k = ease(flight.t);
        controls.target.lerpVectors(flight.from, flight.to, k);
        camera.position.lerpVectors(flight.camFrom, flight.camTo, k);
        if (flight.t >= 1) flight = null;
      }
      clampTarget();
      if (camera.position.y < 4) camera.position.y = 4;
      controls.update();
    },
    dispose() {
      controls.dispose();
    },
  };
}
