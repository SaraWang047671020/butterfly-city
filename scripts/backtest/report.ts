/**
 * Renders docs/BACKTEST.md (Requirements 20.5, 20.6, 20.7, 20.9, 20.10).
 *
 * The output is deterministic: no timestamps, fixed decimals, LF line endings, and the same bytes for the
 * same inputs. This module is pure; reading files and writing the report belong to scripts/backtest.ts.
 * Wording is neutral: every error is a number, every check is "met" or "not met".
 */
import { createHash } from 'node:crypto';
import { ENGINE_VERSION } from '../../src/simulation/constants.ts';
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
    lines.push(...(r.status === 'computed' ? computedSection(r) : notComputedSection(r)));
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return `${lines.join('\n')}\n`;
}
