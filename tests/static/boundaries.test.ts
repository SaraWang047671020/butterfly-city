import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'src');
const SCRIPTS = join(ROOT, 'scripts');

interface ImportRef {
  file: string;
  spec: string;
  target: string | null; // absolute path for relative specs, else null
  typeOnly: boolean;
}

function listTs(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function parseImports(file: string): ImportRef[] {
  const text = stripComments(readFileSync(file, 'utf8'));
  const refs: ImportRef[] = [];
  const add = (spec: string, typeOnly: boolean) => {
    const target = spec.startsWith('.') ? resolve(dirname(file), spec) : null;
    refs.push({ file, spec, target, typeOnly });
  };
  // import ... from '...', export ... from '...'
  const fromRe = /\b(import|export)\s+(type\s+)?([^;'"`]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(fromRe)) {
    const typeOnly = m[2] !== undefined || /^\s*type\s*\*/.test(m[3] ?? '');
    add(m[4]!, typeOnly);
  }
  // side-effect import '...'
  for (const m of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) add(m[1]!, false);
  // dynamic import('...')
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1]!, false);
  return refs;
}

function inDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir + sep);
}

const files = listTs(SRC);
const refs = files.flatMap(parseImports);
const rel = (p: string) => relative(ROOT, p).split(sep).join('/');

function violations(
  fromDir: string,
  bad: (r: ImportRef) => boolean,
): string[] {
  return refs
    .filter((r) => inDir(r.file, join(SRC, fromDir)) && bad(r))
    .map((r) => `${rel(r.file)} imports '${r.spec}'`);
}

const into = (r: ImportRef, ...dirs: string[]) =>
  r.target !== null && dirs.some((d) => inDir(r.target!, join(SRC, d)));

describe('module boundaries', () => {
  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('src/ui imports src/simulation only with import type, and nothing from src/save or src/data (18.1)', () => {
    const v = [
      ...violations('ui', (r) => into(r, 'simulation') && !r.typeOnly),
      ...violations('ui', (r) => into(r, 'save', 'data')),
    ];
    expect(v).toEqual([]);
  });

  it('src/save imports nothing from src/ui (18.3)', () => {
    expect(violations('save', (r) => into(r, 'ui'))).toEqual([]);
  });

  it('src/simulation imports nothing from ui, game, save, data (18.6)', () => {
    expect(violations('simulation', (r) => into(r, 'ui', 'game', 'save', 'data'))).toEqual([]);
  });

  it('nothing in src imports scripts/ (18.7)', () => {
    const v = refs
      .filter((r) => r.target !== null && inDir(r.target, SCRIPTS))
      .map((r) => `${rel(r.file)} imports '${r.spec}'`);
    expect(v).toEqual([]);
  });
});

// play-loop Requirement 11.5: the boundaries above hold for the new modules. The list makes sure each one is
// really in the checked set (a moved or renamed file fails here instead of silently leaving the scan).
const PLAY_LOOP_MODULES = [
  'src/data/character-loader.ts',
  'src/save/character-store.ts',
  'src/game/brief.ts',
  'src/game/core/change-bounds.ts',
  'src/game/life/availability.ts',
  'src/game/life/controller.ts',
  'src/game/life/life-state.ts',
  'src/game/life/numbers.ts',
  'src/ui/brief/quarter-brief.ts',
  'src/ui/character/chip.ts',
  'src/ui/character/creation.ts',
  'src/ui/district-card.ts',
  'src/ui/guide/first-play.ts',
  'src/ui/life/life-dialog.ts',
  'src/ui/menu/menu.ts',
  'src/ui/policy/policy-cards.ts',
  'src/ui/policy/preview.ts',
  'src/ui/report/city-report.ts',
  'src/ui/strings/en.ts',
  'src/ui/strings/zh-Hant.ts',
];

describe('play-loop module boundaries (play-loop 11.5)', () => {
  it('checks every play-loop module', () => {
    const checked = new Set(files.map(rel));
    expect(PLAY_LOOP_MODULES.filter((m) => !checked.has(m))).toEqual([]);
  });

  it('the play-loop modules of src/game, src/save and src/data import nothing from src/ui', () => {
    const lower = PLAY_LOOP_MODULES.filter((m) => !m.startsWith('src/ui/'));
    const v = refs
      .filter((r) => lower.includes(rel(r.file)) && into(r, 'ui'))
      .map((r) => `${rel(r.file)} imports '${r.spec}'`);
    expect(v).toEqual([]);
  });
});
