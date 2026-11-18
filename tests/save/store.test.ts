import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encodeSave } from '../../src/save/codec.ts';
import { SAVE_KEY, SaveStore, type StoragePort } from '../../src/save/store.ts';
import { saveArb } from './arbitraries.ts';

function memoryPort(initial: Record<string, string> = {}): StoragePort & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe('SaveStore', () => {
  // **Validates: Requirements 19.9, 12.3, 12.7, 12.9**
  it('null port: read is unavailable and write fails', () => {
    const store = new SaveStore(null);
    expect(store.readStored()).toEqual({ kind: 'unavailable' });
    const save = fc.sample(saveArb, 1)[0]!;
    expect(store.write(save)).toEqual({ ok: false });
  });

  it('throwing setItem gives ok: false and stores nothing', () => {
    const port: StoragePort = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = new SaveStore(port);
    const save = fc.sample(saveArb, 1)[0]!;
    expect(store.write(save)).toEqual({ ok: false });
    expect(store.readStored()).toEqual({ kind: 'none' });
  });

  it('throwing getItem reads as unavailable', () => {
    const store = new SaveStore({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    });
    expect(store.readStored()).toEqual({ kind: 'unavailable' });
  });

  it('empty storage reads as none', () => {
    expect(new SaveStore(memoryPort()).readStored()).toEqual({ kind: 'none' });
  });

  it('invalid stored text is returned unchanged and not rewritten', () => {
    const bad = '{"not":"a save"} \u00e9 garbage';
    const port = memoryPort({ [SAVE_KEY]: bad });
    const store = new SaveStore(port);
    expect(store.readStored()).toEqual({ kind: 'text', text: bad });
    expect(store.readStored()).toEqual({ kind: 'text', text: bad });
    expect(port.data.get(SAVE_KEY)).toBe(bad);
  });

  it('writes the encoded save under one key only', () => {
    const port = memoryPort();
    const store = new SaveStore(port);
    const save = fc.sample(saveArb, 1)[0]!;
    expect(store.write(save)).toEqual({ ok: true });
    expect([...port.data.keys()]).toEqual([SAVE_KEY]);
    expect(port.data.get(SAVE_KEY)).toBe(encodeSave(save));
    expect(store.readStored()).toEqual({ kind: 'text', text: encodeSave(save) });
  });
});
