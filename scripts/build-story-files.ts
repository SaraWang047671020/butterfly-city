/**
 * npm run story-files (story-layer tasks 1 and 2, done by Claude Code):
 * - copies data/config/citizens.json and data/config/model-limits.json to public/data/ (no transformation);
 * - writes public/data/income-spread.json from the FIA quartile file of income year 2023 in data/raw/income/.
 * Exits 1 on any error and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DISTRICTS } from './lib/districts.ts';
import { ROOT, raw } from './lib/paths.ts';
import { FIA_REFERENCE_FILE } from './pipeline/params/part1.ts';
import { GHOST_REFERENCE_YEAR } from './pipeline/params/ghost.ts';
import { parseFiaQuartiles } from './pipeline/parsers/income.ts';
import { incomeSpreadOf, serializeIncomeSpread } from './story/income-spread.ts';

const COPIES = ['citizens.json', 'model-limits.json'] as const;

try {
  const outputs = new Map<string, string>();
  for (const name of COPIES) {
    const text = fs.readFileSync(path.join(ROOT, 'data', 'config', name), 'utf8');
    JSON.parse(text); // stop on invalid JSON before anything is written
    outputs.set(path.join(ROOT, 'public', 'data', name), text);
  }
  const fia = raw(FIA_REFERENCE_FILE);
  const rows = parseFiaQuartiles(fs.readFileSync(fia, 'utf8'), `data/raw/${FIA_REFERENCE_FILE}`, GHOST_REFERENCE_YEAR);
  const spread = incomeSpreadOf(
    rows,
    DISTRICTS.map((d) => d.code),
  );
  outputs.set(path.join(ROOT, 'public', 'data', 'income-spread.json'), serializeIncomeSpread(spread));
  for (const [file, text] of outputs) fs.writeFileSync(file, text);
  const values = Object.values(spread.sigma);
  console.log(
    `npm run story-files: copied ${COPIES.join(', ')}; income-spread.json with ${values.length} sigmas (${Math.min(...values)}–${Math.max(...values)}).`,
  );
} catch (e) {
  console.error(`npm run story-files: ${(e as Error).message}; nothing was written.`);
  process.exit(1);
}
