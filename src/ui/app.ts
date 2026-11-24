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
import { createPolicyCards } from './policy/policy-cards.ts';
import { createQuarterBrief, type GoThere } from './brief/quarter-brief.ts';
import { createCityReport } from './report/city-report.ts';
import { createDistrictCard } from './district-card.ts';
import { createTimelineView } from './timeline/timeline-view.ts';
import { createTurnBar } from './turn-bar/turn-bar.ts';
import { createLiveRegion } from './a11y/live-region.ts';
import { createGameMenu, mainFocusTarget, NARROW_QUERY, type MenuSection } from './menu/menu.ts';
import { mountComponent, setText } from './component.ts';
import { buildEngineErrorText, fillTemplate, UI_STRINGS, LOCALE, type Locale, quarterLabel } from './strings.ts';
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
  /** Called with the other language when the player activates the language control (play-loop Requirement 12.1). */
  readonly onLanguage?: (next: Locale) => void;
  /** Go_There_Action of the Quarter_Brief (play-loop Requirement 6.5): Walk_Mode at the place. */
  readonly onGoThere?: (place: GoThere) => void;
  /** Screen position of a district (the City_View projection), for the District_Card; null when off screen. */
  readonly project?: (code: string) => { readonly x: number; readonly y: number } | null;
}

export interface App {
  /** Full-viewport background element (class `ui-city-layer`). The City_View is mounted into it by the caller. */
  readonly cityLayer: HTMLElement;
  showLoading(loaded: number): void;
  showLoadError(failures: readonly { readonly file: string; readonly message: string }[]): void;
  /** Adds a button to the "Save and settings" section of the menu (the language control, the guide replay). */
  addMapControl(label: string, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement;
  /** A section of the menu (☰), for controls the caller moves there (the city tools). */
  menuSection(name: MenuSection): HTMLElement;
  /** Adds a button to the Turn_Bar block, after the quarter (Walk_Mode: "Back to overview"). */
  addTurnButton(label: string, className: string, onClick: () => void): HTMLButtonElement;
  /** Adds a City_Report tab and returns its host (story-layer Story_Panel). `collapsed` is no longer used. */
  addPanel(name: string, title: string, collapsed: boolean): HTMLElement;
  /** Places a block on the main game screen (the character chip); on a narrow screen it moves into the menu. */
  addMainBlock(block: HTMLElement): void;
  /** Adds a button to the menu's "You and the city" section, before the City_Report button ("My life"). */
  addHeaderButton(label: string, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement;
  /** The host of a City_Report tab (to add a section), or null. */
  reportTab(name: string): HTMLElement | null;
  /** Closes the City_Report when it is open. */
  closeReport(): void;
  /** Adds a City_Report tab whose content is built when it is shown (play-loop Requirement 7.2). */
  addReportTab(name: string, title: string, onShow: (host: HTMLElement) => void): HTMLElement;
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

function button(doc: Document, className: string, label: string, onClick: () => void, parent?: Element): HTMLButtonElement {
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
  if (a.quarter !== null) parts.push(fillTemplate(N.quarterComputed, { quarter: quarterLabel(a.quarter) }));
  if (a.eventTitles.length > 0) parts.push(fillTemplate(N.majorEvents, { titles: a.eventTitles.join(', ') }));
  return parts.join(' ');
}

function areaNamesOf(list: DistrictListView): ReadonlyMap<DistrictCode, string> {
  const map = new Map<DistrictCode, string>();
  for (const g of list.groups) for (const d of g.districts) map.set(d.code, d.name);
  return map;
}

/** The language the language control switches to, and its label written in that language. */
export function otherLocale(): Locale {
  return LOCALE === 'zh-Hant' ? 'en' : 'zh-Hant';
}
export function languageLabel(): string {
  return otherLocale() === 'zh-Hant' ? UI_STRINGS.app.languageZh : UI_STRINGS.app.languageEn;
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
  if (options.onLanguage !== undefined) {
    const onLanguage = options.onLanguage;
    const lang = button(doc, 'ui-button ui-language', languageLabel(), () => onLanguage(otherLocale()), startScreen);
    lang.lang = otherLocale();
  }

  // ---- Game screen: independent blocks, each mounted into its own host ---------------------------------------
  const gameScreen = el(doc, 'div', 'ui-game', overlay);
  const gameTitle = el(doc, 'h1', 'ui-visually-hidden', gameScreen, A.title);
  gameTitle.tabIndex = -1;
  const headerHost = el(doc, 'header', 'ui-block ui-block--turn-bar', gameScreen);
  const block = (parent: Element, name: string): HTMLElement => el(doc, 'div', `ui-block ui-block--${name}`, parent);

  // City_Report (play-loop Requirement 7): the detail that left the main screen, in tabs of a full-screen dialog.
  const R = UI_STRINGS.report;
  const report = createCityReport(doc, { title: R.title, close: UI_STRINGS.dialogs.close, tabsLabel: R.tabsLabel }, () => mainFocusTarget(doc));
  const districtsHost = report.addTab('districts', R.districts);
  const districtListHost = el(doc, 'div', 'ui-report__list', districtsHost);
  const rightHost = el(doc, 'div', 'ui-report__detail', districtsHost);
  const mapHost = report.addTab('map', R.map);
  const leftHost = mapHost;
  const timelineHost = report.addTab('timeline', R.timeline);
  // In the menu's "You and the city" section (approved menu design, 2026-11-24).
  const reportButton = button(doc, 'ui-report-open ui-report-button', R.open, () => report.open(null, reportButton));

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
  // Policy_Cards replace the Policies panel (play-loop Requirement 5).
  const policyCards = createPolicyCards(doc, actions);
  const timeline = createTimelineView(doc, actions);

  mountComponent(headerHost, turnBar);

  // ---- Menu (☰), approved design docs/design-proposal/menu-proposal.html (2026-11-24) -------------------------
  // On screen: the character chip, the quarter with Next quarter (wide screens), ☰ and the disclosure line.
  // Everything else is in the menu; on a narrow screen the Turn_Bar block and the chip move into it too.
  const menu = createGameMenu(
    doc,
    () => [cityLayer, ...Array.from(gameScreen.children).filter((e): e is HTMLElement => e instanceof HTMLElement && e !== menu.panel)],
    (open) => gameScreen.classList.toggle('is-menu-open', open),
  );
  gameScreen.append(menu.button, menu.panel);
  // The disclosure leaves the Turn_Bar for its own line at the bottom, on screen at every width (game-ui 15.1).
  const disclosureLine = headerHost.querySelector<HTMLElement>('.turn-bar__disclosure')!;
  disclosureLine.classList.add('ui-disclosure-line');
  gameScreen.appendChild(disclosureLine);
  menu.section('round').append(headerHost.querySelector('.turn-bar__button--secondary')!);
  menu.section('settings').append(headerHost.querySelector('.turn-bar__save')!);
  menu.section('city').append(reportButton);
  const mainBlocks: HTMLElement[] = [];
  const narrowQuery = doc.defaultView?.matchMedia(NARROW_QUERY) ?? null;
  const placeBlocks = (): void => {
    if (narrowQuery?.matches === true) {
      menu.section('turn').append(headerHost);
      for (const b of mainBlocks) menu.section('me').append(b);
    } else {
      gameScreen.insertBefore(headerHost, menu.button);
      for (const b of mainBlocks) gameScreen.insertBefore(b, headerHost);
    }
  };
  narrowQuery?.addEventListener('change', placeBlocks);
  placeBlocks();
  // Turn steps (play-loop Requirement 4.2): decide, compute, what changed.
  const steps = el(doc, 'p', 'ui-turn-steps', headerHost);
  const stepBars = el(doc, 'span', 'ui-turn-steps__bars', steps);
  stepBars.setAttribute('aria-hidden', 'true');
  const bars = [0, 1, 2].map(() => el(doc, 'span', '', stepBars));
  const stepText = el(doc, 'span', 'ui-turn-steps__text', steps);
  const renderSteps = (g: GameView): void => {
    const n = g.turnBar.busy ? 2 : g.brief !== null ? 3 : 1;
    bars.forEach((b, i) => b.classList.toggle('is-on', i < n));
    const T = UI_STRINGS.turnSteps;
    setText(stepText, `${fillTemplate(T.label, { n: String(n) })} · ${n === 1 ? T.decide : n === 2 ? T.compute : T.brief}`);
  };
  mountComponent(block(leftHost, 'map-controls'), indicatorSwitch);
  mountComponent(block(leftHost, 'map-controls'), indicatorText);
  mountComponent(block(leftHost, 'map-controls'), legend);
  mountComponent(block(leftHost, 'map-controls'), priceLabel);
  mountComponent(block(districtListHost, 'district-list'), districtList);
  mountComponent(block(rightHost, 'district-panel'), districtPanel);
  mountComponent(menu.section('policy'), policyCards);
  gameScreen.appendChild(policyCards.dialogRoot);
  mountComponent(block(timelineHost, 'timeline'), timeline);
  gameScreen.appendChild(report.root);
  // The figures note sits with the legend in the report; the Illustration_Note stays on the main screen
  // (city-3d Requirement 11.1, play-loop Requirement 7.3).
  el(doc, 'p', 'ui-illustration-note', mapHost, UI_STRINGS.city.figuresNote);
  el(doc, 'p', 'ui-illustration-note', mapHost, UI_STRINGS.city.illustrationNote);
  el(doc, 'p', 'ui-main-note', menu.section('note'), UI_STRINGS.city.illustrationNote);

  // District_Card (play-loop Requirement 7.4): near the selected district on wide screens, docked on narrow ones.
  const districtCard = createDistrictCard(doc, actions, {
    walk: (code) => options.onGoThere?.({ district: code, kind: 'station' }),
    report: (opener) => report.open('districts', opener),
  });
  // Before the disclosure line in the DOM: the card is shown above it (game-ui 17.2).
  gameScreen.insertBefore(districtCard.root, disclosureLine);
  const placeCard = (): void => {
    const code = districtCard.shown();
    const win = doc.defaultView;
    if (code !== null && win !== null && win.innerWidth >= 1024 && options.project !== undefined) {
      const p = options.project(code);
      const card = districtCard.root;
      if (p === null) {
        card.classList.add('is-docked');
      } else {
        card.classList.remove('is-docked');
        const w = card.offsetWidth;
        const h = card.offsetHeight;
        // Clear of the menu panel when it is open.
        const right = menu.isOpen() ? menu.panel.getBoundingClientRect().left : win.innerWidth;
        const x = Math.min(Math.max(p.x - w / 2, 16), right - w - 16);
        // Below the Turn_Bar and above the disclosure line.
        const top = headerHost.getBoundingClientRect().bottom + 12;
        const bottom = disclosureLine.getBoundingClientRect().top - 12;
        const y = Math.min(Math.max(p.y - h - 24, top), Math.max(top, bottom - h));
        card.style.setProperty('--card-x', `${Math.round(x)}px`);
        card.style.setProperty('--card-y', `${Math.round(y)}px`);
      }
    }
    win?.requestAnimationFrame(placeCard);
  };
  doc.defaultView?.requestAnimationFrame(placeCard);

  // ---- Dialogs and live regions (available on every screen) ----------------------------------------------------
  const dialogs = createDialogs(doc, actions, {
    getFallbackFocus: () => mainFocusTarget(doc) ?? startButtons.querySelector('button'),
  });
  mountComponent(overlay, dialogs);
  const quarterBrief = createQuarterBrief(doc, actions, (place) => options.onGoThere?.(place), () => mainFocusTarget(doc));
  overlay.appendChild(quarterBrief.root);
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
    renderSteps(g);
    indicatorSwitch.update(g.map);
    indicatorText.update(g.map);
    legend.update(g.map);
    priceLabel.update(g.map);
    districtList.update(g.districtList);
    districtPanel.update(g.districtPanel);
    policyCards.update({
      policy: g.policyPanel,
      planning: g.turnBar.planning,
      focusRequest: g.focusRequest,
      areaNames: names,
      districtGroups: g.districtList.groups,
      selected: g.districtList.selected,
      briefOpen: g.brief !== null,
    });
    timeline.update({ quarters: g.timeline, areaNames: names });
    const q = g.turnBar.displayed ?? g.turnBar.planning;
    menu.setQuarter(q === null ? '' : quarterLabel(q));
    menu.setAttention(policyCards.root.querySelector('.is-warning') !== null);
    districtCard.update({ panel: g.districtPanel, construction: g.policyPanel.construction });
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
    quarterBrief.update({ brief: screen.kind === 'game' ? v.brief : null, blocked: v.dialog !== null });
    live.update(v.announcement);
  };

  // Initial state before any controller: loading with 0 files.
  showLoading(0);
  setText(errorHeading, A.loadErrorHeading);
  setText(statusDisclosure, A.disclosure);

  return {
    cityLayer,
    addPanel: (name, title) => report.addTab(name, title),
    addMainBlock: (block) => {
      mainBlocks.push(block);
      placeBlocks();
    },
    addHeaderButton(label, onClick) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'ui-report-open';
      b.textContent = label;
      b.addEventListener('click', () => onClick(b));
      menu.section('city').insertBefore(b, reportButton);
      return b;
    },
    menuSection: (name) => menu.section(name),
    addTurnButton(label, className, onClick) {
      const b = button(doc, `ui-turn-button ${className}`, label, onClick);
      headerHost.insertBefore(b, headerHost.querySelector('.ui-turn-steps'));
      return b;
    },
    reportTab: (name) => report.host(name),
    closeReport: () => {
      if (report.isOpen()) report.close();
    },
    addReportTab: (name, title, onShow) => report.addTab(name, title, onShow),
    addMapControl(label, onClick) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'dialog__button ui-map-control';
      b.textContent = label;
      b.addEventListener('click', () => onClick(b));
      menu.section('settings').appendChild(b);
      return b;
    },
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
