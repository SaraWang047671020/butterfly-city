// Timeline_View items (Requirement 11). Display grouping only: no simulation formulas.

import type { DistrictCode, QuarterKey } from '../../types/data-files.ts';
import type { EventCard } from '../../types/events-file.ts';
import type { EventCardView, TimelineItemView, TimelineQuarterView } from '../../types/view.ts';
import { quarterIndex } from '../../simulation/quarter.ts';
import { LAST_QUARTER } from '../../simulation/constants.ts';
import { completionItems } from './construction.ts';
import type { GameSession } from './session.ts';

function cardView(card: EventCard): EventCardView {
  return {
    id: card.id,
    type: card.type,
    firstQuarter: card.firstQuarter,
    lastQuarter: card.lastQuarter,
    title: card.title,
    description: card.description,
    sources: card.sources.map((s) => ({ name: s.label, url: s.url })),
    major: card.major,
  };
}

/**
 * Headings run from 2015Q1 to the Planning_Quarter (2025Q4 when complete), only for quarters with items.
 * Per quarter: Event_Cards of a Computed_Quarter in events.json order, Completion_Items by district name,
 * then Timeline_Entries in applied order. Only Major_Event items carry `major: true`.
 * `names` maps district codes to romanized names for the Completion_Item order.
 */
export function timelineItems(
  session: GameSession,
  names: ReadonlyMap<DistrictCode, string> = new Map(),
): readonly TimelineQuarterView[] {
  const last = session.next === 'complete' ? LAST_QUARTER : session.next;
  const lastIndex = quarterIndex(last);
  const states = session.computed?.central ?? [];
  const lastComputed = states[states.length - 1];
  const computedIndex = lastComputed === undefined ? -1 : quarterIndex(lastComputed.quarter);

  const byQuarter = new Map<QuarterKey, TimelineItemView[]>();
  const add = (q: QuarterKey, item: TimelineItemView): void => {
    const list = byQuarter.get(q);
    if (list === undefined) byQuarter.set(q, [item]);
    else list.push(item);
  };

  for (const card of session.cards) {
    const i = quarterIndex(card.firstQuarter);
    if (i > computedIndex || i > lastIndex) continue;
    add(card.firstQuarter, { kind: 'event', card: cardView(card), major: card.major });
  }
  for (const item of completionItems(states, names)) {
    if (quarterIndex(item.effect) > lastIndex) continue;
    add(item.effect, { kind: 'completion', item, major: false });
  }
  session.timeline.forEach((e, index) => {
    add(e.quarter, {
      kind: 'entry',
      index,
      entryKind: e.kind,
      tool: e.tool,
      field: e.field,
      area: e.area,
      before: e.before,
      after: e.after,
      major: false,
    });
  });

  return [...byQuarter.entries()]
    .sort((a, b) => quarterIndex(a[0]) - quarterIndex(b[0]))
    .map(([quarter, items]) => ({ quarter, items }));
}
