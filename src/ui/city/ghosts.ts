// Ghost_Figures above the districts (city-3d Requirement 6). One sprite per simulated ghost, at most 12 per district.
import * as THREE from 'three';
import type { Rand } from './random.ts';
import type { CityTokens } from './tokens.ts';

export const MAX_GHOSTS_PER_DISTRICT = 12;

function ghostTexture(tokens: CityTokens): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 80;
  const g = c.getContext('2d');
  if (g !== null) {
    const body = tokens.color('--city-ghost');
    const eye = tokens.color('--city-ghost-eye');
    const withAlpha = (col: THREE.Color, a: number) => `#${col.getHexString()}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
    const grad = g.createRadialGradient(32, 30, 4, 32, 36, 40);
    grad.addColorStop(0, withAlpha(body, 0.95));
    grad.addColorStop(1, withAlpha(body, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(8, 72);
    g.lineTo(8, 32);
    g.arc(32, 32, 24, Math.PI, 0);
    g.lineTo(56, 72);
    for (let i = 0; i < 4; i++) g.quadraticCurveTo(50 - i * 12, 62, 44 - i * 12, 72);
    g.fill();
    g.fillStyle = withAlpha(eye, 0.9);
    g.beginPath();
    g.ellipse(24, 34, 3.5, 5, 0, 0, Math.PI * 2);
    g.ellipse(40, 34, 3.5, 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

interface Ghost {
  readonly sprite: THREE.Sprite;
  readonly base: THREE.Vector3;
  readonly phase: number;
}

export interface GhostLayer {
  /** Shows min(12, count) figures above each district; null or 0 shows none. */
  setCounts(counts: readonly (number | null)[]): void;
  step(time: number, moving: boolean): void;
}

export function createGhosts(scene: THREE.Scene, centers: readonly THREE.Vector3[], tokens: CityTokens, rand: Rand): GhostLayer {
  const texture = ghostTexture(tokens);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const perDistrict: Ghost[][] = centers.map((c) =>
    Array.from({ length: MAX_GHOSTS_PER_DISTRICT }, () => {
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(5.5, 7, 1);
      sprite.raycast = () => {}; // receives no pointer events (city-3d 6.5)
      const base = c.clone().add(new THREE.Vector3((rand() - 0.5) * 40, 70 + rand() * 40, (rand() - 0.5) * 40));
      sprite.position.copy(base);
      sprite.visible = false;
      scene.add(sprite);
      return { sprite, base, phase: rand() * Math.PI * 2 };
    }),
  );
  return {
    setCounts(counts) {
      perDistrict.forEach((list, d) => {
        const n = Math.min(MAX_GHOSTS_PER_DISTRICT, Math.max(0, Math.round(counts[d] ?? 0)));
        list.forEach((g, k) => (g.sprite.visible = k < n));
      });
    },
    step(time, moving) {
      for (const list of perDistrict) {
        for (const g of list) {
          if (!g.sprite.visible) continue;
          const a = moving ? time * 0.8 + g.phase : g.phase;
          g.sprite.position.set(g.base.x + Math.sin(a * 0.7) * 6, g.base.y + Math.sin(a) * 3, g.base.z + Math.cos(a * 0.6) * 6);
        }
      }
    },
  };
}
