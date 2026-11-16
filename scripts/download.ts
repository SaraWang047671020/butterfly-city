/**
 * Downloads raw open data into data/raw/ (gitignored). Resumable: existing files are skipped
 * unless --force is given.
 *
 *   node scripts/download.ts --help
 *   node scripts/download.ts income lvr
 *   node scripts/download.ts mrt --od=2025-12
 */
import { parseCli } from './sources/index.ts';

const { sources, options } = parseCli(process.argv.slice(2), 'download');
let failed = 0;
for (const source of sources) {
  console.log(`\n== ${source.id}: ${source.title}`);
  try {
    await source.download(options);
  } catch (e) {
    failed++;
    console.error(`  ${source.id} FAILED: ${(e as Error).message}`);
  }
}
process.exitCode = failed > 0 ? 1 : 0;
