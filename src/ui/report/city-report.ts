// City_Report (play-loop Requirement 7, approved design 2026-11-23): a full-screen Dialog_Frame with tabs that hold
// the detail that left the main screen. Each tab is a host the outer container mounts existing components into;
// the hosts live as long as the App, so the components keep updating while the report is closed.
import { createDialogManager } from '../a11y/dialog.ts';

export interface CityReport {
  /** The dialog element; the outer container mounts it. */
  readonly root: HTMLDialogElement;
  /** Adds a tab and returns its panel host. `onShow` runs each time the tab is shown (lazy content). */
  addTab(name: string, title: string, onShow?: (host: HTMLElement) => void): HTMLElement;
  /** A row above the tabs for report-wide controls (the language control). */
  readonly tools: HTMLElement;
  open(tab: string | null, opener: HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
  /** Shows a tab without opening the report (keyboard and pointer use the tab buttons). */
  select(tab: string): void;
}

let reportCounter = 0;

export function createCityReport(doc: Document, strings: { readonly title: string; readonly close: string; readonly tabsLabel: string }, fallbackFocus: () => HTMLElement | null): CityReport {
  const dialog = createDialogManager(doc, fallbackFocus, strings.close);
  dialog.root.classList.add('ui-report');
  const id = ++reportCounter;
  const body = doc.createElement('div');
  body.className = 'ui-report__body';
  const tools = doc.createElement('div');
  tools.className = 'ui-report__tools';
  const tablist = doc.createElement('div');
  tablist.className = 'ui-report__tabs';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', strings.tabsLabel);
  const panels = doc.createElement('div');
  panels.className = 'ui-report__panels';
  body.append(tools, tablist, panels);

  const tabs: { name: string; button: HTMLButtonElement; panel: HTMLElement; onShow?: (host: HTMLElement) => void }[] = [];
  let current: string | null = null;

  const select = (name: string): void => {
    const t = tabs.find((x) => x.name === name) ?? tabs[0];
    if (t === undefined) return;
    current = t.name;
    for (const x of tabs) {
      const on = x === t;
      x.button.setAttribute('aria-selected', String(on));
      x.button.tabIndex = on ? 0 : -1;
      x.panel.hidden = !on;
    }
    t.onShow?.(t.panel);
  };

  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  tablist.addEventListener('keydown', (e) => {
    const i = tabs.findIndex((x) => x.name === current);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const t = tabs[next]!;
    select(t.name);
    t.button.focus();
  });

  return {
    root: dialog.root,
    tools,
    addTab(name, title, onShow) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ui-report__tab';
      button.id = `ui-report-${id}-tab-${name}`;
      button.setAttribute('role', 'tab');
      button.textContent = title;
      const panel = doc.createElement('div');
      panel.className = `ui-report__panel ui-report__panel--${name}`;
      panel.id = `ui-report-${id}-panel-${name}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      panel.tabIndex = 0;
      button.setAttribute('aria-controls', panel.id);
      button.addEventListener('click', () => select(name));
      tablist.appendChild(button);
      panels.appendChild(panel);
      tabs.push({ name, button, panel, onShow });
      if (current === null) select(name);
      else panel.hidden = true;
      return panel;
    },
    open(tab, opener) {
      if (tab !== null) select(tab);
      else if (current !== null) select(current);
      dialog.open({ title: strings.title, body, opener, size: 'full' });
      tabs.find((x) => x.name === current)?.button.focus();
    },
    close: () => dialog.close(),
    isOpen: () => dialog.isOpen(),
    select,
  };
}
