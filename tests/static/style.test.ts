// game-ui Requirements 1.9, 19.7: colours and durations live in tokens.css only.
// Scope: every .css in src/styles except tokens.css and city.css (city-3d owned), and every .ts under src/ui except src/ui/city.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');
const STYLES = join(ROOT, 'src', 'styles');
const UI = join(ROOT, 'src', 'ui');
const CITY = join(UI, 'city');
const EXCLUDED_CSS = new Set(['tokens.css', 'city.css']);

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

/** Replace comments with spaces, keeping line breaks so line numbers stay correct. */
function stripComments(src: string, css: boolean): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  let out = src.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (!css) out = out.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p: string) => p + blank(m.slice(p.length)));
  return out;
}

const PATTERNS: Array<[string, RegExp]> = [
  ['hex colour', /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g],
  ['colour function', /\b(?:rgba?|hsla?)\(/g],
  ['time value', /(?<![\w.-])\d*\.?\d+(?:ms|s)(?![\w-])/g],
];

function violations(file: string, css: boolean): string[] {
  const lines = stripComments(readFileSync(file, 'utf8'), css).split('\n');
  const rel = relative(ROOT, file).split(sep).join('/');
  const out: string[] = [];
  lines.forEach((line, i) => {
    for (const [label, re] of PATTERNS) {
      for (const m of line.matchAll(re)) out.push(`${rel}:${i + 1} ${label} '${m[0]}'`);
    }
  });
  return out;
}

describe('style tokens only (game-ui 1.9, 19.7)', () => {
  it('src/styles/*.css (except tokens.css, city.css) has no literal colours or durations', () => {
    const files = walk(STYLES, '.css').filter((f) => !EXCLUDED_CSS.has(f.slice(STYLES.length + 1)));
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((f) => violations(f, true))).toEqual([]);
  });

  it('src/ui/**/*.ts (except src/ui/city) has no literal colours or durations', () => {
    const files = walk(UI, '.ts').filter((f) => !f.startsWith(CITY + sep));
    expect(files.flatMap((f) => violations(f, false))).toEqual([]);
  });
});
