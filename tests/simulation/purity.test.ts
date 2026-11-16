/**
 * Static purity scan of src/simulation/.
 * Validates: Requirements 1.6, 1.7, 1.8, 2.6, 14.1, 16.1
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src', 'simulation');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

/** Replaces comments, string literals and template text with spaces (keeps line numbers). */
function stripNonCode(src: string): string {
  let out = '';
  let i = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const c = src[i] as string;
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += blank(src.slice(i, j + 1));
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Import specifiers read from the original source (strings must stay intact). */
function importSpecifiers(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
  const specs: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;
  for (let m = re.exec(code); m !== null; m = re.exec(code)) specs.push(m[2] as string);
  return specs;
}

const files = listFiles(ROOT).map((path) => {
  const text = readFileSync(path, 'utf8');
  return { path, name: relative(process.cwd(), path).replace(/\\/g, '/'), text, code: stripNonCode(text) };
});
const ruleFiles = files.filter((f) => f.name.startsWith('src/simulation/rules/'));

const FORBIDDEN_LAYERS = ['ui', 'game', 'save', 'data'];
const ALLOWED_LITERALS = new Set(['0', '1', '3', '4', '12', '100']);

describe('static purity scan of src/simulation', () => {
  it('finds the simulation sources', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(ruleFiles.length).toBeGreaterThan(0);
  });

  it('has no imports from src/ui, src/game, src/save or src/data', () => {
    const violations: string[] = [];
    for (const f of files) {
      for (const spec of importSpecifiers(f.text)) {
        const parts = spec.split('/').filter((p) => p !== '.' && p !== '');
        const hit = parts.some((p, k) => FORBIDDEN_LAYERS.includes(p) && (k === 0 || parts[k - 1] === '..' || parts[k - 1] === 'src'));
        if (hit && (spec.startsWith('..') || spec.startsWith('src/') || spec.startsWith('/') || spec.startsWith('@/'))) {
          violations.push(`${f.name}: ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('uses no DOM, network, storage, clock or random APIs', () => {
    const banned = /(?<![\w$.])(document|window|fetch|localStorage|sessionStorage|Date|performance)\b|\bMath\s*\.\s*random\b/g;
    const violations: string[] = [];
    for (const f of files) {
      f.code.split('\n').forEach((line, idx) => {
        for (const m of line.matchAll(banned)) violations.push(`${f.name}:${idx + 1}: ${m[0]}`);
      });
    }
    expect(violations).toEqual([]);
  });

  it('has no top-level let or var', () => {
    const violations: string[] = [];
    for (const f of files) {
      f.code.split('\n').forEach((line, idx) => {
        if (/^(?:export\s+)?(?:let|var)\s/.test(line)) violations.push(`${f.name}:${idx + 1}: ${line.trim()}`);
      });
    }
    expect(violations).toEqual([]);
  });

  it('uses only the numeric literals 0, 1, 3, 4, 12 and 100 in rules/', () => {
    const violations: string[] = [];
    const num = /(?<![\w$.])(?:0[xX][\da-fA-F]+|(?:\d[\d_]*\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?![\w$])/g;
    for (const f of ruleFiles) {
      f.code.split('\n').forEach((line, idx) => {
        for (const m of line.matchAll(num)) {
          if (!ALLOWED_LITERALS.has(m[0])) violations.push(`${f.name}:${idx + 1}: ${m[0]}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('exports exactly one rule from each rules/ file', () => {
    const violations: string[] = [];
    for (const f of ruleFiles) {
      const rules = [...f.code.matchAll(/^export\s+const\s+(\w+)\s*:\s*(?:ToolRule|IndicatorRule)\b/gm)];
      if (rules.length !== 1) violations.push(`${f.name}: ${rules.length} exported rules`);
    }
    expect(violations).toEqual([]);
  });
});
