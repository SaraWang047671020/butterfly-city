// City_View: mounts the 3D city and keeps it in step with the Game_Controller map view (city-3d Requirements 3 to 6, 10, 12).
import * as THREE from 'three';
import type { CityStaticView, MapDistrictView, MapViewModel } from '../../types/view.ts';
import { createBuildings } from './buildings.ts';
import { createCollider } from './collision.ts';
import { createCamera } from './camera.ts';
import { classOf, classToken } from './colours.ts';
import { createDistricts } from './districts.ts';
import { stepFocus } from './focus-order.ts';
import { boundsOf, inAnyPolygon } from './geometry.ts';
import { createGhosts } from './ghosts.ts';
import { createLandmarks, landmarkClearings } from './landmarks/index.ts';
import { heightScale, placeDistrict, type PlacementInput } from './placement.ts';
import { project } from './projection.ts';
import { mulberry32 } from './random.ts';
import { createScene, type QualityLevel } from './scene.ts';
import { buildStreetGrid } from './street-grid.ts';
import { readTokens } from './tokens.ts';
import { createTraffic } from './traffic.ts';
import { createWalker } from './walk.ts';

export type CityMode = 'overview' | 'walk';

export type { QualityLevel } from './scene.ts';

export interface CityStrings {
  /** Accessible name of the canvas (city-3d 5.6). */
  readonly canvasLabel: string;
  /** Text shown when WebGL is unavailable (city-3d 12.3). */
  readonly fallback: string;
}

export interface CityViewOptions {
  readonly statics: CityStaticView;
  readonly strings: CityStrings;
  readonly selectDistrict: (code: string) => void;
  /** Polite live-region announcement (city-3d 5.4). */
  readonly announce: (text: string) => void;
  /** Accessible name of a district in the current map view (game-ui 4.2, 4.3). */
  readonly accessibleName: (district: MapDistrictView, map: MapViewModel) => string;
  readonly quality?: QualityLevel;
  /** Code of the district the opening flight looks at. */
  readonly introDistrict?: string;
  /** Called when the mode changes, also when Escape leaves Walk_Mode (city-3d 8.1). */
  readonly onModeChange?: (mode: CityMode) => void;
}

export interface CityView {
  readonly root: HTMLElement;
  /** False when WebGL is unavailable and the fallback text is shown. */
  readonly webgl: boolean;
  update(map: MapViewModel): void;
  setPaused(paused: boolean): void;
  setQuality(q: QualityLevel): void;
  setMode(mode: CityMode): void;
  readonly mode: () => CityMode;
  dispose(): void;
}

const LOW_SHARE = 0.25;
const DRAG_PX = 5;

export function mountCityView(host: HTMLElement, o: CityViewOptions): CityView {
  const doc = host.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'city-view';
  host.appendChild(root);

  const tokens = readTokens(doc.documentElement);
  let quality: QualityLevel = o.quality ?? (doc.defaultView !== null && doc.defaultView.innerWidth < 768 ? 'low' : 'high');
  const s = createScene(root, tokens, quality);
  if (s === null) {
    const p = doc.createElement('p');
    p.className = 'city-fallback';
    p.textContent = o.strings.fallback;
    root.appendChild(p);
    return { root, webgl: false, update() {}, setPaused() {}, setQuality() {}, setMode() {}, mode: () => 'overview', dispose: () => root.remove() };
  }

  const canvas = s.renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-roledescription', '3D city');
  canvas.setAttribute('aria-label', o.strings.canvasLabel);

  // --- static city
  const statics = o.statics.districts;
  const clearings = landmarkClearings();
  const inputs: PlacementInput[] = statics.map((d) => ({
    code: d.code,
    polygons: d.polygons.map((poly) => poly.map((ring) => ring.map((p) => project(p)))),
    center: project(d.centroid),
    areaKm2: d.areaKm2,
    population2015: d.population2015,
    clearings,
  }));
  const placements = inputs.map(placeDistrict);
  const districts = createDistricts(s.scene, statics, tokens);
  const buildings = createBuildings(s.scene, placements, tokens);
  const grid = buildStreetGrid(
    inputs.filter((_, i) => placements[i]!.urban).flatMap((p) => p.polygons),
    clearings,
  );
  const landmarks = createLandmarks(s.scene, tokens);
  const allPolygons = inputs.flatMap((p) => p.polygons);
  const collider = createCollider(
    placements.flatMap((p) => p.buildings.map((b) => ({ x: b.x, z: b.z, hw: b.width / 2, hd: b.depth / 2 }))),
    clearings.map((c) => ({ x: c.x, z: c.z, r: c.r * 0.7 })),
    allPolygons,
  );
  const walker = createWalker(s.scene, collider, tokens, doc);
  root.appendChild(walker.joystick);
  const rand = mulberry32(20151);
  const traffic = createTraffic(s.scene, grid, tokens, rand);
  const ghosts = createGhosts(
    s.scene,
    districts.meshes.map((m) => m.center),
    tokens,
    rand,
  );
  const indexOf = new Map(statics.map((d, i) => [d.code, i]));
  const rig = createCamera(s.camera, canvas, boundsOf(inputs.flatMap((p) => p.polygons)));

  // --- state
  let map: MapViewModel | null = null;
  let selected: string | null = null;
  let focused: string | null = null;
  let hovered: string | null = null;
  let paused = false;
  let mode: CityMode = 'overview';
  let walkDistrict: string | null = null;
  const reducedQuery = doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)') ?? null;
  const motion = () => !paused && !(reducedQuery?.matches ?? false);

  const applyState = (code: string) =>
    districts.setState(code, { selected: code === selected, focused: code === focused, hovered: code === hovered });

  const applyQuality = () => {
    s.setQuality(quality);
    traffic.setShare(quality === 'high' ? 1 : LOW_SHARE);
    buildings.setTreeShare(quality === 'high' ? 1 : LOW_SHARE);
  };
  applyQuality();

  const distanceFor = (code: string) => Math.max(170, Math.sqrt(districts.byCode.get(code)?.areaKm2 ?? 10) * 28);
  const flyToDistrict = (code: string) => {
    const m = districts.byCode.get(code);
    if (m !== undefined) rig.flyTo(m.center, distanceFor(code), tokens.seconds('--city-motion-flight'));
  };

  // --- opening flight
  const introCode = o.introDistrict ?? statics.find((d) => d.city === 'Taipei')?.code ?? statics[0]?.code;
  const introMesh = introCode === undefined ? undefined : districts.byCode.get(introCode);
  rig.intro(introMesh?.center ?? new THREE.Vector3(), tokens.seconds('--city-motion-intro'));

  // --- picking (city-3d 5.2)
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const grounds = districts.meshes.map((m) => m.ground);
  const pick = (e: PointerEvent): string | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, s.camera);
    const hit = ray.intersectObjects(grounds, false)[0];
    const code = hit?.object.userData['code'];
    return typeof code === 'string' ? code : null;
  };
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    if (down === null || Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) return;
    down = null;
    const code = pick(e);
    if (code !== null) o.selectDistrict(code);
  };
  const onMove = (e: PointerEvent) => {
    if (e.buttons !== 0) return;
    const code = pick(e);
    if (code === hovered) return;
    const before = hovered;
    hovered = code;
    if (before !== null) applyState(before);
    if (code !== null) applyState(code);
    canvas.classList.toggle('is-pointing', code !== null);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointermove', onMove);

  // --- keyboard (city-3d 5.1, 5.4)
  const codes = statics.map((d) => d.code);
  const setMode = (next: CityMode) => {
    if (next === mode) return;
    mode = next;
    root.classList.toggle('is-walking', mode === 'walk');
    if (mode === 'walk') {
      rig.controls.enabled = false;
      const m = (selected === null ? undefined : districts.byCode.get(selected)) ?? districts.meshes.find((x) => x.code === introCode);
      const c = m?.center ?? rig.controls.target;
      walker.start(c.x, c.z, 0);
      walker.setVisible(true);
      walkDistrict = selected;
      canvas.focus();
    } else {
      walker.setVisible(false);
      rig.controls.enabled = true;
      rig.flyTo(walker.position.clone(), 200, tokens.seconds('--city-motion-flight'));
    }
    o.onModeChange?.(mode);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (mode === 'walk' && walker.key(e.key, false)) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent) => {
    if (mode === 'walk') {
      if (e.key === 'Escape') {
        setMode('overview');
        e.preventDefault();
      } else if (walker.key(e.key, true)) e.preventDefault();
      return;
    }
    if (e.key === ']' || e.key === '[') {
      const before = focused;
      focused = stepFocus(codes, focused ?? selected, e.key === ']' ? 1 : -1);
      if (before !== null) applyState(before);
      if (focused !== null) {
        applyState(focused);
        flyToDistrict(focused);
        const d = map?.districts.find((x) => x.code === focused);
        if (d !== undefined && map !== null) o.announce(o.accessibleName(d, map));
      }
      e.preventDefault();
    } else if ((e.key === 'Enter' || e.key === ' ') && focused !== null) {
      o.selectDistrict(focused);
      e.preventDefault();
    } else if (rig.key(e.key)) {
      e.preventDefault();
    }
  };
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('keyup', onKeyUp);
  const onBlur = () => {
    const before = focused;
    focused = null;
    if (before !== null) applyState(before);
  };
  canvas.addEventListener('blur', onBlur);

  // --- size and visibility (city-3d 5.8, 12.4)
  const resize = () => s.resize(root.clientWidth, root.clientHeight);
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  resize();

  const clock = new THREE.Clock();
  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    if (mode === 'walk') {
      walker.update(dt, s.camera, !motion());
      // The District_Panel follows the district where the Avatar stands (city-3d 8.4).
      const here = inputs.find((p) => inAnyPolygon(walker.position.x, walker.position.z, p.polygons))?.code ?? null;
      if (here !== null && here !== walkDistrict) {
        walkDistrict = here;
        o.selectDistrict(here);
      }
    } else rig.update(dt);
    const heightDuration = tokens.seconds('--city-motion-height');
    buildings.step(dt, heightDuration > 0 ? 4 / heightDuration : Infinity);
    if (motion()) traffic.step(dt, time);
    ghosts.step(time, motion());
    landmarks.step(time, motion());
    landmarks.setLabelVisibility(s.camera);
    districts.setLabelVisibility(s.camera.position.distanceTo(rig.controls.target));
    s.renderer.render(s.scene, s.camera);
    s.labels.render(s.scene, s.camera);
  };
  const onVisibility = () => s.renderer.setAnimationLoop(doc.hidden ? null : frame);
  doc.addEventListener('visibilitychange', onVisibility);
  onVisibility();

  return {
    root,
    webgl: true,
    update(next) {
      map = next;
      const scales: number[] = new Array(statics.length).fill(1);
      const counts: (number | null)[] = new Array(statics.length).fill(null);
      for (const d of next.districts) {
        const i = indexOf.get(d.code);
        if (i === undefined) continue;
        const cls = d.classIndex ?? classOf(d.central, next.legend.bounds);
        const colour = cls === null ? null : tokens.color(classToken(next.indicator, cls));
        districts.setColour(d.code, colour);
        buildings.setDistrictColour(i, colour);
        scales[i] = heightScale(d.priceIndex);
        counts[i] = d.ghosts;
      }
      buildings.setHeightTargets(scales);
      ghosts.setCounts(counts);

      const nextSelected = next.districts.find((d) => d.selected)?.code ?? null;
      if (nextSelected !== selected) {
        const before = selected;
        selected = nextSelected;
        if (before !== null) applyState(before);
        if (selected !== null) {
          applyState(selected);
          if (mode === 'overview') flyToDistrict(selected);
        }
      }
    },
    setPaused(p) {
      paused = p;
    },
    setMode,
    mode: () => mode,
    setQuality(q) {
      quality = q;
      applyQuality();
    },
    dispose() {
      s.renderer.setAnimationLoop(null);
      doc.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('keyup', onKeyUp);
      walker.dispose();
      canvas.removeEventListener('blur', onBlur);
      rig.dispose();
      districts.hatch.dispose();
      s.dispose();
      root.remove();
    },
  };
}
