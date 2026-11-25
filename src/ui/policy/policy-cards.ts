// Policy_Cards and Policy_Dialog (play-loop Requirement 5, approved design 2026-11-23). One card per Active_Tool opens
// the tool's dialog in the Dialog_Frame. Each editable field has a slider and an input bound to the same value: both
// call `editField`, so there is one value and one validation path (game-ui Requirement 9). Apply, Set to real value and
// every rejection message keep their game-ui behaviour. No page layout here; class names are styled in policy.css.
import type { DistrictCode, QuarterKey } from '../../types/data-files.ts';
import type { FieldView, GameView, PolicyPanelView, ToolView, UiActions } from '../../types/view.ts';
import { createDialogManager } from '../a11y/dialog.ts';
import { reconcileKeyed, setAttr, setText, type Component } from '../component.ts';
import { createConstructionRows } from '../panels/construction-rows.ts';
import {
  carriedProblemText,
  checkMessage,
  fieldLabel,
  formatAmount,
  parameterSourceText,
  realValueText,
  toolName,
  yearOf,
} from '../panels/policy-text.ts';
import { cityLabel, fillTemplate, quarterLabel, UI_STRINGS, unitLabel } from '../strings.ts';
import { cardStatus, quickPreview, sliderValue } from './preview.ts';
import '../../styles/policy.css';
import { mainFocusTarget } from '../menu/menu.ts';
import { createBudgetBar, exactTwd } from '../budget/budget-bar.ts';
import { formatNumber } from '../format/number.ts';

const BB = UI_STRINGS.budgetBar;

const P = UI_STRINGS.policy;
const C = UI_STRINGS.policyCards;
const D = UI_STRINGS.policyDialog;

/** Decorative tool icons (hidden from assistive technology; the tool name is the accessible name). */
const ICONS: Readonly<Record<string, string>> = { socialHousing: '⌂', rentSubsidy: '$', commuterPass: '⇆', sublease: '⇄', holdingTax: '%' };
/** Tools added by the housing-tools spec, marked New on their card (approved design, section 2). */
const NEW_TOOLS: ReadonlySet<string> = new Set(['sublease', 'holdingTax']);

export interface PolicyCardsProps {
  readonly policy: PolicyPanelView;
  readonly planning: QuarterKey | null;
  readonly focusRequest: GameView['focusRequest'];
  readonly areaNames: ReadonlyMap<DistrictCode, string>;
  /** Districts by city for the district picker, in display order. */
  readonly districtGroups: readonly { readonly city: string; readonly districts: readonly { readonly code: DistrictCode; readonly name: string }[] }[];
  readonly selected: DistrictCode | null;
  /** The Quarter_Brief is open; a blocked tool opens after it is closed. */
  readonly briefOpen?: boolean;
}

export interface PolicyCards extends Component<PolicyCardsProps> {
  /** The dialog element; the outer container mounts it next to the cards. */
  readonly dialogRoot: HTMLDialogElement;
}

type ActiveTool = Extract<ToolView, { kind: 'active' }>;

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, parent?: Element, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

let idCounter = 0;

interface FieldParts {
  readonly root: HTMLElement;
  readonly title: HTMLElement;
  readonly note: HTMLElement;
  readonly controls: HTMLElement;
  readonly slider: HTMLInputElement;
  readonly lower: HTMLElement;
  readonly real: HTMLElement;
  readonly upper: HTMLElement;
  readonly input: HTMLInputElement;
  readonly unit: HTMLElement;
  readonly preview: HTMLElement;
  readonly previewChange: HTMLElement;
  readonly previewBudget: HTMLElement;
  readonly previewYear: HTMLElement;
  readonly effect: HTMLElement;
  readonly message: HTMLElement;
  readonly setToReal: HTMLButtonElement;
  readonly apply: HTMLButtonElement;
  readonly details: HTMLElement;
}

export function createPolicyCards(doc: Document, actions: UiActions): PolicyCards {
  const root = el(doc, 'nav', 'ui-policy-cards');
  root.setAttribute('aria-label', C.label);
  // The annual budget is shown by the Budget_Bar of the Turn_Bar (housing-tools Requirement 3.1), which is in view on
  // wide screens and at the top of this menu on narrow ones.
  const cardsHost = el(doc, 'div', 'ui-policy-cards__list', root);
  const cardEls = new Map<string, HTMLButtonElement>();

  // The cards live in the menu (☰); when it is closed, focus goes back to ☰ or Next quarter.
  const dialog = createDialogManager(doc, () => mainFocusTarget(doc), UI_STRINGS.dialogs.close);
  let openTool: string | null = null;
  let last: PolicyCardsProps | null = null;

  // ---- dialog body, rebuilt when another tool opens, updated in place otherwise
  const body = el(doc, 'div', 'ui-policy-dialog');
  // The year's Budget_Bar with the draft previewed as a dashed segment (housing-tools Requirement 3.2).
  const dialogBudget = createBudgetBar(doc);
  dialogBudget.root.classList.add('ui-policy-dialog__budget');
  body.append(dialogBudget.root);
  const trade = el(doc, 'div', 'ui-policy-dialog__trade', body);
  const benefits = el(doc, 'div', 'ui-policy-dialog__benefits', trade);
  const costs = el(doc, 'div', 'ui-policy-dialog__costs', trade);
  const carried = el(doc, 'div', 'ui-policy-dialog__carried', body);
  carried.setAttribute('role', 'alert');
  const carriedText = el(doc, 'p', '', carried);
  const carriedButton = el(doc, 'button', 'dialog__button', carried, P.setToReal);
  carriedButton.type = 'button';
  let carriedKey: string | null = null;
  carriedButton.addEventListener('click', () => {
    if (carriedKey !== null) actions.setToReal(carriedKey);
  });
  const picker = el(doc, 'div', 'ui-policy-dialog__picker', body);
  const pickerId = `ui-policy-district-${++idCounter}`;
  const pickerLabel = el(doc, 'label', 'ui-policy-dialog__label', picker, D.district);
  pickerLabel.htmlFor = pickerId;
  const select = el(doc, 'select', 'ui-policy-dialog__select', picker);
  select.id = pickerId;
  select.addEventListener('change', () => {
    if (select.value !== '') actions.selectDistrict(select.value as DistrictCode);
  });
  let pickerKey = '';
  const fieldsHost = el(doc, 'div', 'ui-policy-dialog__fields', body);
  const fieldEls = new Map<string, HTMLElement>();
  const fieldParts = new Map<string, FieldParts>();
  const disclosure = el(doc, 'details', 'ui-policy-dialog__details', body);
  el(doc, 'summary', '', disclosure, D.details);
  const construction = createConstructionRows(doc);
  disclosure.appendChild(construction.root);
  const done = el(doc, 'button', 'dialog__button dialog__button--primary ui-policy-done', undefined, D.done);
  done.type = 'button';
  done.addEventListener('click', () => closeDialog());

  const closeDialog = (): void => {
    openTool = null;
    dialog.close();
  };

  const fillTrade = (toolId: string): void => {
    const effects = (P.effects as Readonly<Record<string, { benefits: readonly string[]; costs: readonly string[] }>>)[toolId];
    benefits.replaceChildren(el(doc, 'h3', '', undefined, D.benefits));
    costs.replaceChildren(el(doc, 'h3', '', undefined, D.costs));
    const list = (host: HTMLElement, items: readonly string[]) => {
      const ul = el(doc, 'ul', '', host);
      for (const t of items) el(doc, 'li', '', ul, t);
    };
    list(benefits, effects?.benefits ?? []);
    list(costs, effects?.costs ?? []);
  };

  const createField = (f: FieldView): FieldParts => {
    const id = `ui-policy-field-${++idCounter}`;
    const fieldRoot = el(doc, 'section', 'ui-policy-dialog__field');
    fieldRoot.tabIndex = -1;
    const title = el(doc, 'h3', 'ui-policy-dialog__field-title', fieldRoot);
    const note = el(doc, 'p', 'ui-policy-dialog__note', fieldRoot);
    const controls = el(doc, 'div', 'ui-policy-dialog__controls', fieldRoot);
    const row = el(doc, 'div', 'ui-policy-dialog__row', controls);
    const slider = el(doc, 'input', 'ui-policy-dialog__slider', row);
    slider.type = 'range';
    const label = el(doc, 'label', 'ui-visually-hidden', row);
    label.htmlFor = id;
    const input = el(doc, 'input', 'ui-policy-dialog__input', row);
    input.id = id;
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const unit = el(doc, 'span', 'ui-policy-dialog__unit', row);
    const scale = el(doc, 'div', 'ui-policy-dialog__scale', controls);
    const lower = el(doc, 'span', '', scale);
    const real = el(doc, 'span', 'ui-policy-dialog__real', scale);
    const upper = el(doc, 'span', '', scale);
    const preview = el(doc, 'div', 'ui-policy-dialog__preview', controls);
    el(doc, 'p', 'ui-policy-dialog__preview-label', preview, D.preview);
    const previewChange = el(doc, 'p', 'ui-policy-dialog__preview-change', preview);
    const previewBudget = el(doc, 'p', 'ui-policy-dialog__preview-budget', preview);
    const previewYear = el(doc, 'p', 'ui-policy-dialog__preview-year', preview);
    const effect = el(doc, 'p', 'ui-policy-dialog__effect', controls);
    const message = el(doc, 'p', 'ui-policy-dialog__message', controls);
    message.id = `${id}-message`;
    message.setAttribute('role', 'status');
    input.setAttribute('aria-describedby', message.id);
    slider.setAttribute('aria-describedby', message.id);
    const buttons = el(doc, 'div', 'ui-policy-dialog__buttons', controls);
    const setToReal = el(doc, 'button', 'dialog__button', buttons, P.setToReal);
    setToReal.type = 'button';
    const apply = el(doc, 'button', 'dialog__button dialog__button--primary', buttons, P.apply);
    apply.type = 'button';
    const details = el(doc, 'div', 'ui-policy-dialog__field-details', fieldRoot);

    const key = f.key;
    slider.addEventListener('input', () => {
      input.value = slider.value;
      actions.editField(key, slider.value);
    });
    input.addEventListener('input', () => actions.editField(key, input.value));
    apply.addEventListener('click', () => actions.applyField(key));
    setToReal.addEventListener('click', () => actions.setToReal(key));
    return { root: fieldRoot, title, note, controls, slider, lower, real, upper, input, unit, preview, previewChange, previewBudget, previewYear, effect, message, setToReal, apply, details };
  };

  const updateField = (parts: FieldParts, f: FieldView, props: PolicyCardsProps): void => {
    const areaName = props.areaNames.get(f.area as DistrictCode) ?? cityLabel(f.area);
    const name = fieldLabel(f.tool, f.field);
    const unit = unitLabel(f.unit);
    setText(parts.title, `${name} · ${areaName}`);
    const editable = f.editable === 'yes';
    parts.note.hidden = editable;
    setText(parts.note, f.editable === 'select-district' ? P.selectDistrict : f.editable === 'no-pass-product' ? P.noCommuterPass : '');
    parts.controls.hidden = !editable;

    setAttr(parts.slider, 'min', String(f.limits.lower));
    setAttr(parts.slider, 'max', String(f.sliderUpper));
    setAttr(parts.slider, 'step', f.countField ? '1' : 'any');
    setAttr(parts.slider, 'aria-label', fillTemplate(D.slider, { field: `${name} · ${areaName}` }));
    const active = doc.activeElement;
    if (active !== parts.slider) {
      const v = String(sliderValue(f));
      if (parts.slider.value !== v) parts.slider.value = v;
    }
    // Never rewrite the text input while it has focus; rejected text stays as entered (game-ui Requirement 9.5).
    if (active !== parts.input) {
      const text = f.draft !== null ? f.draft.text : f.player === null ? '' : String(f.player);
      if (parts.input.value !== text) parts.input.value = text;
    }
    parts.input.inputMode = f.countField ? 'numeric' : 'decimal';
    setText(parts.unit, unit);
    (parts.root.querySelector('label') as HTMLLabelElement).textContent = `${name} · ${areaName}`;
    const statutory = f.tool === 'holdingTax';
    // Tax rates read with one decimal (1.5 %), as in the approved design; other fields as before.
    const amount = (x: number): string => (statutory ? formatNumber(x, 1) : formatAmount(x));
    setText(parts.lower, fillTemplate(statutory ? D.statutoryLower : D.lowerEnd, { value: amount(f.limits.lower) }));
    const upperTpl =
      f.tierCap !== undefined && f.tierCap !== null ? D.tierOrder : statutory ? D.statutoryUpper : Number.isFinite(f.limits.upper) ? D.upperEnd : D.budgetEnd;
    setText(parts.upper, fillTemplate(upperTpl, { value: amount(f.sliderUpper) }));
    parts.real.hidden = f.real === null;
    setText(parts.real, f.real === null ? '' : fillTemplate(D.realMark, { value: amount(f.real.value) }));

    const pv = quickPreview(f, props.policy.budget, props.planning);
    parts.preview.hidden = pv === null || pv.change === 0;
    if (pv !== null) {
      const sign = pv.change > 0 ? '+' : pv.change < 0 ? '−' : '';
      setText(parts.previewChange, fillTemplate(D.previewChange, { change: `${sign}${formatAmount(Math.abs(pv.change))}`, unit, ready: quarterLabel(pv.ready) }));
      const year = String(pv.year ?? '');
      const left = formatAmount(pv.left ?? 0);
      const revenue = f.draft !== null && !['ok', 'unchanged', 'pending-range'].includes(f.draft.check.status) ? null : revenueLine(f);
      setText(parts.previewBudget, revenue ?? costLine(f, props.policy) ?? fillTemplate(D.previewLeft, { year, left }));
      const y = pv.yearEnd;
      parts.preview.classList.toggle('is-overrun', y !== null && y.overrun !== null);
      setText(
        parts.previewYear,
        y === null
          ? ''
          : y.overrun !== null
            ? fillTemplate(D.previewOverrun, { year: String(y.year), quarter: quarterLabel(y.overrun.quarter), over: formatAmount(y.overrun.over) })
            : fillTemplate(D.previewYearEnd, { year: String(y.year), left: formatAmount(y.remaining) }),
      );
      parts.previewYear.hidden = y === null;
    }
    // No effect line for a value that is rejected (it will not be applied).
    const draftRejected = f.draft !== null && !['ok', 'unchanged', 'pending-range'].includes(f.draft.check.status);
    const eff = draftRejected ? null : (subleaseEffectText(f) ?? holdingTaxEffectText(f));
    setText(parts.effect, eff ?? '');
    parts.effect.hidden = eff === null;
    const msg = f.draft === null ? null : (overText(f, props.policy) ?? checkMessage(f.draft.check, name));
    setText(parts.message, msg ?? '');
    parts.message.hidden = msg === null;
    const rejected = f.draft !== null && !['ok', 'unchanged', 'pending-range'].includes(f.draft.check.status);
    setAttr(parts.input, 'aria-invalid', rejected ? 'true' : null);
    parts.apply.disabled = !f.applyEnabled;
    parts.setToReal.disabled = !f.setToRealEnabled;

    // Details and sources (game-ui Requirements 8.4 to 8.6), shown inside the disclosure of the dialog.
    const year = yearOf(props.planning);
    const lines = [
      realValueText(f, props.planning),
      f.unitCost === null ? '' : `${P.unitCost}: ${formatAmount(f.unitCost.value)} · ${P.citation}: ${parameterSourceText(f.unitCost)}`,
      `${P.lag}: ${formatAmount(f.lag.value)} · ${P.citation}: ${parameterSourceText(f.lag)}`,
      f.limits.lowerRef === null && f.limits.lower === 0
        ? P.lowerZero
        : `${P.lowerLimit}: ${formatAmount(f.limits.lower)} ${unit} · ${P.citation}: ${parameterSourceText(f.limits.lowerRef)}`,
      Number.isFinite(f.limits.upper)
        ? `${P.upperLimit}: ${formatAmount(f.limits.upper)} ${unit} · ${P.citation}: ${parameterSourceText(f.limits.upperRef)}`
        : P.noUpperLimit,
      `${fillTemplate(P.remainingCeiling, { year })}: ${formatAmount(f.remainingCeiling)}`,
      f.limits.scope === 'city-year' && f.cityYearTotal !== null ? `${fillTemplate(P.cityYearTotal, { year })}: ${formatAmount(f.cityYearTotal)} ${unit}` : '',
    ].filter((t) => t !== '');
    const key = lines.join('\n');
    if (parts.details.dataset['key'] !== key) {
      parts.details.dataset['key'] = key;
      parts.details.replaceChildren(el(doc, 'h4', '', undefined, `${name} · ${areaName}`), ...lines.map((t) => el(doc, 'p', '', undefined, t)));
    }
  };

  const renderDialog = (props: PolicyCardsProps): void => {
    if (openTool === null) return;
    const tool = activeTools(props.policy).find((t) => t.id === openTool);
    if (tool === undefined) {
      closeDialog();
      return;
    }
    let draftCost: number | null = null;
    for (const f of tool.fields) {
      const c = draftCharges(f);
      if (c !== null && c.year > 0) draftCost = Math.max(draftCost ?? 0, c.year);
    }
    dialogBudget.update(props.policy.budgetBar, draftCost);
    // District picker: tools whose fields are per district (social housing starts).
    const perDistrict = tool.fields.some((f) => f.limits.scope === 'city-year' || f.editable === 'select-district');
    picker.hidden = !perDistrict;
    if (perDistrict) {
      const key = props.districtGroups.map((g) => g.city + g.districts.map((d) => d.code + d.name).join()).join('|');
      if (key !== pickerKey) {
        pickerKey = key;
        const none = el(doc, 'option', '', undefined, D.chooseDistrict);
        none.value = '';
        select.replaceChildren(
          none,
          ...props.districtGroups.map((g) => {
            const og = doc.createElement('optgroup');
            og.label = cityLabel(g.city);
            for (const d of g.districts) {
              const o = el(doc, 'option', '', og, d.name);
              o.value = d.code;
            }
            return og;
          }),
        );
      }
      const v = props.selected ?? '';
      if (select.value !== v) select.value = v;
    }
    const c = props.policy.carried;
    const carriedHere = c !== null && c.key.startsWith(`${tool.id}|`);
    carried.hidden = !carriedHere;
    carriedKey = carriedHere ? c.key : null;
    if (carriedHere) {
      const [t = '', field = '', area = ''] = c.key.split('|');
      setText(carriedText, carriedProblemText(c, fieldLabel(t, field), props.areaNames.get(area as DistrictCode) ?? cityLabel(area)));
    }
    const byKey = new Map(tool.fields.map((f) => [f.key as string, f]));
    reconcileKeyed(fieldsHost, fieldEls, tool.fields.map((f) => f.key), (key) => {
      const parts = createField(byKey.get(key)!);
      fieldParts.set(key, parts);
      return parts.root;
    });
    for (const key of [...fieldParts.keys()]) if (!fieldEls.has(key)) fieldParts.delete(key);
    for (const f of tool.fields) {
      const parts = fieldParts.get(f.key);
      if (parts !== undefined) updateField(parts, f, props);
    }
    // Field details go into the disclosure, after the construction rows of social housing.
    disclosure.replaceChildren(disclosure.firstElementChild ?? el(doc, 'summary', '', undefined, D.details));
    if (tool.id === 'socialHousing') {
      construction.update(props.policy.construction);
      disclosure.appendChild(construction.root);
    }
    for (const f of tool.fields) {
      const parts = fieldParts.get(f.key);
      if (parts !== undefined) disclosure.appendChild(parts.details);
    }
  };

  const open = (toolId: string, opener: HTMLElement | null): void => {
    if (last === null) return;
    const changed = openTool !== toolId;
    openTool = toolId;
    if (changed) {
      fieldsHost.replaceChildren();
      fieldEls.clear();
      fieldParts.clear();
      fillTrade(toolId);
      disclosure.open = false;
    }
    renderDialog(last);
    dialog.open({
      title: toolName(toolId),
      kicker: last.planning === null ? undefined : fillTemplate(D.appliesFrom, { quarter: quarterLabel(last.planning) }),
      body,
      actions: [done],
      opener,
      onCancel: closeDialog,
      size: 'lg',
    });
  };

  let lastFocusId: number | null = null;
  // A Computation_Run stopped on a carried value (game-ui Requirement 9.8): open the tool so the player sees why
  // Next quarter did nothing and can set the value back (play-loop Requirement 4: every step says what to do next).
  let lastCarried: string | null = null;

  return {
    root,
    dialogRoot: dialog.root,
    update(props) {
      last = props;
      const tools = activeTools(props.policy);
      reconcileKeyed(cardsHost, cardEls, tools.map((t) => t.id), (id) => {
        const b = el(doc, 'button', 'ui-policy-card');
        b.type = 'button';
        const icon = el(doc, 'span', 'ui-policy-card__icon', b, ICONS[id] ?? '•');
        icon.setAttribute('aria-hidden', 'true');
        const name = el(doc, 'span', 'ui-policy-card__name', b, toolName(id));
        if (NEW_TOOLS.has(id)) el(doc, 'span', 'ui-policy-card__new', name, C.newTool);
        const short = el(doc, 'span', 'ui-policy-card__short', b, (C.short as Readonly<Record<string, string>>)[id] ?? toolName(id));
        short.setAttribute('aria-hidden', 'true');
        el(doc, 'span', 'ui-policy-card__status', b);
        b.addEventListener('click', () => open(id, b));
        return b;
      });
      for (const t of tools) {
        const b = cardEls.get(t.id);
        if (b === undefined) continue;
        const s = cardStatus(t, props.policy.construction);
        const carriedHere = props.policy.carried !== null && props.policy.carried.key.startsWith(`${t.id}|`);
        const text = carriedHere
          ? C.carried
          : s.kind === 'real'
            ? C.realTrack
            : s.kind === 'no-pass'
              ? C.noPass
              : s.n === 1
                ? (s.kind === 'sites' ? C.sitesOne : C.changedOne)
                : fillTemplate(s.kind === 'sites' ? C.sites : C.changed, { n: String(s.n) });
        setText(b.querySelector('.ui-policy-card__status')!, text);
        b.classList.toggle('is-changed', s.kind === 'changed' || s.kind === 'sites');
        b.classList.toggle('is-warning', carriedHere);
      }
      if (dialog.isOpen() && openTool !== null) renderDialog(props);

      const carriedNow = props.policy.carried === null ? null : `${props.policy.carried.key}|${props.policy.carried.quarter}`;
      if (carriedNow !== null && carriedNow !== lastCarried && props.briefOpen !== true) {
        const toolId = props.policy.carried?.key.split('|')[0] ?? '';
        if (tools.some((t) => t.id === toolId) && openTool !== toolId) open(toolId, cardEls.get(toolId) ?? null);
        lastCarried = carriedNow;
      } else if (carriedNow === null) lastCarried = null;

      // A timeline selection opens the tool and focuses its field (game-ui Requirement 11.6).
      const fr = props.focusRequest;
      if (fr !== null && fr.id !== lastFocusId) {
        lastFocusId = fr.id;
        const toolId = fr.key.split('|')[0] ?? '';
        if (tools.some((t) => t.id === toolId)) {
          open(toolId, cardEls.get(toolId) ?? null);
          const parts = fieldParts.get(fr.key);
          if (parts !== undefined) (parts.controls.hidden ? parts.root : parts.input).focus();
        }
      }
    },
  };
}

/**
 * The effect line of a sublease field (approved design, section 4): the extra homes of the value shown against the
 * real value, the rent-share range and the largest saving per household; null when there are no extra homes.
 */
function subleaseEffectText(f: FieldView): string | null {
  const e = f.subleaseEffect;
  if (e === undefined || f.real === null) return null;
  const shown = f.draft !== null && f.draft.check.status !== 'invalid-format' ? Number(f.draft.text) : f.player;
  if (shown === null || !Number.isFinite(shown)) return null;
  const n = shown - f.real.value;
  if (!(n > 0)) return null;
  return fillTemplate(D.subleaseEffect, {
    n: formatAmount(n),
    low: formatAmount(Math.round(e.shareLow * 100)),
    high: formatAmount(Math.round(e.shareHigh * 100)),
    saving: formatAmount(Math.round(e.saving)),
    lag: formatAmount(e.lag),
  });
}

/** The revenue line of a holding-tax field (approved design, section 5); null for any other field or no change. */
function revenueLine(f: FieldView): string | null {
  const e = f.holdingTaxEffect;
  if (e === undefined) return null;
  const amount = Math.round(Math.abs(e.revenueYear));
  if (amount === 0) return null;
  return fillTemplate(e.revenueYear > 0 ? D.revenueMore : D.revenueLess, { amount: formatAmount(amount) });
}

/** The vacancy line of a holding-tax field WHEN the rates shown are higher than the real ones. */
function holdingTaxEffectText(f: FieldView): string | null {
  const e = f.holdingTaxEffect;
  if (e === undefined || !(e.vacancyHigh > 0)) return null;
  return fillTemplate(D.holdingTaxEffect, { low: formatNumber(e.vacancyLow, 1), high: formatNumber(e.vacancyHigh, 1) });
}

/** The charges of a draft kept to the end of the year, or null when it has none (housing-tools Requirement 3.2). */
function draftCharges(f: FieldView): { readonly year: number; readonly total: number } | null {
  const check = f.draft?.check;
  if (check === undefined || (check.status !== 'ok' && check.status !== 'pending-range')) return null;
  if (check.costYear === undefined || check.costTotal === undefined) return null;
  return { year: check.costYear, total: check.costTotal };
}

/**
 * The cost line of a draft against the Budget_Bar, which counts the year with the current values kept to its end:
 * what the change costs this year and what stays, the part paid in later years, or what is missing.
 */
function costLine(f: FieldView, policy: PolicyPanelView): string | null {
  const c = draftCharges(f);
  const bar = policy.budgetBar;
  if (c === null || bar === null || c.year === 0) return null;
  const left = bar.remaining - c.year;
  if (left < 0) {
    const others = bar.tools.filter((t) => t.tool !== f.tool);
    const list = others.map((t) => fillTemplate(BB.listItem, { tool: toolName(t.tool), amount: exactTwd(t.spent + t.later) })).join(BB.listSeparator);
    return fillTemplate(BB.costOver, { missing: exactTwd(-left), list });
  }
  if (c.year < 0) {
    return fillTemplate(D.previewCostLess, { year: String(bar.year), cost: formatAmount(-c.year), left: formatAmount(left) });
  }
  const later = c.total - c.year;
  return [
    fillTemplate(BB.costFits, { cost: exactTwd(c.year), left: exactTwd(left) }),
    later > 0 ? fillTemplate(BB.costLaterYears, { amount: exactTwd(later) }) : '',
  ].filter((t) => t !== '').join(' ');
}

/**
 * The rejection of a draft over the Annual_Budget, with what the other tools spend this year (housing-tools
 * Requirement 3.2 and 3.3); null for any other check, which keeps its own message.
 */
function overText(f: FieldView, policy: PolicyPanelView): string | null {
  const check = f.draft?.check;
  if (check === undefined || check.status !== 'budget' || check.problem.reason !== 'annual-budget') return null;
  const others = (policy.budgetBar?.tools ?? []).filter((t) => t.tool !== f.tool);
  const list = others.map((t) => fillTemplate(BB.listItem, { tool: toolName(t.tool), amount: exactTwd(t.spent + t.later) })).join(BB.listSeparator);
  return fillTemplate(BB.costOver, { missing: exactTwd(check.problem.over), list });
}

function activeTools(policy: PolicyPanelView): ActiveTool[] {
  return policy.domains.flatMap((d) => d.tools).filter((t): t is ActiveTool => t.kind === 'active');
}
