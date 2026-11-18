// Metro lines and stations in the City_View (city-3d Requirement 8.7). Lines are drawn on the ground as glowing
// ribbons between consecutive stations; most of the network runs underground, so this is a map layer, not tracks.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GROUND_DEPTH } from '../districts.ts';
import { project } from '../projection.ts';
import type { CityTokens } from '../tokens.ts';
import type { OpenNetwork } from './network.ts';
import type { MetroData, MetroStation } from './types.ts';

export const STATION_LABEL_DISTANCE = 30;

export interface MetroLayer {
  readonly position: (s: MetroStation) => readonly [number, number];
  setOpen(net: OpenNetwork): void;
  setLabelVisibility(camera: THREE.Camera): void;
}

export function createMetro(scene: THREE.Scene, data: MetroData, tokens: CityTokens): MetroLayer {
  const pos = new Map(data.stations.map((s) => [s.key, project([s.lon, s.lat])]));
  const position = (s: MetroStation) => pos.get(s.key) ?? ([0, 0] as const);
  const y = GROUND_DEPTH + 0.3;

  const lineMaterial = new Map(
    data.lines.map((l) => {
      const c = tokens.color(`--city-line-${l.id}`);
      return [l.id, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 })];
    }),
  );
  const segmentMeshes = data.segments.map((g) => {
    const a = pos.get(g.from)!;
    const b = pos.get(g.to)!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.15, 0.9), lineMaterial.get(g.line));
    mesh.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
    mesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    mesh.userData['key'] = `${g.line}|${g.from}|${g.to}`;
    scene.add(mesh);
    return mesh;
  });

  const stationMaterial = new THREE.MeshStandardMaterial({
    color: tokens.color('--city-landmark-steel'),
    emissive: tokens.color('--city-landmark-steel').multiplyScalar(0.6),
  });
  const stationGeo = new THREE.CylinderGeometry(1.3, 1.3, 0.5, 20);
  const stations = data.stations.map((s) => {
    const [x, z] = position(s);
    const mesh = new THREE.Mesh(stationGeo, stationMaterial);
    mesh.position.set(x, GROUND_DEPTH + 0.25, z);
    scene.add(mesh);
    const el = document.createElement('div');
    el.className = 'city-station-label';
    el.textContent = s.name;
    const label = new CSS2DObject(el);
    label.position.set(x, GROUND_DEPTH + 3, z);
    scene.add(label);
    return { s, mesh, label, at: new THREE.Vector3(x, GROUND_DEPTH, z) };
  });

  let open = new Set<string>();
  return {
    position,
    setOpen(net) {
      const segs = new Set(net.segments.map((g) => `${g.line}|${g.from}|${g.to}`));
      for (const m of segmentMeshes) m.visible = segs.has(m.userData['key'] as string);
      open = new Set(net.stations.map((s) => s.key));
      for (const st of stations) {
        st.mesh.visible = open.has(st.s.key);
        st.label.visible = st.mesh.visible;
      }
    },
    setLabelVisibility(camera) {
      for (const st of stations) {
        (st.label.element as HTMLElement).hidden = !open.has(st.s.key) || camera.position.distanceTo(st.at) > STATION_LABEL_DISTANCE;
      }
    },
  };
}
