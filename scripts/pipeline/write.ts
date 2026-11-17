/**
 * Transactional writer (Requirements 2.5, 16.6, 16.7, 16.8).
 *
 * 1. Snapshot every target (bytes or absence).
 * 2. Stage each text to `<target>.pipeline-tmp` in the same directory.
 * 3. Commit: rename each temp over its target, in the given order.
 * 4. On any failure: restore renamed targets from the snapshot, delete all temp files, throw WriteError.
 * 5. On success no temp files remain.
 *
 * A crash during commit can leave a mix of new and old files. The next run deletes stale temp files first and
 * the outputs are deterministic, so a re-run converges.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, PUBLIC_DATA, ROOT } from '../lib/paths.ts';
import { WriteError } from './errors.ts';
import { serializeJson } from './serialize.ts';
import { STALE_TEMP_SUFFIX, type BuildState, type Step } from './run.ts';

export interface PlannedWrite {
  readonly path: string;
  readonly text: string;
}

/** File operations used by the writer. Injected by tests; `node:fs` by default. */
export interface WriteFs {
  exists(file: string): boolean;
  readBytes(file: string): Uint8Array;
  writeFile(file: string, bytes: Uint8Array): void;
  /** Renames `from` over `to`, replacing an existing `to`. */
  rename(from: string, to: string): void;
  /** Deletes a file; no error when it is absent. */
  remove(file: string): void;
  /** Creates a directory and its parents. */
  mkdirp(dir: string): void;
}

export const nodeFs: WriteFs = {
  exists: (file) => fs.existsSync(file),
  readBytes: (file) => new Uint8Array(fs.readFileSync(file)),
  writeFile: (file, bytes) => fs.writeFileSync(file, bytes),
  rename: (from, to) => fs.renameSync(from, to),
  remove: (file) => fs.rmSync(file, { force: true }),
  mkdirp: (dir) => void fs.mkdirSync(dir, { recursive: true }),
};

function display(file: string): string {
  const rel = path.relative(ROOT, file);
  const shown = rel === '' || rel.startsWith('..') || path.isAbsolute(rel) ? file : rel;
  return shown.split(path.sep).join('/');
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Writes all planned files, or none: on any failure the previous state is restored and WriteError is thrown. */
export function writeAll(writes: readonly PlannedWrite[], fsImpl: WriteFs = nodeFs): void {
  const encoder = new TextEncoder();
  const temps = writes.map((w) => w.path + STALE_TEMP_SUFFIX);
  const snapshots: Array<Uint8Array | null> = [];
  let renamed = 0;
  let failedFile = '';

  try {
    failedFile = writes[0]?.path ?? '';
    for (const w of writes) {
      failedFile = w.path;
      snapshots.push(fsImpl.exists(w.path) ? fsImpl.readBytes(w.path) : null);
    }
    for (let i = 0; i < writes.length; i++) {
      const w = writes[i] as PlannedWrite;
      failedFile = w.path;
      fsImpl.mkdirp(path.dirname(w.path));
      fsImpl.writeFile(temps[i] as string, encoder.encode(w.text));
    }
    for (let i = 0; i < writes.length; i++) {
      const w = writes[i] as PlannedWrite;
      failedFile = w.path;
      fsImpl.rename(temps[i] as string, w.path);
      renamed = i + 1;
    }
  } catch (error) {
    const problems: string[] = [];
    for (let i = 0; i < renamed; i++) {
      const w = writes[i] as PlannedWrite;
      try {
        const before = snapshots[i];
        if (before === null || before === undefined) fsImpl.remove(w.path);
        else fsImpl.writeFile(w.path, before);
      } catch (rollbackError) {
        problems.push(`rollback of ${display(w.path)} failed: ${reasonOf(rollbackError)}`);
      }
    }
    for (const temp of temps) {
      try {
        fsImpl.remove(temp);
      } catch (cleanupError) {
        problems.push(`could not delete ${display(temp)}: ${reasonOf(cleanupError)}`);
      }
    }
    const extra = problems.length === 0 ? '' : ` (${problems.join('; ')})`;
    throw new WriteError(display(failedFile), `${reasonOf(error)}${extra}`);
  }
}

export const SOURCES_FILE = path.join(DATA_DIR, 'SOURCES.md');

/** Plans the four writes in commit order. The three JSON files are required; SOURCES.md only when present. */
export function planWrites(state: BuildState): PlannedWrite[] {
  if (state.districtsFile === undefined) throw new Error('write: districts file is missing');
  if (state.historyFile === undefined) throw new Error('write: history file is missing');
  if (state.policyTrackFile === undefined) throw new Error('write: policy-track file is missing');
  if (state.commuteMatrix === undefined) throw new Error('write: commute-matrix file is missing');
  const writes: PlannedWrite[] = [
    { path: path.join(PUBLIC_DATA, 'districts.json'), text: serializeJson(state.districtsFile) },
    { path: path.join(PUBLIC_DATA, 'history.json'), text: serializeJson(state.historyFile) },
    { path: path.join(PUBLIC_DATA, 'policy-track.json'), text: serializeJson(state.policyTrackFile) },
    { path: path.join(PUBLIC_DATA, 'commute-matrix.json'), text: serializeJson(state.commuteMatrix) },
  ];
  if (state.sourcesDoc !== undefined) writes.push({ path: SOURCES_FILE, text: state.sourcesDoc });
  return writes;
}

/** The write step. Not in DEFAULT_STEPS until task 14.2. */
export function writeStep(fsImpl: WriteFs = nodeFs): Step {
  return {
    name: 'write',
    run(_ctx, state) {
      writeAll(planWrites(state), fsImpl);
    },
  };
}
