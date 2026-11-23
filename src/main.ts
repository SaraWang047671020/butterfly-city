// App entry (game-ui task 17.2, city-3d task 6, story-layer Citizen_Encounters). Written by Claude Code.
// The only module that reads import.meta.env. Wires Data_Loader -> Game_Controller -> UI, and mounts the 3D City_View
// into the App's city layer.
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
import { RULE_REGISTRY } from './simulation/registry.ts';
import { districtAccessibleName } from './ui/a11y/accessible-name.ts';
import { createApp } from './ui/app.ts';
import { mountCityView, type CityCitizen, type CityView } from './ui/city/index.ts';
import { formatNumber } from './ui/format/number.ts';
import { UI_STRINGS } from './ui/strings.ts';
import type { MapDistrictView, MapViewModel } from './types/view.ts';

const BASE_URL = import.meta.env.BASE_URL;
const host = document.getElementById('app');
if (host === null) throw new Error('index.html has no #app element');

const app = createApp(document, host, { onRetry: () => void start() });
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
  const data = result.data;
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
      fallback: C.fallback,
      metro: C.metro,
      talk: C.talk,
      tools: {
        label: C.toolsLabel,
        illustrationNote: C.illustrationNote,
        walk: C.walk,
        overview: C.overview,
        pause: C.pause,
        resume: C.resume,
        qualityHigh: C.qualityHigh,
        qualityLow: C.qualityLow,
      },
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
  app.attach(ctl);
}

void start();
