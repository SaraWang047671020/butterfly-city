// First_Play_Guide (play-loop Requirement 8, approved design 2026-11-23): five callouts that point at a Policy_Card,
// the Apply control, the Next_Quarter_Action, a Go_There_Action and the City_Report button. Each step moves on when
// the player does that action (or presses Next), and "Skip guide" ends it. The guide never acts for the player (8.3).
// The callout is a manual popover, so it sits in the top layer; when a modal dialog opens after it, it is shown again
// so that it stays above the dialog it points into.
import { setText } from '../component.ts';
import { fillTemplate, UI_STRINGS } from '../strings.ts';
import '../../styles/guide.css';

const G = UI_STRINGS.guide;

/** One step: where it points (the first visible match wins) and which clicks move it on. */
interface Step {
  readonly targets: readonly string[];
  readonly advanceOn: string;
}

export const GUIDE_STEPS: readonly Step[] = [
  { targets: ['.ui-policy-card'], advanceOn: '.ui-policy-card' },
  { targets: ['.ui-policy-dialog__slider', '.ui-policy-dialog__select', '.ui-policy-card'], advanceOn: '.ui-policy-dialog__buttons .dialog__button--primary, .ui-policy-done' },
  { targets: ['.ui-block--turn-bar .turn-bar__button'], advanceOn: '.ui-block--turn-bar .turn-bar__controls .turn-bar__button' },
  { targets: ['.ui-brief__go', '.ui-brief-continue'], advanceOn: '.ui-brief__go, .ui-brief-continue' },
  { targets: ['.ui-report-button'], advanceOn: '.ui-report-button' },
];

export interface FirstPlayGuide {
  readonly root: HTMLElement;
  start(): void;
  stop(): void;
  running(): boolean;
}

const visible = (e: Element): boolean => {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

export function createFirstPlayGuide(doc: Document, texts: readonly string[], onDone: () => void): FirstPlayGuide {
  const root = doc.createElement('div');
  root.className = 'ui-guide';
  root.setAttribute('popover', 'manual');
  root.setAttribute('role', 'status');
  const count = doc.createElement('p');
  count.className = 'ui-guide__count';
  const text = doc.createElement('p');
  text.className = 'ui-guide__text';
  const row = doc.createElement('div');
  row.className = 'ui-guide__row';
  const skip = doc.createElement('button');
  skip.type = 'button';
  skip.className = 'ui-guide__skip';
  skip.textContent = G.skip;
  const next = doc.createElement('button');
  next.type = 'button';
  next.className = 'ui-guide__next';
  next.textContent = G.next;
  row.append(skip, next);
  root.append(count, text, row);

  let step = -1;
  let frame = 0;
  let openDialogs = 0;
  const win = doc.defaultView;

  const show = (): void => {
    try {
      if (root.matches(':popover-open')) root.hidePopover();
      root.showPopover();
    } catch {
      root.hidden = false; // no popover support: the callout still shows, below any modal dialog
    }
  };
  const hide = (): void => {
    try {
      if (root.matches(':popover-open')) root.hidePopover();
    } catch {
      root.hidden = true;
    }
  };

  const target = (): Element | null => {
    const s = GUIDE_STEPS[step];
    if (s === undefined) return null;
    for (const sel of s.targets) {
      const e = [...doc.querySelectorAll(sel)].find(visible);
      if (e !== undefined) return e;
    }
    return null;
  };

  const place = (): void => {
    if (step < 0 || win === null) return;
    // A modal dialog opened after the callout: show it again so it is above the dialog.
    const n = doc.querySelectorAll('dialog[open]').length;
    if (n > openDialogs) show();
    openDialogs = n;
    const t = target();
    root.classList.toggle('is-floating', t === null);
    if (t !== null) {
      const r = t.getBoundingClientRect();
      const w = root.offsetWidth;
      const h = root.offsetHeight;
      const above = r.top - h - 16 > 8;
      const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, 8), win.innerWidth - w - 8);
      const y = above ? r.top - h - 16 : Math.min(r.bottom + 16, win.innerHeight - h - 8);
      root.classList.toggle('is-below', !above);
      root.style.setProperty('--guide-x', `${Math.round(x)}px`);
      root.style.setProperty('--guide-y', `${Math.round(y)}px`);
      root.style.setProperty('--guide-arrow', `${Math.round(Math.min(Math.max(r.left + r.width / 2 - x, 16), w - 16))}px`);
      for (const e of doc.querySelectorAll('.ui-guide-target')) if (e !== t) e.classList.remove('ui-guide-target');
      t.classList.add('ui-guide-target');
    }
    frame = win.requestAnimationFrame(place);
  };

  const go = (n: number): void => {
    if (n >= GUIDE_STEPS.length) {
      stop();
      onDone();
      return;
    }
    step = n;
    setText(count, fillTemplate(G.step, { n: String(n + 1), total: String(GUIDE_STEPS.length) }));
    setText(text, texts[n] ?? '');
    next.textContent = n === GUIDE_STEPS.length - 1 ? G.done : G.next;
  };

  // The player's own clicks move the guide on; the click itself is never changed or repeated.
  const onClick = (e: MouseEvent): void => {
    if (step < 0) return;
    const s = GUIDE_STEPS[step];
    const el = e.target instanceof Element ? e.target : null;
    if (s !== undefined && el !== null && el.closest(s.advanceOn) !== null) win?.setTimeout(() => go(step + 1), 0);
  };

  const stop = (): void => {
    step = -1;
    if (win !== null) win.cancelAnimationFrame(frame);
    doc.removeEventListener('click', onClick, true);
    for (const e of doc.querySelectorAll('.ui-guide-target')) e.classList.remove('ui-guide-target');
    hide();
  };

  skip.addEventListener('click', () => {
    stop();
    onDone();
  });
  next.addEventListener('click', () => go(step + 1));

  return {
    root,
    start() {
      if (step >= 0) return;
      go(0);
      doc.addEventListener('click', onClick, true);
      openDialogs = doc.querySelectorAll('dialog[open]').length;
      show();
      if (win !== null) frame = win.requestAnimationFrame(place);
    },
    stop,
    running: () => step >= 0,
  };
}
