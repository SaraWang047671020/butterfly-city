/**
 * Backtest staleness test (Requirement 20.8).
 *
 * Recomputes every Backtest_Case exactly as `npm run backtest` does and compares the rendered report with the
 * committed `docs/BACKTEST.md`, byte for byte. This test reads `public/data/`, `params.json`, the committed
 * `data/derived/backtest-mrt-quarterly.json` (never `data/raw/`) and `docs/BACKTEST.md`
 * and is excluded from Requirement 17.6. When an input is missing the recomputed report holds the
 * "not computed: missing input" text, so the test still runs and still detects a stale document.
 *
 * To fix a failure, run `npm run backtest` and commit `docs/BACKTEST.md`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_DATA, ROOT } from '../../scripts/lib/paths.ts';
import { adaptInputs, PARAMS_FILE } from '../../scripts/backtest/adapt.ts';
import { readCases } from '../../scripts/backtest/cases.ts';
import { computeCase, type CaseResult } from '../../scripts/backtest/compute.ts';
import { mrtInputFromDerived, readDerivedFile } from '../../scripts/backtest/derived.ts';
import { renderReport, sha256Hex } from '../../scripts/backtest/report.ts';

function readParamsHash(): string | null {
  try {
    return sha256Hex(readFileSync(path.join(PUBLIC_DATA, PARAMS_FILE)));
  } catch {
    return null;
  }
}

function recompute(): string {
  const entries = readCases();
  const adapted = entries.some((e) => e.status === 'ok') ? adaptInputs() : null;
  // Reads the committed derived file only, never data/raw (data-pipeline Requirement 27.25).
  const derived = readDerivedFile();
  const mrt = derived === null ? undefined : mrtInputFromDerived(derived);
  const results: CaseResult[] = entries.map((entry): CaseResult => {
    if (entry.status === 'not-computed') return { status: 'not-computed', id: entry.id, reason: entry.reason };
    if (adapted === null || !adapted.ok) {
      return { status: 'not-computed', id: entry.case.id, reason: adapted === null ? 'no inputs' : adapted.reason };
    }
    return computeCase(entry.case, adapted.inputs, mrt);
  });
  return renderReport({ results, parameterTableSha256: readParamsHash() });
}

describe('docs/BACKTEST.md staleness (Requirement 20.8)', () => {
  it('matches the report recomputed from the current inputs, byte for byte', () => {
    const committed = readFileSync(path.join(ROOT, 'docs', 'BACKTEST.md'), 'utf8');
    const recomputed = recompute();
    expect(
      recomputed === committed,
      'docs/BACKTEST.md is stale: run `npm run backtest` and commit the rewritten report',
    ).toBe(true);
  });
});
