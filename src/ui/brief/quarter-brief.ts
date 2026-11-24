// Quarter_Brief (play-loop Requirement 6, approved design 2026-11-23): after a Computation_Run, and after any
// Event_Cards, a dialog lists up to 3 Brief_Items, each with a Go_There_Action where it has a district. The items and
// their order come from the Game_Controller (src/game/brief.ts); this block only words and shows them.
import type { QuarterKey } from '../../types/data-files.ts';
import type { BriefItemView, BriefView, UiActions } from '../../types/view.ts';
import { createDialogManager } from '../a11y/dialog.ts';
import type { Component } from '../component.ts';
import { formatNumber } from '../format/number.ts';
import { fillTemplate, quarterLabel, UI_STRINGS, unitLabel } from '../strings.ts';
import '../../styles/brief.css';

const B = UI_STRINGS.brief;

export interface GoThere {
  readonly district: string;
  readonly kind: 'site' | 'station' | 'centre';
}

export interface QuarterBriefProps {
  readonly brief: BriefView | null;
  /** Another dialog (Event_Cards, confirmations) is open; the brief waits for it (Requirement 4.3). */
  readonly blocked: boolean;
}

/** The Character's part of the brief (life-story Requirement 5.4): built for a quarter, shown above the Brief_Items. */
export interface BriefStoryHook {
  readonly build: (quarter: QuarterKey) => HTMLElement | null;
  /** Extra buttons of the action row, before Continue (My_Story). */
  readonly actions: () => readonly HTMLElement[];
}

export interface QuarterBrief extends Component<QuarterBriefProps> {
  readonly root: HTMLDialogElement;
  setStory(hook: BriefStoryHook | null): void;
}

/** Text of one Brief_Item. Pure; exported for tests. */
export function briefItemText(item: BriefItemView): { readonly text: string; readonly detail: string | null } {
  if (item.kind === 'completion') return { text: fillTemplate(B.completion, { units: formatNumber(item.units, 0), district: item.districtName }), detail: null };
  if (item.kind === 'major-event') return { text: fillTemplate(B.majorEvent, { title: item.title }), detail: null };
  if (item.kind === 'people') {
    const n = formatNumber(Math.abs(item.persons), 0);
    const text = fillTemplate(item.persons > 0 ? B.peopleMore : item.persons < 0 ? B.peopleFewer : B.peopleSame, { district: item.districtName, n });
    const sign = item.change > 0 ? '+' : item.change < 0 ? '−' : '';
    return { text, detail: fillTemplate(B.peopleSinceLast, { change: `${sign}${formatNumber(Math.abs(item.change), 0)}` }) };
  }
  const indicator = (UI_STRINGS.districtPanel.mapIndicators as Readonly<Record<string, string>>)[item.indicator] ?? item.indicator;
  const unit = unitLabel(item.unit);
  const diffUnit = item.percentPoints ? UI_STRINGS.districtPanel.units.percentagePoints : unit;
  const values = {
    indicator,
    district: item.districtName,
    value: formatNumber(item.value, item.decimals),
    unit,
    diff: formatNumber(Math.abs(item.diff), item.decimals),
    diffUnit,
  };
  const text = fillTemplate(item.diff > 0 ? B.up : item.diff < 0 ? B.down : B.same, values);
  const sign = item.change > 0 ? '+' : item.change < 0 ? '−' : '';
  const detail = fillTemplate(B.sinceLast, { change: `${sign}${formatNumber(Math.abs(item.change), item.decimals)}`, diffUnit });
  return { text, detail };
}

const ICON: Readonly<Record<BriefItemView['kind'], string>> = { completion: '⌂', 'major-event': '!', change: '%', people: '☺' };

export function createQuarterBrief(doc: Document, actions: UiActions, goThere: (place: GoThere) => void, fallbackFocus: () => HTMLElement | null): QuarterBrief {
  const dialog = createDialogManager(doc, fallbackFocus, UI_STRINGS.dialogs.close);
  dialog.root.classList.add('ui-brief-dialog');
  let shownKey: string | null = null;
  let story: BriefStoryHook | null = null;

  const close = (): void => {
    shownKey = null;
    if (dialog.isOpen()) dialog.close();
  };

  const build = (brief: BriefView): HTMLElement => {
    const body = doc.createElement('div');
    body.className = 'ui-brief';
    const mine = story?.build(brief.quarter) ?? null;
    if (mine !== null) body.append(mine);
    const list = doc.createElement('ul');
    list.className = 'ui-brief__items';
    if (brief.items.length === 0) {
      const p = doc.createElement('p');
      p.className = 'ui-brief__none';
      p.textContent = B.none;
      body.append(p);
    }
    for (const item of brief.items) {
      const li = doc.createElement('li');
      li.className = `ui-brief__item ui-brief__item--${item.kind}`;
      const icon = doc.createElement('span');
      icon.className = 'ui-brief__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = ICON[item.kind];
      const words = doc.createElement('div');
      words.className = 'ui-brief__words';
      const { text, detail } = briefItemText(item);
      const p = doc.createElement('p');
      p.className = 'ui-brief__text';
      p.textContent = text;
      words.append(p);
      if (detail !== null) {
        const d = doc.createElement('p');
        d.className = 'ui-brief__detail';
        d.textContent = detail;
        words.append(d);
      }
      li.append(icon, words);
      if (item.kind !== 'major-event') {
        const go = doc.createElement('button');
        go.type = 'button';
        go.className = 'dialog__button ui-brief__go ui-walk-action';
        go.textContent = B.goThere;
        go.setAttribute('aria-label', `${B.goThere}: ${item.districtName}`);
        const place: GoThere = { district: item.district, kind: item.kind === 'completion' ? 'site' : 'station' };
        go.addEventListener('click', () => {
          close();
          actions.dismissBrief();
          goThere(place);
        });
        li.append(go);
      }
      list.append(li);
    }
    if (brief.items.length > 0) body.append(list);
    const rule = doc.createElement('p');
    rule.className = 'ui-brief__rule';
    rule.textContent = B.rule;
    body.append(rule);
    return body;
  };

  const next = doc.createElement('button');
  next.type = 'button';
  next.className = 'dialog__button dialog__button--primary ui-brief-continue';
  next.textContent = B.continue;
  next.addEventListener('click', () => {
    close();
    actions.dismissBrief();
  });

  return {
    root: dialog.root,
    setStory(hook) {
      story = hook;
    },
    update({ brief, blocked }) {
      if (brief === null || blocked) {
        if (brief === null) close();
        else if (dialog.isOpen()) {
          // Event_Cards came first: hide the brief until they are dismissed.
          shownKey = null;
          dialog.close();
        }
        return;
      }
      const key = `${brief.quarter}|${brief.items.map((i) => (i.kind === 'major-event' ? i.id : `${i.kind}:${i.district}`)).join(',')}`;
      if (key === shownKey && dialog.isOpen()) return;
      shownKey = key;
      dialog.open({
        kicker: B.kicker,
        title: quarterLabel(brief.quarter),
        body: build(brief),
        actions: [...(story?.actions() ?? []), next],
        opener: null,
        onCancel: () => {
          close();
          actions.dismissBrief();
        },
        size: 'md',
      });
    },
  };
}
