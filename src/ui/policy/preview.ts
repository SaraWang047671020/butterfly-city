// Pure helpers of the Policy_Cards and the Policy_Dialog (play-loop Requirement 5). No DOM. Every figure comes from
// the view model: the Quick_Preview cost is the difference of two `checkBudget` results the Game_Controller already
// computed (the committed spending with the edit, minus the committed spending without it).
import type { QuarterKey } from '../../types/data-files.ts';
import type { BudgetFiguresView, ConstructionRowView, FieldView, ToolView } from '../../types/view.ts';

/** The quarter `n` quarters after `quarter` ("2016Q3" + 8 = "2018Q3"). */
export function addQuarters(quarter: QuarterKey, n: number): QuarterKey {
  const m = /^(\d{4})Q([1-4])$/.exec(quarter);
  if (m === null) return quarter;
  const index = Number(m[1]) * 4 + (Number(m[2]) - 1) + Math.round(n);
  return `${Math.floor(index / 4)}Q${(index % 4) + 1}` as QuarterKey;
}

export interface QuickPreview {
  /** Edited value minus the player's current value, in the field's unit. */
  readonly change: number;
  /** Quarter the change takes effect: Planning_Quarter + Lag. */
  readonly ready: QuarterKey;
  /** Change of the committed spending of the year, in TWD; null when the budget figures are not comparable. */
  readonly cost: number | null;
  readonly left: number | null;
  readonly year: number | null;
}

/**
 * The Quick_Preview of a field's draft, or null when there is no draft that passed the format, limit and budget
 * checks (a rejected draft shows its message instead).
 */
export function quickPreview(field: FieldView, before: BudgetFiguresView | null, planning: QuarterKey | null): QuickPreview | null {
  const draft = field.draft;
  if (draft === null || planning === null) return null;
  const check = draft.check;
  if (check.status !== 'ok' && check.status !== 'pending-range') return null;
  const value = Number(draft.text);
  if (!Number.isFinite(value)) return null;
  const current = field.player ?? field.real?.value ?? null;
  if (current === null) return null;
  const after = check.budget;
  const comparable = before !== null && before.year === after.year;
  return {
    change: value - current,
    ready: addQuarters(planning, field.lag.value),
    cost: comparable ? after.committed - before.committed : null,
    left: after.remaining,
    year: after.year,
  };
}

export type CardStatus =
  | { readonly kind: 'real' }
  | { readonly kind: 'changed'; readonly n: number }
  | { readonly kind: 'sites'; readonly n: number }
  | { readonly kind: 'no-pass' };

/** What a Policy_Card says about its tool compared with real history. */
export function cardStatus(tool: Extract<ToolView, { kind: 'active' }>, construction: readonly ConstructionRowView[]): CardStatus {
  if (tool.fields.length > 0 && tool.fields.every((f) => f.editable === 'no-pass-product')) return { kind: 'no-pass' };
  const changed = tool.fields.filter((f) => f.player !== null && f.real !== null && f.player !== f.real.value);
  if (tool.id === 'socialHousing') {
    // Districts whose construction already differs, plus the shown district when its applied value differs.
    const districts = new Set([...construction.map((r) => r.district as string), ...changed.map((f) => f.area as string)]);
    return districts.size > 0 ? { kind: 'sites', n: districts.size } : { kind: 'real' };
  }
  const n = changed.length;
  return n > 0 ? { kind: 'changed', n } : { kind: 'real' };
}

/** The slider's value: the draft when it is a number, else the player's value, else the real value, inside the limits. */
export function sliderValue(field: FieldView): number {
  const draft = field.draft === null ? Number.NaN : Number(field.draft.text);
  const v = Number.isFinite(draft) ? draft : (field.player ?? field.real?.value ?? field.limits.lower);
  return Math.min(field.limits.upper, Math.max(field.limits.lower, v));
}
