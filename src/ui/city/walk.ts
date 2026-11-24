// Walk_Mode: the Avatar, its follow camera, keys and the touch joystick (city-3d Requirements 8.1 to 8.4).
import * as THREE from 'three';
import { slideMove, type Collider } from './collision.ts';
import { GROUND_DEPTH } from './districts.ts';
import type { CityTokens } from './tokens.ts';
import { avatarModel, buildModels, moverMaterial } from './traffic.ts';

export const AVATAR_RADIUS = 0.5;
const WALK_SPEED = 4; // world units per second (game scale)
const RUN_SPEED = 10;
const TURN_SPEED = 2.4; // radians per second
/** Follow distance limits in world units; the player changes the distance with the wheel, + and − or a pinch. */
export const CAMERA_MIN = 2.5;
export const CAMERA_MAX = 60;
const CAMERA_START = 7;
/** Above this follow distance the camera looks down from over the roofs. */
const ROOF_VIEW = 12;
const AVATAR_SCALE = 1.4;

export interface WalkInput {
  forward: number; // −1 … 1
  turn: number; // −1 … 1 (positive: turn left)
  run: boolean;
}

export interface Walker {
  readonly position: THREE.Vector3;
  /** Places the Avatar at the free spot nearest to (x, z), facing `heading`. */
  start(x: number, z: number, heading: number): void;
  setVisible(v: boolean): void;
  /** The Character's look: clothing colour and a body width factor (play-loop Requirement 2.7: display only). */
  /** The Character's look: clothing colour, body width and hair style (play-loop task 6.3). */
  setLook(colour: THREE.Color, width: number, hair: string): void;
  /** Moves the Avatar and the camera; `snap` places the camera without easing (reduced motion). */
  update(dt: number, camera: THREE.PerspectiveCamera, snap: boolean): void;
  key(key: string, down: boolean): boolean;
  /** Multiplies the follow distance by `factor`, kept within CAMERA_MIN … CAMERA_MAX. */
  zoom(factor: number): void;
  readonly joystick: HTMLElement;
  dispose(): void;
}

/** Nearest free point to (x, z) on a square spiral of 1-unit steps, up to `max` units away. */
export function nearestFree(c: Collider, x: number, z: number, radius: number, max = 80): readonly [number, number] | null {
  if (!c.blocked(x, z, radius)) return [x, z];
  for (let r = 1; r <= max; r++) {
    for (let i = -r; i <= r; i++) {
      for (const [px, pz] of [
        [x + i, z - r],
        [x + i, z + r],
        [x - r, z + i],
        [x + r, z + i],
      ] as const) {
        if (!c.blocked(px, pz, radius)) return [px, pz];
      }
    }
  }
  return null;
}

export function createWalker(scene: THREE.Scene, collider: Collider, tokens: CityTokens, doc: Document): Walker {
  const time = { value: 0 };
  const geo = buildModels(tokens).person;
  const avatar = new THREE.InstancedMesh(geo, moverMaterial(time, true), 1);
  // One model per hair style, built when first used and kept (the Avatar swaps between them).
  const hairModels = new Map<string, THREE.BufferGeometry>();
  avatar.setColorAt(0, tokens.color('--city-avatar'));
  avatar.castShadow = true;
  avatar.frustumCulled = false; // the instance moves far from the bounds computed at creation
  avatar.visible = false;
  scene.add(avatar);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.95, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: tokens.color('--city-avatar'), transparent: true, opacity: 0.8 }),
  );
  ring.visible = false;
  // A light column over the Avatar, shown in the roof view so the Avatar can be found between the buildings.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 60, 8, 1, true).translate(0, 30, 0),
    new THREE.MeshBasicMaterial({ color: tokens.color('--city-avatar'), transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }),
  );
  beacon.visible = false;
  beacon.renderOrder = 10;
  scene.add(beacon);
  scene.add(ring);

  const position = new THREE.Vector3(0, GROUND_DEPTH, 0);
  let heading = 0;
  const keys = new Set<string>();
  const stick = { x: 0, y: 0 };
  const tmp = new THREE.Object3D();
  const camTarget = new THREE.Vector3();
  let distance = CAMERA_START;

  // Touch joystick: a DOM pad; shown by CSS on coarse pointers while Walk_Mode is on.
  const joystick = doc.createElement('div');
  joystick.className = 'city-joystick';
  joystick.setAttribute('aria-hidden', 'true');
  const knob = doc.createElement('div');
  knob.className = 'city-joystick-knob';
  joystick.appendChild(knob);
  const setStick = (e: PointerEvent) => {
    const r = joystick.getBoundingClientRect();
    const half = r.width / 2;
    let x = (e.clientX - r.left - half) / half;
    let y = (e.clientY - r.top - half) / half;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    stick.x = x;
    stick.y = y;
    knob.style.transform = `translate(${x * half * 0.6}px, ${y * half * 0.6}px)`;
  };
  const release = () => {
    stick.x = 0;
    stick.y = 0;
    knob.style.transform = '';
  };
  joystick.addEventListener('pointerdown', (e) => {
    joystick.setPointerCapture(e.pointerId);
    setStick(e);
  });
  joystick.addEventListener('pointermove', (e) => {
    if (joystick.hasPointerCapture(e.pointerId)) setStick(e);
  });
  joystick.addEventListener('pointerup', release);
  joystick.addEventListener('pointercancel', release);

  const input = (): WalkInput => {
    const fwd = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - stick.y;
    const turn = (keys.has('a') || keys.has('arrowleft') ? 1 : 0) - (keys.has('d') || keys.has('arrowright') ? 1 : 0) - stick.x;
    return { forward: Math.max(-1, Math.min(1, fwd)), turn: Math.max(-1, Math.min(1, turn)), run: keys.has('shift') };
  };

  let bodyWidth = 1;
  const place = () => {
    tmp.position.copy(position);
    tmp.rotation.set(0, heading, 0);
    tmp.scale.set(AVATAR_SCALE * bodyWidth, AVATAR_SCALE, AVATAR_SCALE * bodyWidth);
    tmp.updateMatrix();
    avatar.setMatrixAt(0, tmp.matrix);
    avatar.instanceMatrix.needsUpdate = true;
    ring.position.set(position.x, GROUND_DEPTH + 0.08, position.z);
    beacon.position.set(position.x, GROUND_DEPTH, position.z);
  };

  return {
    position,
    joystick,
    start(x, z, h) {
      const spot = nearestFree(collider, x, z, AVATAR_RADIUS) ?? [x, z];
      position.set(spot[0], GROUND_DEPTH, spot[1]);
      // Face the most open of eight directions, starting from h, so that the camera does not start against a wall.
      let best = h;
      let bestFree = -1;
      for (let k = 0; k < 8; k++) {
        const a = h + (k * Math.PI) / 4;
        let free = 0;
        while (free < 12 && !collider.blocked(spot[0] + Math.cos(a) * (free + 1), spot[1] - Math.sin(a) * (free + 1), AVATAR_RADIUS)) free++;
        if (free > bestFree) {
          best = a;
          bestFree = free;
        }
      }
      heading = best;
      place();
    },
    setLook(colour, width, hair) {
      let g = hairModels.get(hair);
      if (g === undefined) {
        g = avatarModel(tokens, hair);
        hairModels.set(hair, g);
      }
      if (avatar.geometry !== g) avatar.geometry = g;
      avatar.setColorAt(0, colour);
      if (avatar.instanceColor !== null) avatar.instanceColor.needsUpdate = true;
      bodyWidth = width;
      place();
    },
    setVisible(v) {
      avatar.visible = v;
      ring.visible = v;
      if (!v) beacon.visible = false;
      if (!v) {
        keys.clear();
        release();
      }
    },
    update(dt, camera, snap) {
      const inp = input();
      heading += inp.turn * TURN_SPEED * dt;
      const speed = (inp.run ? RUN_SPEED : WALK_SPEED) * inp.forward;
      const fx = Math.cos(heading);
      const fz = -Math.sin(heading);
      if (speed !== 0) {
        const [nx, nz] = slideMove(collider, position.x, position.z, fx * speed * dt, fz * speed * dt, AVATAR_RADIUS);
        position.x = nx;
        position.z = nz;
        time.value += dt * (inp.run ? 1.6 : 1);
      }
      place();
      // Street view (short distance): the camera stays in front of a building between it and the Avatar.
      // Roof view (long distance): the camera rises over the roofs and looks down, so buildings do not block it.
      const roof = distance > ROOF_VIEW;
      beacon.visible = avatar.visible && roof;
      let back = distance;
      if (!roof) {
        for (let d = 1; d <= distance; d += 0.5) {
          if (collider.blocked(position.x - fx * d, position.z - fz * d, 0.3)) {
            back = Math.max(1.2, d - 0.6);
            break;
          }
        }
      }
      const up = roof ? 6 + distance * 1.1 : 1 + back * 0.45;
      camTarget.set(position.x - fx * back, position.y + up, position.z - fz * back);
      if (snap) camera.position.copy(camTarget);
      else camera.position.lerp(camTarget, Math.min(1, dt * 5));
      camera.lookAt(position.x + fx * 3, position.y + 1.4, position.z + fz * 3);
    },
    zoom(factor) {
      distance = Math.min(CAMERA_MAX, Math.max(CAMERA_MIN, distance * factor));
    },
    key(key, down) {
      const k = key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) return false;
      if (down) keys.add(k);
      else keys.delete(k);
      return true;
    },
    dispose() {
      joystick.remove();
      geo.dispose();
      for (const g of hairModels.values()) g.dispose();
    },
  };
}
