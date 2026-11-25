// The Character's life story on screen (life-story task 5, approved Design_Proposal
// docs/design-proposal/life-story-proposal.html, decisions A and B1): the Life_Event dialog, the story part of the
// Quarter_Brief (Story_Lines, the Application result with the Shared_Draw, the Two_Me_Panel), My_Story and the
// Ending. Everything shown comes from the LifeController's story model; this module only words and lays it out.
import type { ApplicationSupply, City, Eligibility, Track } from '../../game/life/applications.ts';
import { realOdds } from '../../game/life/applications.ts';
import type { CharacterView, ChooseResult } from '../../game/life/controller.ts';
import type { LifeEventId } from '../../game/life/events.ts';
import type { PersonalLedger } from '../../game/life/ledger.ts';
import type { Benefit, LifeDecision, PronounId } from '../../game/life/life-state.ts';
import { quarterStory, endingPart, type StoryFormat, type StoryLine } from '../../game/life/story.ts';
import type { ChoicePayload, OptionView, PendingEvent } from '../../game/life/story-model.ts';

/** A text in both languages (the Life_Event_File and Life_Story_File shape; src/ui does not import src/data). */
export interface LocalText {
  readonly en: string;
  readonly 'zh-Hant': string;
}
type EventOption = OptionView['option'];
import type { QuarterKey } from '../../types/data-files.ts';
import { createDialogManager } from '../a11y/dialog.ts';
import { formatNumber } from '../format/number.ts';
import { fillTemplate, LOCALE, quarterLabel, UI_STRINGS } from '../strings.ts';
import '../../styles/life-story.css';

const L = UI_STRINGS.lifeStory;
const T = L.twoMe;

export interface StoryUiDeps {
  readonly view: () => CharacterView | null;
  /** The template of the Life_Story_File at a dotted key (`difference.rentLower`); null when missing. */
  readonly template: (key: string) => LocalText | null;
  readonly keepLabel: LocalText;
  readonly supply: ApplicationSupply;
  readonly pick: (t: LocalText | undefined) => string;
  readonly districts: readonly { readonly code: string; readonly name: string; readonly city: string }[];
  readonly occupations: readonly { readonly id: string; readonly name: LocalText; readonly workCodes: readonly string[] }[];
  /** Pronoun labels and the partner texts of the Character_File (the partner picker reuses them). */
  readonly pronounLabel: (p: PronounId) => string;
  readonly partnerTexts: { readonly sameSexQuestion: string; readonly sameSexNote: string };
  readonly choose: (event: LifeEventId, option: string, payload: ChoicePayload) => ChooseResult;
  readonly previewChoice: (decisions: readonly LifeDecision[]) => Readonly<Record<Track, PersonalLedger>> | null;
  readonly announce: (text: string) => void;
  readonly fallbackFocus: () => HTMLElement | null;
  /** Mean monthly pay of an occupation's industry in a year (Wage_File); null when missing. */
  readonly wageOf: (occupation: string, year: number) => number | null;
  /** The sourced gender lines of the Ending (Application_Supply_File `gender`), already in the App's language. */
  readonly genderLines: readonly string[];
}

/**
 * Share of commuters (and students) who use public transport in 2016, for the `passLaunch` Life_Event text.
 * Source: MOTC, 111年民眾日常使用運具狀況調查摘要分析, 附表6 (data/research/life-story-rent-subsidy-2026-11-24.md §6a).
 */
const TRANSIT_SHARE_2016: Readonly<Record<City, number>> = { Taipei: 47.6, 'New Taipei': 34.0 };

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, parent?: Element, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className !== '') e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const money = (n: number): string => `NT$${formatNumber(Math.round(n), 0)}`;

/** An occupation inside an English sentence: "a cram school teacher" (the names are written as titles). */
export function occupationInSentence(name: string): string {
  if (LOCALE !== 'en' || name === '') return name;
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  return `${/^[aeiou]/i.test(lower) ? 'an' : 'a'} ${lower}`;
}
const pct = (n: number): string => formatNumber(n, 1);

/** Formats Story_Line values in the language of the App. */
export function storyFormat(d: StoryUiDeps, events: () => readonly { readonly id: string; readonly options: readonly EventOption[] }[]): StoryFormat {
  const names = new Map(d.districts.map((x) => [x.code, x.name]));
  return {
    money,
    percent: pct,
    minutes: (n) => formatNumber(Math.round(n), 0),
    count: (n) => formatNumber(n, 0),
    odds: (p) => formatNumber(p * 100, 1),
    draw: (x) => x.toFixed(3),
    district: (c) => names.get(c) ?? c,
    city: (c) => (UI_STRINGS.cityNames as Readonly<Record<string, string>>)[c] ?? c,
    quarter: quarterLabel,
    occupation: (id) => occupationInSentence(d.pick(d.occupations.find((o) => o.id === id)?.name)),
    option: (e, o) => d.pick(events().find((x) => x.id === e)?.options.find((x) => x.id === o)?.title).replace(/[…]$|\.\.\.$/, ''),
    rule: (e) => ruleText(e),
  };
}

function ruleText(e: Eligibility): string {
  if (e.ok) return '';
  if (e.rule === 'income') return fillTemplate(L.rules.income, { value: money(e.value), limit: money(e.limit) });
  return L.rules[e.rule];
}

/** Fills one template of the Life_Story_File in the language of the App. */
function fillKey(d: StoryUiDeps, key: string, values: Readonly<Record<string, string>>): string {
  const t = d.template(key);
  return t === null ? '' : fillTemplate(d.pick(t), values);
}

/** A Story_Line as one paragraph. */
export function lineText(d: StoryUiDeps, line: StoryLine): string {
  // Chinese sentences follow each other without a space; English ones with one.
  return line.map((p) => fillKey(d, p.key, p.values)).join(LOCALE === 'zh-Hant' ? '' : ' ');
}

// ---------------------------------------------------------------- odds bars (Application, decision B1)

interface Bars {
  readonly benefit: Benefit;
  readonly odds: Readonly<Record<Track, number>>;
  readonly supply: Readonly<Record<Track, number>>;
  readonly draw: number | null;
  readonly success: Readonly<Record<Track, boolean>> | null;
}

function oddsBars(doc: Document, b: Bars, rule: string | null): HTMLElement {
  const box = el(doc, 'div', 'ls-odds');
  const top = Math.max(b.odds.player, b.odds.real, b.draw ?? 0, 0.01) * 1.25;
  const share = (x: number) => `${Math.min(100, (x / top) * 100).toFixed(2)}%`;
  for (const t of ['player', 'real'] as const) {
    const bar = el(doc, 'div', `ls-bar ls-bar--${t}`, box);
    const fill = el(doc, 'div', 'ls-bar__fill', bar);
    fill.style.width = share(b.odds[t]);
    const track = t === 'player' ? L.yourCity : L.realHistory;
    let label = fillTemplate(b.benefit === 'socialHousing' ? L.supplySocialHousing : b.benefit === 'sublease' ? L.supplySublease : L.supplyRentSubsidy, {
      track,
      supply: formatNumber(Math.round(b.supply[t]), 0),
      odds: formatNumber(b.odds[t] * 100, 1),
    });
    if (b.success !== null) {
      const yes = b.benefit === 'socialHousing' ? L.allocated : b.benefit === 'sublease' ? L.matched : L.approved;
      const no = b.benefit === 'socialHousing' ? L.notAllocated : b.benefit === 'sublease' ? L.notMatched : L.notApproved;
      label = `${fillTemplate(L.oddsShort, { track, odds: formatNumber(b.odds[t] * 100, 1) })} · ${b.success[t] ? yes : no}`;
    }
    el(doc, 'span', 'ls-bar__label', bar, label);
    if (b.draw !== null) {
      const mark = el(doc, 'span', 'ls-bar__draw', bar);
      mark.style.left = share(b.draw);
      mark.setAttribute('aria-hidden', 'true');
    }
  }
  if (b.draw !== null) el(doc, 'p', 'ls-legend', box, fillTemplate(L.drawLegend, { draw: b.draw.toFixed(3) }));
  if (rule !== null) el(doc, 'p', 'ls-legend', box, rule);
  return box;
}

function oddsRule(d: StoryUiDeps, benefit: Benefit, city: City, quarter: QuarterKey): string {
  const year = Number(quarter.slice(0, 4));
  const rule = benefit === 'socialHousing' ? L.oddsRuleSocialHousing : benefit === 'sublease' ? L.oddsRuleSublease : L.oddsRuleRentSubsidy;
  return fillTemplate(rule, {
    city: (UI_STRINGS.cityNames as Readonly<Record<string, string>>)[city] ?? city,
    year: String(year),
    real: formatNumber(realOdds(d.supply, benefit, city, year) * 100, 1),
  });
}

// ---------------------------------------------------------------- Two_Me_Panel (Requirement 4.3)

function diffWords(a: number | null, b: number | null, kind: 'money' | 'points' | 'minutes', lowerIsLess = true): string {
  if (a === null || b === null) return '—';
  const d = a - b;
  const step = kind === 'money' ? 100 : kind === 'points' ? 0.05 : 0.5;
  if (Math.abs(d) < step) return T.same;
  const v = kind === 'money' ? money(Math.abs(d)) : kind === 'points' ? pct(Math.abs(d)) : formatNumber(Math.round(Math.abs(d)), 0);
  if (kind === 'points') return fillTemplate(d < 0 ? T.lower : T.higher, { value: v });
  if (kind === 'minutes') return fillTemplate(d < 0 ? T.shorter : T.longer, { value: v });
  return fillTemplate(d < 0 === lowerIsLess ? T.less : T.more, { value: v });
}

export function twoMePanel(doc: Document, d: StoryUiDeps, name: string, quarter: QuarterKey, ledgers: Readonly<Record<Track, PersonalLedger>>, homes: Readonly<Record<Track, string>>, rentShare: number | null): HTMLElement {
  const names = new Map(d.districts.map((x) => [x.code, x.name]));
  const wrap = el(doc, 'div', 'ls-twome');
  const table = el(doc, 'table', '', wrap);
  table.setAttribute('aria-label', fillTemplate(T.label, { quarter: quarterLabel(quarter) }));
  const head = el(doc, 'tr', '', el(doc, 'thead', '', table));
  el(doc, 'th', '', head, quarterLabel(quarter)).setAttribute('scope', 'col');
  el(doc, 'th', 'ls-you', head, fillTemplate(L.inYourCity, { name })).setAttribute('scope', 'col');
  el(doc, 'th', 'ls-real', head, fillTemplate(L.inRealHistory, { name })).setAttribute('scope', 'col');
  el(doc, 'th', '', head, T.difference).setAttribute('scope', 'col');
  const body = el(doc, 'tbody', '', table);
  const p = ledgers.player;
  const r = ledgers.real;
  const home = (t: Track) => {
    const l = ledgers[t];
    const tpl = l.housing === 'social' ? T.social : l.housing === 'sublease' ? T.sublease : l.housing === 'family' ? T.family : T.renting;
    return fillTemplate(tpl, { district: names.get(homes[t]) ?? homes[t] });
  };
  const row = (label: string, a: string, b: string, diff: string, why?: string) => {
    const tr = el(doc, 'tr', '', body);
    el(doc, 'th', '', tr, label).setAttribute('scope', 'row');
    el(doc, 'td', 'ls-n', tr, a);
    el(doc, 'td', 'ls-n', tr, b);
    const td = el(doc, 'td', 'ls-diff', tr, diff);
    if (why !== undefined) {
      const det = el(doc, 'details', 'ls-why', td);
      el(doc, 'summary', '', det, T.why);
      el(doc, 'p', '', det, why);
    }
  };
  const m = (x: number | null) => (x === null ? '—' : money(x));
  row(T.home, home('player'), home('real'), homes.player === homes.real && p.housing === r.housing ? T.same : T.different);
  row(
    T.rent,
    m(p.rent),
    m(r.rent),
    diffWords(p.rent, r.rent, 'money'),
    fillTemplate(T.whyRent, {
      share: rentShare === null ? '—' : formatNumber(rentShare * 100, 0),
      marketPlayer: m(p.marketRent),
      marketReal: m(r.marketRent),
      subsidyPlayer: money(p.subsidy),
      subsidyReal: money(r.subsidy),
    }),
  );
  row(T.burden, p.rentBurden === null ? '—' : `${pct(p.rentBurden)}%`, r.rentBurden === null ? '—' : `${pct(r.rentBurden)}%`, diffWords(p.rentBurden, r.rentBurden, 'points'));
  const mins = (x: number | null) => (x === null ? '—' : fillTemplate(T.minutes, { value: formatNumber(Math.round(x), 0) }));
  row(T.commute, mins(p.commuteMinutes), mins(r.commuteMinutes), diffWords(p.commuteMinutes, r.commuteMinutes, 'minutes'), T.whyCommute);
  const pass = (x: number | null) => (x === null ? T.noPass : money(x));
  row(T.pass, pass(p.transport), pass(r.transport), diffWords(p.transport ?? 0, r.transport ?? 0, 'money'), p.transport === null ? T.singleFares : undefined);
  row(
    T.left,
    m(p.left),
    m(r.left),
    diffWords(p.left, r.left, 'money', false),
    fillTemplate(T.whyLeft, {
      incomePlayer: m(p.income),
      rentPlayer: m(p.rent),
      passPlayer: money(p.transport ?? 0),
      incomeReal: m(r.income),
      rentReal: m(r.rent),
      passReal: money(r.transport ?? 0),
    }),
  );
  return wrap;
}

// ---------------------------------------------------------------- Quarter_Brief part (Requirement 5.4, 4.5)

/** Story_Lines, the Application result and the Two_Me_Panel of a computed quarter; null without a story. */
export function briefStory(doc: Document, d: StoryUiDeps, quarter: QuarterKey, format: StoryFormat): HTMLElement | null {
  const v = d.view();
  const model = v?.story ?? null;
  if (v === null || model === null) return null;
  const k = model.inputs.findIndex((x) => x.quarter === quarter);
  if (k < 0) return null;
  const input = { ...model.inputs[k]!, name: v.character.name };
  const box = el(doc, 'section', 'ls-brief');
  for (const line of quarterStory(input, format)) el(doc, 'p', 'ls-story', box, lineText(d, line));
  const o = input.outcome;
  if (o !== null && o.eligibility.ok) {
    box.append(oddsBars(doc, { benefit: o.benefit, odds: o.odds, supply: o.supply, draw: o.draw, success: o.success }, null));
  }
  box.append(twoMePanel(doc, d, v.character.name, quarter, input.ledgers, { player: input.states.player.home, real: input.states.real.home }, input.rentShare));
  return box;
}

// ---------------------------------------------------------------- Life_Event dialog (Requirement 2.4, 2.5)

export interface LifeEventDialog {
  readonly root: HTMLDialogElement;
  /** Opens the dialog WHEN a Life_Event is pending and not shown yet; `canOpen` says no other dialog is in the way. */
  update(canOpen: boolean): void;
  isOpen(): boolean;
}

function eventValues(d: StoryUiDeps, v: CharacterView, p: PendingEvent): Record<string, string> {
  const f = p.facts;
  const names = new Map(d.districts.map((x) => [x.code, x.name]));
  const occ = (id: string | null | undefined) => d.pick(d.occupations.find((o) => o.id === id)?.name);
  const reasonKey = f.reason === null ? null : (p.event.reasons?.[f.reason] ?? null);
  const base: Record<string, string> = {
    name: v.character.name,
    district: names.get(f.district) ?? f.district,
    work: f.work === null ? '' : (names.get(f.work) ?? f.work),
    city: f.city === null ? '' : ((UI_STRINGS.cityNames as Readonly<Record<string, string>>)[f.city] ?? f.city),
    rentBurden: f.rentBurden === null ? '—' : pct(f.rentBurden),
    commute: f.commute === null ? '—' : formatNumber(Math.round(f.commute), 0),
    income: f.incomeYear === null ? '—' : money(f.incomeYear),
    incomePerPerson: f.incomePerPerson === null ? '—' : money(f.incomePerPerson),
    limit: f.limit === null ? '—' : money(f.limit),
    rentShare: formatNumber(Math.round(d.supply.sublease.rentShare * 100), 0),
    years: f.years === null ? '—' : formatNumber(f.years, 0),
    amount: f.subsidyAmount === null ? '—' : money(f.subsidyAmount),
    offerOccupation: f.offer === null ? '' : occupationInSentence(occ(f.offer.occupation)),
    offerDistrict: f.offer === null ? '' : (names.get(f.offer.workCode) ?? f.offer.workCode),
    offerWage: (() => {
      const w = f.offer === null ? null : d.wageOf(f.offer.occupation, Number(p.quarter.slice(0, 4)));
      return w === null ? '—' : money(w);
    })(),
    year: p.quarter.slice(0, 4),
    share: f.city === null ? '—' : pct(TRANSIT_SHARE_2016[f.city]),
    partnerName: UI_STRINGS.characterUi.memberPartner,
    lawFact: '',
  };
  base['reason'] = reasonKey === null ? '' : fillTemplate(d.pick(reasonKey), base);
  return base;
}

/** The picker of an option that needs a district, a job or a partner. Returns a getter of the payload. */
function picker(doc: Document, d: StoryUiDeps, v: CharacterView, o: OptionView, host: HTMLElement, onChange: () => void): () => ChoicePayload | null {
  const e = o.option.effect;
  const form = el(doc, 'div', 'ls-picker', host);
  const select = (label: string, items: readonly { id: string; label: string }[]): HTMLSelectElement => {
    const wrap = el(doc, 'label', 'ls-picker__field', form);
    el(doc, 'span', '', wrap, label);
    const s = el(doc, 'select', '', wrap);
    el(doc, 'option', '', s, L.pickPrompt).value = '';
    for (const it of items) {
      const opt = el(doc, 'option', '', s, it.label);
      opt.value = it.id;
    }
    s.addEventListener('change', onChange);
    return s;
  };
  const story = v.story;
  const city = story?.pending?.facts.city ?? null;
  if (e.kind === 'pickMove' || e.kind === 'move') {
    const family = e['tenure'] === 'family';
    const tenure: 'renting' | 'family' = family ? 'family' : 'renting';
    const familyCity = d.districts.find((x) => x.code === v.life.home)?.city ?? null;
    const list = d.districts.filter((x) => (family ? x.city === (city ?? familyCity) : true) && x.code !== (family ? '' : v.planningLife.home));
    const byCommute = o.id === 'closer';
    const items = list.map((x) => {
      const pv = d.previewChoice([{ kind: 'move', home: x.code, tenure }]);
      const r = (l: PersonalLedger) => (l.rent === null ? '—' : money(l.rent));
      const c = (l: PersonalLedger) => (l.commuteMinutes === null ? '—' : fillTemplate(T.minutes, { value: formatNumber(Math.round(l.commuteMinutes), 0) }));
      const info = pv === null ? '' : ` — ${L.previewRent} ${r(pv.player)} / ${r(pv.real)} · ${T.commute} ${c(pv.player)}`;
      const sort = pv === null ? 0 : byCommute ? (pv.player.commuteMinutes ?? 0) : (pv.player.rent ?? 0);
      return { id: x.code, label: `${x.name}${info}`, sort };
    });
    items.sort((a, b) => a.sort - b.sort);
    const s = select(L.pickDistrict, items);
    return () => (s.value === '' ? null : { home: s.value });
  }
  const occSelect = select(
    L.pickOccupation,
    d.occupations.map((x) => ({ id: x.id, label: d.pick(x.name) })),
  );
  const workWrap = el(doc, 'label', 'ls-picker__field', form);
  el(doc, 'span', '', workWrap, L.pickWork);
  const work = el(doc, 'select', '', workWrap);
  const names = new Map(d.districts.map((x) => [x.code, x.name]));
  const fillWork = () => {
    const occ = d.occupations.find((x) => x.id === occSelect.value);
    work.replaceChildren();
    el(doc, 'option', '', work, L.pickPrompt).value = '';
    for (const c of occ?.workCodes ?? []) el(doc, 'option', '', work, names.get(c) ?? c).value = c;
  };
  occSelect.addEventListener('change', fillWork);
  work.addEventListener('change', onChange);
  fillWork();
  if (e.kind === 'pickJob') {
    return () => (occSelect.value === '' || work.value === '' ? null : { occupation: occSelect.value, workCode: work.value });
  }
  const pron = select(
    L.pickPronouns,
    (['she', 'he', 'they'] as const).map((id) => ({ id, label: d.pronounLabel(id) })),
  );
  const same = select(d.partnerTexts.sameSexQuestion, [
    { id: 'no', label: UI_STRINGS.characterUi.no },
    { id: 'yes', label: UI_STRINGS.characterUi.yes },
  ]);
  el(doc, 'p', 'ls-legend', form, d.partnerTexts.sameSexNote);
  return () =>
    occSelect.value === '' || work.value === '' || pron.value === '' || same.value === ''
      ? null
      : {
          partner: {
            occupation: occSelect.value,
            workCode: work.value,
            pronouns: pron.value as PronounId,
            look: { body: 'b', hair: 'medium', colour: 'amber' },
            sameSexInLaw: same.value === 'yes',
          },
        };
}

export function createLifeEventDialog(doc: Document, d: StoryUiDeps): LifeEventDialog {
  const dialog = createDialogManager(doc, d.fallbackFocus, UI_STRINGS.dialogs.close);
  dialog.root.classList.add('ls-event-dialog');
  let shownKey: string | null = null;
  const confirm = el(doc, 'button', 'dialog__button dialog__button--primary', undefined, L.confirm);
  confirm.type = 'button';

  const open = (v: CharacterView, p: PendingEvent): void => {
    const values = eventValues(d, v, p);
    const body = el(doc, 'div', 'ls-event');
    el(doc, 'p', 'ls-story', body, fillTemplate(d.pick(p.event.text), values));
    const apply = p.options.find((o) => o.odds !== null && o.available);
    if (apply?.odds != null && p.facts.city !== null) {
      body.append(oddsBars(doc, { benefit: apply.odds.benefit, odds: apply.odds.odds, supply: apply.odds.supply, draw: null, success: null }, oddsRule(d, apply.odds.benefit, p.facts.city, p.quarter)));
    }
    const group = el(doc, 'div', 'ls-options', body);
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', fillTemplate(d.pick(p.event.title), values));
    const radios: HTMLInputElement[] = [];
    const payloads = new Map<string, () => ChoicePayload | null>();
    let chosen: string | null = null;
    const sync = () => {
      const o = p.options.find((x) => x.id === chosen);
      const get = chosen === null ? undefined : payloads.get(chosen);
      confirm.disabled = o === undefined || !o.available || (get !== undefined && get() === null);
    };
    for (const o of p.options) {
      const card = el(doc, 'label', `ls-option${o.available ? '' : ' is-blocked'}`, group);
      const radio = el(doc, 'input', 'ls-option__radio', card);
      radio.type = 'radio';
      radio.name = 'ls-option';
      radio.value = o.id;
      radio.disabled = !o.available;
      radios.push(radio);
      const words = el(doc, 'span', 'ls-option__words', card);
      el(doc, 'span', 'ls-option__name', words, fillTemplate(d.pick(o.option.title), values));
      el(doc, 'span', 'ls-option__desc', words, fillTemplate(d.pick(o.option.text), values));
      if (!o.available) {
        const why =
          o.block === 'ineligible' && o.eligibility !== null
            ? fillTemplate(L.unavailable.ineligible, { rule: ruleText(o.eligibility) })
            : o.block === 'family'
              ? L.unavailable.family
              : L.unavailable.law;
        el(doc, 'span', 'ls-option__block', words, why);
      }
      const vs = el(doc, 'span', 'ls-option__vs', card);
      if (o.odds !== null) {
        el(doc, 'span', 'ls-k', vs, L.yourCity);
        el(doc, 'span', 'ls-you', vs, `${formatNumber(o.odds.odds.player * 100, 1)}%`);
        el(doc, 'span', 'ls-k', vs, L.realHistory);
        el(doc, 'span', 'ls-real', vs, `${formatNumber(o.odds.odds.real * 100, 1)}%`);
      } else if (o.preview !== null && o.option.effect.kind !== 'leave') {
        const r = (l: PersonalLedger) => (l.rent === null ? '—' : money(l.rent));
        el(doc, 'span', 'ls-k', vs, `${L.previewRent} · ${L.yourCity}`);
        el(doc, 'span', 'ls-you', vs, r(o.preview.player));
        el(doc, 'span', 'ls-k', vs, L.realHistory);
        el(doc, 'span', 'ls-real', vs, r(o.preview.real));
      }
      if (o.available && o.preview === null && o.odds === null && o.option.effect.kind !== 'none') {
        const slot = el(doc, 'div', 'ls-option__picker', card);
        slot.hidden = true;
        payloads.set(o.id, picker(doc, d, v, o, slot, sync));
      }
      radio.addEventListener('change', () => {
        chosen = o.id;
        for (const slot of group.querySelectorAll<HTMLElement>('.ls-option__picker')) slot.hidden = !slot.parentElement?.contains(radio);
        sync();
      });
    }
    const first = p.options[0]!;
    const keepTitle = fillTemplate(d.pick(first.option.title), values);
    el(doc, 'p', 'ls-legend', body, fillTemplate(d.pick(d.keepLabel), { option: keepTitle }));
    const first0 = radios.find((r) => !r.disabled);
    if (first0 !== undefined) {
      first0.checked = true;
      chosen = first0.value;
    }
    sync();
    const answer = (option: string, escaped: boolean): void => {
      const get = payloads.get(option);
      const payload = get === undefined ? {} : (get() ?? {});
      const r = d.choose(p.event.id, option, payload);
      if (!r.ok) return;
      const title = fillTemplate(d.pick(p.options.find((x) => x.id === option)?.option.title), values);
      dialog.close();
      d.announce(fillTemplate(escaped ? L.escaped : L.chosen, { option: title }));
    };
    confirm.onclick = () => {
      if (chosen !== null) answer(chosen, false);
    };
    dialog.open({
      kicker: fillTemplate(L.kicker, { quarter: quarterLabel(p.quarter) }),
      title: fillTemplate(d.pick(p.event.title), values),
      body,
      actions: [confirm],
      opener: null,
      // Escape chooses the first option, which keeps things as they are (Requirement 2.5).
      onCancel: () => answer(first.id, true),
      size: 'md',
      closable: false,
    });
  };

  return {
    root: dialog.root,
    isOpen: () => dialog.isOpen(),
    update(canOpen) {
      const v = d.view();
      const p = v?.story?.pending ?? null;
      if (v === null || p === null) {
        shownKey = null;
        if (dialog.isOpen()) dialog.close();
        return;
      }
      const key = `${p.quarter}:${p.event.id}`;
      if (!canOpen || key === shownKey) return;
      shownKey = key;
      open(v, p);
    },
  };
}

// ---------------------------------------------------------------- My_Story (Requirement 5.5)

export interface StoryPage {
  readonly root: HTMLDialogElement;
  open(opener: HTMLElement | null): void;
}

export function createMyStory(doc: Document, d: StoryUiDeps, format: StoryFormat, openEnding: () => void): StoryPage {
  const dialog = createDialogManager(doc, d.fallbackFocus, UI_STRINGS.dialogs.close);
  dialog.root.classList.add('ls-page-dialog');
  const M = L.myStory;
  return {
    root: dialog.root,
    open(opener) {
      const v = d.view();
      const model = v?.story ?? null;
      if (v === null || model === null) return;
      const body = el(doc, 'div', 'ls-page');
      const main = el(doc, 'div', 'ls-timeline', body);
      if (model.inputs.length === 0) el(doc, 'p', 'ls-legend', main, M.empty);
      let year = '';
      for (const input of model.inputs) {
        const y = input.quarter.slice(0, 4);
        if (y !== year) {
          year = y;
          el(doc, 'h3', 'ls-year', main, y);
        }
        const row = el(doc, 'div', 'ls-quarter', main);
        el(doc, 'div', 'ls-quarter__q', row, input.quarter.slice(4));
        const text = el(doc, 'div', '', row);
        // My_Story leaves out "the same as real history": a quarter without a difference reads as its situation.
        for (const line of quarterStory({ ...input, name: v.character.name }, format)) {
          const parts = line.filter((part) => part.key !== 'difference.same');
          if (parts.length > 0) el(doc, 'p', 'ls-story', text, lineText(d, parts));
        }
      }
      const side = el(doc, 'aside', 'ls-side', body);
      const last = model.rows.player[model.rows.player.length - 1];
      const card = el(doc, 'div', 'ls-card', side);
      const range = fillTemplate(M.range, { from: quarterLabel('2015Q1'), quarter: last === undefined ? '' : quarterLabel(last.quarter) });
      el(doc, 'h3', '', card, fillTemplate(M.soFar, { range }));
      const kv = el(doc, 'dl', 'ls-kv', card);
      for (const t of ['player', 'real'] as const) {
        const total = model.rows[t].reduce((a, r) => a + (r.ledger.rent ?? 0) * 3, 0);
        el(doc, 'dt', '', kv, `${M.rentPaid} · ${t === 'player' ? L.yourCity : L.realHistory}`);
        el(doc, 'dd', t === 'player' ? 'ls-you' : 'ls-real', kv, money(total));
      }
      const apps = el(doc, 'div', 'ls-card', side);
      el(doc, 'h3', '', apps, M.applications);
      if (model.resolved.outcomes.length === 0) el(doc, 'p', 'ls-legend', apps, M.none);
      for (const o of model.resolved.outcomes) {
        const yes = o.benefit === 'socialHousing' ? L.allocated : L.approved;
        const no = o.benefit === 'socialHousing' ? L.notAllocated : L.notApproved;
        el(
          doc,
          'p',
          'ls-legend',
          apps,
          `${quarterLabel(o.quarter)}: ${L.yourCity} ${o.success.player ? yes : no} · ${L.realHistory} ${o.success.real ? yes : no}`,
        );
      }
      const actions: HTMLElement[] = [];
      if (model.ending !== null) {
        const b = el(doc, 'button', 'dialog__button', undefined, M.ending);
        b.type = 'button';
        b.addEventListener('click', () => {
          dialog.close();
          openEnding();
        });
        actions.push(b);
      }
      dialog.open({ title: fillTemplate(M.title, { name: v.character.name }), kicker: range, body, actions, opener, size: 'full' });
    },
  };
}

// ---------------------------------------------------------------- Ending (Requirement 6)

export interface EndingPage extends StoryPage {
  /** Opens the Ending once WHEN the story has ended and nothing else is open. */
  update(canOpen: boolean): void;
}

function burdenChart(doc: Document, rows: Readonly<Record<Track, readonly { readonly ledger: PersonalLedger }[]>>, label: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1180 160');
  svg.setAttribute('class', 'ls-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const n = Math.max(rows.player.length, 2);
  const values = [...rows.player, ...rows.real].map((r) => r.ledger.rentBurden ?? 0);
  const top = Math.max(40, ...values) * 1.1;
  const x = (i: number) => 40 + (i * 1120) / (n - 1);
  const y = (v: number) => 140 - (v / top) * 130;
  const line = doc.createElementNS(NS, 'line');
  line.setAttribute('x1', '40');
  line.setAttribute('x2', '1160');
  line.setAttribute('y1', String(y(30)));
  line.setAttribute('y2', String(y(30)));
  line.setAttribute('class', 'ls-chart__line30');
  svg.append(line);
  for (const t of ['real', 'player'] as const) {
    const pl = doc.createElementNS(NS, 'polyline');
    pl.setAttribute('points', rows[t].map((r, i) => `${x(i).toFixed(1)},${y(r.ledger.rentBurden ?? 0).toFixed(1)}`).join(' '));
    pl.setAttribute('class', `ls-chart__${t}`);
    svg.append(pl);
  }
  for (let k = 0; k < n; k += 4) {
    const tx = doc.createElementNS(NS, 'text');
    tx.setAttribute('x', String(x(k)));
    tx.setAttribute('y', '158');
    tx.setAttribute('class', 'ls-chart__year');
    tx.textContent = String(2015 + k / 4);
    svg.append(tx);
  }
  return svg;
}

export function createEnding(doc: Document, d: StoryUiDeps, format: StoryFormat, readStory: () => void, newGame: () => void): EndingPage {
  const dialog = createDialogManager(doc, d.fallbackFocus, UI_STRINGS.dialogs.close);
  dialog.root.classList.add('ls-page-dialog');
  const E = L.ending;
  let shownKey: string | null = null;
  const open = (opener: HTMLElement | null) => {
    const v = d.view();
    const model = v?.story ?? null;
    if (v === null || model === null || model.ending === null) return;
    const name = v.character.name;
    const body = el(doc, 'div', 'ls-ending');
    const cols = el(doc, 'div', 'ls-ending__cols', body);
    for (const t of ['player', 'real'] as const) {
      const s = model.ending[t];
      const col = el(doc, 'section', 'ls-card', cols);
      el(doc, 'h3', t === 'player' ? 'ls-you' : 'ls-real', col, fillTemplate(t === 'player' ? L.inYourCity : L.inRealHistory, { name }));
      const part = endingPart(name, s, format);
      el(doc, 'p', 'ls-story', col, fillKey(d, part.key, part.values));
      const kv = el(doc, 'dl', 'ls-kv', col);
      const add = (k: string, val: string) => {
        el(doc, 'dt', '', kv, k);
        el(doc, 'dd', '', kv, val);
      };
      add(E.totalRent, money(s.totalRent));
      add(E.meanBurden, s.meanBurden === null ? '—' : `${pct(s.meanBurden)}%`);
      add(E.meanCommute, s.meanCommute === null ? '—' : fillTemplate(T.minutes, { value: formatNumber(Math.round(s.meanCommute), 0) }));
      add(E.totalLeft, money(s.totalLeft));
    }
    const chart = el(doc, 'section', 'ls-card', body);
    el(doc, 'h3', '', chart, E.chart);
    const last = model.rows.player[model.rows.player.length - 1];
    chart.append(burdenChart(doc, model.rows, fillTemplate(E.chartLabel, { quarter: last === undefined ? '' : quarterLabel(last.quarter) })));
    // The lines are named in words, not by colour only (Requirement 8.3).
    const legend = el(doc, 'p', 'ls-legend', chart);
    el(doc, 'span', 'ls-you', legend, `— ${L.yourCity}`);
    legend.append(' · ');
    el(doc, 'span', 'ls-real', legend, `— ${L.realHistory}`);
    const gender = el(doc, 'section', 'ls-card', body);
    const g = (key: string) => d.template(key);
    el(doc, 'h3', '', gender, d.pick(g('ending.gender.heading') ?? undefined));
    for (const line of d.genderLines) el(doc, 'p', 'ls-legend', gender, line);
    const read = el(doc, 'button', 'dialog__button', undefined, E.readStory);
    read.type = 'button';
    read.addEventListener('click', () => {
      dialog.close();
      readStory();
    });
    const again = el(doc, 'button', 'dialog__button dialog__button--primary', undefined, E.newGame);
    again.type = 'button';
    again.addEventListener('click', () => {
      dialog.close();
      newGame();
    });
    const title = g('ending.title');
    dialog.open({ title: title === null ? name : fillTemplate(d.pick(title), { name }), body, actions: [read, again], opener, size: 'full' });
  };
  return {
    root: dialog.root,
    open,
    update(canOpen) {
      const v = d.view();
      const e = v?.story?.ending ?? null;
      if (e === null) {
        shownKey = null;
        return;
      }
      const key = `${v!.character.name}:${e.player.leftIn ?? 'complete'}`;
      if (!canOpen || key === shownKey) return;
      shownKey = key;
      open(null);
    },
  };
}
