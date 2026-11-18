// Pure text builders of the Policy_Panel. No DOM. Every string comes from strings.ts, every number from the view model.
import type {
  BudgetProblemView,
  CarriedProblemView,
  ConstructionRowView,
  EditCheckView,
  FieldView,
  LimitProblem,
  ParameterRefView,
} from '../../types/view.ts';
import { formatNumber } from '../format/number.ts';
import { buildEngineErrorText, fillTemplate, UI_STRINGS } from '../strings.ts';

const P = UI_STRINGS.policy;

/** Whole numbers without decimals, others with 2. The view model carries no per-field decimals. */
export function formatAmount(x: number): string {
  return formatNumber(x, Number.isInteger(x) ? 0 : 2);
}

export function toolName(id: string): string {
  return (P.tools as Readonly<Record<string, string>>)[id] ?? id;
}

export function fieldLabel(tool: string, field: string): string {
  return (P.fields as Readonly<Record<string, string>>)[`${tool}.${field}`] ?? `${tool}.${field}`;
}

export function yearOf(quarter: string | null): string {
  return quarter === null ? '' : quarter.slice(0, 4);
}

/** Display text of a parameter status; `check` has no defined text in the spec and shows its id. */
function statusText(status: ParameterRefView['status']): string {
  return status === 'check' ? status : P.parameterStatus[status];
}

/** "Source" line of a Parameter: citation or "No source recorded", then status and estimate method. */
export function parameterSourceText(ref: ParameterRefView | null): string {
  if (ref === null) return P.noSource;
  const parts = [ref.citation ?? P.noSource, statusText(ref.status)];
  if (ref.estimatedMethod !== null) parts.push(ref.estimatedMethod);
  return parts.join(' · ');
}

export function limitProblemText(problem: LimitProblem): string {
  const values = { limit: formatAmount(problem.limit), unit: problem.unit };
  const head = fillTemplate(problem.side === 'lower' ? P.breaksLower : P.breaksUpper, values);
  const reason = problem.ref?.assumption ?? problem.ref?.citation ?? P.noSource;
  return `${head} ${fillTemplate(P.limitReason, { reason })}`;
}

export function budgetProblemText(problem: BudgetProblemView): string {
  const template = problem.reason === 'annual-budget' ? P.budgetAnnualExceeded : P.budgetCeilingExceeded;
  return fillTemplate(template, {
    year: String(problem.year),
    budget: formatAmount(problem.budget),
    over: formatAmount(problem.over),
  });
}

/** Message of a rejected or pending draft; null when the draft needs no message. */
export function checkMessage(check: EditCheckView, fieldName: string): string | null {
  switch (check.status) {
    case 'fixed-quarter':
      return fillTemplate(P.fixedQuarter, { quarter: check.planning ?? '' });
    case 'invalid-format':
      return fillTemplate(check.expected === 'integer' ? P.invalidInteger : P.invalidNumber, { field: fieldName });
    case 'timeline-full':
      return UI_STRINGS.errors.timelineCap;
    case 'limit':
      return limitProblemText(check.limit);
    case 'budget':
      return budgetProblemText(check.problem);
    case 'pending-range':
      return P.checking;
    case 'engine':
      return `${buildEngineErrorText(check.error.code, check.error.details)} ${P.rangeEngineError}`;
    case 'unchanged':
    case 'ok':
      return null;
  }
}

export function carriedProblemText(c: CarriedProblemView, fieldName: string, area: string): string {
  const rule = c.problem.kind === 'limit' ? limitProblemText(c.problem.limit) : budgetProblemText(c.problem.budget);
  return fillTemplate(P.carriedValueStop, {
    field: fieldName,
    area,
    value: formatAmount(c.value),
    rule,
    quarter: c.quarter,
  });
}

export function constructionLabels(row: ConstructionRowView): { progress: string; units: string; fraction: number } {
  const C = UI_STRINGS.construction;
  const u = formatAmount(Math.abs(row.difference));
  return {
    progress: fillTemplate(C.progress, { n: String(row.progress), lag: String(row.lag) }),
    units: fillTemplate(row.difference > 0 ? C.more : C.fewer, { u }),
    fraction: row.lag > 0 ? Math.min(1, Math.max(0, row.progress / row.lag)) : 0,
  };
}

/** Field key of an editable input is the view key; real value text with the estimate flag. */
export function realValueText(field: FieldView, quarter: string | null): string {
  const label = fillTemplate(P.realValueLabel, { quarter: quarter ?? '' });
  if (field.real === null) return `${label}: ${P.noRealValue}`;
  const flag = field.real.estimated ? ` (${UI_STRINGS.range.estimated})` : '';
  return `${label}: ${formatAmount(field.real.value)} ${field.unit}${flag}`;
}
