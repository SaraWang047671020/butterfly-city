// City_View data from the Game_Controller (city-3d Requirement 2, task 3.3).
// Ghost counts in the map view equal the central runRange output; the Price_Index equals the quotient of the
// two salePrice records; the City_Static_View carries every district with its polygons and 2015Q1 population.

import { describe, expect, it } from 'vitest';

import { convert } from '../../src/data/convert.ts';
import type { LoadedData } from '../../src/data/convert.ts';
import { playerTimeline } from '../../src/game/core/policy.ts';
import { newSession } from '../../src/game/core/session.ts';
import type { GameSession } from '../../src/game/core/session.ts';
import { buildCityStatic, buildGameView, priceIndexOf } from '../../src/game/core/views.ts';
import type { ControllerUiState } from '../../src/game/core/views.ts';
import { runRange } from '../../src/simulation/engine.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import type { QuarterKey } from '../../src/types/data-files.ts';
import { quarterIndex } from '../../src/simulation/quarter.ts';
import { readFixture } from '../data/fixtures/index.ts';

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

function load(): LoadedData {
  return convert({
    districts: readFixture('districts.json'),
    history: readFixture('history.json'),
    policyTrack: readFixture('policy-track.json'),
    events: readFixture('events.json'),
    params: readFixture('params.json'),
    commute: readFixture('commute-matrix.json'),
  });
}

function computedAt(data: LoadedData, target: QuarterKey): GameSession {
  const s = newSession(data, RULE_REGISTRY);
  const r = runRange(playerTimeline(s.realTrack, []), s.events, s.params, s.baseline, s.realTrack, s.commute, target, {
    registry: RULE_REGISTRY,
  });
  if (!r.ok) throw new Error(`runRange failed at ${target}`);
  return { ...s, computed: r };
}

function salePrice(data: LoadedData, code: string, qi: number): number | null {
  const ind = data.history.indicators.find((i) => i.id === 'salePrice');
  if (ind === undefined || ind.level !== 'district') return null;
  return ind.series[code]?.[qi]?.value ?? null;
}

describe('City_View data (city-3d Requirement 2)', () => {
  it(
    'ghosts equal the central runRange Ghost count and priceIndex equals the salePrice quotient, one district per city, two quarters',
    () => {
      const data = load();
      const picks = ['Taipei', 'New Taipei'].map((city) => {
        const d = data.districts.find((x) => x.city === city);
        if (d === undefined) throw new Error(`no district in ${city}`);
        return d;
      });
      for (const target of ['2015Q4', '2016Q2'] as const) {
        const s = computedAt(data, target);
        const last = s.computed?.ranges[s.computed.ranges.length - 1];
        const view = buildGameView(s, UI, data);
        const qi = quarterIndex(target);
        for (const d of picks) {
          const m = view.map.districts.find((x) => x.code === d.code);
          if (m === undefined) throw new Error('district missing from map view');
          const r = last?.ranges['ghostCount']?.[d.code];
          expect(r).toBeDefined();
          expect(m.ghosts).toBe(r?.central);
          const base = salePrice(data, d.code, 0);
          const now = salePrice(data, d.code, qi);
          const want = base === null || now === null || base === 0 ? null : now / base;
          expect(m.priceIndex).toBe(want);
        }
      }
    },
    120_000,
  );

  it('ghosts are null before any quarter is computed', () => {
    const data = load();
    const view = buildGameView(newSession(data, RULE_REGISTRY), UI, data);
    for (const m of view.map.districts) expect(m.ghosts).toBeNull();
    const noSession = buildGameView(null, UI, data);
    for (const m of noSession.map.districts) expect(m.ghosts).toBeNull();
  });

  it('priceIndex is null when a record is missing', () => {
    const data = load();
    const code = data.districts[0]!.code;
    const missing = { ...data.history, indicators: data.history.indicators.filter((i) => i.id !== 'salePrice') };
    expect(priceIndexOf(missing, code, 4)).toBeNull();
    expect(priceIndexOf(data.history, code, 0)).toBe(salePrice(data, code, 0) === null ? null : 1);
  });

  it('cityStatic lists every district in code order with polygons and 2015Q1 population', () => {
    const data = load();
    const cs = buildCityStatic(data);
    expect(cs.districts.map((d) => d.code)).toEqual(data.districts.map((d) => d.code));
    const pop = data.history.indicators.find((i) => i.id === 'population');
    for (const d of cs.districts) {
      expect(d.polygons.length).toBeGreaterThan(0);
      for (const poly of d.polygons) expect(poly[0]!.length).toBeGreaterThanOrEqual(4);
      const want = pop !== undefined && pop.level === 'district' ? (pop.series[d.code]?.[0]?.value ?? 0) : 0;
      expect(d.population2015).toBe(want);
    }
  });
});
