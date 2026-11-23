// Social housing the player started, shown where it is built (city-3d, user feedback 2026-11-23: a policy must be
// visible in the city). Under construction: scaffold, rising core and a turning crane; completed: a glowing block.
// Only the player's difference from real history is drawn (more units than real); real social housing is not.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GROUND_DEPTH } from './districts.ts';
import type { CityTokens } from './tokens.ts';

export interface SiteView {
  readonly district: string;
  /** Extra units completed by the Displayed_Quarter. */
  readonly completed: number;
  /** Extra units under construction, with the share of the Lag passed (0–1) and the completion quarter. */
  readonly building: number;
  readonly progress: number;
  readonly ready: string | null;
}

export interface SiteLayer {
  setSites(sites: readonly SiteView[], labels: { readonly done: (units: number) => string; readonly building: (units: number, quarter: string) => string }): void;
  step(time: number, moving: boolean, camera: THREE.Camera): void;
}

const LABEL_DISTANCE = 220;
const heightOf = (units: number) => 6 + Math.log2(1 + Math.max(0, units)) * 3;

export function createSites(scene: THREE.Scene, tokens: CityTokens, spot: (district: string) => readonly [number, number]): SiteLayer {
  const green = tokens.color('--city-social-housing');
  const orange = tokens.color('--city-scaffold');
  const doneMat = new THREE.MeshStandardMaterial({ color: green, emissive: green.clone().multiplyScalar(0.55), roughness: 0.5 });
  const coreMat = new THREE.MeshStandardMaterial({ color: orange, emissive: orange.clone().multiplyScalar(0.35), roughness: 0.7 });
  const lineMat = new THREE.LineBasicMaterial({ color: orange });
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const edges = new THREE.EdgesGeometry(box);
  const items = new Map<string, { group: THREE.Group; crane: THREE.Group | null; label: CSS2DObject; at: THREE.Vector3 }>();

  const clear = () => {
    for (const it of items.values()) {
      scene.remove(it.group);
      scene.remove(it.label);
    }
    items.clear();
  };

  return {
    setSites(sites, labels) {
      clear();
      for (const s of sites) {
        if (s.completed <= 0 && s.building <= 0) continue;
        const [x, z] = spot(s.district);
        const group = new THREE.Group();
        group.position.set(x, GROUND_DEPTH, z);
        let crane: THREE.Group | null = null;
        let top = 0;
        if (s.completed > 0) {
          const h = heightOf(s.completed);
          const block = new THREE.Mesh(box, doneMat);
          block.scale.set(6, h, 6);
          group.add(block);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.25, 6, 32).rotateX(Math.PI / 2), doneMat);
          ring.position.y = h + 1;
          group.add(ring);
          top = h + 2;
        }
        if (s.building > 0) {
          const h = heightOf(s.building);
          const site = new THREE.Group();
          site.position.x = s.completed > 0 ? 9 : 0;
          const frame = new THREE.LineSegments(edges, lineMat);
          frame.scale.set(6.4, h, 6.4);
          site.add(frame);
          const core = new THREE.Mesh(box, coreMat);
          core.scale.set(5.6, Math.max(0.4, h * Math.min(1, Math.max(0, s.progress))), 5.6);
          site.add(core);
          crane = new THREE.Group();
          crane.position.set(4, 0, -4);
          const mast = new THREE.Mesh(box, coreMat);
          mast.scale.set(0.5, h + 6, 0.5);
          crane.add(mast);
          const jib = new THREE.Mesh(box, coreMat);
          jib.scale.set(12, 0.4, 0.4);
          jib.position.set(3, h + 5.6, 0);
          crane.add(jib);
          site.add(crane);
          group.add(site);
          top = Math.max(top, h + 7);
        }
        scene.add(group);
        const el = document.createElement('div');
        el.className = 'city-site-label';
        el.textContent = [
          s.completed > 0 ? labels.done(Math.round(s.completed)) : '',
          s.building > 0 && s.ready !== null ? labels.building(Math.round(s.building), s.ready) : '',
        ]
          .filter((t) => t !== '')
          .join(' · ');
        const label = new CSS2DObject(el);
        label.position.set(x, GROUND_DEPTH + top + 3, z);
        scene.add(label);
        items.set(s.district, { group, crane, label, at: new THREE.Vector3(x, GROUND_DEPTH, z) });
      }
    },
    step(time, moving, camera) {
      for (const it of items.values()) {
        if (it.crane !== null && moving) it.crane.rotation.y = Math.sin(time * 0.4) * 1.2;
        (it.label.element as HTMLElement).hidden = camera.position.distanceTo(it.at) > LABEL_DISTANCE;
      }
    },
  };
}
