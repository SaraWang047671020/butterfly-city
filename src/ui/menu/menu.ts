// Game menu (☰), approved design `docs/design-proposal/menu-proposal.html` (2026-11-24). Everything that is not
// needed every moment lives here: the policy tools, Fast-forward, My life, the City report, the city tools, save
// and settings. On a wide screen the menu is a side panel that leaves the city usable; on a narrow screen it fills
// the screen, the rest of the page is inert and focus stays inside, like a modal dialog. It is a panel, not a
// <dialog>, because the one dialog manager (play-loop Requirement 9) opens only modal dialogs.
import { focusableIn, wrapFocusIndex } from '../a11y/focus.ts';
import { UI_STRINGS } from '../strings.ts';
import '../../styles/menu.css';

export type MenuSection = 'turn' | 'me' | 'policy' | 'round' | 'city' | 'view' | 'settings' | 'note';

/** Width below which the menu fills the screen (the narrow layout of layout.css starts at the same width). */
export const NARROW_QUERY = '(max-width: 63.99rem)';

export interface GameMenu {
  /** The ☰ button with the quarter badge, placed by the caller. */
  readonly button: HTMLElement;
  readonly panel: HTMLElement;
  section(name: MenuSection): HTMLElement;
  open(): void;
  close(returnFocus: boolean): void;
  isOpen(): boolean;
  /** The Displayed_Quarter next to ☰ on a narrow screen (user decision A, 2026-11-24). */
  setQuarter(text: string): void;
  /** Marks ☰ when a policy needs attention (text, not only colour). */
  setAttention(on: boolean): void;
}

/**
 * The element focus goes to when a dialog closes and its opener is hidden in the closed menu: ☰ when the dialog was
 * opened from the menu (approved design: focus returns to ☰), else the Next quarter button when it is on screen,
 * otherwise ☰.
 */
export function mainFocusTarget(doc: Document): HTMLElement | null {
  const menuButton = doc.querySelector<HTMLElement>('.ui-menu-button');
  if (menuButton !== null && menuButton.hasAttribute('data-return-focus') && menuButton.getClientRects().length > 0) {
    menuButton.removeAttribute('data-return-focus');
    return menuButton;
  }
  for (const sel of ['.ui-block--turn-bar .turn-bar__controls .turn-bar__button', '.ui-menu-button']) {
    const e = doc.querySelector<HTMLElement>(sel);
    if (e !== null && e.getClientRects().length > 0) return e;
  }
  return null;
}

export function createGameMenu(doc: Document, inertRoots: () => readonly HTMLElement[], onToggle: (open: boolean) => void): GameMenu {
  const M = UI_STRINGS.menu;
  const win = doc.defaultView;
  const narrow = (): boolean => win?.matchMedia(NARROW_QUERY).matches ?? false;

  const wrap = doc.createElement('div');
  wrap.className = 'ui-menu-anchor';
  const quarter = doc.createElement('span');
  quarter.className = 'ui-menu-quarter';
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'ui-menu-button';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'ui-menu');
  const icon = doc.createElement('span');
  icon.className = 'ui-menu-button__icon';
  icon.setAttribute('aria-hidden', 'true');
  const dot = doc.createElement('span');
  dot.className = 'ui-menu-button__dot';
  dot.setAttribute('aria-hidden', 'true');
  button.append(icon, dot);
  wrap.append(quarter, button);

  const panel = doc.createElement('div');
  panel.className = 'ui-menu';
  panel.id = 'ui-menu';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', M.label);
  panel.hidden = true;
  const head = doc.createElement('div');
  head.className = 'ui-menu__head';
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'ui-menu__close';
  closeButton.setAttribute('aria-label', M.close);
  closeButton.textContent = '×';
  head.append(closeButton);
  panel.append(head);

  const titles: Partial<Record<MenuSection, string>> = {
    policy: M.policy,
    round: M.round,
    city: M.city,
    view: M.view,
    settings: M.settings,
  };
  const sections = new Map<MenuSection, HTMLElement>();
  for (const name of ['turn', 'me', 'policy', 'round', 'city', 'view', 'settings', 'note'] as const) {
    const sec = doc.createElement('section');
    sec.className = `ui-menu__section ui-menu__section--${name}`;
    const title = titles[name];
    if (title !== undefined) {
      const h = doc.createElement('h2');
      h.className = 'ui-menu__heading';
      h.textContent = title;
      sec.append(h);
      sec.setAttribute('aria-label', title);
    }
    const body = doc.createElement('div');
    body.className = 'ui-menu__body';
    sec.append(body);
    panel.append(sec);
    sections.set(name, body);
  }

  let attention = false;
  const label = (): void => {
    const open = !panel.hidden;
    button.setAttribute('aria-label', open ? M.close : attention ? `${M.label} · ${M.attention}` : M.label);
    button.title = attention && !open ? M.attention : '';
  };

  let inerted: HTMLElement[] = [];
  const setInert = (on: boolean): void => {
    for (const e of inerted) e.inert = false;
    inerted = on ? inertRoots().filter((e) => !e.contains(panel)) : [];
    for (const e of inerted) e.inert = true;
  };

  const open = (): void => {
    if (!panel.hidden) return;
    button.removeAttribute('data-return-focus');
    panel.hidden = false;
    const full = narrow();
    panel.classList.toggle('is-full', full);
    if (full) panel.setAttribute('aria-modal', 'true');
    else panel.removeAttribute('aria-modal');
    setInert(full);
    button.setAttribute('aria-expanded', 'true');
    label();
    onToggle(true);
    const first = focusableIn(panel).find((e) => e !== closeButton) ?? closeButton;
    first.focus();
  };

  const close = (returnFocus: boolean): void => {
    if (panel.hidden) return;
    const hadFocus = panel.contains(doc.activeElement);
    panel.hidden = true;
    setInert(false);
    button.setAttribute('aria-expanded', 'false');
    label();
    onToggle(false);
    if (returnFocus && (hadFocus || doc.activeElement === doc.body)) button.focus();
  };

  button.addEventListener('click', () => (panel.hidden ? open() : close(true)));
  closeButton.addEventListener('click', () => close(true));

  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== 'Tab' || !panel.classList.contains('is-full')) return;
    // Full-screen menu: Tab wraps inside, like the modal dialogs.
    const items = focusableIn(panel);
    const index = items.indexOf(doc.activeElement as HTMLElement);
    const atEdge = index === -1 || (e.shiftKey ? index === 0 : index === items.length - 1);
    if (atEdge && items.length > 0) {
      e.preventDefault();
      items[wrapFocusIndex(items.length, index, e.shiftKey)]?.focus();
    }
  });

  // An item that opens a dialog or changes the screen closes the menu; the view toggles keep it open.
  panel.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('button') : null;
    if (t === null || t === closeButton || t.closest('[data-menu-stay]') !== null) return;
    // A dialog opened from the menu gives focus back to ☰ when it closes (mainFocusTarget).
    button.setAttribute('data-return-focus', '');
    win?.setTimeout(() => close(false), 0);
  });

  // Wide screen: a click on the city or the page outside the panel closes it.
  doc.addEventListener('pointerdown', (e) => {
    if (panel.hidden || panel.classList.contains('is-full')) return;
    const t = e.target instanceof Node ? e.target : null;
    if (t !== null && !panel.contains(t) && !wrap.contains(t)) close(false);
  });

  // Changing between the side panel and the full screen while open: close, so inert and focus stay consistent.
  win?.matchMedia(NARROW_QUERY).addEventListener('change', () => close(false));

  label();
  return {
    button: wrap,
    panel,
    section: (name) => sections.get(name)!,
    open,
    close,
    isOpen: () => !panel.hidden,
    setQuarter(text) {
      if (quarter.textContent !== text) quarter.textContent = text;
    },
    setAttention(on) {
      if (on === attention) return;
      attention = on;
      button.classList.toggle('has-attention', on);
      label();
    },
  };
}
