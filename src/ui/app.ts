// Root of the UI (game-ui task 17.1). It mounts every component once and updates each from its slice of the view.
//
// Layers (src/styles/app.css shell; src/styles/layout.css is the approved overlay layout of city-3d Requirement 9):
//   host
//   ├─ .ui-city-layer   full-viewport background. EMPTY here: the 3D City_View is mounted into it by the caller.
//   └─ .ui-overlay      floating blocks above the city layer: screens (loading, load error, start) and the game blocks.
//
// How the City_View is attached (src/ui/city/ is not imported here):
//   const app = createApp(document, host, { onRetry });
//   const city = mountCityView(app.cityLayer, options);   // app.cityLayer is the element with class `ui-city-layer`
//   app.attach(controller);                                // controller: GameController (or anything shaped like AppController)
// `app.cityLayer` is created once and never re-rendered or cleared by the App.
//
// Before the controller exists (loading, load error) the caller uses `showLoading` and `showLoadError`.
// After the data loaded, `attach` renders `controller.screen()` and re-renders on every controller publish.
import type {
  Announcement,
  DistrictListView,
  GameView,
  ScreenView,
  StoredProblemView,
  UiActions,
} from '../types/view.ts';
import type { DistrictCode } from '../types/data-files.ts';
import { createDialogs } from './dialogs/dialogs.ts';
import { createIndicatorSwitch, createLegend, createIndicatorText, createPriceToIncomeLabel } from './map/map-controls.ts';
import { createDistrictList } from './panels/district-list.ts';
import { createDistrictPanel } from './panels/district-panel.ts';
import { createPolicyPanel } from './panels/policy-panel.ts';
import { createTimelineView } from './timeline/timeline-view.ts';
import { createTurnBar } from './turn-bar/turn-bar.ts';
import { createLiveRegion } from './a11y/live-region.ts';
import { mountComponent, setText } from './component.ts';
import { buildEngineErrorText, fillTemplate, UI_STRINGS } from './strings.ts';
import '../styles/app.css';

const A = UI_STRINGS.app;
const S = UI_STRINGS.startMenu;
const N = UI_STRINGS.announcements;

/** What the App needs from the game. `GameController` satisfies it. */
export interface AppController {
  screen(): ScreenView;
  view(): GameView;
  subscribe(listener: (view: GameView) => void): () => void;
  readonly actions: UiActions;
}

export interface AppOptions {
  /** Called when the player activates "Retry" in the load-error screen. */
  readonly onRetry: () => void;
}

export interface App {
  /** Full-viewport background element (class `ui-city-layer`). The City_View is mounted into it by the caller. */
  readonly cityLayer: HTMLElement;
  showLoading(loaded: number): void;
  showLoadError(failures: readonly { readonly file: string; readonly message: string }[]): void;
  /** Adds a floating panel to the Game_Screen and returns its body (story-layer Story_Panel). */
  addPanel(name: string, title: string, collapsed: boolean): HTMLElement;
  /** Renders `controller.screen()` now and after every publish. Returns a detach function. */
  attach(controller: AppController): () => void;
}

type ScreenKind = ScreenView['kind'];

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  parent?: Element,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function button(doc: Document, className: string, label: string, onClick: () => void, parent: Element): HTMLButtonElement {
  const b = el(doc, 'button', className, parent, label);
  b.type = 'button';
  // Enter and Space activate a native button as a click.
  b.addEventListener('click', onClick);
  return b;
}

function storedProblemText(problem: StoredProblemView): string {
  if (problem.kind === 'unavailable') return UI_STRINGS.storage.notStored;
  const reason = [problem.path, problem.reason].filter((p): p is string => p !== null && p !== '').join(': ');
  return fillTemplate(S.storedProblem, { reason });
}

function announcementText(a: Announcement): string {
  if (a.engineError !== null) return buildEngineErrorText(a.engineError.code, a.engineError.details);
  const parts: string[] = [];
  if (a.quarter !== null) parts.push(fillTemplate(N.quarterComputed, { quarter: a.quarter }));
  if (a.eventTitles.length > 0) parts.push(fillTemplate(N.majorEvents, { titles: a.eventTitles.join(', ') }));
  return parts.join(' ');
}

function areaNamesOf(list: DistrictListView): ReadonlyMap<DistrictCode, string> {
  const map = new Map<DistrictCode, string>();
  for (const g of list.groups) for (const d of g.districts) map.set(d.code, d.name);
  return map;
}

export function createApp(doc: Document, host: HTMLElement, options: AppOptions): App {
  host.classList.add('ui-app');

  const cityLayer = el(doc, 'div', 'ui-city-layer', host);
  const overlay = el(doc, 'div', 'ui-overlay', host);

  // ---- Screens other than the game --------------------------------------------------------------------------
  const statusScreen = el(doc, 'section', 'ui-screen ui-screen--status', overlay);
  const statusTitle = el(doc, 'h1', 'ui-screen__title', statusScreen, A.title);
  statusTitle.tabIndex = -1;
  const statusDisclosure = el(doc, 'p', 'ui-screen__disclosure', statusScreen, A.disclosure);
  const loadingText = el(doc, 'p', 'ui-screen__loading', statusScreen);
  loadingText.setAttribute('role', 'status');
  const errorBox = el(doc, 'div', 'ui-screen__error', statusScreen);
  const errorHeading = el(doc, 'p', 'ui-screen__error-heading', errorBox, A.loadErrorHeading);
  const errorList = el(doc, 'ul', 'ui-screen__error-list', errorBox);
  const retry = button(doc, 'ui-button', A.retry, () => options.onRetry(), errorBox);

  const startScreen = el(doc, 'section', 'ui-screen ui-screen--start', overlay);
  const startTitle = el(doc, 'h1', 'ui-screen__title', startScreen, S.title);
  startTitle.tabIndex = -1;
  el(doc, 'p', 'ui-screen__disclosure', startScreen, A.disclosure);
  const startProblem = el(doc, 'p', 'ui-screen__problem', startScreen);
  startProblem.setAttribute('role', 'status');
  const startButtons = el(doc, 'div', 'ui-screen__actions', startScreen);

  // ---- Game screen: independent blocks, each mounted into its own host ---------------------------------------
  const gameScreen = el(doc, 'div', 'ui-game', overlay);
  const gameTitle = el(doc, 'h1', 'ui-visually-hidden', gameScreen, A.title);
  gameTitle.tabIndex = -1;
  const headerHost = el(doc, 'header', 'ui-block ui-block--turn-bar', gameScreen);
  const block = (parent: Element, name: string): HTMLElement => el(doc, 'div', `ui-block ui-block--${name}`, parent);

  // Floating panels (city-3d Requirement 9). Wide screens: each panel can be hidden and shown from its header.
  // Narrow screens: a tab row opens one panel at a time as a sheet above the Turn_Bar.
  const L = UI_STRINGS.layout;
  const tabs = el(doc, 'nav', 'ui-tabs', gameScreen);
  tabs.setAttribute('aria-label', L.tabsLabel);
  const panels: { name: string; tab: HTMLButtonElement; setSheet: (on: boolean) => void }[] = [];
  const panel = (name: string, title: string, collapsed: boolean): HTMLElement => {
    const section = el(doc, 'section', `ui-panel ui-panel--${name}`, gameScreen);
    const head = el(doc, 'div', 'ui-panel__head', section);
    const heading = el(doc, 'h2', 'ui-panel__title', head, title);
    heading.id = `ui-panel-title-${name}`;
    section.setAttribute('aria-labelledby', heading.id);
    const body = el(doc, 'div', 'ui-panel__body', section);
    body.id = `ui-panel-body-${name}`;
    const toggle = button(doc, 'ui-panel__toggle', L.hide, () => setCollapsed(!section.classList.contains('is-collapsed')), head);
    toggle.setAttribute('aria-controls', body.id);
    const setCollapsed = (on: boolean): void => {
      section.classList.toggle('is-collapsed', on);
      toggle.textContent = on ? L.show : L.hide;
      toggle.setAttribute('aria-expanded', String(!on));
    };
    setCollapsed(collapsed);
    const tab = button(doc, 'ui-tabs__tab', title, () => {
      const open = !section.classList.contains('is-sheet');
      for (const p of panels) p.setSheet(false);
      if (open) panels.find((p) => p.name === name)?.setSheet(true);
    }, tabs);
    tab.setAttribute('aria-controls', section.id = `ui-panel-${name}`);
    const setSheet = (on: boolean): void => {
      section.classList.toggle('is-sheet', on);
      tab.setAttribute('aria-expanded', String(on));
    };
    setSheet(false);
    panels.push({ name, tab, setSheet });
    return body;
  };
  const wide = (doc.defaultView?.innerWidth ?? 0) >= 1600;
  const districtHost = panel('district', L.district, false);
  const policyHost = panel('policy', L.policy, false);
  const mapHost = panel('map', L.map, false);
  const timelineHost = panel('timeline', L.timeline, !wide);
  const leftHost = mapHost;
  const rightHost = districtHost;

  // Placeholder: actions are bound in `attach`; components keep a stable reference to this proxy.
  let current: UiActions | null = null;
  const actions = new Proxy({} as UiActions, {
    get(_t, prop: string) {
      return (...args: unknown[]) => {
        const fn = (current as unknown as Record<string, ((...a: unknown[]) => void) | undefined> | null)?.[prop];
        fn?.(...args);
      };
    },
  });

  const turnBar = createTurnBar(doc, actions);
  const indicatorSwitch = createIndicatorSwitch(doc, actions);
  const indicatorText = createIndicatorText(doc, actions);
  const legend = createLegend(doc, actions);
  const priceLabel = createPriceToIncomeLabel(doc, actions);
  const districtList = createDistrictList(doc, actions);
  const districtPanel = createDistrictPanel(doc, actions);
  const policyPanel = createPolicyPanel(doc, actions);
  const timeline = createTimelineView(doc, actions);

  mountComponent(headerHost, turnBar);
  mountComponent(block(leftHost, 'map-controls'), indicatorSwitch);
  mountComponent(block(leftHost, 'map-controls'), indicatorText);
  mountComponent(block(leftHost, 'map-controls'), legend);
  mountComponent(block(leftHost, 'map-controls'), priceLabel);
  mountComponent(block(leftHost, 'district-list'), districtList);
  mountComponent(block(rightHost, 'district-panel'), districtPanel);
  mountComponent(block(policyHost, 'policy-panel'), policyPanel);
  mountComponent(block(timelineHost, 'timeline'), timeline);
  // The Illustration_Note sits with the legend (city-3d Requirement 11.1).
  el(doc, 'p', 'ui-illustration-note', mapHost, UI_STRINGS.city.figuresNote);
  el(doc, 'p', 'ui-illustration-note', mapHost, UI_STRINGS.city.illustrationNote);

  // ---- Dialogs and live regions (available on every screen) ----------------------------------------------------
  const dialogs = createDialogs(doc, actions, {
    getFallbackFocus: () => headerHost.querySelector<HTMLElement>('.turn-bar__button') ?? startButtons.querySelector('button'),
  });
  mountComponent(overlay, dialogs);
  const live = createLiveRegion(doc, announcementText);
  mountComponent(overlay, live);

  // ---- Rendering ---------------------------------------------------------------------------------------------
  let shown: ScreenKind | null = null;
  let startKey: string | null = null;
  let namesSource: DistrictListView | null = null;
  let names: ReadonlyMap<DistrictCode, string> = new Map();

  const show = (kind: ScreenKind): void => {
    statusScreen.hidden = kind !== 'loading' && kind !== 'load-error';
    startScreen.hidden = kind !== 'start';
    gameScreen.hidden = kind !== 'game';
    loadingText.hidden = kind !== 'loading';
    errorBox.hidden = kind !== 'load-error';
    if (kind === shown) return;
    const previous = shown;
    shown = kind;
    // Move focus to the new screen's heading; the first loading screen keeps the page default.
    if (previous === null) return;
    const target = kind === 'game' ? gameTitle : kind === 'start' ? startTitle : statusTitle;
    target.focus({ preventScroll: true });
  };

  const showLoading = (loaded: number): void => {
    setText(loadingText, fillTemplate(A.loading, { n: String(loaded) }));
    show('loading');
  };

  const showLoadError: App['showLoadError'] = (failures) => {
    errorList.replaceChildren(
      ...failures.map((f) => {
        const li = doc.createElement('li');
        li.textContent = fillTemplate(A.loadErrorLine, { file: f.file, error: f.message });
        return li;
      }),
    );
    show('load-error');
    retry.disabled = false;
  };

  const renderStart = (s: Extract<ScreenView, { kind: 'start' }>, ctl: AppController): void => {
    const key = `${s.options.join(',')}|${s.storedProblem?.kind ?? ''}`;
    if (key !== startKey) {
      startKey = key;
      startButtons.replaceChildren();
      const labels = { continue: S.continue, new: S.newGame, demo: S.loadDemo } as const;
      const run = { continue: () => ctl.actions.continueStored(), new: () => ctl.actions.startNew(), demo: () => ctl.actions.openDemo() };
      for (const o of s.options) button(doc, 'ui-button', labels[o], run[o], startButtons);
      if (s.storedProblem?.kind === 'invalid') {
        button(doc, 'ui-button', S.exportStored, () => ctl.actions.exportStoredText(), startButtons);
      }
    }
    startProblem.hidden = s.storedProblem === null;
    setText(startProblem, s.storedProblem === null ? '' : storedProblemText(s.storedProblem));
  };

  const renderGame = (g: GameView): void => {
    if (namesSource !== g.districtList) {
      namesSource = g.districtList;
      names = areaNamesOf(g.districtList);
    }
    turnBar.update(g.turnBar);
    indicatorSwitch.update(g.map);
    indicatorText.update(g.map);
    legend.update(g.map);
    priceLabel.update(g.map);
    districtList.update(g.districtList);
    districtPanel.update(g.districtPanel);
    policyPanel.update({ policy: g.policyPanel, planning: g.turnBar.planning, focusRequest: g.focusRequest, areaNames: names });
    timeline.update({ quarters: g.timeline, areaNames: names });
  };

  const render = (ctl: AppController): void => {
    const screen = ctl.screen();
    if (screen.kind === 'game') {
      show('game');
      renderGame(screen.game);
    } else if (screen.kind === 'start') {
      show('start');
      renderStart(screen, ctl);
    } else if (screen.kind === 'loading') {
      showLoading(screen.loaded);
    } else {
      showLoadError(screen.failures);
    }
    // Dialogs and announcements are valid on the start screen too (demo description, confirmations, stored text).
    const v = screen.kind === 'game' ? screen.game : ctl.view();
    dialogs.update(v.dialog);
    live.update(v.announcement);
  };

  // Initial state before any controller: loading with 0 files.
  showLoading(0);
  setText(errorHeading, A.loadErrorHeading);
  setText(statusDisclosure, A.disclosure);

  return {
    cityLayer,
    addPanel: (name, title, collapsed) => panel(name, title, collapsed),
    showLoading,
    showLoadError,
    attach(controller) {
      current = controller.actions;
      const unsubscribe = controller.subscribe(() => render(controller));
      render(controller);
      return () => {
        unsubscribe();
        current = null;
      };
    },
  };
}
