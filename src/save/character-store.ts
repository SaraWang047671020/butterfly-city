// Character_Store (play-loop Requirement 2.10, 2.11; life-story Requirement 7.1): the Character, its Life_Timeline,
// the First_Play_Guide flag and, from version 2, the seed of the Character's story and the Life_Event choices, under
// their own localStorage key. The game Save and the Save_Code are unchanged; the Character is not part of an exported
// Save_Code. A stored value that does not have the expected shape is ignored (read as none). A version 1 record is
// read with no seed (the game derives one) and no choices.
import type { StoragePort } from './store.ts';

export const CHARACTER_KEY = 'butterflycity.character.v1';

export interface StoredChoice {
  readonly quarter: string;
  readonly event: string;
  readonly option: string;
}

export interface StoredCharacter {
  readonly schemaVersion: 2;
  /** The Character and its Life_Timeline as the game layer defines them; checked by shape only. */
  readonly character: unknown;
  readonly timeline: readonly unknown[];
  readonly guideDone: boolean;
  /** Seed of the Life_Events and Shared_Draws; null in a version 1 record. */
  readonly seed: number | null;
  readonly choices: readonly StoredChoice[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isChoice = (x: unknown): x is StoredChoice =>
  isObj(x) && typeof x['quarter'] === 'string' && typeof x['event'] === 'string' && typeof x['option'] === 'string';

/** The stored Character record, or null when nothing valid is stored or storage is unavailable. */
export function readCharacter(port: StoragePort | null): StoredCharacter | null {
  if (port === null) return null;
  try {
    const text = port.getItem(CHARACTER_KEY);
    if (text === null) return null;
    const v = JSON.parse(text) as unknown;
    if (!isObj(v) || (v['schemaVersion'] !== 1 && v['schemaVersion'] !== 2) || !isObj(v['character']) || !Array.isArray(v['timeline'])) return null;
    const v2 = v['schemaVersion'] === 2;
    const seed = v2 && typeof v['seed'] === 'number' && Number.isInteger(v['seed']) ? v['seed'] : null;
    const choices = v2 && Array.isArray(v['choices']) ? v['choices'].filter(isChoice) : [];
    return { schemaVersion: 2, character: v['character'], timeline: v['timeline'], guideDone: v['guideDone'] === true, seed, choices };
  } catch {
    return null;
  }
}

/** Stores the Character record (version 2); returns false when storage is unavailable. */
export function writeCharacter(port: StoragePort | null, record: Omit<StoredCharacter, 'schemaVersion'>): boolean {
  if (port === null) return false;
  try {
    port.setItem(CHARACTER_KEY, JSON.stringify({ schemaVersion: 2, ...record }));
    return true;
  } catch {
    return false;
  }
}
