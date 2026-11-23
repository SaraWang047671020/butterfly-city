// The followed Persona, under its own localStorage key (story-layer Requirement 5.2, 5.3). The game Save and the
// Save_Code are unchanged; the Persona choice is not part of an exported Save_Code.
import type { StoragePort } from './store.ts';

export const STORY_KEY = 'butterflycity.story.v1';

/** The stored Persona id, or null when nothing valid is stored or storage is unavailable. */
export function readPersonaId(port: StoragePort | null, validIds: readonly string[]): string | null {
  if (port === null) return null;
  try {
    const text = port.getItem(STORY_KEY);
    if (text === null) return null;
    const v = JSON.parse(text) as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const rec = v as Record<string, unknown>;
    const id = rec['personaId'];
    return rec['schemaVersion'] === 1 && typeof id === 'string' && validIds.includes(id) ? id : null;
  } catch {
    return null;
  }
}

/** Stores the Persona id; returns false when storage is unavailable. */
export function writePersonaId(port: StoragePort | null, personaId: string): boolean {
  if (port === null) return false;
  try {
    port.setItem(STORY_KEY, JSON.stringify({ schemaVersion: 1, personaId }));
    return true;
  } catch {
    return false;
  }
}
