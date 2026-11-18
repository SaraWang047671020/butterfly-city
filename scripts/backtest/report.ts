/**
 * Renders docs/BACKTEST.md (Requirements 20.5, 20.6, 20.7, 20.9, 20.10).
 *
 * The output is deterministic: no timestamps, fixed decimals, LF line endings, and the same bytes for the
 * same inputs. This module is pure; reading files and writing the report belong to scripts/backtest.ts.
 * Wording is neutral: every error is a number, every check is "met" or "not met".
 */
import { createHash } from 'node:crypto';
import { ENGINE_VERSION } from '../../src/simulation/constants.ts';
import type { BacktestCase } from './cases.ts';
import type { CaseResult, ComputedCase, NotComputedCase } from './compute.ts';

export interface ReportInput {
  readonly results: readonly CaseResult[];
  /** SHA-256 (hex) of params.json, or null when params.json could not be read. */
  readonly parameterTableSha256: string | null;
  /** Defaults to the engine's ENGINE_VERSION. */
  readonly engineVersion?: string;
}

/** SHA-256 of the exact bytes of params.json, as lowercase hex. */
export function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Fixed-decimal number; never prints "-0.00". */
function num(value: number, digits = 2): string {
  const text = value.toFixed(digits);
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

function signed(value: number, digits = 2): string {
  const text = num(value, digits);
  return value > 0 && !text.startsWith('-') ? `+${text}` : text;
}

function percent(fraction: number | null): string {
  return fraction === null ? 'not defined (observed effect is 0)' : `${signed(fraction * 100, 1)} percent`;
}

function met(flag: boolean): string {
  return flag ? 'met' : 'not met';
}

/** Escapes a value placed inside a Markdown table cell or line. */
function text(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function list(items: readonly string[]): string[] {
  return items.map((item) => `- ${text(item)}`);
}

function computedSection(r: ComputedCase): string[] {
  const c = r.case;
  const o = c.observed;
  const label = c.parametersChangedAfterOutcome.length === 0 ? 'validation' : 'calibration';
  const lines: string[] = [];
  lines.push(`## Case ${text(c.id)}: ${text(c.title)}`, '');
  lines.push(`Label: ${label}`);
  lines.push('');
  if (c.parametersChangedAfterOutcome.length === 0) {
    lines.push('No Parameter value or range was chosen or changed after seeing the outcome of this case.');
  } else {
    lines.push('Parameter values or ranges chosen or changed after seeing the outcome of this case:');
    lines.push(...list(c.parametersChangedAfterOutcome));
  }
  lines.push('');

  lines.push('### Change and quarters', '');
  lines.push(`- Policy tool: ${text(c.tool)}`);
  lines.push(`- Changed field: ${text(c.change.field)} in ${text(c.change.cities.join(', '))}`);
  lines.push(`- First quarter of the change: ${c.change.firstQuarter}`);
  lines.push(`- Value before: ${num(c.change.before)}`);
  lines.push(`- Value after: ${num(c.change.after)}`);
  lines.push(`- Compared indicator: ${text(c.indicator)}`);
  lines.push(`- Compared areas: ${text(c.areas.join(', '))}`);
  lines.push(`- Evaluation quarters: ${text([...c.evaluationQuarters].sort().join(', '))}`);
  lines.push('');

  lines.push('### Simulated effect', '');
  lines.push('| Minimum | Central | Maximum |');
  lines.push('| ---: | ---: | ---: |');
  lines.push(`| ${num(r.simulated.min)} | ${num(r.simulated.central)} | ${num(r.simulated.max)} |`);
  lines.push('');

  lines.push('### Observed effect', '');
  lines.push(`- Observed effect: ${num(r.observed.effect)}`);
  lines.push(`- Source: ${text(o.source)}, indicator ${text(o.indicator)}`);
  lines.push(`- Cities: ${text(o.cities.join(', '))} (${r.observed.districtCount} districts)`);
  lines.push(`- Comparison year: ${o.comparisonYear}`);
  lines.push(`- Change year: ${o.changeYear}`);
  lines.push(`- Method: ${text(o.method)}`);
  lines.push('');
  lines.push('| Period | Quarters | Sum |');
  lines.push('| --- | --- | ---: |');
  lines.push(`| Post-change year ${o.changeYear} | ${o.postQuarters.join(', ')} | ${num(r.observed.postChangeYear)} |`);
  lines.push(
    `| Post-comparison year ${o.comparisonYear} | ${o.postQuarters.join(', ')} | ${num(r.observed.postComparisonYear)} |`,
  );
  lines.push(`| Pre-change year ${o.changeYear} | ${o.preQuarters.join(', ')} | ${num(r.observed.preChangeYear)} |`);
  lines.push(
    `| Pre-comparison year ${o.comparisonYear} | ${o.preQuarters.join(', ')} | ${num(r.observed.preComparisonYear)} |`,
  );
  lines.push('');
  lines.push('Known confounders:');
  lines.push(...list(o.confounders));
  lines.push('');

  lines.push('### Errors and checks', '');
  lines.push(`- Absolute error (simulated central minus observed): ${signed(r.absoluteError)}`);
  lines.push(`- Relative error: ${percent(r.relativeError)}`);
  lines.push(`- Magnitude ratio (simulated central divided by observed): ${r.checks.ratio === null ? 'not defined (observed effect is 0)' : num(r.checks.ratio, 3)}`);
  lines.push(`- Tolerance interval for the ratio: ${num(c.tolerances.ratioLow, 3)} to ${num(c.tolerances.ratioHigh, 3)}`);
  lines.push('');
  lines.push('| Check | Result |');
  lines.push('| --- | --- |');
  lines.push(`| Direction (central simulated effect has the same sign as the observed effect) | ${met(r.checks.direction)} |`);
  lines.push(`| Magnitude ratio inside the tolerance interval | ${met(r.checks.ratioWithinTolerance)} |`);
  lines.push(`| Range (observed effect lies between simulated minimum and maximum) | ${met(r.checks.range)} |`);
  lines.push('');

  if (o.secondaryContext.length > 0) {
    lines.push('### Secondary context, not used in any check', '');
    lines.push('These news-report figures are quoted for context only. They are not the observed effect above and no check uses them.');
    lines.push('');
    for (const f of o.secondaryContext) {
      const note = f.note === '' ? '' : ` ${text(f.note)}`;
      lines.push(`- ${text(f.label)}: ${signed(f.percent, 1)} percent. Source: [${text(f.source)}](${f.url}).${note}`);
    }
    lines.push('');
  }
  return lines;
}

function notComputedSection(r: NotComputedCase): string[] {
  return [`## Case ${text(r.id)}`, '', 'Result: not computed', '', `Reason: ${text(r.reason)}`, ''];
}

/**
 * The first TPASS result, kept as a fixed record. It was copied from the committed docs/BACKTEST.md before the
 * monthly data existed and is never recomputed (Requirements 27.22, 27.23).
 */
export const TPASS_CASE_ID = 'tpass-2023';

export const TPASS_FIRST_RESULT = {
  observedEffect: -797951,
  simulatedMin: 4590931.59,
  simulatedCentral: 6886397.38,
  simulatedMax: 11477328.97,
  ratio: -8.63,
  ratioLow: 0.5,
  ratioHigh: 2,
  directionMet: false,
  ratioMet: false,
  rangeMet: false,
} as const;

function tpassHeadSections(): string[] {
  const f = TPASS_FIRST_RESULT;
  const lines: string[] = [];
  lines.push(`## Case ${TPASS_CASE_ID}: 2023 TPASS commuter pass`, '');
  lines.push('### Invalid result (first run, kept unchanged)', '');
  lines.push(
    'The first run is kept as it was printed. It is marked invalid because its quarterly MRT entries were apportioned from annual data with fixed 2015-2016 seasonal shares, so a mid-year policy change cannot be detected.',
  );
  lines.push('');
  lines.push(`- Observed effect: ${num(f.observedEffect)}`);
  lines.push(`- Simulated effect: minimum ${num(f.simulatedMin)}, central ${num(f.simulatedCentral)}, maximum ${num(f.simulatedMax)}`);
  lines.push(`- Magnitude ratio (simulated central divided by observed): ${num(f.ratio, 3)}`);
  lines.push(`- Tolerance interval for the ratio: ${num(f.ratioLow, 3)} to ${num(f.ratioHigh, 3)}`);
  lines.push(`- Direction: ${met(f.directionMet)}`);
  lines.push(`- Magnitude ratio inside the tolerance interval: ${met(f.ratioMet)}`);
  lines.push(`- Range: ${met(f.rangeMet)}`);
  lines.push('');

  lines.push('### Comparison method (decided 2026-11-18, before the monthly result was computed)', '');
  lines.push('- Data: monthly Taipei Metro station entries. Entries only; exits are not used.');
  lines.push(
    '- District scope: observed and simulated sums cover only districts with a Taipei Metro station. The simulated sum over all 41 districts is shown as a reference.',
  );
  lines.push(
    '- Station scope: the main result uses stations with entries in all 24 months of 2019 and 2023. The result with all stations is also shown, together with the share of 2023 entries that belongs to the excluded stations.',
  );
  lines.push(
    '- The simulated side is by district and includes the Circular Line. The observed side counts Taipei Metro stations only.',
  );
  lines.push('- Tolerances are unchanged from the first run.');
  lines.push('');

  lines.push('### Confounders', '');
  lines.push(
    '- 2023H1 was still in post-COVID-19 recovery. Part of the H2 minus H1 difference may come from the recovery and not from the pass. This biases the result toward the pass appearing effective.',
  );
  lines.push('- The Ankeng LRT opened on 2023-02-10.');
  lines.push('');

  lines.push('### Scope', '');
  lines.push(
    'Taipei Metro only. The New Taipei Metro lines (Danhai LRT, Ankeng LRT, Sanying Line) are not included because no station-level data exists.',
  );
  lines.push('');
  lines.push('### Derived data file', '');
  lines.push(
    'The sums behind the new result are stored in `data/derived/backtest-mrt-quarterly.json`, which is committed. It holds the per-district per-quarter entry sums for the main result and for all stations, the observed effects, the 24 months with their source URLs and station counts, the stations of the main result, and the excluded stations with the reason for each. The staleness test reads this file and never `data/raw/`.',
  );
  lines.push('');
  lines.push(
    'Recomputing from raw data: with the 24 monthly files in `data/raw/mrt/od-station-month/` (see `data/DOWNLOAD.md`), `npm run backtest` recomputes the file content and compares it with the committed file. If any value differs, the command lists each difference, exits with a non-zero code and overwrites nothing. If the file does not exist, the command creates it from the raw files. To regenerate it on purpose, delete the file and run `npm run backtest` again. If neither the file nor the raw files exist, the command stops and prints the download commands.',
  );
  lines.push('');
  return lines;
}

function secondaryLines(c: BacktestCase['observed']): string[] {
  if (c.secondaryContext.length === 0) return [];
  const lines: string[] = ['#### Secondary context, not used in any check', ''];
  lines.push('These news-report figures are quoted for context only. They are not the observed effect above and no check uses them.', '');
  for (const f of c.secondaryContext) {
    const note = f.note === '' ? '' : ` ${text(f.note)}`;
    lines.push(`- ${text(f.label)}: ${signed(f.percent, 1)} percent. Source: [${text(f.source)}](${f.url}).${note}`);
  }
  lines.push('');
  return lines;
}

function tpassNewResult(r: CaseResult): string[] {
  const lines: string[] = ['### New result (monthly station entries)', ''];
  if (r.status === 'not-computed') {
    lines.push(`Result: not computed: ${text(r.reason)}`, '');
    return lines;
  }
  const c = r.case;
  const o = c.observed;
  const ob = r.observed;
  lines.push(`- Compared indicator: ${text(c.indicator)}; evaluation quarters: ${text([...c.evaluationQuarters].sort().join(', '))}`);
  lines.push(`- Districts with a Taipei Metro station: ${ob.districtCount}`);
  lines.push('');
  lines.push('#### Effects', '');
  lines.push('| Series | Minimum | Central | Maximum |');
  lines.push('| --- | ---: | ---: | ---: |');
  lines.push(`| Simulated, districts with a station (main) | ${num(r.simulated.min)} | ${num(r.simulated.central)} | ${num(r.simulated.max)} |`);
  lines.push(
    `| Simulated, all 41 districts (reference) | ${num(r.simulatedAllDistricts.min)} | ${num(r.simulatedAllDistricts.central)} | ${num(r.simulatedAllDistricts.max)} |`,
  );
  lines.push('');
  lines.push(`- Observed effect, main (${ob.includedStationCount} stations with entries in all 24 months): ${num(ob.effect)}`);
  lines.push(`- Observed effect, all stations (reference): ${num(ob.allStations.effect)}`);
  lines.push(`- Stations left out of the main result: ${ob.excludedStations.length}`);
  lines.push(
    `- Share of 2023 entries from the excluded stations: ${ob.excludedShare2023 === null ? 'not defined' : `${num(ob.excludedShare2023 * 100, 2)} percent`}`,
  );
  lines.push('');
  lines.push('| Period (main) | Quarters | Sum | All stations |');
  lines.push('| --- | --- | ---: | ---: |');
  lines.push(`| Post-change year ${o.changeYear} | ${o.postQuarters.join(', ')} | ${num(ob.postChangeYear)} | ${num(ob.allStations.postChangeYear)} |`);
  lines.push(`| Post-comparison year ${o.comparisonYear} | ${o.postQuarters.join(', ')} | ${num(ob.postComparisonYear)} | ${num(ob.allStations.postComparisonYear)} |`);
  lines.push(`| Pre-change year ${o.changeYear} | ${o.preQuarters.join(', ')} | ${num(ob.preChangeYear)} | ${num(ob.allStations.preChangeYear)} |`);
  lines.push(`| Pre-comparison year ${o.comparisonYear} | ${o.preQuarters.join(', ')} | ${num(ob.preComparisonYear)} | ${num(ob.allStations.preComparisonYear)} |`);
  lines.push('');
  lines.push('#### Errors and checks (main result)', '');
  lines.push(`- Absolute error (simulated central minus observed): ${signed(r.absoluteError)}`);
  lines.push(`- Relative error: ${percent(r.relativeError)}`);
  lines.push(`- Magnitude ratio (simulated central divided by observed): ${r.checks.ratio === null ? 'not defined (observed effect is 0)' : num(r.checks.ratio, 3)}`);
  lines.push(`- Tolerance interval for the ratio: ${num(c.tolerances.ratioLow, 3)} to ${num(c.tolerances.ratioHigh, 3)}`);
  lines.push('');
  lines.push('| Check | Result |');
  lines.push('| --- | --- |');
  lines.push(`| Direction (central simulated effect has the same sign as the observed effect) | ${met(r.checks.direction)} |`);
  lines.push(`| Magnitude ratio inside the tolerance interval | ${met(r.checks.ratioWithinTolerance)} |`);
  lines.push(`| Range (observed effect lies between simulated minimum and maximum) | ${met(r.checks.range)} |`);
  lines.push('');
  lines.push('This result validates MRT entries only, not migration. No parameter was changed in response to it.', '');
  lines.push(...secondaryLines(o));
  return lines;
}

function tpassSection(r: CaseResult): string[] {
  return [...tpassHeadSections(), ...tpassNewResult(r)];
}

/** Renders the whole report. Always ends with a single LF. */
export function renderReport(input: ReportInput): string {
  const version = input.engineVersion ?? ENGINE_VERSION;
  const lines: string[] = [];
  lines.push('# Backtest report', '');
  lines.push('Generated by `npm run backtest`. Do not edit by hand.', '');
  lines.push('Each case compares the simulated effect of a real policy change with an effect observed in open data.');
  lines.push('The simulation is not a prediction. Errors are reported as numbers, whether they are small or large.', '');
  lines.push('## Versions', '');
  lines.push(`- Engine version: ${text(version)}`);
  lines.push(
    `- Parameter_Table version (SHA-256 of params.json): ${input.parameterTableSha256 ?? 'not available (params.json missing)'}`,
  );
  lines.push('');
  for (const r of input.results) {
    const id = r.status === 'computed' ? r.case.id : r.id;
    if (id === TPASS_CASE_ID) lines.push(...tpassSection(r));
    else lines.push(...(r.status === 'computed' ? computedSection(r) : notComputedSection(r)));
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return `${lines.join('\n')}\n`;
}
