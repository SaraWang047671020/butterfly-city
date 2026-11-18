// Policy_Panel (Requirements 8 and 9, task 16.5). Independent block: mount `root` into a host (src/ui/component.ts).
// No page layout, no position and no visual values here; class names are styled in src/styles.
// Units, limits, citations and values come from the view model. Strings come from strings.ts.
import type { DistrictCode, QuarterKey } from '../../types/data-files.ts';
import type { FieldView, GameView, PolicyPanelView, ToolView, UiActions } from '../../types/view.ts';
import { reconcileKeyed, setAttr, setText, type Component } from '../component.ts';
import { formatNumber } from '../format/number.ts';
import { fillTemplate, UI_STRINGS } from '../strings.ts';
import { createConstructionRows } from './construction-rows.ts';
import '../../styles/panels.css';
import {
  carriedProblemText,
  checkMessage,
  fieldLabel,
  formatAmount,
  parameterSourceText,
  realValueText,
  toolName,
  yearOf,
} from './policy-text.ts';

const P = UI_STRINGS.policy;

/** What the Policy_Panel needs besides the view: the Planning_Quarter and the one-shot focus request (11.6). */
export interface PolicyPanelProps {
  readonly policy: PolicyPanelView;
  readonly planning: QuarterKey | null;
  readonly focusRequest: GameView['focusRequest'];
  /** Display names of districts by code, for the Area of a field. Optional; the code is shown when absent. */
  readonly areaNames?: ReadonlyMap<DistrictCode, string>;
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

interface FieldParts {
  readonly root: HTMLElement;
  readonly title: HTMLElement;
  readonly real: HTMLElement;
  readonly player: HTMLElement;
  readonly unitCost: HTMLElement;
  readonly lag: HTMLElement;
  readonly lower: HTMLElement;
  readonly upper: HTMLElement;
  readonly ceiling: HTMLElement;
  readonly cityYear: HTMLElement;
  readonly note: HTMLElement;
  readonly controls: HTMLElement;
  readonly label: HTMLLabelElement;
  readonly input: HTMLInputElement;
  readonly unit: HTMLElement;
  readonly apply: HTMLButtonElement;
  readonly setToReal: HTMLButtonElement;
  readonly message: HTMLElement;
}

interface ToolParts {
  readonly root: HTMLElement;
  readonly name: HTMLElement;
  readonly badge: HTMLElement;
  readonly body: HTMLElement;
  readonly effects: HTMLElement;
  readonly fields: HTMLElement;
  readonly fieldCache: Map<string, FieldParts>;
  readonly fieldEls: Map<string, HTMLElement>;
  readonly realList: HTMLElement;
}

export function createPolicyPanel(doc: Document, actions: UiActions): Component<PolicyPanelProps> {
  const root = el(doc, 'section', 'ui-policy-panel');
  const heading = el(doc, 'h2', 'ui-policy-heading', root);
  heading.textContent = P.heading;

  // Budget figures (Requirement 9.1)
  const budget = el(doc, 'div', 'ui-policy-budget', root);
  const budgetTitle = el(doc, 'p', 'ui-policy-budget-title', budget);
  const budgetCommitted = el(doc, 'p', 'ui-policy-budget-committed', budget);
  const budgetRemaining = el(doc, 'p', 'ui-policy-budget-remaining', budget);
  const budgetNote = el(doc, 'p', 'ui-policy-budget-note', budget);
  budgetNote.textContent = P.budgetNote;

  // Carried value problem (Requirement 9.8)
  const carried = el(doc, 'div', 'ui-policy-carried', root);
  carried.setAttribute('role', 'alert');
  const carriedText = el(doc, 'p', 'ui-policy-carried-text', carried);
  const carriedButton = el(doc, 'button', 'ui-button ui-set-to-real', carried);
  carriedButton.type = 'button';
  carriedButton.textContent = P.setToReal;
  let carriedKey: string | null = null;
  carriedButton.addEventListener('click', () => {
    if (carriedKey !== null) actions.setToReal(carriedKey);
  });

  const domainsHost = el(doc, 'div', 'ui-policy-domains', root);
  const domainCache = new Map<string, HTMLElement>();
  const toolCaches = new Map<string, Map<string, ToolParts>>();
  const toolEls = new Map<string, Map<string, HTMLElement>>();

  const construction = createConstructionRows(doc);
  root.appendChild(construction.root);

  const createEffects = (toolId: string, host: HTMLElement): void => {
    const effects = (P.effects as Readonly<Record<string, { benefits: readonly string[]; costs: readonly string[] }>>)[
      toolId
    ];
    if (effects === undefined) return;
    for (const [cls, items] of [
      ['ui-policy-benefits', effects.benefits],
      ['ui-policy-costs', effects.costs],
    ] as const) {
      const ul = el(doc, 'ul', cls, host);
      for (const text of items) el(doc, 'li', 'ui-policy-effect', ul).textContent = text;
    }
  };

  const createTool = (toolId: string): ToolParts => {
    const toolRoot = el(doc, 'section', 'ui-policy-tool');
    const name = el(doc, 'h4', 'ui-policy-tool-name', toolRoot);
    name.textContent = toolName(toolId);
    const badge = el(doc, 'p', 'ui-policy-badge', toolRoot);
    badge.textContent = P.comingSoon;
    const body = el(doc, 'div', 'ui-policy-tool-body', toolRoot);
    const realList = el(doc, 'ul', 'ui-policy-real-list', body);
    const effects = el(doc, 'div', 'ui-policy-effects', body);
    createEffects(toolId, effects);
    const fields = el(doc, 'div', 'ui-policy-fields', body);
    return {
      root: toolRoot,
      name,
      badge,
      body,
      effects,
      fields,
      realList,
      fieldCache: new Map(),
      fieldEls: new Map(),
    };
  };

  const createField = (view: FieldView): FieldParts => {
    const id = `ui-policy-input-${++idCounter}`;
    const fieldRoot = el(doc, 'div', 'ui-policy-field');
    fieldRoot.tabIndex = -1;
    const title = el(doc, 'h5', 'ui-policy-field-title', fieldRoot);
    const real = el(doc, 'p', 'ui-policy-real', fieldRoot);
    const player = el(doc, 'p', 'ui-policy-player', fieldRoot);
    const unitCost = el(doc, 'p', 'ui-policy-unit-cost', fieldRoot);
    const lag = el(doc, 'p', 'ui-policy-lag', fieldRoot);
    const lower = el(doc, 'p', 'ui-policy-limit-lower', fieldRoot);
    const upper = el(doc, 'p', 'ui-policy-limit-upper', fieldRoot);
    const ceiling = el(doc, 'p', 'ui-policy-ceiling', fieldRoot);
    const cityYear = el(doc, 'p', 'ui-policy-city-year', fieldRoot);
    const note = el(doc, 'p', 'ui-policy-note', fieldRoot);
    const controls = el(doc, 'div', 'ui-policy-controls', fieldRoot);
    const label = el(doc, 'label', 'ui-policy-input-label', controls);
    label.htmlFor = id;
    const input = el(doc, 'input', 'ui-policy-input', controls);
    input.id = id;
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const messageId = `${id}-message`;
    const unit = el(doc, 'span', 'ui-policy-unit', controls);
    const apply = el(doc, 'button', 'ui-button ui-apply', controls);
    apply.type = 'button';
    apply.textContent = P.apply;
    const setToReal = el(doc, 'button', 'ui-button ui-set-to-real', controls);
    setToReal.type = 'button';
    setToReal.textContent = P.setToReal;
    const message = el(doc, 'p', 'ui-policy-message', fieldRoot);
    message.id = messageId;
    message.setAttribute('role', 'status');
    input.setAttribute('aria-describedby', messageId);

    const key = view.key;
    input.addEventListener('input', () => actions.editField(key, input.value));
    apply.addEventListener('click', () => actions.applyField(key));
    setToReal.addEventListener('click', () => actions.setToReal(key));
    return {
      root: fieldRoot,
      title,
      real,
      player,
      unitCost,
      lag,
      lower,
      upper,
      ceiling,
      cityYear,
      note,
      controls,
      label,
      input,
      unit,
      apply,
      setToReal,
      message,
    };
  };

  const updateField = (parts: FieldParts, f: FieldView, props: PolicyPanelProps): void => {
    const areaName = props.areaNames?.get(f.area as DistrictCode) ?? f.area;
    const name = fieldLabel(f.tool, f.field);
    const year = yearOf(props.planning);
    setText(parts.title, `${name} (${areaName})`);
    setText(parts.real, realValueText(f, props.planning));
    setText(parts.player, `${P.yourValue}: ${f.player === null ? UI_STRINGS.range.noValue : `${formatAmount(f.player)} ${f.unit}`}`);
    setText(
      parts.unitCost,
      f.unitCost === null
        ? ''
        : `${P.unitCost}: ${formatAmount(f.unitCost.value)} · ${P.citation}: ${parameterSourceText(f.unitCost)}`,
    );
    parts.unitCost.hidden = f.unitCost === null;
    setText(parts.lag, `${P.lag}: ${formatAmount(f.lag.value)} · ${P.citation}: ${parameterSourceText(f.lag)}`);
    setText(
      parts.lower,
      `${P.lowerLimit}: ${formatAmount(f.limits.lower)} ${f.unit} · ${P.citation}: ${parameterSourceText(f.limits.lowerRef)}`,
    );
    setText(
      parts.upper,
      `${P.upperLimit}: ${formatAmount(f.limits.upper)} ${f.unit} · ${P.citation}: ${parameterSourceText(f.limits.upperRef)}`,
    );
    setText(parts.ceiling, `${fillTemplate(P.remainingCeiling, { year })}: ${formatAmount(f.remainingCeiling)}`);
    const showCityYear = f.limits.scope === 'city-year' && f.cityYearTotal !== null;
    parts.cityYear.hidden = !showCityYear;
    setText(
      parts.cityYear,
      showCityYear ? `${fillTemplate(P.cityYearTotal, { year })}: ${formatAmount(f.cityYearTotal ?? 0)} ${f.unit}` : '',
    );

    const editable = f.editable === 'yes';
    parts.note.hidden = editable;
    setText(parts.note, f.editable === 'select-district' ? P.selectDistrict : f.editable === 'no-pass-product' ? P.noCommuterPass : '');
    parts.controls.hidden = !editable;
    setText(parts.label, name);
    setText(parts.unit, f.unit);
    parts.input.inputMode = f.countField ? 'numeric' : 'decimal';

    // Never rewrite an input while it has focus (task 16.5). Rejected text stays as entered (Requirement 9.5).
    const active = parts.input.ownerDocument.activeElement;
    if (active !== parts.input) {
      const text = f.draft !== null ? f.draft.text : f.player === null ? '' : String(f.player);
      if (parts.input.value !== text) parts.input.value = text;
    }
    parts.apply.disabled = !f.applyEnabled;
    parts.setToReal.disabled = !f.setToRealEnabled;

    const msg = f.draft === null ? null : checkMessage(f.draft.check, name);
    setText(parts.message, msg ?? '');
    parts.message.hidden = msg === null;
    const rejected =
      f.draft !== null && !['ok', 'unchanged', 'pending-range'].includes(f.draft.check.status);
    setAttr(parts.input, 'aria-invalid', rejected ? 'true' : null);
  };

  const updateTool = (parts: ToolParts, tool: ToolView, props: PolicyPanelProps): void => {
    const soon = tool.kind === 'coming-soon';
    parts.badge.hidden = !soon;
    parts.effects.hidden = soon;
    parts.fields.hidden = soon;
    parts.realList.hidden = !soon;
    if (tool.kind === 'coming-soon') {
      parts.realList.replaceChildren(
        ...tool.realValues.map((v) => {
          const li = doc.createElement('li');
          li.className = 'ui-policy-real-value';
          const area = props.areaNames?.get(v.area as DistrictCode) ?? v.area;
          const flag = v.estimated ? `, ${UI_STRINGS.range.estimated}` : '';
          li.textContent = `${area}: ${formatNumber(v.value, v.decimals)} ${v.unit} (${P.realValue}${flag})`;
          return li;
        }),
      );
      return;
    }
    const byKey = new Map(tool.fields.map((f) => [f.key, f]));
    reconcileKeyed(parts.fields, parts.fieldEls, tool.fields.map((f) => f.key), (key) => {
      const f = byKey.get(key) as FieldView;
      const created = createField(f);
      parts.fieldCache.set(key, created);
      return created.root;
    });
    for (const key of [...parts.fieldCache.keys()]) if (!parts.fieldEls.has(key)) parts.fieldCache.delete(key);
    for (const f of tool.fields) {
      const fp = parts.fieldCache.get(f.key);
      if (fp !== undefined) updateField(fp, f, props);
    }
  };

  const toolParts = (domain: string): Map<string, ToolParts> => {
    let m = toolCaches.get(domain);
    if (m === undefined) {
      m = new Map();
      toolCaches.set(domain, m);
    }
    return m;
  };

  let lastFocusId: number | null = null;

  return {
    root,
    update(props) {
      const { policy } = props;
      // Budget
      const b = policy.budget;
      budget.hidden = b === null;
      if (b !== null) {
        setText(budgetTitle, fillTemplate(P.annualBudget, { year: String(b.year) }) + `: ${formatAmount(b.annualBudget)}`);
        setText(budgetCommitted, `${P.committed}: ${formatAmount(b.committed)}`);
        setText(budgetRemaining, `${P.remaining}: ${formatAmount(b.remaining)}`);
      }
      // Carried problem
      const c = policy.carried;
      carried.hidden = c === null;
      carriedKey = c === null ? null : c.key;
      if (c !== null) {
        const [tool = '', field = '', area = ''] = c.key.split('|');
        const areaName = props.areaNames?.get(area as DistrictCode) ?? area;
        setText(carriedText, carriedProblemText(c, fieldLabel(tool, field), areaName));
      }

      // Domains
      reconcileKeyed(domainsHost, domainCache, policy.domains.map((d) => d.domain), (domain) => {
        const section = el(doc, 'section', 'ui-policy-domain');
        el(doc, 'h3', 'ui-policy-domain-heading', section).textContent = domain === 'housing' ? P.housing : P.transit;
        el(doc, 'div', 'ui-policy-tools', section);
        return section;
      });
      for (const d of policy.domains) {
        const section = domainCache.get(d.domain);
        const host = section?.querySelector('.ui-policy-tools');
        if (host === null || host === undefined) continue;
        let els = toolEls.get(d.domain);
        if (els === undefined) {
          els = new Map();
          toolEls.set(d.domain, els);
        }
        const cache = toolParts(d.domain);
        const byId = new Map(d.tools.map((t) => [t.id as string, t]));
        reconcileKeyed(host, els, d.tools.map((t) => t.id), (id) => {
          const created = createTool(id);
          cache.set(id, created);
          return created.root;
        });
        for (const id of [...cache.keys()]) if (!els.has(id)) cache.delete(id);
        for (const t of d.tools) {
          const parts = cache.get(t.id);
          if (parts !== undefined) updateTool(parts, t, props);
        }
      }

      construction.update(policy.construction);

      // One-shot focus request from a timeline selection (Requirement 11.6)
      const fr = props.focusRequest;
      if (fr !== null && fr.id !== lastFocusId) {
        lastFocusId = fr.id;
        for (const cache of toolCaches.values()) {
          for (const tp of cache.values()) {
            const fp = tp.fieldCache.get(fr.key);
            if (fp !== undefined) {
              (fp.controls.hidden ? fp.root : fp.input).focus();
              return;
            }
          }
        }
      }
    },
  };
}

