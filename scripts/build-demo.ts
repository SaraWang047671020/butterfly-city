// Demo_Script entry: `npm run demo` (game-ui task 10.6, Requirements 14.5, 14.6, 14.19, 14.23, 14.25).
// Writes src/save/demo-save.generated.ts only on success; on failure prints the failure and exits with code 1.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readDemoInputs } from './demo/inputs.ts';
import { renderReport } from './demo/output.ts';
import { runDemo } from './demo/run-demo.ts';

const OUTPUT = join('src', 'save', 'demo-save.generated.ts');

async function main(): Promise<number> {
  const root = resolve(process.cwd());
  const read = await readDemoInputs(root);
  if (!read.ok) {
    console.error(read.message);
    for (const d of read.details) console.error(`  ${d}`);
    return 1;
  }
  const result = runDemo(read.inputs);
  const lines = renderReport(result);
  if (!result.ok) {
    for (const l of lines) console.error(l);
    return 1;
  }
  for (const l of lines) console.log(l);
  const file = join(root, OUTPUT);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, result.fileText, 'utf8');
  console.log(`Wrote ${OUTPUT}`);
  return 0;
}

process.exitCode = await main();
