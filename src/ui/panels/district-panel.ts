// District_Panel (Requirement 6, task 16.4). Independent block: mount `root` into a host (src/ui/component.ts).
// No page layout, no position and no visual values here; class names are styled in src/styles.
// A missing value is shown as "no value", never as 0. Strings come from strings.ts, numbers from format/.
import type { ComparisonLabel, DistrictPanelView, PanelRowId, PanelRowView, UiActions } from '../../types/view.ts';
import { reconcileKeyed, setAttr, setText, type Component } from '../component.ts';
import { formatDifference } from '../format/difference.ts';
import { formatNumber } from '../format/number.ts';
import { formatRange } from '../format/range.ts';
import { fillTemplate, UI_STRINGS, quarterLabel, unitLabel, cityLabel } from '../strings.ts';
import '../../styles/panels.css';

const D = UI_STRINGS.districtPanel;
const R = UI_STRINGS.range;

interface RowParts {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  readonly value: HTMLElement;
  readonly estimate: HTMLElement;
  readonly comparison: HTMLElement;
  readonly difference: HTMLElement;
  readonly methods: HTMLElement;
  readonly source: HTMLElement;
  readonly note: HTMLElement;
  readonly why: HTMLButtonElement;
  readonly about: HTMLButtonElement;
  readonly aboutText: HTMLElement;
}

let idCounter = 0;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  parent?: Element,
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = className;
  parent?.appendChild(e);
  return e;
}

function setHidden(e: HTMLElement, hidden: boolean): void {
  if (e.hidden !== hidden) e.hidden = hidden;
}

function comparisonLabel(label: ComparisonLabel): string {
  return label === 'real' ? R.real : R.derivedBaseline;
}

function valueWithUnit(value: number | null, decimals: number, unit: string): string {
  if (value === null || !Number.isFinite(value)) return R.noValue;
  return `${formatNumber(value, decimals)} ${unit}`.trimEnd();
}

export function createDistrictPanel(doc: Document, actions: UiActions): Component<DistrictPanelView> {
  const root = el(doc, 'section', 'ui-district-panel');
  const prompt = el(doc, 'p', 'ui-district-prompt', root);
  prompt.textContent = D.prompt;
  const body = el(doc, 'div', 'ui-district-body', root);
  const title = el(doc, 'h2', 'ui-district-title', body);
  const city = el(doc, 'p', 'ui-district-city', body);
  const mode = el(doc, 'p', 'ui-district-mode', body);
  const rowsHost = el(doc, 'ul', 'ui-district-rows', body);
  const ghostSize = el(doc, 'p', 'ui-district-ghost-size', body);

  const rowCache = new Map<string, RowParts>();
  const rowEls = new Map<string, HTMLElement>();
  let currentView: DistrictPanelView | null = null;

  const createRow = (id: string): HTMLElement => {
    const n = (idCounter += 1);
    const li = el(doc, 'li', 'ui-district-row');
    li.dataset['row'] = id;
    const label = el(doc, 'span', 'ui-row-label', li);
    const value = el(doc, 'span', 'ui-row-value', li);
    const estimate = el(doc, 'span', 'ui-estimate-marker', li);
    estimate.textContent = R.estimated;
    const comparison = el(doc, 'span', 'ui-row-comparison', li);
    const difference = el(doc, 'span', 'ui-row-difference', li);
    difference.setAttribute('aria-label', D.differenceLabel);
    const methods = el(doc, 'span', 'ui-row-methods', li);
    const source = el(doc, 'span', 'ui-row-source', li);
    const note = el(doc, 'span', 'ui-row-note', li);
    const why = el(doc, 'button', 'ui-button ui-why', li);
    why.type = 'button';
    why.textContent = R.why;
    const about = el(doc, 'button', 'ui-button ui-about-range', li);
    about.type = 'button';
    about.textContent = R.aboutControl;
    about.setAttribute('aria-expanded', 'false');
    const aboutText = el(doc, 'p', 'ui-about-text', li);
    aboutText.id = `ui-about-range-${n}`;
    aboutText.hidden = true;
    aboutText.textContent = R.aboutText;
    about.setAttribute('aria-controls', aboutText.id);

    const collapse = (): void => {
      aboutText.hidden = true;
      about.setAttribute('aria-expanded', 'false');
    };
    about.addEventListener('click', () => {
      const open = about.getAttribute('aria-expanded') !== 'true';
      aboutText.hidden = !open;
      about.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Escape hides the text and returns focus to its control (Requirement 5.6).
    li.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && about.getAttribute('aria-expanded') === 'true') {
        collapse();
        about.focus();
        e.stopPropagation();
      }
    });
    why.addEventListener('click', () => {
      const row = currentView?.rows.find((r) => r.id === id);
      if (row?.simulated) actions.openRangeSource(row.simulated.ref);
    });
    rowCache.set(id, { root: li, label, value, estimate, comparison, difference, methods, source, note, why, about, aboutText });
    return li;
  };

  const updateRow = (row: PanelRowView, parts: RowParts): void => {
    const name = D.rows[row.id as PanelRowId];
    setText(parts.label, name);
    const sim = row.simulated;
    if (sim !== null) {
      const text = formatRange(sim.range, sim.decimals, unitLabel(sim.unit));
      setText(parts.value, text.text);
      setText(parts.comparison, `${comparisonLabel(sim.comparison.label)}: ${valueWithUnit(sim.comparison.value, sim.decimals, unitLabel(sim.unit))}`);
      const diffUnit = row.percentRow ? D.units.percentagePoints : unitLabel(sim.unit);
      // No difference is shown when a value is missing (Requirement 6.6).
      const noDiff = text.kind === 'none' || sim.comparison.value === null;
      setText(parts.difference, noDiff ? '' : formatDifference(sim.range.central, sim.comparison.value, sim.decimals, diffUnit));
      setHidden(parts.difference, noDiff);
      setHidden(parts.estimate, sim.estimated === null);
      const methodTitles = sim.estimated?.methods.map((m) => fillTemplate(R.estimateMethod, { method: m.title })) ?? [];
      setText(parts.methods, methodTitles.join('; '));
      setHidden(parts.methods, methodTitles.length === 0);
      setHidden(parts.why, false);
      setHidden(parts.about, false);
    } else {
      const real = row.realOnly;
      setText(parts.value, valueWithUnit(real?.value ?? null, row.decimals, unitLabel(row.unit)));
      setText(parts.comparison, real === null ? '' : comparisonLabel(real.label));
      setHidden(parts.comparison, real === null);
      setText(parts.difference, '');
      setHidden(parts.difference, true);
      setHidden(parts.estimate, true);
      setText(parts.methods, '');
      setHidden(parts.methods, true);
      setHidden(parts.why, true);
      setHidden(parts.about, true);
      setHidden(parts.aboutText, true);
      setAttr(parts.about, 'aria-expanded', 'false');
    }
    setHidden(parts.comparison, sim === null && row.realOnly === null);
    setText(parts.source, row.sourceNames.length > 0 ? row.sourceNames.join('; ') : R.sourceNotListed);
    const notes: string[] = [];
    if (row.modelEstimate) notes.push(R.modelEstimate);
    if (row.id === 'priceToIncome') notes.push(D.priceNotChanged);
    setText(parts.note, notes.join('. '));
    setHidden(parts.note, notes.length === 0);
    setAttr(parts.why, 'aria-label', `${R.why} ${name}`);
    setAttr(parts.about, 'aria-label', `${R.aboutControl}: ${name}`);
  };

  return {
    root,
    update(view: DistrictPanelView): void {
      currentView = view;
      const isPrompt = view.mode === 'prompt' || view.district === null;
      setHidden(prompt, !isPrompt);
      setHidden(body, isPrompt);
      if (isPrompt || view.district === null) return;
      setText(title, view.district.name);
      setText(city, cityLabel(view.district.city));
      setText(mode, view.mode === 'real-2015Q1' ? UI_STRINGS.turnBar.realData2015Q1 : view.quarter === null ? '' : quarterLabel(view.quarter));
      reconcileKeyed(rowsHost, rowEls, view.rows.map((r) => r.id), createRow);
      for (const row of view.rows) {
        const parts = rowCache.get(row.id);
        if (parts !== undefined) updateRow(row, parts);
      }
      setText(ghostSize, fillTemplate(D.ghostSize, { size: formatNumber(view.ghostSize, 0) }));
    },
  };
}
