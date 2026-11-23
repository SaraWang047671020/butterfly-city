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
import { createWalker, nearestFree } from './walk.ts';
import { createCitizens, type CityCitizen } from './citizens.ts';

export type { CityCitizen } from './citizens.ts';
import { createDialogManager } from '../a11y/dialog.ts';
import { openNetwork, stationNear, stationsByLine, type OpenNetwork } from './metro/network.ts';
import { createMetro } from './metro/render.ts';
import { METRO_DATA } from './metro/station-data.ts';
import type { MetroStation } from './metro/types.ts';

export type CityMode = 'overview' | 'walk';

export type { QualityLevel } from './scene.ts';

export interface CityStrings {
  /** Accessible name of the canvas (city-3d 5.6). */
  readonly canvasLabel: string;
  /** Text shown when WebGL is unavailable (city-3d 12.3). */
  readonly fallback: string;
  /** Metro texts (city-3d 8.6). {station} is replaced by the station name. */
  readonly metro: {
    readonly prompt: string;
    readonly button: string;
    readonly title: string;
    readonly here: string;
  };
  /** City tools and the Illustration_Note (city-3d 10.3, 11.1, 12.2, 8.1). */
  readonly tools?: {
    readonly label: string;
    readonly illustrationNote: string;
    readonly walk: string;
    readonly overview: string;
    readonly pause: string;
    readonly resume: string;
    readonly qualityHigh: string;
    readonly qualityLow: string;
  };
  /** Citizen_Encounter texts. {name} is replaced by the citizen's name. */
  readonly talk: {
    readonly prompt: string;
    readonly button: string;
  };
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
  /** The story-layer Personas met in Walk_Mode (phase 4); empty when the story files did not load. */
  readonly citizens?: readonly CityCitizen[];
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
/** District_Code of Zhongzheng District, where Walk_Mode starts when no district is selected (city-3d 8.2). */
const ZHONGZHENG = '63000050';

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
  // Station entrances are kept free of illustrative buildings; they stay walkable.
  const stationClear = METRO_DATA.stations.map((st) => {
    const [x, z] = project([st.lon, st.lat]);
    return { x, z, r: 2.5 };
  });
  const inputs: PlacementInput[] = statics.map((d) => ({
    code: d.code,
    polygons: d.polygons.map((poly) => poly.map((ring) => ring.map((p) => project(p)))),
    center: project(d.centroid),
    areaKm2: d.areaKm2,
    population2015: d.population2015,
    clearings: [...clearings, ...stationClear],
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
    clearings.map((c) => ({ x: c.x, z: c.z, r: c.r * 0.85 })),
    allPolygons,
  );
  const walker = createWalker(s.scene, collider, tokens, doc);
  root.appendChild(walker.joystick);

  // --- metro (city-3d 8.6, 8.7)
  const metro = createMetro(s.scene, METRO_DATA, tokens);
  let net: OpenNetwork = openNetwork(METRO_DATA, '2015Q1');
  metro.setOpen(net);
  let nearStation: MetroStation | null = null;
  const prompt = doc.createElement('div');
  prompt.className = 'city-metro-prompt';
  prompt.hidden = true;
  const promptText = doc.createElement('span');
  const promptButton = doc.createElement('button');
  promptButton.type = 'button';
  promptButton.textContent = o.strings.metro.button;
  prompt.append(promptText, promptButton);
  const fade = doc.createElement('div');
  fade.className = 'city-fade';
  root.append(prompt, fade);
  const dialog = createDialogManager(doc, () => canvas);
  root.appendChild(dialog.root);
  const travel = (to: MetroStation) => {
    const [x, z] = metro.position(to);
    const seconds = tokens.seconds('--city-motion-flight');
    const arrive = () => {
      walker.start(x + 2, z + 2, 0);
      fade.classList.remove('is-on');
      canvas.focus();
    };
    if (seconds <= 0) arrive();
    else {
      fade.classList.add('is-on');
      doc.defaultView?.setTimeout(arrive, seconds * 1000);
    }
  };
  const openStations = () => {
    if (nearStation === null) return;
    const here = nearStation;
    const body = doc.createElement('div');
    body.className = 'city-metro-list';
    for (const group of stationsByLine(METRO_DATA, net)) {
      const section = doc.createElement('section');
      const h = doc.createElement('h3');
      h.textContent = group.name;
      const ul = doc.createElement('ul');
      for (const st of group.stations) {
        const li = doc.createElement('li');
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = st.key === here.key ? o.strings.metro.here.replace('{station}', st.name) : st.name;
        b.disabled = st.key === here.key;
        b.addEventListener('click', () => {
          dialog.close();
          travel(st);
        });
        li.appendChild(b);
        ul.appendChild(li);
      }
      section.append(h, ul);
      body.appendChild(section);
    }
    dialog.open({ title: o.strings.metro.title.replace('{station}', here.name), body, opener: promptButton });
  };
  promptButton.addEventListener('click', openStations);

  // --- Citizen_Encounters (phase 4): each Persona stands next to the metro station of its home district.
  const citizenSpot = (homeCode: string): readonly [number, number] => {
    const home = districts.byCode.get(homeCode);
    const c = home?.center ?? new THREE.Vector3();
    const all = openNetwork(METRO_DATA, '2025Q4');
    const exit = stationNear({ ...all, stations: all.stations.filter((st) => st.district === homeCode) }, metro.position, c.x, c.z, Infinity);
    const [sx, sz] = exit === null ? [c.x, c.z] : metro.position(exit);
    // Next to the spot where Walk_Mode starts at this station (walker.start uses station + (2, 2)), so the citizen
    // is the first person the player meets on coming up from the metro.
    const [bx, bz] = nearestFree(collider, sx + 2, sz + 2, 0.5) ?? [sx + 2, sz + 2];
    const offsets: readonly (readonly [number, number])[] = [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5], [1.8, 1.8], [-1.8, -1.8]];
    const free = offsets.find(([dx, dz]) => !collider.blocked(bx + dx, bz + dz, 0.8));
    return free === undefined ? [bx + 2.5, bz] : [bx + free[0], bz + free[1]];
  };
  const citizens = createCitizens(s.scene, o.citizens ?? [], citizenSpot, tokens);
  let nearCitizen: CityCitizen | null = null;
  const talk = doc.createElement('div');
  talk.className = 'city-metro-prompt city-talk-prompt';
  talk.hidden = true;
  const talkText = doc.createElement('span');
  const talkButton = doc.createElement('button');
  talkButton.type = 'button';
  talkButton.textContent = o.strings.talk.button;
  talk.append(talkText, talkButton);
  root.appendChild(talk);
  const openTalk = () => {
    if (nearCitizen === null) return;
    const body = doc.createElement('div');
    body.className = 'city-talk-body';
    for (const text of nearCitizen.story().paragraphs) {
      const p = doc.createElement('p');
      p.textContent = text;
      body.appendChild(p);
    }
    dialog.open({ title: nearCitizen.name, body, opener: talkButton });
  };
  talkButton.addEventListener('click', openTalk);
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
      const m = (selected === null ? undefined : districts.byCode.get(selected)) ?? districts.byCode.get(ZHONGZHENG);
      const c = m?.center ?? rig.controls.target;
      // Start at the open metro station of the district nearest to its centre, as if coming up from the metro.
      const exit = m === undefined ? null : stationNear({ ...net, stations: net.stations.filter((st) => st.district === m.code) }, metro.position, c.x, c.z, Infinity);
      const [sx, sz] = exit === null ? [c.x, c.z] : metro.position(exit);
      walker.start(sx + 2, sz + 2, 0);
      walker.setVisible(true);
      citizens.setVisible(true);
      walkDistrict = selected;
      canvas.focus();
    } else {
      walker.setVisible(false);
      citizens.setVisible(false);
      nearStation = null;
      prompt.hidden = true;
      nearCitizen = null;
      talk.hidden = true;
      rig.controls.enabled = true;
      rig.flyTo(walker.position.clone(), 200, tokens.seconds('--city-motion-flight'));
    }
    o.onModeChange?.(mode);
    syncTools();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (mode === 'walk' && walker.key(e.key, false)) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent) => {
    if (mode === 'walk') {
      if (e.key === 'Escape') {
        setMode('overview');
        e.preventDefault();
      } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
        walker.zoom(e.key === '+' || e.key === '=' ? 1 / 1.2 : 1.2);
        e.preventDefault();
      } else if ((e.key === 'e' || e.key === 'E') && nearCitizen !== null) {
        openTalk();
        e.preventDefault();
      } else if ((e.key === 'e' || e.key === 'E') && nearStation !== null) {
        openStations();
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
  // Follow distance in Walk_Mode: mouse wheel and two-finger pinch (city-3d 8.3).
  const onWheel = (e: WheelEvent) => {
    if (mode !== 'walk') return;
    e.preventDefault();
    walker.zoom(Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 200) * 0.0015));
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: number | null = null;
  const onTouchDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onTouchMove = (e: PointerEvent) => {
    if (mode !== 'walk' || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2) return;
    const [a, b] = [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch !== null && span > 0) walker.zoom(pinch / span);
    pinch = span;
  };
  const onTouchUp = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    pinch = null;
  };
  canvas.addEventListener('pointerdown', onTouchDown);
  canvas.addEventListener('pointermove', onTouchMove);
  canvas.addEventListener('pointerup', onTouchUp);
  canvas.addEventListener('pointercancel', onTouchUp);
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
      const st = stationNear(net, metro.position, walker.position.x, walker.position.z, 5);
      if (st !== nearStation) {
        nearStation = st;
        prompt.hidden = st === null;
        if (st !== null) promptText.textContent = o.strings.metro.prompt.replace('{station}', st.name);
      }
      const who = citizens.near(walker.position.x, walker.position.z);
      if (who !== nearCitizen) {
        nearCitizen = who;
        talk.hidden = who === null;
        if (who !== null) talkText.textContent = o.strings.talk.prompt.replace('{name}', who.name);
      }
    } else rig.update(dt);
    const heightDuration = tokens.seconds('--city-motion-height');
    buildings.step(dt, heightDuration > 0 ? 4 / heightDuration : Infinity);
    if (motion()) traffic.step(dt, time);
    ghosts.step(time, motion());
    landmarks.step(time, motion());
    // In Walk_Mode only the Landmarks around the Avatar are named.
    landmarks.setLabelVisibility(s.camera, mode === 'walk' ? 45 : undefined);
    metro.setLabelVisibility(s.camera);
    citizens.step(time, motion(), s.camera);
    districts.setLabelVisibility(s.camera.position.distanceTo(rig.controls.target));
    s.renderer.render(s.scene, s.camera);
    s.labels.render(s.scene, s.camera);
  };
  const onVisibility = () => s.renderer.setAnimationLoop(doc.hidden ? null : frame);
  doc.addEventListener('visibilitychange', onVisibility);
  onVisibility();

  // --- city tools: walk, pause, quality, and the Illustration_Note (city-3d 8.1, 10.3, 11.1, 12.2)
  const t = o.strings.tools;
  let syncTools = () => {};
  if (t !== undefined) {
    const bar = doc.createElement('div');
    bar.className = 'city-tools';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t.label);
    const mk = (onClick: () => void) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    };
    const walkBtn = mk(() => setMode(mode === 'walk' ? 'overview' : 'walk'));
    const pauseBtn = mk(() => {
      paused = !paused;
      syncTools();
    });
    const qualityBtn = mk(() => {
      quality = quality === 'high' ? 'low' : 'high';
      applyQuality();
      syncTools();
    });
    pauseBtn.setAttribute('aria-pressed', 'false');
    const note = doc.createElement('p');
    note.className = 'city-note';
    note.textContent = t.illustrationNote;
    root.append(bar, note);
    syncTools = () => {
      walkBtn.textContent = mode === 'walk' ? t.overview : t.walk;
      pauseBtn.textContent = paused ? t.resume : t.pause;
      pauseBtn.setAttribute('aria-pressed', String(paused));
      qualityBtn.textContent = quality === 'high' ? t.qualityHigh : t.qualityLow;
    };
    syncTools();
  }

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
      net = openNetwork(METRO_DATA, next.quarter ?? '2015Q1');
      metro.setOpen(net);
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
      syncTools();
    },
    setMode,
    mode: () => mode,
    setQuality(q) {
      quality = q;
      applyQuality();
      syncTools();
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
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onTouchDown);
      canvas.removeEventListener('pointermove', onTouchMove);
      canvas.removeEventListener('pointerup', onTouchUp);
      canvas.removeEventListener('pointercancel', onTouchUp);
      walker.dispose();
      canvas.removeEventListener('blur', onBlur);
      rig.dispose();
      districts.hatch.dispose();
      s.dispose();
      root.remove();
    },
  };
}
