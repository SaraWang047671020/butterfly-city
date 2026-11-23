// Harness for the production City_View (src/ui/city/) before the game-ui wiring exists (city-3d design "Phases").
// Loads the real Data_Files, computes the real track to ?q=<quarter> with the Engine and mounts the City_View.
// Not production code; never imported by src/.
import '../src/styles/tokens.css';
import '../src/styles/city.css';
import { loadDataFiles } from '../src/data/loader.ts';
import { newSession } from '../src/game/core/session.ts';
import type { GameSession } from '../src/game/core/session.ts';
import { buildCityStatic, buildGameView } from '../src/game/core/views.ts';
import type { ControllerUiState } from '../src/game/core/views.ts';
import { playerTimeline } from '../src/game/core/policy.ts';
import { runRange } from '../src/simulation/engine.ts';
import { RULE_REGISTRY } from '../src/simulation/registry.ts';
import type { QuarterKey } from '../src/types/data-files.ts';
import type { MapIndicatorId } from '../src/types/save.ts';
import { mountCityView, type CityCitizen } from '../src/ui/city/index.ts';
import { loadStoryFiles } from '../src/data/story-loader.ts';
import { buildStoryFacts } from '../src/game/story-facts.ts';
import { storyLines } from '../src/narrative/select.ts';

const UI: ControllerUiState = {
  busy: false,
  storageWarning: false,
  versionNotice: null,
  engineError: null,
  carried: null,
  drafts: new Map(),
  dialog: null,
  announcement: null,
  focusRequest: null,
};

const qs = new URLSearchParams(location.search);
const status = document.getElementById('status')!;
const result = await loadDataFiles(
  (url, init) => fetch(url, init),
  import.meta.env.BASE_URL,
  (n) => (status.textContent = `Loading ${n} of 6`),
  { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as number) },
);
if (!result.ok) {
  status.textContent = result.failures.map((f) => `${f.file}: ${f.message}`).join('\n');
  throw new Error('load failed');
}
const data = result.data;
let session: GameSession = newSession(data, RULE_REGISTRY);
const target = (qs.get('q') ?? '2019Q2') as QuarterKey;
const r = runRange(playerTimeline(session.realTrack, []), session.events, session.params, session.baseline, session.realTrack, session.commute, target, {
  registry: RULE_REGISTRY,
});
if (r.ok) session = { ...session, computed: r };
session = { ...session, mapIndicator: (qs.get('ind') ?? 'rentBurden') as MapIndicatorId, selectedDistrict: qs.get('select') };
status.textContent = r.ok ? `Real track computed to ${target}` : `Engine error: ${JSON.stringify(r)}`;

const live = document.getElementById('live')!;
// Story files: a load error leaves the city without citizens (story-layer 1.4).
const story = await loadStoryFiles((url) => fetch(url).then((x) => x.text()), import.meta.env.BASE_URL, new Set(data.districts.map((d) => d.code)));
const fmt = (x: number, d: number) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const history = (id: 'rent' | 'householdIncome', code: string, qi: number): number | null => {
  const ind = data.history.indicators.find((i) => i.id === id);
  return ind === undefined || ind.level !== 'district' ? null : (ind.series[code]?.[qi]?.value ?? null);
};
const citizens: CityCitizen[] = !story.ok
  ? []
  : story.value.citizens.personas.map((persona) => ({
      id: persona.id,
      name: persona.name,
      homeCode: persona.homeCode,
      story: () => {
        const ranges = session.computed?.ranges ?? [];
        const facts = buildStoryFacts({
          persona,
          citizens: story.value.citizens,
          spread: story.value.spread,
          params: session.params,
          commute: session.commute,
          history,
          ranges,
          displayed: ranges.length - 1,
          quarters: data.history.quarters,
          format: fmt,
        });
        const lines = facts === null ? [] : storyLines(story.value.citizens.templates, facts.state, facts.values);
        return { paragraphs: [persona.intro, ...lines.map((l) => ('text' in l ? l.text : 'no value'))] };
      },
    }));
if (!story.ok) console.warn(story.error);
const view = mountCityView(document.getElementById('city')!, {
  statics: buildCityStatic(data),
  strings: {
    canvasLabel: '3D city of the 41 districts. Every district is also in the district list.',
    fallback: 'This browser cannot show the 3D city. Use the district list to select a district.',
    metro: {
      prompt: '{station} station. Press E or',
      button: 'Take the metro',
      title: 'Metro from {station}: choose a station',
      here: '{station} (you are here)',
    },
    talk: { prompt: '{name} is here. Press E or', button: 'Talk' },
  },
  citizens,
  selectDistrict: (code) => {
    session = { ...session, selectedDistrict: code };
    render();
  },
  announce: (text) => (live.textContent = text),
  accessibleName: (d, map) => `${d.name}, ${d.city}: ${map.indicator} ${d.central ?? 'no value'}`,
  onModeChange: (m) => (walkButton.textContent = m === 'walk' ? 'Back to overview' : 'Walk the streets'),
});
const walkButton = document.getElementById('walk') as HTMLButtonElement;
walkButton.addEventListener('click', () => view.setMode(view.mode() === 'walk' ? 'overview' : 'walk'));
const render = () => {
  const v = buildGameView(session, UI, data);
  view.update(v.map);
  const sel = v.map.districts.find((d) => d.selected);
  status.textContent = `${target} · ${v.map.indicator} · ${sel ? `${sel.name}: ${sel.central?.toFixed(1)} · ghosts ${sel.ghosts} · price index ${sel.priceIndex?.toFixed(2)}` : 'no district selected'}`;
};
render();
(window as unknown as Record<string, unknown>)['__cityView'] = { view, setQ: () => {} };
