// Life dialog (play-loop Requirement 3A, approved design 2026-11-23): "My life" in each Decide_Step. Left, the
// household and the Character_Numbers; right, one card per Life_Decision. An unavailable decision shows its reason,
// or the legal fact with its source (same-sex marriage before 2019Q2). Choosing one shows its form and the numbers
// with and without it; Confirm adds it to the Life_Timeline in the Planning_Quarter.
import type { Availability } from '../../game/life/availability.ts';
import type { CharacterView } from '../../game/life/controller.ts';
import type { LifeDecisionKind, Look, MyLifeDecision as LifeDecision, PronounId } from '../../game/life/life-state.ts';
import type { CharacterNumbers } from '../../game/life/numbers.ts';
import { createDialogManager } from '../a11y/dialog.ts';
import { pick, type LocalText } from '../character/creation.ts';
import { formatNumber } from '../format/number.ts';
import { cityLabel, fillTemplate, LOCALE, quarterLabel, UI_STRINGS } from '../strings.ts';
import '../../styles/life.css';

const U = UI_STRINGS.characterUi;

export interface LifeFiles {
  readonly characters: {
    readonly origins: readonly { readonly id: string; readonly familyCity: string | null }[];
    readonly occupations: readonly { readonly id: string; readonly name: LocalText; readonly workCodes: readonly string[] }[];
    readonly appearance: { readonly colour: readonly string[] };
    readonly pronouns: Readonly<Record<PronounId, { readonly label: LocalText }>>;
    readonly legal: readonly { readonly id: string; readonly text: LocalText; readonly source: { readonly citation: string; readonly url: string } }[];
    readonly decisions: Readonly<Record<string, unknown>>;
  };
}

export interface LifeDialogDeps {
  readonly files: LifeFiles;
  readonly districts: readonly { readonly code: string; readonly name: string; readonly city: string }[];
  readonly view: () => CharacterView | null;
  readonly preview: (d: LifeDecision) => { readonly with: CharacterNumbers; readonly without: CharacterNumbers } | null;
  readonly apply: (d: LifeDecision) => { readonly ok: boolean };
  readonly fallbackFocus: () => HTMLElement | null;
}

export interface LifeDialog {
  readonly root: HTMLDialogElement;
  open(opener: HTMLElement | null): void;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, parent?: Element, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const KINDS: readonly LifeDecisionKind[] = ['move', 'changeJob', 'partnerIn', 'partnerOut', 'marry', 'childJoins', 'parentJoins', 'parentLeaves'];

export function createLifeDialog(doc: Document, deps: LifeDialogDeps): LifeDialog {
  const ch = deps.files.characters;
  const D = ch.decisions;
  const T = (key: string): LocalText | undefined => D[key] as LocalText | undefined;
  const kindText = (kind: string, key: 'title' | 'text'): string => pick((D[kind] as Record<string, LocalText> | undefined)?.[key]);
  const reasonText = (reason: string): string => pick((D['unavailable'] as Record<string, LocalText> | undefined)?.[reason]);
  const nameOf = (code: string) => deps.districts.find((d) => d.code === code)?.name ?? code;
  const dialog = createDialogManager(doc, deps.fallbackFocus, UI_STRINGS.dialogs.close);
  dialog.root.classList.add('ui-life-dialog');

  const body = el(doc, 'div', 'ui-life');
  const left = el(doc, 'section', 'ui-life__household', body);
  const right = el(doc, 'section', 'ui-life__decisions', body);
  const intro = el(doc, 'p', 'ui-life__intro', right);
  const grid = el(doc, 'div', 'ui-life__cards', right);
  const form = el(doc, 'div', 'ui-life__form', right);
  const compare = el(doc, 'p', 'ui-life__compare', right);
  compare.setAttribute('role', 'status');
  const cancel = el(doc, 'button', 'dialog__button', undefined, UI_STRINGS.dialogs.cancel);
  cancel.type = 'button';
  const confirm = el(doc, 'button', 'dialog__button dialog__button--primary', undefined, pick(T('confirm')));
  confirm.type = 'button';

  let chosen: LifeDecisionKind | null = null;
  // form state
  let home = '';
  let tenure: 'renting' | 'family' = 'renting';
  let occupation = ch.occupations[0]?.id ?? '';
  let workCode = ch.occupations[0]?.workCodes[0] ?? '';
  let partnerPronouns: PronounId = 'they';
  let partnerColour = ch.appearance.colour[1] ?? 'amber';
  let sameSex = false;

  const decision = (): LifeDecision | null => {
    const look: Look = { body: 'b', hair: 'medium', colour: partnerColour };
    switch (chosen) {
      case null:
        return null;
      case 'move':
        return { kind: 'move', home, tenure };
      case 'changeJob':
        return { kind: 'changeJob', occupation, workCode };
      case 'partnerIn':
        return { kind: 'partnerIn', partner: { occupation, workCode, pronouns: partnerPronouns, look, sameSexInLaw: sameSex } };
      case 'childJoins':
        return { kind: 'childJoins', look: { body: 'a', hair: 'short', colour: partnerColour }, pronouns: 'they' };
      case 'parentJoins':
        return { kind: 'parentJoins', look: { body: 'b', hair: 'short', colour: 'slate' }, pronouns: 'they' };
      default:
        return { kind: chosen } as LifeDecision;
    }
  };

  const chips = (parent: HTMLElement, label: string, options: readonly { readonly id: string; readonly label: string }[], get: () => string, set: (v: string) => void): void => {
    const group = el(doc, 'div', 'ui-creation__group', parent);
    const h = el(doc, 'p', 'ui-creation__label', group, label);
    h.id = `ui-life-${label.replace(/\W/g, '')}-${parent.childElementCount}`;
    const row = el(doc, 'div', 'ui-creation__chips', group);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-labelledby', h.id);
    for (const o of options) {
      const b = el(doc, 'button', 'ui-creation__chip', row, o.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(o.id === get()));
      b.addEventListener('click', () => {
        set(o.id);
        render();
        form.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
      });
    }
  };

  const select = (parent: HTMLElement, label: string, options: readonly { readonly id: string; readonly label: string; readonly group?: string }[], get: () => string, set: (v: string) => void): void => {
    const id = `ui-life-select-${label.replace(/\W/g, '')}-${parent.childElementCount}`;
    const l = el(doc, 'label', 'ui-creation__label', parent, label);
    l.htmlFor = id;
    const s = el(doc, 'select', 'ui-creation__select', parent);
    s.id = id;
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const o of options) {
      let host: HTMLElement = s;
      if (o.group !== undefined) {
        let g = groups.get(o.group);
        if (g === undefined) {
          g = doc.createElement('optgroup');
          g.label = o.group;
          s.appendChild(g);
          groups.set(o.group, g);
        }
        host = g;
      }
      const opt = el(doc, 'option', '', host, o.label);
      opt.value = o.id;
    }
    s.value = get();
    s.addEventListener('change', () => {
      set(s.value);
      render();
      form.querySelector<HTMLSelectElement>(`#${id}`)?.focus();
    });
  };

  const numbersLine = (n: CharacterNumbers): { burden: string; commute: string } => ({
    burden: n.rentBurden === null ? U.noValue : formatNumber(n.rentBurden, 1),
    commute: n.commuteMinutes === null ? '—' : formatNumber(n.commuteMinutes, 0),
  });

  const renderHousehold = (v: CharacterView): void => {
    left.replaceChildren();
    el(doc, 'p', 'ui-creation__label', left, U.household);
    const figures = el(doc, 'div', 'ui-life__figures', left);
    figures.setAttribute('aria-hidden', 'true');
    for (const m of v.planningLife.members) {
      const f = el(doc, 'span', `ui-life__figure ui-life__figure--${m.kind} ui-life-look--${m.look.colour}`, figures);
      void f;
    }
    const memberName = (k: string) => (k === 'self' ? U.memberSelf : k === 'partner' ? U.memberPartner : k === 'child' ? U.memberChild : U.memberParent);
    const members = v.planningLife.members.map((m) => memberName(m.kind)).join(LOCALE_SEP);
    el(
      doc,
      'p',
      'ui-life__line',
      left,
      fillTemplate(U.householdLine, { members: v.planningLife.married ? `${members} (${U.married})` : members, tenure: v.planningLife.tenure === 'family' ? U.family : U.renting, district: nameOf(v.planningLife.home) }),
    );
    const n = numbersLine(v.numbers.player);
    const dl = el(doc, 'dl', 'ui-district-card__rows', left);
    el(doc, 'dt', '', dl, U.chipRent);
    el(doc, 'dd', '', dl, n.burden === U.noValue ? n.burden : `${n.burden}%`);
    el(doc, 'dt', '', dl, U.chipCommute);
    el(doc, 'dd', '', dl, n.commute);
  };

  const renderCards = (available: readonly Availability[]): void => {
    grid.replaceChildren();
    for (const kind of KINDS) {
      const a = available.find((x) => x.kind === kind);
      const b = el(doc, 'button', 'ui-creation__card ui-life__card', grid);
      b.type = 'button';
      el(doc, 'span', 'ui-creation__card-title', b, kindText(kind, 'title'));
      el(doc, 'span', 'ui-creation__card-text', b, kindText(kind, 'text'));
      b.setAttribute('aria-pressed', String(chosen === kind));
      if (a !== undefined && !a.ok) {
        b.disabled = a.reason !== 'legal';
        b.classList.add('is-unavailable');
        const why = a.reason === 'legal' ? '' : reasonText(a.reason);
        if (why !== '') el(doc, 'span', 'ui-life__why', b, why);
      }
      b.addEventListener('click', () => {
        chosen = kind;
        render();
        grid.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
      });
    }
  };

  const renderForm = (v: CharacterView): void => {
    form.replaceChildren();
    const a = v.available.find((x) => x.kind === chosen);
    if (chosen === null || a === undefined) return;
    if (!a.ok && a.reason === 'legal') {
      const fact = ch.legal.find((l) => l.id === a.legalId);
      const box = el(doc, 'div', 'ui-life__legal', form);
      el(doc, 'p', '', box, pick(fact?.text));
      if (fact !== undefined) {
        const link = el(doc, 'a', 'dialog__link', box, `${U.source}: ${fact.source.citation}`);
        link.href = fact.source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      return;
    }
    const origin = ch.origins.find((o) => o.id === v.character.origin);
    if (chosen === 'move') {
      if (home === '') home = v.planningLife.home;
      if (origin?.familyCity !== null && origin?.familyCity !== undefined) {
        chips(form, U.tenure, [{ id: 'renting', label: U.renting }, { id: 'family', label: U.family }], () => tenure, (x) => (tenure = x as typeof tenure));
      } else tenure = 'renting';
      const allowed = deps.districts.filter((d) => tenure !== 'family' || d.city === origin?.familyCity);
      if (!allowed.some((d) => d.code === home)) home = allowed[0]?.code ?? home;
      select(form, U.district, allowed.map((d) => ({ id: d.code, label: d.name, group: cityLabel(d.city) })), () => home, (x) => (home = x));
    }
    if (chosen === 'changeJob' || chosen === 'partnerIn') {
      select(form, U.job, ch.occupations.map((o) => ({ id: o.id, label: pick(o.name) })), () => occupation, (x) => {
        occupation = x;
        workCode = ch.occupations.find((o) => o.id === x)?.workCodes[0] ?? workCode;
      });
      const occ = ch.occupations.find((o) => o.id === occupation);
      chips(form, U.workWhere, (occ?.workCodes ?? []).map((c) => ({ id: c, label: nameOf(c) })), () => workCode, (x) => (workCode = x));
    }
    if (chosen === 'partnerIn') {
      chips(form, U.pronouns, (['she', 'he', 'they'] as const).map((id) => ({ id, label: pick(ch.pronouns[id]?.label) })), () => partnerPronouns, (x) => (partnerPronouns = x as PronounId));
      const K = U.colours as Readonly<Record<string, string>>;
      chips(form, U.colour, ch.appearance.colour.map((id) => ({ id, label: K[id] ?? id })), () => partnerColour, (x) => (partnerColour = x));
      const p = D['partnerIn'] as Record<string, LocalText> | undefined;
      chips(form, pick(p?.['sameSexQuestion']), [{ id: 'no', label: U.no }, { id: 'yes', label: U.yes }], () => (sameSex ? 'yes' : 'no'), (x) => (sameSex = x === 'yes'));
      el(doc, 'p', 'ui-creation__note', form, pick(p?.['sameSexNote']));
    }
  };

  const render = (): void => {
    const v = deps.view();
    if (v === null) return;
    renderHousehold(v);
    intro.textContent = pick(T('intro'));
    renderCards(v.available);
    renderForm(v);
    const a = v.available.find((x) => x.kind === chosen);
    const d = decision();
    const usable = d !== null && a !== undefined && a.ok;
    confirm.disabled = !usable;
    compare.textContent = '';
    if (!usable || d === null) {
      if (chosen === null) compare.textContent = U.chooseDecision;
      return;
    }
    const p = deps.preview(d);
    if (p === null) return;
    const w = numbersLine(p.with);
    const wo = numbersLine(p.without);
    compare.textContent = fillTemplate(pick(T('compare')), { rentBurdenWith: w.burden, commuteWith: w.commute, rentBurdenWithout: wo.burden, commuteWithout: wo.commute });
  };

  confirm.addEventListener('click', () => {
    const d = decision();
    if (d === null) return;
    if (deps.apply(d).ok) {
      chosen = null;
      dialog.close();
    } else render();
  });
  cancel.addEventListener('click', () => {
    chosen = null;
    dialog.close();
  });

  return {
    root: dialog.root,
    open(opener) {
      const v = deps.view();
      if (v === null) return;
      chosen = null;
      home = v.planningLife.home;
      // A move from social housing or a sublease home starts as renting (the dialog offers renting and family only).
      tenure = v.planningLife.tenure === 'social' || v.planningLife.tenure === 'sublease' ? 'renting' : v.planningLife.tenure;
      render();
      dialog.open({
        title: fillTemplate(pick(T('title')), { quarter: v.planning === null ? '' : quarterLabel(v.planning) }),
        body,
        actions: [cancel, confirm],
        opener,
        onCancel: () => {
          chosen = null;
          dialog.close();
        },
        size: 'lg',
      });
    },
  };
}

const LOCALE_SEP = LOCALE === 'zh-Hant' ? '、' : ', ';
