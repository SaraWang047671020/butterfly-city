// Pure text of the Range_Source_View (game-ui Requirement 20). No DOM, no Scenario name.
import type { ParameterAssumptionView, RangeSourceView } from '../../types/view.ts';
import { formatNumber } from '../format/number.ts';
import { formatRange } from '../format/range.ts';
import { fillTemplate, UI_STRINGS } from '../strings.ts';

export interface AssumptionText {
  readonly name: string;
  /** "<name>: <value> <unit>" */
  readonly line: string;
  /** Citation, or "No source recorded". */
  readonly citation: string;
  /** Link target, or null when no URL is recorded. */
  readonly url: string | null;
  /** Shown in place of a link when `url` is null. */
  readonly urlText: string;
}

export interface ResultSectionText {
  readonly heading: string;
  readonly resultText: string;
  readonly assumptions: readonly AssumptionText[];
}

export interface RangeSourceText {
  readonly title: string;
  /** Range_Display, or the single value when the value is the same everywhere. */
  readonly display: string;
  readonly sameText: string | null;
  readonly sections: readonly ResultSectionText[];
  readonly about: string;
  readonly causeBreakdown: { readonly label: string; readonly disabled: true };
}

/** A decimal count that shows `x` exactly, at most 6 places. */
function decimalsOf(x: number): number {
  const s = x.toFixed(6).replace(/0+$/, '');
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

function nameOf(id: string): string {
  const names = UI_STRINGS.rangeSource.parameterNames as Readonly<Record<string, string>>;
  return names[id] ?? id;
}

function assumptionText(a: ParameterAssumptionView): AssumptionText {
  const name = nameOf(a.parameterId);
  const citation = a.citation !== null && a.citation.trim() !== '' ? a.citation : UI_STRINGS.rangeSource.noSource;
  const hasUrl = a.url !== null && a.url.trim() !== '';
  return {
    name,
    line: fillTemplate(UI_STRINGS.rangeSource.parameterValue, {
      name,
      value: formatNumber(a.value, decimalsOf(a.value)),
      unit: a.unit,
    }).trimEnd(),
    citation,
    url: hasUrl ? (a.url as string) : null,
    urlText: UI_STRINGS.rangeSource.noUrl,
  };
}

function section(
  heading: string,
  side: { readonly value: number; readonly assumptions: readonly ParameterAssumptionView[] },
  decimals: number,
  unit: string,
): ResultSectionText {
  return {
    heading,
    resultText: `${formatNumber(side.value, decimals)} ${unit}`.trimEnd(),
    assumptions: side.assumptions.map(assumptionText),
  };
}

export function rangeSourceText(view: RangeSourceView): RangeSourceText {
  const { range, unit, decimals } = view.value;
  const formatted = formatRange(range, decimals, unit);
  const same = view.same || formatted.kind === 'same';
  const display =
    formatted.kind === 'same' ? `${formatted.value} ${unit}`.trimEnd() : formatted.text;
  const sections: ResultSectionText[] = [];
  if (!same) {
    if (view.lowest !== null) sections.push(section(UI_STRINGS.rangeSource.lowest, view.lowest, decimals, unit));
    if (view.highest !== null) sections.push(section(UI_STRINGS.rangeSource.highest, view.highest, decimals, unit));
  }
  return {
    title: UI_STRINGS.dialogs.rangeSourceTitle,
    display,
    sameText: same ? UI_STRINGS.rangeSource.sameEverywhere : null,
    sections,
    about: UI_STRINGS.range.aboutText,
    causeBreakdown: { label: UI_STRINGS.rangeSource.causeBreakdown, disabled: true },
  };
}
