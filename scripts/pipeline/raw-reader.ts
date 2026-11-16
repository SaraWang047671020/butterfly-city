/**
 * The only reader of data/raw/. Listings are sorted by Unicode code point (never file-system order)
 * and messages use repository-relative paths with forward slashes, so output is machine independent.
 *
 * Paths passed to the reader are relative to data/raw/, with forward slashes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RAW } from '../lib/paths.ts';
import { codePointCompare } from './numeric.ts';

export type TextEncoding = 'utf-8' | 'big5';

export interface RawReader {
  /** Entry names directly inside a directory under data/raw/, sorted by Unicode code point. */
  list(dir: string): readonly string[];
  exists(relPath: string): boolean;
  readBytes(relPath: string): Buffer;
  /** Decodes UTF-8 (BOM stripped) or Big5. */
  readText(relPath: string, encoding?: TextEncoding): string;
  /** Repository-relative path with forward slashes, used in every message. */
  display(relPath: string, zipEntry?: string): string;
}

const DISPLAY_ROOT = 'data/raw';

/** Normalizes to forward slashes with no leading, trailing or repeated slash. Rejects `.`/`..` segments. */
function normalize(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.');
  if (parts.includes('..')) throw new Error(`Path escapes data/raw: ${relPath}`);
  return parts.join('/');
}

export function decodeText(bytes: Uint8Array, encoding: TextEncoding = 'utf-8'): string {
  if (encoding === 'big5') return new TextDecoder('big5').decode(bytes);
  // ignoreBOM: true keeps the BOM in the output, so it is stripped explicitly below.
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function displayPath(relPath: string, zipEntry?: string): string {
  const base = normalize(relPath);
  const full = base === '' ? DISPLAY_ROOT : `${DISPLAY_ROOT}/${base}`;
  return zipEntry === undefined ? full : `${full}!${zipEntry}`;
}

/** Reader backed by a directory on disk (default: data/raw/). */
export class FsRawReader implements RawReader {
  private readonly root: string;

  constructor(root: string = RAW) {
    this.root = root;
  }

  private abs(relPath: string): string {
    return path.join(this.root, ...normalize(relPath).split('/'));
  }

  list(dir: string): readonly string[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.abs(dir));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return [];
      throw e;
    }
    return names.sort(codePointCompare);
  }

  exists(relPath: string): boolean {
    return fs.existsSync(this.abs(relPath));
  }

  readBytes(relPath: string): Buffer {
    return fs.readFileSync(this.abs(relPath));
  }

  readText(relPath: string, encoding: TextEncoding = 'utf-8'): string {
    return decodeText(this.readBytes(relPath), encoding);
  }

  display(relPath: string, zipEntry?: string): string {
    return displayPath(relPath, zipEntry);
  }
}

/** Reader over an in-memory file map, for tests. Never touches the file system. */
export class MemoryRawReader implements RawReader {
  private readonly files: Map<string, Buffer>;

  /** `files` maps paths relative to data/raw/ to text (stored as UTF-8) or bytes. */
  constructor(files: Readonly<Record<string, string | Uint8Array>> = {}) {
    this.files = new Map();
    for (const [p, content] of Object.entries(files)) {
      this.files.set(normalize(p), typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content));
    }
  }

  list(dir: string): readonly string[] {
    const prefix = normalize(dir);
    const start = prefix === '' ? '' : `${prefix}/`;
    const names = new Set<string>();
    for (const p of this.files.keys()) {
      if (!p.startsWith(start)) continue;
      const first = p.slice(start.length).split('/')[0];
      if (first !== undefined && first !== '') names.add(first);
    }
    return [...names].sort(codePointCompare);
  }

  exists(relPath: string): boolean {
    const p = normalize(relPath);
    if (this.files.has(p)) return true;
    return this.list(p).length > 0;
  }

  readBytes(relPath: string): Buffer {
    const bytes = this.files.get(normalize(relPath));
    if (bytes === undefined) throw new Error(`ENOENT: no such file ${displayPath(relPath)}`);
    return bytes;
  }

  readText(relPath: string, encoding: TextEncoding = 'utf-8'): string {
    return decodeText(this.readBytes(relPath), encoding);
  }

  display(relPath: string, zipEntry?: string): string {
    return displayPath(relPath, zipEntry);
  }
}
