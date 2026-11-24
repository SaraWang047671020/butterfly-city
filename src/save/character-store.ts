// Character_Store (play-loop Requirement 2.10, 2.11): the Character, its Life_Timeline and the First_Play_Guide flag
// under their own localStorage key. The game Save and the Save_Code are unchanged; the Character is not part of an
// exported Save_Code. A stored value that does not have the expected shape is ignored (read as none).
import type { StoragePort } from './store.ts';

export const CHARACTER_KEY = 'butterflycity.character.v1';

export interface StoredCharacter {
  readonly schemaVersion: 1;
  /** The Character and its Life_Timeline as the game layer defines them; checked by shape only. */
  readonly character: unknown;
  readonly timeline: readonly unknown[];
  readonly guideDone: boolean;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The stored Character record, or null when nothing valid is stored or storage is unavailable. */
export function readCharacter(port: StoragePort | null): StoredCharacter | null {
  if (port === null) return null;
  try {
    const text = port.getItem(CHARACTER_KEY);
    if (text === null) return null;
    const v = JSON.parse(text) as unknown;
    if (!isObj(v) || v['schemaVersion'] !== 1 || !isObj(v['character']) || !Array.isArray(v['timeline'])) return null;
    return { schemaVersion: 1, character: v['character'], timeline: v['timeline'], guideDone: v['guideDone'] === true };
  } catch {
    return null;
  }
}

/** Stores the Character record; returns false when storage is unavailable. */
export function writeCharacter(port: StoragePort | null, record: Omit<StoredCharacter, 'schemaVersion'>): boolean {
  if (port === null) return false;
  try {
    port.setItem(CHARACTER_KEY, JSON.stringify({ schemaVersion: 1, ...record }));
    return true;
  } catch {
    return false;
  }
}
