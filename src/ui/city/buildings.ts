// Illustrative buildings and trees as instanced meshes (city-3d 4.2, 4.3, 4.6, 4.7, 4.8).
import * as THREE from 'three';
import { GROUND_DEPTH } from './districts.ts';
import type { Placement } from './placement.ts';
import type { CityTokens } from './tokens.ts';

export interface BuildingLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly trees: THREE.InstancedMesh;
  /** Sets the class colour of one district's buildings (null: no tint). */
  setDistrictColour(districtIndex: number, colour: THREE.Color | null): void;
  /** Target height scale per district; heights move toward it in `step`. */
  setHeightTargets(scales: readonly number[]): void;
  /** Advances the height transition; `rate` is the approach rate per second (Infinity: jump). */
  step(dt: number, rate: number): void;
  setTreeShare(share: number): void;
}

export function createBuildings(scene: THREE.Scene, placements: readonly Placement[], tokens: CityTokens): BuildingLayer {
  const spots = placements.flatMap((p, d) => p.buildings.map((b) => ({ ...b, d })));
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.15 });
  const warm = tokens.color('--city-window-warm');
  const cool = tokens.color('--city-window-cool');
  material.onBeforeCompile = (sh) => {
    sh.uniforms['uWarm'] = { value: warm };
    sh.uniforms['uCool'] = { value: cool };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vONrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wpos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpos = instanceMatrix * wpos;
        #endif
        vWPos = (modelMatrix * wpos).xyz; vONrm = normal;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uWarm; uniform vec3 uCool; varying vec3 vWPos; varying vec3 vONrm;
        float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float side = 1.0 - step(0.5, abs(vONrm.y));
          float u = abs(vONrm.x) > 0.5 ? vWPos.z : vWPos.x;
          float fy = fract(vWPos.y * 1.1), fu = fract(u * 1.4);
          float win = step(0.4, fy) * step(fy, 0.72) * step(0.3, fu) * step(fu, 0.7);
          float lit = step(0.72, h3(floor(vec3(u * 1.4, vWPos.y * 1.1, vWPos.x + vWPos.z))));
          float near = 1.0 - smoothstep(120.0, 420.0, length(vViewPosition));
          totalEmissiveRadiance += diffuseColor.rgb * 0.3;
          totalEmissiveRadiance += near * mix(uWarm, uCool, h3(floor(vWPos * 0.37))) * 1.1 * win * side * lit;
        }`,
      );
  };
  const mesh = new THREE.InstancedMesh(box, material, Math.max(1, spots.length));
  mesh.count = spots.length;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const neutral = tokens.color('--city-building-neutral');
  const tmp = new THREE.Object3D();
  const colour = new THREE.Color();
  spots.forEach((s, i) => {
    tmp.position.set(s.x, GROUND_DEPTH, s.z);
    tmp.scale.set(s.width, s.height, s.depth);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
    mesh.setColorAt(i, colour.copy(neutral).multiplyScalar(s.shade));
  });
  scene.add(mesh);

  const treeSpots = placements.flatMap((p) => p.trees);
  const cone = new THREE.ConeGeometry(0.5, 1, 6);
  cone.translate(0, 0.5, 0);
  const trees = new THREE.InstancedMesh(
    cone,
    new THREE.MeshStandardMaterial({ color: tokens.color('--city-tree'), roughness: 1, emissive: tokens.color('--city-tree-glow') }),
    Math.max(1, treeSpots.length),
  );
  treeSpots.forEach((t, i) => {
    tmp.position.set(t.x, GROUND_DEPTH, t.z);
    tmp.scale.set(t.size, t.size * t.stretch, t.size);
    tmp.updateMatrix();
    trees.setMatrixAt(i, tmp.matrix);
  });
  trees.count = treeSpots.length;
  scene.add(trees);

  const districtCount = placements.length;
  const now = new Float32Array(districtCount).fill(1);
  const target = new Float32Array(districtCount).fill(1);
  const write = () => {
    spots.forEach((s, i) => {
      tmp.position.set(s.x, GROUND_DEPTH, s.z);
      tmp.scale.set(s.width, s.height * now[s.d]!, s.depth);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    mesh,
    trees,
    setDistrictColour(d, c) {
      spots.forEach((s, i) => {
        if (s.d !== d) return;
        colour.copy(neutral);
        if (c !== null) colour.copy(c).lerp(neutral, 0.25);
        mesh.setColorAt(i, colour.multiplyScalar(s.shade * 0.85));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    setHeightTargets(scales) {
      for (let d = 0; d < districtCount; d++) target[d] = scales[d] ?? 1;
    },
    step(dt, rate) {
      let dirty = false;
      for (let d = 0; d < districtCount; d++) {
        const diff = target[d]! - now[d]!;
        if (Math.abs(diff) < 1e-3) {
          if (diff !== 0) {
            now[d] = target[d]!;
            dirty = true;
          }
          continue;
        }
        now[d] = now[d]! + diff * (rate === Infinity ? 1 : Math.min(1, dt * rate));
        dirty = true;
      }
      if (dirty) write();
    },
    setTreeShare(share) {
      trees.count = Math.round(treeSpots.length * share);
    },
  };
}
