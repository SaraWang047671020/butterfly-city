// city-3d Requirement 1.4 and 13.4: only modules in src/ui/city/ import three, and only the jsm modules named in the design.
// The pure City_View modules (13.1) import no three at all.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'src');
const CITY = join(SRC, 'ui', 'city');
const ALLOWED_JSM = new Set([
  'three/examples/jsm/controls/OrbitControls.js',
  'three/examples/jsm/renderers/CSS2DRenderer.js',
  'three/examples/jsm/utils/BufferGeometryUtils.js',
]);
const PURE = ['projection.ts', 'geometry.ts', 'random.ts', 'street-grid.ts', 'placement.ts', 'routing.ts', 'focus-order.ts', 'colours.ts', 'collision.ts', 'metro/network.ts', 'metro/types.ts', 'metro/station-data.ts'];

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const threeImports = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/\bfrom\s*['"](three(?:\/[^'"]*)?)['"]|\bimport\s*\(\s*['"](three(?:\/[^'"]*)?)['"]/g)].map(
    (m) => (m[1] ?? m[2])!,
  );
const rel = (p: string) => relative(ROOT, p).split(sep).join('/');

describe('three.js boundary (city-3d 1.4, 1.5, 13.1, 13.4)', () => {
  it('no module outside src/ui/city imports three', () => {
    const bad = listTs(SRC)
      .filter((f) => !(f === CITY || f.startsWith(CITY + sep)))
      .flatMap((f) => threeImports(f).map((s) => `${rel(f)} imports '${s}'`));
    expect(bad).toEqual([]);
  });

  it('src/ui/city imports only three and the allowed jsm modules', () => {
    const bad = listTs(CITY).flatMap((f) =>
      threeImports(f)
        .filter((s) => s !== 'three' && !ALLOWED_JSM.has(s))
        .map((s) => `${rel(f)} imports '${s}'`),
    );
    expect(bad).toEqual([]);
  });

  it('the pure modules import no three', () => {
    for (const name of PURE) expect(threeImports(join(CITY, name))).toEqual([]);
  });
});
