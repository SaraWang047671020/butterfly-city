/**
 * npm run events: builds public/data/events.json and data/EVENT-SOURCES.md from data/config/events.json.
 * Prints every error with card id and field and exits 1 on failure, leaving both files unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/paths.ts';
import { reportLines, runEventBuild } from './events/build.ts';

const read = (repoPath: string): string | undefined => {
  const file = path.join(ROOT, repoPath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
};

const result = runEventBuild(read);
if (!result.ok) {
  console.error(`npm run events: ${result.errors.length} error(s); nothing was written.`);
  for (const e of result.errors) console.error(`  ${e}`);
  process.exit(1);
}
for (const line of reportLines(result.cards)) console.log(line);
