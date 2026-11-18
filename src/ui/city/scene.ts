// Renderer, camera, lights, sky, stars and water of the City_View (city-3d 4.7, 12.1, 12.2).
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { mulberry32 } from './random.ts';
import type { CityTokens } from './tokens.ts';

export type QualityLevel = 'high' | 'low';

export interface CityScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly moon: THREE.DirectionalLight;
  resize(width: number, height: number): void;
  setQuality(q: QualityLevel): void;
  dispose(): void;
}

/** Creates the renderer, or returns null when the browser cannot create a WebGL context (city-3d 12.3). */
export function createScene(host: HTMLElement, tokens: CityTokens, quality: QualityLevel): CityScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    return null;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = 'city-canvas';
  host.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'city-labels';
  labels.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = tokens.color('--city-sky');
  scene.fog = new THREE.FogExp2(tokens.color('--city-fog'), 0.0016);

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 6000);

  scene.add(new THREE.HemisphereLight(tokens.color('--city-ambient-sky'), tokens.color('--city-ambient-ground'), 1.1));
  const moon = new THREE.DirectionalLight(tokens.color('--city-moon-light'), 1.1);
  moon.position.set(-400, 600, -300);
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -500, right: 500, top: 500, bottom: -500, far: 2000 });
  scene.add(moon);

  const moonBall = new THREE.Mesh(
    new THREE.SphereGeometry(40, 32, 16),
    new THREE.MeshBasicMaterial({ color: tokens.color('--city-moon'), fog: false }),
  );
  moonBall.position.set(-1600, 900, -2200);
  scene.add(moonBall);

  // Stars on a fixed seed.
  const rand = mulberry32(20151);
  const n = 1800;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = rand() * Math.PI * 2;
    const ph = rand() * Math.PI * 0.45;
    const r = 3500;
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(
    new THREE.Points(starGeo, new THREE.PointsMaterial({ color: tokens.color('--city-stars'), size: 3, sizeAttenuation: false, fog: false })),
  );

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ color: tokens.color('--city-water'), roughness: 0.35, metalness: 0.6 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -2;
  scene.add(water);

  const setQuality = (q: QualityLevel) => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1));
    renderer.shadowMap.enabled = q === 'high';
    moon.castShadow = q === 'high';
  };
  setQuality(quality);

  return {
    renderer,
    labels,
    scene,
    camera,
    moon,
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      labels.setSize(width, height);
    },
    setQuality,
    dispose() {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
