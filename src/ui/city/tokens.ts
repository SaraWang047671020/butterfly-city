// Reads the City_View colours and motion durations from the Token_File custom properties (city-3d 3.4).
import * as THREE from 'three';

export interface CityTokens {
  readonly color: (name: string) => THREE.Color;
  readonly list: (prefix: string, count: number) => THREE.Color[];
  /** Duration of a `--*` time token in seconds (0 under reduced motion, as the Token_File sets it). */
  readonly seconds: (name: string) => number;
}

/** Parses a CSS time value in milliseconds or seconds to seconds; anything else is 0. */
export function parseSeconds(text: string): number {
  const t = text.trim();
  const ms = /^(-?\d+(?:\.\d+)?)ms$/.exec(t);
  if (ms) return Number(ms[1]) / 1000;
  const s = /^(-?\d+(?:\.\d+)?)s$/.exec(t);
  return s ? Number(s[1]) : 0;
}

export function readTokens(root: Element): CityTokens {
  const style = getComputedStyle(root);
  const raw = (name: string) => style.getPropertyValue(name).trim();
  const cache = new Map<string, THREE.Color>();
  const color = (name: string): THREE.Color => {
    let c = cache.get(name);
    if (c === undefined) {
      const v = raw(name);
      // A missing token falls back to mid grey so that a typo shows up on screen instead of failing.
      c = new THREE.Color(v === '' ? 'grey' : v);
      cache.set(name, c);
    }
    return c.clone();
  };
  return {
    color,
    list: (prefix, count) => Array.from({ length: count }, (_, i) => color(`${prefix}${i}`)),
    seconds: (name) => parseSeconds(raw(name)),
  };
}
