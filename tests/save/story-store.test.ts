// The followed Persona store (story-layer Requirement 5.2, 5.3).
import { describe, expect, it } from 'vitest';
import { readPersonaId, STORY_KEY, writePersonaId } from '../../src/save/story-store.ts';
import type { StoragePort } from '../../src/save/store.ts';

const memory = (): StoragePort & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const ids = ['ting-zhonghe', 'lin-wanhua'];

describe('story store', () => {
  it('round-trips a valid Persona id under its own key', () => {
    const port = memory();
    expect(writePersonaId(port, 'lin-wanhua')).toBe(true);
    expect([...port.data.keys()]).toEqual([STORY_KEY]);
    expect(readPersonaId(port, ids)).toBe('lin-wanhua');
  });

  it('returns null for an unknown id, a wrong schema, bad JSON or no storage (picker shown again)', () => {
    const port = memory();
    writePersonaId(port, 'someone-else');
    expect(readPersonaId(port, ids)).toBeNull();
    port.data.set(STORY_KEY, JSON.stringify({ schemaVersion: 2, personaId: 'ting-zhonghe' }));
    expect(readPersonaId(port, ids)).toBeNull();
    port.data.set(STORY_KEY, '{not json');
    expect(readPersonaId(port, ids)).toBeNull();
    expect(readPersonaId(null, ids)).toBeNull();
    expect(writePersonaId(null, 'ting-zhonghe')).toBe(false);
    const throwing: StoragePort = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readPersonaId(throwing, ids)).toBeNull();
    expect(writePersonaId(throwing, 'ting-zhonghe')).toBe(false);
  });
});
