// Real-file Data_Loader and view tests (game-ui task 19.5).
// Reads the real public/data files through loadDataFiles over a disk-backed FetchPort.
// Validates: Requirements 2.3, 2.4, 3.5, 3.14, 18.5

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadDataFiles } from '../../src/data/loader.ts';
import type { FetchPort, TimerPort } from '../../src/data/loader.ts';
import type { LoadedData } from '../../src/data/convert.ts';
import { populationChange, priceToIncome } from '../../src/game/core/conversions.ts';
import { playerTimeline } from '../../src/game/core/policy.ts';
import { newSession } from '../../src/game/core/session.ts';
import type { GameSession } from '../../src/game/core/session.ts';
import { buildGameView } from '../../src/game/core/views.ts';
import type { ControllerUiState } from '../../src/game/core/views.ts';
import { runRange } from '../../src/simulation/engine.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import type { QuarterKey } from '../../src/types/data-files.ts';
import { MAP_INDICATOR_IDS } from '../../src/types/save.ts';
import type { PanelRowId } from '../../src/types/view.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const T = 120_000;

const timer: TimerPort = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const diskFetch: FetchPort = (url) => {
  const name = url.slice(url.lastIndexOf('/') + 1);
  try {
    const body = readFileSync(join(ROOT, 'public', 'data', name), 'utf8');
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
  } catch {
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  }
};

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

const ENGINE_ID: Partial<Record<PanelRowId, string>> = {
  rentBurden: 'rentBurden',
  commuteTime: 'meanCommuteTime',
  populationChange: 'population',
  rent: 'rent',
  population: 'population',
  socialHousingStock: 'socialHousingStock',
  mrtEntries: 'mrtEntries',
  ghostCount: 'ghostCount',
};

let data: LoadedData;
let failures: readonly string[] = [];

beforeAll(async () => {
  const loaded = await loadDataFiles(diskFetch, '/', () => undefined, timer);
  if (loaded.ok) data = loaded.data;
  else failures = loaded.failures.map((f) => `${f.file}: ${f.message}`);
}, T);

function computedAt(target: QuarterKey): GameSession {
  const s = newSession(data, RULE_REGISTRY);
  const r = runRange(playerTimeline(s.realTrack, []), s.events, s.params, s.baseline, s.realTrack, s.commute, target, {
    registry: RULE_REGISTRY,
  });
  if (!r.ok) throw new Error(`runRange failed at ${target}`);
  return { ...s, computed: r };
}

function districtSeries(id: string, code: string) {
  const ind = data.history.indicators.find((i) => i.id === id);
  if (ind === undefined || ind.level !== 'district') throw new Error(`no district indicator ${id}`);
  const series = ind.series[code];
  if (series === undefined) throw new Error(`no series ${id}/${code}`);
  return series;
}

describe('real public/data files', () => {
  it('loadDataFiles returns ok: true for the 6 real files', () => {
    expect(failures).toEqual([]);
    expect(data).toBeDefined();
    expect(data.districts.length).toBe(41);
  }, T);

  it('commute-matrix.json holds only codes and minutes', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'commute-matrix.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['codes', 'minutes']);
    const codes = raw['codes'] as string[];
    const minutes = raw['minutes'] as number[][];
    expect(codes.length).toBe(41);
    expect(minutes.length).toBe(41);
    for (const row of minutes) {
      expect(row.length).toBe(41);
      for (const m of row) expect(Number.isFinite(m)).toBe(true);
    }
  }, T);

  it('Price_To_Income: hand-computed value and estimate flag on real history', () => {
    const code = data.districts[0]!.code;
    const price = districtSeries('medianTotalPrice', code);
    const income = districtSeries('householdIncome', code);
    const qi = price.findIndex((r, i) => r.value !== null && income[i]?.value != null);
    expect(qi).toBeGreaterThanOrEqual(0);
    const p = price[qi]!.value as number;
    const inc = income[qi]!.value as number;
    const q = data.history.quarters[qi]!;
    const got = priceToIncome(data.history, code, q);
    expect(got.value).toBe(Math.round((p / inc) * 100) / 100);
    expect(got.estimated).toBe(true);
  }, T);
});

describe('real-data views', () => {
  it('map model: 5 indicators, lowUseHousingRate null/dataPeriod rule, medianTotalPrice present', () => {
    const s = computedAt('2016Q2');
    let lowUseNull = 0;
    let lowUseSet = 0;
    for (const indicator of MAP_INDICATOR_IDS) {
      const view = buildGameView({ ...s, mapIndicator: indicator }, UI, data);
      expect(view.map.indicator).toBe(indicator);
      expect(view.map.districts.length).toBe(41);
      expect(view.map.legend.indicator).toBe(indicator);
      if (indicator === 'lowUseHousingRate') {
        for (const d of view.map.districts) {
          if (d.central === null) {
            lowUseNull += 1;
            expect(d.dataPeriod).toBeNull();
          } else {
            lowUseSet += 1;
            expect(typeof d.dataPeriod).toBe('string');
          }
        }
      }
    }
    expect(lowUseNull + lowUseSet).toBe(41);
    const withPrice = data.districts.filter((d) => districtSeries('medianTotalPrice', d.code).some((r) => r.value !== null));
    expect(withPrice.length).toBeGreaterThan(0);
  }, T);

  it('district panel values equal runRange for one district per city and two quarters', () => {
    for (const target of ['2015Q4', '2016Q2'] as const) {
      const s0 = computedAt(target);
      const last = s0.computed?.ranges[s0.computed.ranges.length - 1];
      expect(last?.quarter).toBe(target);
      for (const city of ['Taipei', 'New Taipei']) {
        const d = data.districts.find((x) => x.city === city);
        if (d === undefined) throw new Error(`no district in ${city}`);
        const view = buildGameView({ ...s0, selectedDistrict: d.code }, UI, data);
        expect(view.districtPanel.mode).toBe('quarter');
        let checked = 0;
        for (const row of view.districtPanel.rows) {
          const engineId = ENGINE_ID[row.id];
          if (engineId === undefined) continue;
          const r = last?.ranges[engineId]?.[d.code];
          expect(r).toBeDefined();
          if (r === undefined || row.simulated === null) throw new Error(`row ${row.id} not simulated`);
          let want = { min: r.min, central: r.central, max: r.max };
          if (row.id === 'populationChange') {
            const base = districtSeries('population', d.code)[0]!.value as number;
            want = {
              min: populationChange(r.min, base),
              central: populationChange(r.central, base),
              max: populationChange(r.max, base),
            };
          }
          expect(row.simulated.range).toEqual(want);
          checked += 1;
        }
        expect(checked).toBe(Object.keys(ENGINE_ID).length);
      }
    }
  }, T);
});
