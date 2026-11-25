// Budget_Bar (housing-tools Requirement 3.1), approved design docs/design-proposal/housing-tools-proposal.html
// (2026-11-25). The money left of the Planning_Quarter's year, the year's total, and one segment per tool: solid for
// the charges of quarters already computed, hatched for charges committed to later quarters of the year. Every
// segment is named with its amount in the legend, so colour is never the only signal. A draft cost (the Policy_Dialog
// preview) is drawn as one dashed segment after the tools.
import type { BudgetBarView } from '../../types/view.ts';
import { formatNumber } from '../format/number.ts';
import { toolName } from '../panels/policy-text.ts';
import { fillTemplate, UI_STRINGS } from '../strings.ts';
import '../../styles/budget-bar.css';

const B = UI_STRINGS.budgetBar;

/** An amount in TWD, exact (the heading and the cost lines). */
export function exactTwd(x: number): string {
  return formatNumber(Math.round(x), 0);
}

/** An amount in TWD rounded to 億 (Traditional Chinese) or millions (English). */
export function compactTwd(x: number, short = false): string {
  const n = x / Number(B.compactDivisor);
  const decimals = Number(short ? B.shortDecimals : B.compactDecimals);
  return x === 0 ? '0' : fillTemplate(B.compact, { n: formatNumber(n, decimals) });
}

/** The text next to ☰ on a narrow screen. */
export function shortBudgetText(view: BudgetBarView | null): string {
  return view === null ? '' : fillTemplate(B.short, { amount: compactTwd(Math.max(0, view.remaining), true) });
}

export interface BudgetBar {
  readonly root: HTMLElement;
  /** `draftCost` is the cost this year of an edit not yet applied; `afterApply` switches the heading to that view. */
  update(view: BudgetBarView | null, draftCost?: number | null): void;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = className;
  parent?.append(e);
  return e;
}

export function createBudgetBar(doc: Document): BudgetBar {
  const root = el(doc, 'div', 'ui-budget');
  const head = el(doc, 'p', 'ui-budget__head', root);
  const left = el(doc, 'span', 'ui-budget__left', head);
  const total = el(doc, 'span', 'ui-budget__total', head);
  const bar = el(doc, 'div', 'ui-budget__bar', root);
  // The legend below carries the same information in words; the bar itself is decoration for screen readers.
  bar.setAttribute('aria-hidden', 'true');
  const legend = el(doc, 'ul', 'ui-budget__legend', root);

  function update(view: BudgetBarView | null, draftCost: number | null = null): void {
    root.hidden = view === null;
    if (view === null) return;
    const draft = draftCost !== null && draftCost > 0 ? draftCost : null;
    const year = String(view.year);
    if (draft === null) {
      left.textContent = fillTemplate(B.left, { year, left: exactTwd(Math.max(0, view.remaining)) });
      total.textContent = fillTemplate(B.total, { total: exactTwd(view.annualBudget) });
    } else {
      // Over the budget, the cost line of the field says how much is missing; the heading stops at 0.
      left.textContent = fillTemplate(B.afterApply, { year, left: exactTwd(Math.max(0, view.remaining - draft)) });
      total.textContent = fillTemplate(B.now, { left: exactTwd(Math.max(0, view.remaining)) });
    }

    const scale = view.annualBudget > 0 ? 100 / view.annualBudget : 0;
    const pct = (x: number): string => `${Math.max(0, Math.min(100, x * scale))}%`;
    bar.replaceChildren();
    legend.replaceChildren();
    for (const t of view.tools) {
      const spent = el(doc, 'span', `ui-budget__seg ui-budget__seg--${t.tool}`, bar);
      spent.style.width = pct(t.spent);
      if (t.later > 0) {
        const later = el(doc, 'span', `ui-budget__seg ui-budget__seg--${t.tool} ui-budget__seg--later`, bar);
        later.style.width = pct(t.later);
      }
      const li = el(doc, 'li', 'ui-budget__item', legend);
      el(doc, 'span', `ui-budget__swatch ui-budget__seg--${t.tool}`, li).setAttribute('aria-hidden', 'true');
      const text = el(doc, 'span', 'ui-budget__item-text', li);
      text.append(`${toolName(t.tool)} `);
      el(doc, 'b', '', text).textContent = compactTwd(t.spent + t.later);
      if (t.later > 0) text.append(` ${fillTemplate(B.later, { amount: compactTwd(t.later) })}`);
    }
    if (draft !== null) el(doc, 'span', 'ui-budget__seg ui-budget__seg--draft', bar).style.width = pct(draft);
    const rest = el(doc, 'li', 'ui-budget__item', legend);
    el(doc, 'span', 'ui-budget__swatch ui-budget__swatch--left', rest).setAttribute('aria-hidden', 'true');
    const restText = el(doc, 'span', 'ui-budget__item-text', rest);
    restText.append(`${B.unused} `);
    el(doc, 'b', '', restText).textContent = compactTwd(Math.max(0, view.remaining));
  }

  return { root, update };
}
