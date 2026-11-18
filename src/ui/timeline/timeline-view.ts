// Timeline_View: quarter headings with Event_Cards, Completion_Items and Timeline_Entries (game-ui Requirement 11).
// Independent block: no page layout, no position, no visual values here. Class names are styled in src/styles.
// Event card text is shown as given by the view model, with no added text.
import type { DistrictCode } from '../../types/data-files.ts';
import type { EventCardView, TimelineItemView, TimelineQuarterView, UiActions } from '../../types/view.ts';
import { reconcileKeyed, setText, type Component, type ComponentFactory } from '../component.ts';
import { formatNumber } from '../format/number.ts';
import { fillTemplate, UI_STRINGS } from '../strings.ts';
import { fieldLabel, formatAmount, toolName } from '../panels/policy-text.ts';
import '../../styles/timeline.css';

const T = UI_STRINGS.timeline;

export interface TimelineViewProps {
  readonly quarters: readonly TimelineQuarterView[];
  /** Display names of districts by code. Optional; the code is shown when absent. */
  readonly areaNames?: ReadonlyMap<DistrictCode, string>;
}

function itemKey(item: TimelineItemView): string {
  switch (item.kind) {
    case 'event':
      return `event:${item.card.id}`;
    case 'completion':
      return `completion:${item.item.district}:${item.item.committed}:${item.item.effect}`;
    case 'entry':
      return `entry:${item.index}`;
  }
}

function isWikipedia(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('wikipedia.org');
  } catch {
    return false;
  }
}

function renderEvent(doc: Document, li: HTMLElement, card: EventCardView, major: boolean): void {
  li.replaceChildren();
  li.className = 'timeline__item timeline__item--event';
  if (major) {
    const badge = doc.createElement('p');
    badge.className = 'timeline__major';
    const icon = doc.createElement('span');
    icon.className = 'timeline__major-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u25C6';
    const label = doc.createElement('span');
    label.textContent = T.majorEvent;
    badge.append(icon, label);
    li.append(badge);
  }
  const date = doc.createElement('p');
  date.className = 'timeline__date';
  date.textContent = card.firstQuarter === card.lastQuarter ? card.firstQuarter : `${card.firstQuarter} - ${card.lastQuarter}`;
  const title = doc.createElement('h4');
  title.className = 'timeline__title';
  title.textContent = card.title;
  const description = doc.createElement('p');
  description.className = 'timeline__description';
  description.textContent = card.description;
  li.append(date, title, description);

  if (card.sources.length > 0) {
    const list = doc.createElement('ul');
    list.className = 'timeline__sources';
    for (const source of card.sources) {
      const item = doc.createElement('li');
      const a = doc.createElement('a');
      a.className = 'timeline__link';
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = source.name;
      item.append(a);
      list.append(item);
    }
    li.append(list);
  }
  if (card.sources.some((s) => isWikipedia(s.url))) {
    const note = doc.createElement('p');
    note.className = 'timeline__attribution';
    note.textContent = T.wikipediaAttribution;
    li.append(note);
  }
}

function entryText(item: Extract<TimelineItemView, { kind: 'entry' }>, areaNames: TimelineViewProps['areaNames']): string {
  const area = areaNames?.get(item.area as DistrictCode) ?? item.area;
  const after =
    item.entryKind === 'real-track'
      ? fillTemplate(T.realTrack, { value: item.after === null ? formatNumber(null, 0) : formatAmount(item.after) })
      : formatAmount(item.after ?? Number.NaN);
  return fillTemplate(T.entry, {
    tool: toolName(item.tool),
    field: fieldLabel(item.tool, item.field),
    area,
    before: formatAmount(item.before),
    after,
  });
}

/** Timeline_View component. `update` takes the quarter list and optional district display names. */
export const createTimelineView: ComponentFactory<TimelineViewProps> = (
  doc: Document,
  actions: UiActions,
): Component<TimelineViewProps> => {
  const root = doc.createElement('section');
  root.className = 'timeline';
  root.setAttribute('aria-label', T.heading);

  const heading = doc.createElement('h3');
  heading.className = 'timeline__heading';
  heading.textContent = T.heading;

  const empty = doc.createElement('p');
  empty.className = 'timeline__empty';
  empty.textContent = T.empty;

  const quarterList = doc.createElement('ol');
  quarterList.className = 'timeline__quarters';
  root.append(heading, empty, quarterList);

  interface QuarterParts {
    readonly li: HTMLElement;
    readonly title: HTMLElement;
    readonly items: HTMLElement;
    readonly cache: Map<string, HTMLElement>;
    readonly signature: Map<string, string>;
  }
  const quarterCache = new Map<string, HTMLElement>();
  const parts = new Map<string, QuarterParts>();

  const createQuarter = (key: string): HTMLElement => {
    const li = doc.createElement('li');
    li.className = 'timeline__quarter';
    const title = doc.createElement('h4');
    title.className = 'timeline__quarter-heading';
    const items = doc.createElement('ul');
    items.className = 'timeline__items';
    li.append(title, items);
    parts.set(key, { li, title, items, cache: new Map(), signature: new Map() });
    return li;
  };

  return {
    root,
    update(view: TimelineViewProps): void {
      empty.hidden = view.quarters.length > 0;
      reconcileKeyed(
        quarterList,
        quarterCache,
        view.quarters.map((q) => q.quarter),
        createQuarter,
      );
      for (const key of [...parts.keys()]) if (!quarterCache.has(key)) parts.delete(key);

      for (const q of view.quarters) {
        const p = parts.get(q.quarter);
        if (p === undefined) continue;
        setText(p.title, fillTemplate(T.quarterHeading, { quarter: q.quarter }));
        const keys = q.items.map(itemKey);
        reconcileKeyed(p.items, p.cache, keys, (key) => {
          const li = doc.createElement('li');
          li.dataset['key'] = key;
          return li;
        });
        for (const key of [...p.signature.keys()]) if (!p.cache.has(key)) p.signature.delete(key);

        q.items.forEach((item, i) => {
          const key = keys[i] as string;
          const li = p.cache.get(key);
          if (li === undefined) return;
          if (item.kind === 'event') {
            const sig = JSON.stringify([item.card, item.major]);
            if (p.signature.get(key) !== sig) {
              renderEvent(doc, li, item.card, item.major);
              p.signature.set(key, sig);
            }
          } else if (item.kind === 'completion') {
            li.className = 'timeline__item timeline__item--completion';
            setText(
              li,
              fillTemplate(T.completion, {
                district: item.item.districtName,
                units: formatAmount(Math.abs(item.item.difference)),
              }),
            );
          } else {
            li.className = 'timeline__item timeline__item--entry';
            let button = li.firstElementChild as HTMLButtonElement | null;
            if (button === null) {
              button = doc.createElement('button');
              button.type = 'button';
              button.className = 'timeline__entry';
              const index = item.index;
              button.addEventListener('click', () => actions.selectTimelineEntry(index));
              li.append(button);
            }
            setText(button, entryText(item, view.areaNames));
          }
        });
      }
    },
  };
};
