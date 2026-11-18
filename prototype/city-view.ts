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
import { mountCityView } from '../src/ui/city/index.ts';

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
const view = mountCityView(document.getElementById('city')!, {
  statics: buildCityStatic(data),
  strings: {
    canvasLabel: '3D city of the 41 districts. Every district is also in the district list.',
    fallback: 'This browser cannot show the 3D city. Use the district list to select a district.',
  },
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
