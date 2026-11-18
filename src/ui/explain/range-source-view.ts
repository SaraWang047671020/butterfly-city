// Range_Source_View block (game-ui Requirement 20). Independent: mounted into a host by the outer container
// (the dialog manager supplies the dialog shell and title). No page layout, no position.
import type { Component } from '../component.ts';
import type { RangeSourceView } from '../../types/view.ts';
import { rangeSourceText } from './range-source-text.ts';
import type { AssumptionText, RangeSourceText } from './range-source-text.ts';

export const RANGE_SOURCE_CLASS = 'range-source';

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderAssumption(doc: Document, a: AssumptionText): HTMLElement {
  const li = el(doc, 'li', 'range-source__assumption');
  li.appendChild(el(doc, 'div', 'range-source__param', a.line));
  li.appendChild(el(doc, 'div', 'range-source__citation', a.citation));
  if (a.url !== null) {
    const link = el(doc, 'a', 'range-source__link', a.url);
    link.setAttribute('href', a.url);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    li.appendChild(link);
  } else {
    li.appendChild(el(doc, 'div', 'range-source__link range-source__link--none', a.urlText));
  }
  return li;
}

function render(doc: Document, root: HTMLElement, t: RangeSourceText): void {
  const nodes: HTMLElement[] = [];
  nodes.push(el(doc, 'p', 'range-source__display', t.display));
  if (t.sameText !== null) nodes.push(el(doc, 'p', 'range-source__same', t.sameText));
  for (const s of t.sections) {
    const sec = el(doc, 'section', 'range-source__section');
    sec.appendChild(el(doc, 'h3', 'range-source__heading', s.heading));
    sec.appendChild(el(doc, 'p', 'range-source__result', s.resultText));
    const ul = el(doc, 'ul', 'range-source__list');
    for (const a of s.assumptions) ul.appendChild(renderAssumption(doc, a));
    sec.appendChild(ul);
    nodes.push(sec);
  }
  nodes.push(el(doc, 'p', 'range-source__about', t.about));
  const cause = el(doc, 'section', 'range-source__cause');
  const btn = el(doc, 'button', 'range-source__cause-button', t.causeBreakdown.label);
  btn.type = 'button';
  btn.disabled = true;
  btn.setAttribute('aria-disabled', 'true');
  cause.appendChild(btn);
  nodes.push(cause);
  root.replaceChildren(...nodes);
}

/** Creates the block. `update(null)` empties it. */
export function createRangeSourceView(doc: Document): Component<RangeSourceView | null> {
  const root = el(doc, 'div', RANGE_SOURCE_CLASS);
  return {
    root,
    update(view) {
      if (view === null) root.replaceChildren();
      else render(doc, root, rangeSourceText(view));
    },
  };
}
