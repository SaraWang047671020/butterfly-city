/** In-memory WriteFs with failure injection at the n-th call (1-based) of one operation kind. */
import type { WriteFs } from '../../../scripts/pipeline/write.ts';

export type FsOp = 'exists' | 'readBytes' | 'writeFile' | 'rename' | 'remove' | 'mkdirp';

export interface Failure {
  readonly op: FsOp;
  /** 1-based index among calls of `op`. */
  readonly nth: number;
  /** When true the operation fails only during rollback (after the first failure). Default false. */
  readonly afterFirstFailure?: boolean;
}

export class FakeWriteFs implements WriteFs {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  readonly calls: Record<FsOp, number> = { exists: 0, readBytes: 0, writeFile: 0, rename: 0, remove: 0, mkdirp: 0 };
  private readonly failures: readonly Failure[];
  private failed = false;

  constructor(initial: Record<string, string> = {}, failures: readonly Failure[] = []) {
    for (const [file, text] of Object.entries(initial)) this.files.set(file, new TextEncoder().encode(text));
    this.failures = failures;
  }

  private tick(op: FsOp): void {
    this.calls[op] += 1;
    for (const f of this.failures) {
      if (f.op !== op || f.nth !== this.calls[op]) continue;
      if (f.afterFirstFailure === true && !this.failed) continue;
      this.failed = true;
      throw new Error(`injected ${op} failure #${f.nth}`);
    }
  }

  text(file: string): string | undefined {
    const bytes = this.files.get(file);
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }

  exists(file: string): boolean {
    this.tick('exists');
    return this.files.has(file);
  }

  readBytes(file: string): Uint8Array {
    this.tick('readBytes');
    const bytes = this.files.get(file);
    if (bytes === undefined) throw new Error(`ENOENT ${file}`);
    return bytes.slice();
  }

  writeFile(file: string, bytes: Uint8Array): void {
    this.tick('writeFile');
    this.files.set(file, bytes.slice());
  }

  rename(from: string, to: string): void {
    this.tick('rename');
    const bytes = this.files.get(from);
    if (bytes === undefined) throw new Error(`ENOENT ${from}`);
    this.files.delete(from);
    this.files.set(to, bytes);
  }

  remove(file: string): void {
    this.tick('remove');
    this.files.delete(file);
  }

  mkdirp(dir: string): void {
    this.tick('mkdirp');
    this.dirs.add(dir);
  }

  tempFiles(): string[] {
    return [...this.files.keys()].filter((k) => k.endsWith('.pipeline-tmp'));
  }
}
