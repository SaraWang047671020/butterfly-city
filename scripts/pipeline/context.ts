/** BuildContext: everything a pipeline step receives. Steps do no other I/O besides the reader and logger. */
import { DISTRICTS, type DistrictRef } from '../lib/districts.ts';
import { quartersBetween, type Quarter } from '../lib/time.ts';
import { FsRawReader, type RawReader } from './raw-reader.ts';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface BuildContext {
  readonly reader: RawReader;
  /** The 41 districts, in the order of scripts/lib/districts.ts (ascending code). */
  readonly districts: readonly DistrictRef[];
  /** The 44 quarters, 2015Q1 to 2025Q4. */
  readonly quarters: readonly Quarter[];
  readonly logger: Logger;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

/** Logger that stores lines, for tests. */
export function memoryLogger(): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message) => void lines.push(message),
    warn: (message) => void lines.push(`warning: ${message}`),
  };
}

export function createContext(options: { reader?: RawReader; logger?: Logger } = {}): BuildContext {
  return {
    reader: options.reader ?? new FsRawReader(),
    districts: DISTRICTS,
    quarters: quartersBetween(),
    logger: options.logger ?? consoleLogger,
  };
}
