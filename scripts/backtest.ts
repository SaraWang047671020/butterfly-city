/**
 * `npm run backtest`: recomputes every Backtest_Case and rewrites docs/BACKTEST.md (Requirements 20.7, 20.9).
 *
 * Exit code: 0 when every case was computed (a "not met" check is still computed); 1 after the report has been
 * written when any case is "not computed".
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_DATA, ROOT } from './lib/paths.ts';
import { adaptInputs, PARAMS_FILE } from './backtest/adapt.ts';
import { readCases } from './backtest/cases.ts';
import { computeCase, type CaseResult } from './backtest/compute.ts';
import { renderReport, sha256Hex } from './backtest/report.ts';

const REPORT_FILE = path.join(ROOT, 'docs', 'BACKTEST.md');

function readParamsHash(): string | null {
  try {
    return sha256Hex(readFileSync(path.join(PUBLIC_DATA, PARAMS_FILE)));
  } catch {
    return null;
  }
}

function main(): number {
  const entries = readCases();
  const adapted = entries.some((e) => e.status === 'ok') ? adaptInputs() : null;

  const results: CaseResult[] = entries.map((entry): CaseResult => {
    if (entry.status === 'not-computed') return { status: 'not-computed', id: entry.id, reason: entry.reason };
    if (adapted === null || !adapted.ok) {
      return { status: 'not-computed', id: entry.case.id, reason: adapted === null ? 'no inputs' : adapted.reason };
    }
    return computeCase(entry.case, adapted.inputs);
  });

  mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  writeFileSync(REPORT_FILE, renderReport({ results, parameterTableSha256: readParamsHash() }), 'utf8');

  let failed = 0;
  for (const r of results) {
    if (r.status === 'not-computed') {
      failed += 1;
      console.log(`case ${r.id}: not computed: ${r.reason}`);
    } else {
      const c = r.checks;
      console.log(
        `case ${r.case.id}: computed (direction ${c.direction ? 'met' : 'not met'}, ratio ${c.ratioWithinTolerance ? 'met' : 'not met'}, range ${c.range ? 'met' : 'not met'})`,
      );
    }
  }
  console.log(`wrote ${path.relative(ROOT, REPORT_FILE)}`);
  return failed === 0 ? 0 : 1;
}

process.exitCode = main();
