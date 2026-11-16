/** Repository paths used by the data scripts. All scripts resolve paths from the repo root. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RAW = path.join(ROOT, 'data', 'raw');
export const PUBLIC_DATA = path.join(ROOT, 'public', 'data');

/** Path inside data/raw/. */
export function raw(...parts: string[]): string {
  return path.join(RAW, ...parts);
}
