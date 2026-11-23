// App entry (game-ui task 17.2, city-3d task 6, story-layer Citizen_Encounters). Written by Claude Code.
// The only module that reads import.meta.env. Wires Data_Loader -> Game_Controller -> UI, and mounts the 3D City_View
// into the App's city layer.
import { DISTRICT_NAMES_ZH } from './ui/strings/district-names.generated.ts';
import './styles/tokens.css';
import './styles/city.css';
import { loadDataFiles } from './data/loader.ts';
import type { LoadedData } from './data/convert.ts';
import { loadStoryFiles, type StoryFiles } from './data/story-loader.ts';
import { GameController, type DemoPort } from './game/controller.ts';
import { describeDemo, readDemo } from './game/demo.ts';
import { buildStoryFacts } from './game/story-facts.ts';
import { storyLines } from './narrative/select.ts';
import { DEMO_SAVE_CODE, DEMO_SUMMARY_TEXT } from './save/demo-save.generated.ts';
import { SaveStore, type StoragePort } from './save/store.ts';
import { readPersonaId, writePersonaId } from './save/story-store.ts';
import { endingLines } from './narrative/select.ts';
import { createStoryPanel, type StoryPanelView } from './ui/story/story-panel.ts';
import { buildLimitsBody } from './ui/story/limits-dialog.ts';
import { createDialogManager } from './ui/a11y/dialog.ts';
import { fillTemplate as fillStory } from './narrative/fill.ts';
import { RULE_REGISTRY } from './simulation/registry.ts';
import { districtAccessibleName } from './ui/a11y/accessible-name.ts';
import { createApp, languageLabel, otherLocale } from './ui/app.ts';
import { LANG_KEY, type Locale } from './ui/strings/locale.ts';
// After app.ts so that the approved overlay layout follows the shell styles of app.css.
import './styles/layout.css';
import './styles/hud.css';
import { mountCityView, type CityCitizen, type CityView, type SiteView } from './ui/city/index.ts';
import { formatNumber } from './ui/format/number.ts';
import { UI_STRINGS, quarterLabel, unitLabel, LOCALE } from './ui/strings.ts';
import type { MapDistrictView, MapViewModel } from './types/view.ts';

const BASE_URL = import.meta.env.BASE_URL;
const appRoot = document.getElementById('app');
if (appRoot === null) throw new Error('index.html has no #app element');
const host: HTMLElement = appRoot;

// Language (play-loop Requirement 12.2): store the choice and reload; the game is already saved in the browser.
const switchLanguage = (next: Locale): void => {
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // storage unavailable: the reload falls back to the browser language
  }
  location.reload();
};
const app = createApp(document, host, { onRetry: () => void start(), onLanguage: switchLanguage });
let city: CityView | null = null;
let controller: GameController | null = null;

/** localStorage adapter, or null when access throws (private mode, blocked storage). */
function storagePort(): StoragePort | null {
  try {
    const s = window.localStorage;
    s.getItem('butterflycity.probe');
    return { getItem: (k) => s.getItem(k), setItem: (k, v) => s.setItem(k, v) };
  } catch {
    return null;
  }
}

function demoPort(data: LoadedData): DemoPort {
  if (DEMO_SAVE_CODE.trim() === '') return { ok: false, reason: UI_STRINGS.demo.notGenerated };
  const src = readDemo({ registry: RULE_REGISTRY, districts: data.districts }, DEMO_SAVE_CODE, DEMO_SUMMARY_TEXT);
  if (!src.ok) return src;
  const names = new Map(data.districts.map((d) => [d.code, d.name]));
  return { ok: true, save: src.save, description: describeDemo(src.save, src.summary, (c) => names.get(c) ?? c) };
}

function accessibleName(d: MapDistrictView, map: MapViewModel): string {
  const noData = map.indicator === 'lowUseHousingRate' && d.central === null;
  return districtAccessibleName({
    name: d.name,
    city: d.city,
    indicator: UI_STRINGS.districtPanel.mapIndicators[map.indicator],
    unit: map.legend.unit,
    range: d.range,
    decimals: map.legend.decimals,
    estimated: d.estimated,
    dataPeriod: d.dataPeriod,
    noData,
  });
}

/** Citizens met in Walk_Mode; their story is built for the Displayed_Quarter each time the player talks to them. */
function citizensOf(data: LoadedData, story: StoryFiles, ctl: () => GameController | null): CityCitizen[] {
  const history = (id: 'rent' | 'householdIncome', code: string, qi: number): number | null => {
    const ind = data.history.indicators.find((i) => i.id === id);
    return ind === undefined || ind.level !== 'district' ? null : (ind.series[code]?.[qi]?.value ?? null);
  };
  return story.citizens.personas.map((persona) => ({
    id: persona.id,
    name: persona.name,
    homeCode: persona.homeCode,
    story: () => {
      const session = ctl()?.storySession() ?? null;
      const ranges = session?.computed?.ranges ?? [];
      const facts =
        session === null
          ? null
          : buildStoryFacts({
              persona,
              citizens: story.citizens,
              spread: story.spread,
              params: session.params,
              commute: session.commute,
              history,
              ranges,
              displayed: ranges.length - 1,
              quarters: data.history.quarters,
              format: (x, d) => formatNumber(x, d),
            });
      const lines = facts === null ? [] : storyLines(story.citizens.templates, facts.state, facts.values);
      return { paragraphs: [persona.intro, ...lines.map((l) => ('text' in l ? l.text : UI_STRINGS.story.noValue))] };
    },
  }));
}

async function start(): Promise<void> {
  app.showLoading(0);
  const result = await loadDataFiles(
    (url, init) => fetch(url, init),
    BASE_URL,
    (n) => app.showLoading(n),
    { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) },
  );
  if (!result.ok) {
    app.showLoadError(result.failures);
    return;
  }
  // Traditional Chinese: district names from the boundary data's TOWNNAME (play-loop Requirement 12.5). Names are
  // display text only; every rule and file matches districts by District_Code.
  const data =
    LOCALE === 'zh-Hant'
      ? { ...result.data, districts: result.data.districts.map((d) => ({ ...d, name: DISTRICT_NAMES_ZH[d.code] ?? d.name })) }
      : result.data;
  // The Save_Store is created only after a successful load (game-ui 2.6).
  controller = new GameController({
    data,
    registry: RULE_REGISTRY,
    store: new SaveStore(storagePort()),
    scheduler: { defer: (fn) => window.setTimeout(fn, 0) },
    demo: demoPort(data),
  });
  const ctl = controller;

  // Story files are a separate group: an error leaves the game running without citizens (story-layer 1.4).
  const story = await loadStoryFiles(
    (url) => fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${url}: HTTP ${r.status}`)))),
    BASE_URL,
    new Set(data.districts.map((d) => d.code)),
  );
  if (!story.ok) console.warn(story.error);

  const C = UI_STRINGS.city;
  city?.dispose();
  city = mountCityView(app.cityLayer, {
    statics: ctl.cityStatic(),
    strings: {
      canvasLabel: C.canvasLabel,
      close: UI_STRINGS.dialogs.close,
      quarterLabel,
      unitLabel,
      chineseNames: LOCALE === 'zh-Hant',
      fallback: C.fallback,
      metro: C.metro,
      talk: C.talk,
      tools: {
        label: C.toolsLabel,
        illustrationNote: '', // shown in the Map panel of the App, next to the legend
        walk: C.walk,
        overview: C.overview,
        pause: C.pause,
        resume: C.resume,
        qualityHigh: C.qualityHigh,
        qualityLow: C.qualityLow,
        showChange: C.showChange,
        showValues: C.showValues,
        changeLegend: C.changeLegend,
      },
      sites: { done: C.socialHousingLabel, building: C.constructionLabel },
    },
    selectDistrict: (code) => ctl.actions.selectDistrict(code),
    announce: (text) => {
      const live = document.getElementById('city-live');
      if (live !== null) live.textContent = text;
    },
    accessibleName,
    citizens: story.ok ? citizensOf(data, story.value, () => controller) : [],
  });
  const cityView = city;
  cityView.update(ctl.view().map);
  ctl.subscribe((view) => cityView.update(view.map));
  // The player's social housing in the city: extra units under construction and completed (only differences > 0).
  const sitesOf = (view: ReturnType<typeof ctl.view>): SiteView[] => {
    const by = new Map<string, { completed: number; building: number; progress: number; ready: string | null }>();
    const at = (code: string) => by.get(code) ?? (by.set(code, { completed: 0, building: 0, progress: 0, ready: null }), by.get(code)!);
    for (const q of view.timeline) for (const it of q.items) if (it.kind === 'completion' && it.item.difference > 0) at(it.item.district).completed += it.item.difference;
    for (const r of view.policyPanel.construction) {
      if (r.difference <= 0) continue;
      const s = at(r.district);
      s.building += r.difference;
      s.progress = Math.max(s.progress, (r.progress + 1) / Math.max(1, r.lag));
      s.ready = s.ready === null || r.effect < s.ready ? r.effect : s.ready;
    }
    return [...by.entries()].map(([district, s]) => ({ district, ...s }));
  };
  cityView.setSites(sitesOf(ctl.view()));
  ctl.subscribe((view) => cityView.setSites(sitesOf(view)));

  // Story_Panel (story-layer Requirement 5): pick one Persona, then read its update each quarter.
  const port = storagePort();
  const storyPanel = createStoryPanel(document, {
    choose: (id) => {
      personaId = id;
      writePersonaId(port, id);
      renderStory();
    },
    change: () => {
      personaId = null;
      renderStory();
    },
  });
  app.addPanel('story', UI_STRINGS.story.title, false).appendChild(storyPanel.root);
  let personaId = story.ok ? readPersonaId(port, story.value.citizens.personas.map((p) => p.id)) : null;
  const renderStory = (): void => storyPanel.update(storyView());
  const storyView = (): StoryPanelView => {
    if (!story.ok) return { kind: 'error', error: story.error };
    const files = story.value;
    const persona = files.citizens.personas.find((p) => p.id === personaId);
    if (persona === undefined) {
      return { kind: 'picker', personas: files.citizens.personas.map((p) => ({ id: p.id, name: p.name, picker: p.picker })) };
    }
    const session = ctl.storySession();
    const ranges = session?.computed?.ranges ?? [];
    if (session === null || ranges.length === 0) {
      return { kind: 'story', name: persona.name, intro: persona.intro, lines: [], quarter: null, ending: [] };
    }
    const history = (id: 'rent' | 'householdIncome', code: string, qi: number): number | null => {
      const ind = data.history.indicators.find((i) => i.id === id);
      return ind === undefined || ind.level !== 'district' ? null : (ind.series[code]?.[qi]?.value ?? null);
    };
    const facts = buildStoryFacts({
      persona,
      citizens: files.citizens,
      spread: files.spread,
      params: session.params,
      commute: session.commute,
      history,
      ranges,
      displayed: ranges.length - 1,
      quarters: data.history.quarters,
      format: (x, d) => formatNumber(x, d),
    });
    const text = (l: { text: string } | { error: unknown }) => ('text' in l ? l.text : UI_STRINGS.story.noValue);
    return {
      kind: 'story',
      name: persona.name,
      intro: persona.intro,
      quarter: ranges[ranges.length - 1]?.quarter ?? null,
      lines: facts === null ? [] : storyLines(files.citizens.templates, facts.state, facts.values).map(text),
      ending: facts?.endingValues == null ? [] : endingLines(files.citizens.templates, facts.endingValues).map(text),
    };
  };
  renderStory();
  ctl.subscribe(() => renderStory());

  // Limits_Dialog (story-layer Requirement 6): opened from the Map panel; texts from model-limits.json, filled from
  // model-facts.json (minutes as whole numbers). A Placeholder without a value shows "no value" for that item.
  const limitsDialog = createDialogManager(document, () => document.querySelector<HTMLElement>('.turn-bar__button'), UI_STRINGS.dialogs.close);
  host.appendChild(limitsDialog.root);
  limitsDialog.root.classList.add('ui-dialog--limits');
  app.addMapControl(UI_STRINGS.story.limitsButton, (opener) => {
    if (!story.ok) {
      const p = document.createElement('p');
      p.textContent = UI_STRINGS.story.limitsUnavailable.replace('{error}', story.error);
      limitsDialog.open({ title: UI_STRINGS.story.limitsButton, body: p, opener });
      return;
    }
    const { limits, facts } = story.value;
    const values = {
      commuteModelled: formatNumber(facts.commuteModelled, 0),
      commuteSurvey: formatNumber(facts.commuteSurvey, 0),
      backtestResult: facts.backtestResult,
    };
    const fill = (id: string, text: string): string => {
      try {
        return fillStory(id, text, values);
      } catch {
        return UI_STRINGS.story.noValue;
      }
    };
    const body = buildLimitsBody(document, {
      intro: limits.page.intro,
      disclosure: limits.page.disclosure,
      sourcesLink: limits.page.sourcesLink,
      sections: limits.sections.map((sec) => ({ title: sec.title, items: sec.items.map((it) => ({ title: it.title, text: fill(`limits.${it.id}`, it.text) })) })),
    });
    limitsDialog.open({ title: limits.page.title, body, opener, size: 'lg' });
  });
  const langButton = app.addMapControl(languageLabel(), () => switchLanguage(otherLocale()));
  langButton.lang = otherLocale();
  app.attach(ctl);
}

void start();
