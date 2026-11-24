// Character_Creation (play-loop Requirement 2, approved design 2026-11-23): a full-screen Dialog_Frame in four short
// steps (who, roots, work, home) with the Character's numbers of 2015Q1 and their sources beside every step, and a
// Random character control. Option texts come from the Character_File in the language of the locale.
import type { CharacterNumbers } from '../../game/life/numbers.ts';
import type { Character, LifeState, Look, PronounId } from '../../game/life/life-state.ts';
import { createDialogManager } from '../a11y/dialog.ts';
import { formatNumber } from '../format/number.ts';
import { cityLabel, fillTemplate, LOCALE, quarterLabel, UI_STRINGS } from '../strings.ts';
import '../../styles/character.css';

const U = UI_STRINGS.characterUi;

/** A text of the Character_File in both languages. */
export interface LocalText {
  readonly en: string;
  readonly 'zh-Hant': string;
}

export const pick = (t: LocalText | undefined): string => (t === undefined ? '' : LOCALE === 'zh-Hant' ? t['zh-Hant'] : t.en);

/** The parts of the Character_File and Wage_File the screen reads (structural: src/ui does not import src/data). */
export interface CreationFiles {
  readonly characters: {
    readonly origins: readonly { readonly id: string; readonly name: LocalText; readonly text: LocalText; readonly familyCity: string | null }[];
    readonly occupations: readonly {
      readonly id: string;
      readonly name: LocalText;
      readonly text: LocalText;
      readonly industry: string;
      readonly wageNote: LocalText;
      readonly workCodes: readonly string[];
    }[];
    readonly appearance: { readonly body: readonly string[]; readonly hair: readonly string[]; readonly colour: readonly string[] };
    readonly pronouns: Readonly<Record<PronounId, { readonly label: LocalText }>>;
    readonly creation: Readonly<Record<string, unknown>>;
  };
  readonly wages: { readonly earnings: Readonly<Record<string, Readonly<Record<string, number>>>> };
}

export interface CreationDeps {
  readonly files: CreationFiles;
  readonly districts: readonly { readonly code: string; readonly name: string; readonly city: string }[];
  /** Real rent per m² of a district in 2015Q1; null when missing. */
  readonly rent2015: (code: string) => number | null;
  /** Character_Numbers of a start state in 2015Q1 (real history). */
  readonly preview: (start: LifeState) => CharacterNumbers;
  readonly onConfirm: (c: Character) => void;
  readonly fallbackFocus: () => HTMLElement | null;
}

export interface CharacterCreation {
  readonly root: HTMLDialogElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

interface State {
  name: string;
  pronouns: PronounId;
  look: Look;
  origin: string;
  occupation: string;
  workCode: string;
  tenure: 'renting' | 'family';
  home: string;
}

const C = (files: CreationFiles, key: string): LocalText | undefined => files.characters.creation[key] as LocalText | undefined;

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, parent?: Element, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** A small seeded generator for Random character (no clock, no Math.random). */
function nextRandom(seed: { value: number }): number {
  seed.value = (seed.value * 1103515245 + 12345) % 2147483648;
  return seed.value / 2147483648;
}

export function createCharacterCreation(doc: Document, deps: CreationDeps): CharacterCreation {
  const files = deps.files;
  const ch = files.characters;
  const dialog = createDialogManager(doc, deps.fallbackFocus, UI_STRINGS.dialogs.close);
  dialog.root.classList.add('ui-creation-dialog');
  const seed = { value: 20151 };
  const firstOcc = ch.occupations[0]!;
  const state: State = {
    name: '',
    pronouns: 'they',
    look: { body: ch.appearance.body[1] ?? ch.appearance.body[0] ?? 'a', hair: ch.appearance.hair[1] ?? 'medium', colour: ch.appearance.colour[0] ?? 'teal' },
    origin: ch.origins[2]?.id ?? ch.origins[0]!.id,
    occupation: firstOcc.id,
    workCode: firstOcc.workCodes[0]!,
    tenure: 'renting',
    home: firstOcc.workCodes[0]!,
  };
  let step = 1;
  const nameOf = (code: string) => deps.districts.find((d) => d.code === code)?.name ?? code;
  const origin = () => ch.origins.find((o) => o.id === state.origin) ?? ch.origins[0]!;
  const occupation = () => ch.occupations.find((o) => o.id === state.occupation) ?? firstOcc;

  // ---- layout: stepper, the step panel, the side panel (preview and numbers)
  const body = el(doc, 'div', 'ui-creation');
  const intro = el(doc, 'p', 'ui-creation__intro', body, pick(C(files, 'intro')));
  void intro;
  const stepper = el(doc, 'ol', 'ui-creation__stepper', body);
  const steps = (C(files, 'steps') as unknown as Record<string, LocalText> | undefined) ?? {};
  const stepNames = ['who', 'roots', 'work', 'home'].map((k) => pick(steps[k]));
  const stepItems = stepNames.map((n, i) => el(doc, 'li', 'ui-creation__step', stepper, `${i + 1} · ${n}`));
  const grid = el(doc, 'div', 'ui-creation__grid', body);
  const main = el(doc, 'div', 'ui-creation__main', grid);
  const side = el(doc, 'aside', 'ui-creation__side', grid);
  const panels = [1, 2, 3, 4].map(() => el(doc, 'section', 'ui-creation__panel', main));

  // chips: a group of toggle buttons with aria-pressed
  const chipGroups: (() => void)[] = [];
  const chips = <T extends string>(parent: HTMLElement, label: string, options: readonly { readonly id: T; readonly label: string }[], get: () => T, set: (v: T) => void): void => {
    const group = el(doc, 'div', 'ui-creation__group', parent);
    const id = `ui-creation-${label.replace(/\W/g, '')}-${chipGroups.length}`;
    const h = el(doc, 'p', 'ui-creation__label', group, label);
    h.id = id;
    const row = el(doc, 'div', 'ui-creation__chips', group);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-labelledby', id);
    const buttons = options.map((o) => {
      const b = el(doc, 'button', 'ui-creation__chip', row, o.label);
      b.type = 'button';
      b.addEventListener('click', () => {
        set(o.id);
        refresh();
      });
      return { b, id: o.id };
    });
    chipGroups.push(() => {
      for (const x of buttons) x.b.setAttribute('aria-pressed', String(x.id === get()));
    });
  };

  // ---- step 1: name, pronouns, look
  const p1 = panels[0]!;
  const nameId = 'ui-creation-name';
  const nameLabel = el(doc, 'label', 'ui-creation__label', p1, U.name);
  nameLabel.htmlFor = nameId;
  const nameInput = el(doc, 'input', 'ui-creation__input', p1);
  nameInput.id = nameId;
  nameInput.maxLength = 20;
  nameInput.autocomplete = 'off';
  const nameError = el(doc, 'p', 'ui-creation__error', p1, U.nameRequired);
  nameError.id = `${nameId}-error`;
  nameError.hidden = true;
  nameInput.addEventListener('input', () => {
    state.name = nameInput.value;
    nameError.hidden = true;
    nameInput.removeAttribute('aria-invalid');
    refreshSide();
  });
  chips(p1, U.pronouns, (['she', 'he', 'they'] as const).map((id) => ({ id, label: pick(ch.pronouns[id]?.label) })), () => state.pronouns, (v) => (state.pronouns = v));
  el(doc, 'p', 'ui-creation__note', p1, pick(C(files, 'pronounNote')));
  const B = U.bodies as Readonly<Record<string, string>>;
  const H = U.hairs as Readonly<Record<string, string>>;
  const K = U.colours as Readonly<Record<string, string>>;
  chips(p1, U.body, ch.appearance.body.map((id) => ({ id, label: B[id] ?? id })), () => state.look.body, (v) => (state.look = { ...state.look, body: v }));
  chips(p1, U.hair, ch.appearance.hair.map((id) => ({ id, label: H[id] ?? id })), () => state.look.hair, (v) => (state.look = { ...state.look, hair: v }));
  chips(p1, U.colour, ch.appearance.colour.map((id) => ({ id, label: K[id] ?? id })), () => state.look.colour, (v) => (state.look = { ...state.look, colour: v }));

  // ---- step 2: origin
  const p2 = panels[1]!;
  const originCards = ch.origins.map((o) => {
    const b = el(doc, 'button', 'ui-creation__card', p2);
    b.type = 'button';
    el(doc, 'span', 'ui-creation__card-title', b, pick(o.name));
    el(doc, 'span', 'ui-creation__card-text', b, pick(o.text));
    b.addEventListener('click', () => {
      state.origin = o.id;
      if (o.familyCity === null) state.tenure = 'renting';
      refresh();
    });
    return { b, id: o.id };
  });

  // ---- step 3: occupation and work district
  const p3 = panels[2]!;
  const occGrid = el(doc, 'div', 'ui-creation__cards', p3);
  const occCards = ch.occupations.map((o) => {
    const b = el(doc, 'button', 'ui-creation__card', occGrid);
    b.type = 'button';
    el(doc, 'span', 'ui-creation__card-title', b, pick(o.name));
    el(doc, 'span', 'ui-creation__card-text', b, pick(o.text));
    const w = files.wages.earnings[o.industry]?.['2015'];
    el(doc, 'span', 'ui-creation__card-wage', b, w === undefined ? U.noValue : fillTemplate(U.wage, { wage: formatNumber(w, 0), year: '2015' }));
    b.addEventListener('click', () => {
      state.occupation = o.id;
      state.workCode = o.workCodes[0]!;
      refresh();
    });
    return { b, id: o.id };
  });
  const wageNote = el(doc, 'p', 'ui-creation__note', p3);
  const workHost = el(doc, 'div', 'ui-creation__work', p3);

  // ---- step 4: tenure and home district
  const p4 = panels[3]!;
  const tenureHost = el(doc, 'div', '', p4);
  const homeId = 'ui-creation-home';
  const homeLabel = el(doc, 'label', 'ui-creation__label', p4, U.district);
  homeLabel.htmlFor = homeId;
  const homeSelect = el(doc, 'select', 'ui-creation__select', p4);
  homeSelect.id = homeId;
  homeSelect.addEventListener('change', () => {
    state.home = homeSelect.value;
    refreshSide();
  });

  // ---- side: preview figure and numbers
  const figure = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  figure.setAttribute('viewBox', '0 0 120 150');
  figure.setAttribute('class', 'ui-creation__figure');
  figure.setAttribute('aria-hidden', 'true');
  side.appendChild(figure);
  const who = el(doc, 'p', 'ui-creation__who', side);
  const box = el(doc, 'div', 'ui-creation__numbers', side);
  const youIn = el(doc, 'p', 'ui-creation__label', box, fillTemplate(U.youIn, { quarter: quarterLabel('2015Q1') }));
  void youIn;
  const nums = el(doc, 'div', 'ui-creation__figures', box);
  const burdenBig = el(doc, 'p', 'ui-creation__big', nums);
  const commuteBig = el(doc, 'p', 'ui-creation__big', nums);
  const srcWage = el(doc, 'p', 'ui-creation__src', box);
  const srcHome = el(doc, 'p', 'ui-creation__src', box);

  const drawFigure = (): void => {
    const width = state.look.body === 'a' ? 46 : state.look.body === 'c' ? 74 : 60;
    const hair: Record<string, string> = {
      short: 'M38 36 Q60 8 82 36 L82 30 Q60 4 38 30 Z',
      medium: 'M36 40 Q60 0 84 40 L84 52 Q80 30 60 26 Q40 30 36 52 Z',
      long: 'M34 40 Q60 -2 86 40 L88 86 Q78 60 78 40 Q60 26 42 40 Q42 60 32 86 Z',
      tied: 'M38 36 Q60 8 82 36 L82 30 Q60 4 38 30 Z M80 22 a8 8 0 1 0 0.1 0',
      none: '',
    };
    figure.innerHTML = `<circle cx="60" cy="40" r="22" class="ui-creation__skin"/>${
      hair[state.look.hair] ? `<path d="${hair[state.look.hair]}" class="ui-creation__hair"/>` : ''
    }<rect x="${60 - width / 2}" y="68" width="${width}" height="80" rx="${width / 2.4}" class="ui-creation__cloth ui-look--${state.look.colour}"/>`;
  };

  const start = (): LifeState => ({
    home: state.home,
    tenure: state.tenure,
    married: false,
    members: [{ kind: 'self', occupation: state.occupation, workCode: state.workCode, pronouns: state.pronouns, look: state.look }],
  });

  const refreshSide = (): void => {
    drawFigure();
    const o = origin();
    who.textContent = [state.name.trim(), pick(ch.pronouns[state.pronouns]?.label), pick(o.name)].filter((t) => t !== '').join(' · ');
    const n = deps.preview(start());
    burdenBig.innerHTML = '';
    el(doc, 'span', 'ui-creation__value', burdenBig, n.rentBurden === null ? U.noValue : `${formatNumber(n.rentBurden, 1)}%`);
    el(doc, 'span', 'ui-creation__unit', burdenBig, U.ofIncome);
    commuteBig.innerHTML = '';
    if (n.commuteMinutes === null) el(doc, 'span', 'ui-creation__unit', commuteBig, U.noTrip);
    else {
      el(doc, 'span', 'ui-creation__value', commuteBig, formatNumber(n.commuteMinutes, 0));
      el(doc, 'span', 'ui-creation__unit', commuteBig, U.toWork);
    }
    const occ = occupation();
    const w = files.wages.earnings[occ.industry]?.['2015'];
    srcWage.textContent = w === undefined ? '' : fillTemplate(pick(C(files, 'wageLine')), { year: '2015', wage: formatNumber(w, 0), source: 'DGBAS' });
    const rent = deps.rent2015(state.home);
    srcHome.textContent =
      state.tenure === 'family'
        ? fillTemplate(pick(C(files, 'familyLine')), { district: nameOf(state.home) })
        : fillTemplate(pick(C(files, 'homeLine')), {
            district: nameOf(state.home),
            rentPerM2: rent === null ? U.noValue : formatNumber(rent, 0),
            size: formatNumber(n.size, 0),
            rent: n.rent === null ? U.noValue : formatNumber(n.rent, 0),
          });
  };

  const refresh = (): void => {
    for (const g of chipGroups) g();
    for (const c of originCards) c.b.setAttribute('aria-pressed', String(c.id === state.origin));
    for (const c of occCards) c.b.setAttribute('aria-pressed', String(c.id === state.occupation));
    wageNote.textContent = pick(occupation().wageNote);
    // work districts of the occupation
    workHost.replaceChildren();
    const occ = occupation();
    chipsInto(workHost, U.workWhere, occ.workCodes.map((code) => ({ id: code, label: nameOf(code) })), () => state.workCode, (v) => (state.workCode = v));
    // tenure: "with family" only for an origin with a family city
    tenureHost.replaceChildren();
    const fam = origin().familyCity;
    if (fam !== null) {
      chipsInto(tenureHost, U.tenure, [{ id: 'renting', label: U.renting }, { id: 'family', label: U.family }], () => state.tenure, (v) => (state.tenure = v as State['tenure']));
    } else state.tenure = 'renting';
    // home districts: all, or the family city's for living with family; sorted by 2015Q1 rent
    const allowed = deps.districts.filter((d) => state.tenure !== 'family' || d.city === fam);
    if (!allowed.some((d) => d.code === state.home)) state.home = allowed[0]?.code ?? state.home;
    const byCity = new Map<string, typeof allowed>();
    for (const d of [...allowed].sort((a, b) => (deps.rent2015(a.code) ?? Infinity) - (deps.rent2015(b.code) ?? Infinity))) {
      byCity.set(d.city, [...(byCity.get(d.city) ?? []), d]);
    }
    homeSelect.replaceChildren(
      ...[...byCity.entries()].map(([city, list]) => {
        const og = doc.createElement('optgroup');
        og.label = cityLabel(city);
        for (const d of list) {
          const r = deps.rent2015(d.code);
          const o = el(doc, 'option', '', og, `${d.name} · ${r === null ? U.noValue : fillTemplate(U.rentPerM2, { rent: formatNumber(r, 0) })}`);
          o.value = d.code;
        }
        return og;
      }),
    );
    homeSelect.value = state.home;
    refreshSide();
  };

  // chip groups rebuilt on refresh (work districts, tenure): not kept in chipGroups
  const chipsInto = (parent: HTMLElement, label: string, options: readonly { readonly id: string; readonly label: string }[], get: () => string, set: (v: string) => void): void => {
    const group = el(doc, 'div', 'ui-creation__group', parent);
    const h = el(doc, 'p', 'ui-creation__label', group, label);
    h.id = `ui-creation-group-${label.length}-${parent.className.length}`;
    const row = el(doc, 'div', 'ui-creation__chips', group);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-labelledby', h.id);
    for (const o of options) {
      const b = el(doc, 'button', 'ui-creation__chip', row, o.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(o.id === get()));
      b.addEventListener('click', () => {
        set(o.id);
        refresh();
        (workHost.contains(b) ? workHost : tenureHost).querySelector<HTMLButtonElement>(`button[aria-pressed="true"]`)?.focus();
      });
    }
  };

  // ---- footer
  const random = el(doc, 'button', 'dialog__button ui-creation__random', undefined, pick(C(files, 'random')));
  random.type = 'button';
  const back = el(doc, 'button', 'dialog__button', undefined, U.back);
  back.type = 'button';
  const next = el(doc, 'button', 'dialog__button dialog__button--primary', undefined, U.next);
  next.type = 'button';

  const showStep = (n: number): void => {
    step = n;
    panels.forEach((p, i) => (p.hidden = i !== n - 1));
    stepItems.forEach((li, i) => {
      li.classList.toggle('is-on', i === n - 1);
      li.classList.toggle('is-done', i < n - 1);
      if (i === n - 1) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    back.hidden = n === 1;
    next.textContent = n === 4 ? pick(C(files, 'confirm')) : U.next;
    panels[n - 1]?.querySelector<HTMLElement>('input, button, select')?.focus();
  };

  const nameOk = (): boolean => {
    const t = state.name.trim();
    return t.length >= 1 && t.length <= 20;
  };

  next.addEventListener('click', () => {
    if (step === 1 && !nameOk()) {
      nameError.hidden = false;
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.setAttribute('aria-describedby', nameError.id);
      nameInput.focus();
      return;
    }
    if (step < 4) {
      showStep(step + 1);
      return;
    }
    deps.onConfirm({ name: state.name.trim(), origin: state.origin, start: start() });
    dialog.close();
  });
  back.addEventListener('click', () => showStep(Math.max(1, step - 1)));
  random.addEventListener('click', () => {
    const r = () => nextRandom(seed);
    const any = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
    state.pronouns = any(['she', 'he', 'they'] as const);
    state.look = { body: any(ch.appearance.body), hair: any(ch.appearance.hair), colour: any(ch.appearance.colour) };
    const o = any(ch.origins);
    state.origin = o.id;
    const occ = any(ch.occupations);
    state.occupation = occ.id;
    state.workCode = any(occ.workCodes);
    state.tenure = o.familyCity !== null && r() < 0.5 ? 'family' : 'renting';
    const homes = deps.districts.filter((d) => state.tenure !== 'family' || d.city === o.familyCity);
    state.home = any(homes).code;
    if (!nameOk()) {
      const names = LOCALE === 'zh-Hant' ? ['小雨', '阿哲', '佳穎', '承恩', '子晴', '冠廷'] : ['Mei', 'Kai', 'Yu', 'Jun', 'An', 'Lin'];
      state.name = any(names);
      nameInput.value = state.name;
    }
    refresh();
    showStep(4);
  });

  return {
    root: dialog.root,
    open() {
      nameInput.value = state.name;
      refresh();
      dialog.open({
        kicker: undefined,
        title: pick(C(files, 'title')),
        body,
        actions: [random, back, next],
        opener: null,
        onCancel: () => undefined, // a new game needs a Character: Escape does not close the screen
        closable: false,
        size: 'full',
      });
      showStep(step);
    },
    close: () => dialog.close(),
    isOpen: () => dialog.isOpen(),
  };
}
