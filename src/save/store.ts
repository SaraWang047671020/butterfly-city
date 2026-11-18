// Save_Store over an injected storage port. One key only. Never removes or rewrites stored text on its own.

import type { Save } from '../types/save.ts';
import { encodeSave } from './codec.ts';

export const SAVE_KEY = 'butterflycity.save.v1';

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type StoredRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'text'; readonly text: string };

export class SaveStore {
  private readonly port: StoragePort | null;

  constructor(port: StoragePort | null) {
    this.port = port;
  }

  readStored(): StoredRead {
    if (this.port === null) return { kind: 'unavailable' };
    try {
      const text = this.port.getItem(SAVE_KEY);
      return text === null ? { kind: 'none' } : { kind: 'text', text };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  write(save: Save): { readonly ok: boolean } {
    if (this.port === null) return { ok: false };
    try {
      this.port.setItem(SAVE_KEY, encodeSave(save));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
}
