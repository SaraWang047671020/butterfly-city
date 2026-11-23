/**
 * `npm run backtest`: recomputes every Backtest_Case and rewrites docs/BACKTEST.md (Requirements 20.7, 20.9).
 *
 * Exit code: 0 when every case was computed (a "not met" check is still computed); 1 after the report has been
 * written when any case is "not computed".
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { backtestSentence, updateModelFacts } from './lib/model-facts.ts';
import path from 'node:path';
import { PUBLIC_DATA, ROOT } from './lib/paths.ts';
import { adaptInputs, PARAMS_FILE } from './backtest/adapt.ts';
import { readCases } from './backtest/cases.ts';
import { computeCase, type CaseResult, type MrtDerivedInput } from './backtest/compute.ts';
import { renderReport, sha256Hex } from './backtest/report.ts';
import { BACKTEST_MONTHS, listMissingMonthFiles, loadStationDistrict, readMonthlyEntries } from './backtest/mrt-monthly.ts';
import { buildDerived, DERIVED_FILE, mrtInputFromDerived, readDerivedFile, resolveDerived, writeDerivedFile } from './backtest/derived.ts';
import { PipelineError } from './pipeline/errors.ts';
import { FsRawReader } from './pipeline/raw-reader.ts';

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

  // Requirements 27.20, 27.26, 27.27: the TPASS case reads the Backtest_Derived_File. With the 24 raw files
  // present the file is created or checked against them; without them the committed file is used. Every stop
  // happens before docs/BACKTEST.md is touched.
  const needsMonthly = entries.some((e) => e.status === 'ok' && e.case.observed.source === 'mrt-od-monthly');
  let mrt: MrtDerivedInput | undefined;
  if (needsMonthly && adapted !== null && adapted.ok) {
    const baseline = adapted.inputs.baseline;
    const cases = entries.flatMap((e) => (e.status === 'ok' && e.case.observed.source === 'mrt-od-monthly' ? [e.case] : []));
    try {
      const reader = new FsRawReader();
      const missing = listMissingMonthFiles(reader);
      const decision = resolveDerived(
        missing.length === 0,
        readDerivedFile(),
        () => buildDerived(readMonthlyEntries(BACKTEST_MONTHS, reader), loadStationDistrict(reader), cases, baseline),
      );
      if (decision.kind === 'missing') {
        console.error(
          `backtest stopped: ${path.relative(ROOT, DERIVED_FILE)} does not exist and ${missing.length} of ${BACKTEST_MONTHS.length} monthly Taipei Metro station files are missing. docs/BACKTEST.md was not changed.`,
        );
        for (const m of missing) console.error(`  missing ${m.path}\n    run: ${m.command}`);
        return 1;
      }
      if (decision.kind === 'differs') {
        console.error(
          `backtest stopped: ${path.relative(ROOT, DERIVED_FILE)} differs from the value recomputed from data/raw (${decision.differences.length} differences). Nothing was overwritten. To regenerate on purpose, delete the file and run \`npm run backtest\` again.`,
        );
        for (const d of decision.differences) console.error(`  ${d.path}: committed ${d.committed}, recomputed ${d.recomputed}`);
        return 1;
      }
      if (decision.kind === 'create') {
        writeDerivedFile(decision.derived);
        console.log(`created ${path.relative(ROOT, DERIVED_FILE)} from data/raw`);
      } else if (decision.kind === 'verified') {
        console.log(`${path.relative(ROOT, DERIVED_FILE)} matches the value recomputed from data/raw`);
      } else {
        console.log(`using ${path.relative(ROOT, DERIVED_FILE)} (monthly raw files not present)`);
      }
      mrt = mrtInputFromDerived(decision.derived);
    } catch (e) {
      if (!(e instanceof PipelineError)) throw e;
      console.error(`backtest stopped: ${e.message}. docs/BACKTEST.md was not changed.`);
      for (const d of e.details) console.error(`  ${d}`);
      return 1;
    }
  }

  const results: CaseResult[] = entries.map((entry): CaseResult => {
    if (entry.status === 'not-computed') return { status: 'not-computed', id: entry.id, reason: entry.reason };
    if (adapted === null || !adapted.ok) {
      return { status: 'not-computed', id: entry.case.id, reason: adapted === null ? 'no inputs' : adapted.reason };
    }
    return computeCase(entry.case, adapted.inputs, mrt);
  });

  // Model_Facts (story-layer Requirement 2): the filled backtest sentences of the tpass-2023 case.
  const tpass = results.find((r) => r.status === 'computed' && r.case.id === 'tpass-2023');
  if (tpass !== undefined && tpass.status === 'computed') {
    if (tpass.checks.ratio === null) {
      console.error('backtest stopped: the tpass-2023 ratio has no value; public/data/model-facts.json was not changed.');
      return 1;
    }
    const limits = JSON.parse(readFileSync(path.join(ROOT, 'data', 'config', 'model-limits.json'), 'utf8')) as {
      templates: { backtestResult: Parameters<typeof backtestSentence>[0] };
    };
    updateModelFacts({
      backtestResult: backtestSentence(limits.templates.backtestResult, {
        direction: tpass.checks.direction,
        ratioMet: tpass.checks.ratioWithinTolerance,
        range: tpass.checks.range,
        ratio: tpass.checks.ratio,
        toleranceLow: tpass.case.tolerances.ratioLow,
        toleranceHigh: tpass.case.tolerances.ratioHigh,
      }),
    });
    console.log('wrote public/data/model-facts.json (backtestResult)');
  }

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
