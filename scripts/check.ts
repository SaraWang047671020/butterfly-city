/**
 * Prints coverage reports (years, quarters, months, 41 districts) for raw files already in
 * data/raw/. Downloads nothing. These reports produce the numbers in data/DATA-CHECK.md.
 *
 *   node scripts/check.ts all
 *   node scripts/check.ts lvr population
 */
import { parseCli } from './sources/index.ts';

const { sources, options } = parseCli(process.argv.slice(2), 'check');
let failed = 0;
for (const source of sources) {
  console.log(`\n== ${source.id}: ${source.title}`);
  try {
    await source.check(options);
  } catch (e) {
    failed++;
    console.error(`  ${source.id} FAILED: ${(e as Error).message}`);
  }
}
process.exitCode = failed > 0 ? 1 : 0;
