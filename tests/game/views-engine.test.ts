// Engine parity (task 8.14): the values buildGameView passes equal the runRange Result_Ranges.
// Validates: Requirements 18.5, 5.1

import { describe, expect, it } from 'vitest';

import { convert } from '../../src/data/convert.ts';
import type { LoadedData } from '../../src/data/convert.ts';
import { populationChange } from '../../src/game/core/conversions.ts';
import { newSession } from '../../src/game/core/session.ts';
import type { GameSession } from '../../src/game/core/session.ts';
import { buildGameView, buildRangeSourceView } from '../../src/game/core/views.ts';
import type { ControllerUiState } from '../../src/game/core/views.ts';
import { playerTimeline } from '../../src/game/core/policy.ts';
import { runRange } from '../../src/simulation/engine.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import type { PanelRowId } from '../../src/types/view.ts';
import type { QuarterKey } from '../../src/types/data-files.ts';
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

function basePopulation(data: LoadedData, code: string): number {
  const ind = data.history.indicators.find((i) => i.id === 'population');
  if (ind === undefined || ind.level !== 'district') throw new Error('no population');
  const v = ind.series[code]?.[0]?.value;
  if (v === undefined || v === null) throw new Error('no base');
  return v;
}

describe('buildGameView equals runRange Result_Ranges', () => {
  it(
    'one district per city, two Computed_Quarters, every simulated row and the Range_Source_View',
    () => {
      const data = load();
      const picks = ['Taipei', 'New Taipei'].map((city) => {
        const d = data.districts.find((x) => x.city === city);
        if (d === undefined) throw new Error(`no district in ${city}`);
        return d;
      });
      for (const target of ['2015Q4', '2016Q2'] as const) {
        const s0 = computedAt(data, target);
        const last = s0.computed?.ranges[s0.computed.ranges.length - 1];
        expect(last?.quarter).toBe(target);
        for (const d of picks) {
          const s = { ...s0, selectedDistrict: d.code };
          const view = buildGameView(s, UI, data);
          expect(view.districtPanel.mode).toBe('quarter');
          let checked = 0;
          for (const row of view.districtPanel.rows) {
            const engineId = ENGINE_ID[row.id];
            if (engineId === undefined) {
              expect(row.simulated).toBeNull();
              continue;
            }
            const r = last?.ranges[engineId]?.[d.code];
            expect(r).toBeDefined();
            if (r === undefined || row.simulated === null) throw new Error(`row ${row.id} not simulated`);
            let want = { min: r.min, central: r.central, max: r.max };
            if (row.id === 'populationChange') {
              const base = basePopulation(data, d.code);
              want = {
                min: populationChange(r.min, base),
                central: populationChange(r.central, base),
                max: populationChange(r.max, base),
              };
            }
            expect(row.simulated.range).toEqual(want);
            const rs = buildRangeSourceView(s, data, row.simulated.ref);
            expect(rs?.value.range).toEqual(want);
            checked += 1;
          }
          expect(checked).toBe(Object.keys(ENGINE_ID).length);
        }
      }
    },
    120_000,
  );
});
