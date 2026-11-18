import type { Announcement } from '../../types/view.ts';
import type { Component } from '../component.ts';

/** Pure: a live region writes only when the announcement id is new (Requirements 17.7, 17.8). */
export function isNewAnnouncement(lastId: number | null, next: Announcement | null): next is Announcement {
  return next !== null && next.id !== lastId;
}

/**
 * Two visually hidden live elements. Polite and assertive text goes to its own element.
 * The caller supplies `toText`, which builds the message from strings.ts and format/ (this module holds no strings).
 * The `ui-visually-hidden` class is styled in src/styles (task 16.10).
 */
export function createLiveRegion(
  doc: Document,
  toText: (announcement: Announcement) => string,
): Component<Announcement | null> {
  const root = doc.createElement('div');
  root.className = 'ui-live-region';
  const make = (politeness: 'polite' | 'assertive'): HTMLElement => {
    const el = doc.createElement('div');
    el.className = 'ui-visually-hidden';
    el.setAttribute('aria-live', politeness);
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');
    root.appendChild(el);
    return el;
  };
  const polite = make('polite');
  const assertive = make('assertive');
  let lastId: number | null = null;

  return {
    root,
    update(view) {
      if (!isNewAnnouncement(lastId, view)) return;
      lastId = view.id;
      const target = view.politeness === 'assertive' ? assertive : polite;
      target.textContent = toText(view);
    },
  };
}
