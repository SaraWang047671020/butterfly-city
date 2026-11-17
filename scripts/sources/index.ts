/** Registry of raw-data sources, in the order of data/DATA-CHECK.md. */
import { affordability } from './affordability.ts';
import { air } from './air.ts';
import { boundaries } from './boundaries.ts';
import { commute } from './commute.ts';
import { income } from './income.ts';
import { lowUse } from './low-use.ts';
import { lvr } from './lvr.ts';
import { macro } from './macro.ts';
import { mrt } from './mrt.ts';
import { policy } from './policy.ts';
import { population } from './population.ts';
import { rent } from './rent.ts';
import { socialHousing } from './social-housing.ts';
import { stations } from './stations.ts';
import { fares, timetables } from './tdx-rail.ts';
import type { Source, SourceOptions } from './types.ts';
import { villages } from './villages.ts';

export const SOURCES: readonly Source[] = [income, lvr, rent, population, mrt, stations, commute, socialHousing, macro, affordability, air, boundaries, policy, fares, timetables, lowUse, villages];

export interface Cli {
  readonly sources: readonly Source[];
  readonly options: SourceOptions;
}

/** Parses `[source ...|all] [--force] [--key=value ...]`. Exits with usage text on --help or unknown ids. */
export function parseCli(argv: readonly string[], command: string): Cli {
  const flags: Record<string, string | true> = {};
  const ids: string[] = [];
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) flags[m[1]!] = m[2] ?? true;
    else ids.push(arg);
  }
  const usage = () => {
    console.log(`Usage: node scripts/${command}.ts <source ...|all> [--force] [--flag=value]\n\nSources:`);
    for (const s of SOURCES) console.log(`  ${s.id.padEnd(15)} ${s.title}`);
    process.exit(0);
  };
  if (flags['help'] || ids.length === 0) usage();
  const unknown = ids.filter((id) => id !== 'all' && !SOURCES.some((s) => s.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown source: ${unknown.join(', ')}`);
    usage();
  }
  const sources = ids.includes('all') ? SOURCES : SOURCES.filter((s) => ids.includes(s.id));
  return { sources, options: { force: flags['force'] === true, flags } };
}
