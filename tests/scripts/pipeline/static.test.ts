/**
 * Static checks over source text. Validates Requirements 1.1, 2.1, 2.2, 18.8.
 * Scans only scripts/pipeline/, package.json and the test folders that must not read the real data/raw/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

function listTs(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

/** Removes block and line comments so mentions in documentation do not count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

describe('pipeline does not use the network', () => {
  const files = listTs(path.join(ROOT, 'scripts', 'pipeline'));

  it('finds the pipeline sources', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports neither scripts/lib/http.ts nor scripts/lib/datagov.ts', () => {
    const offenders = files.filter((f) => /lib\/(http|datagov)(\.ts)?['"]/.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('never calls fetch', () => {
    const offenders = files.filter((f) => /\bfetch\s*\(/.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('npm scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('the data script runs scripts/build-data.ts', () => {
    expect(pkg.scripts['data']).toBe('node scripts/build-data.ts');
  });

  it('no script uses POSIX-only syntax', () => {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      expect(command, name).not.toMatch(/(^|[\s&|;])(rm|cp|mv|mkdir|touch|cat|export)\s/);
      expect(command, name).not.toMatch(/^\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s/);
      expect(command, name).not.toMatch(/&&\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s/);
    }
  });
});

describe('tests do not read the real data/raw/', () => {
  const dirs = [path.join(ROOT, 'tests', 'scripts', 'pipeline'), path.join(ROOT, 'tests', 'data')];
  const self = path.resolve(import.meta.filename);
  const files = dirs.flatMap(listTs).filter((f) => path.resolve(f) !== self);

  it('finds test files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no file imports the repository path helpers or builds a default-root reader or context', () => {
    const offenders = files.filter((f) => {
      const code = stripComments(fs.readFileSync(f, 'utf8'));
      return /lib\/paths(\.ts)?['"]/.test(code) || /new\s+FsRawReader\(\s*\)/.test(code) || /createContext\(\s*\)/.test(code);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('no file passes a data/raw path to a file-system call', () => {
    const fsCall = /\b(readFileSync|readdirSync|existsSync|statSync|readFile|readdir|createReadStream|openSync)\b/;
    const offenders = files.filter((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .some((line) => fsCall.test(line) && /data[\\/]+raw|'data',\s*'raw'/.test(line)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});
