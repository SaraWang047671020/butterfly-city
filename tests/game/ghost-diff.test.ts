// ghostDiffPersons (city-3d Requirement 6, changed 2026-11-23) on the real data: zero on the real track, and on the
// Demo_Save equal to the difference of two Engine runs with Ghost_Size 1 (persons, before the floor).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { convert } from '../../src/data/convert.ts';
import { playerTimeline } from '../../src/game/core/policy.ts';
import { fromSave, newSession } from '../../src/game/core/session.ts';
import { buildGameView } from '../../src/game/core/views.ts';
import type { ControllerUiState } from '../../src/game/core/views.ts';
import { decodeSaveCode } from '../../src/save/codec.ts';
import { DEMO_SAVE_CODE } from '../../src/save/demo-save.generated.ts';
import { runRange } from '../../src/simulation/engine.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';

const j = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8')) as never;
const data = convert({
  districts: j('public/data/districts.json'),
  history: j('public/data/history.json'),
  policyTrack: j('public/data/policy-track.json'),
  events: j('public/data/events.json'),
  params: j('public/data/params.json'),
  commute: j('public/data/commute-matrix.json'),
});
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

describe('ghostDiffPersons', () => {
  it('is zero for every district on the real track', () => {
    const s = newSession(data, RULE_REGISTRY);
    const r = runRange(playerTimeline(s.realTrack, []), s.events, s.params, s.baseline, s.realTrack, s.commute, '2016Q4', { registry: RULE_REGISTRY });
    if (!r.ok) throw new Error('run failed');
    const view = buildGameView({ ...s, computed: r }, UI, data);
    for (const d of view.map.districts) expect(Math.abs(d.ghostDiffPersons ?? NaN)).toBeLessThan(1e-6);
  }, 120_000);

  it('equals the persons difference of runs with Ghost_Size 1 on the Demo_Save (2021Q1)', () => {
    const dec = decodeSaveCode(DEMO_SAVE_CODE, { registry: RULE_REGISTRY, districts: data.districts });
    if (!dec.ok) throw new Error('demo save invalid');
    const loaded = fromSave(dec.save, data, RULE_REGISTRY);
    if (!loaded.ok) throw new Error('fromSave failed');
    const s = loaded.session;
    const view = buildGameView(s, UI, data);
    const size1 = { ...s.params, 'ghost.size': { ...(s.params['ghost.size'] as object), value: 1 } } as unknown as typeof s.params;
    const target = s.computed!.ranges[s.computed!.ranges.length - 1]!.quarter;
    const run = (diffs: typeof s.diffs) =>
      runRange(playerTimeline(s.realTrack, diffs), s.events, size1, s.baseline, s.realTrack, s.commute, target, { registry: RULE_REGISTRY });
    const real = run([]);
    const demo = run(s.diffs);
    if (!real.ok || !demo.ok) throw new Error('run failed');
    const at = (r: typeof real) => (r.ok ? r.ranges[r.ranges.length - 1]!.ranges['ghostCount']! : {});
    let total = 0;
    for (const d of view.map.districts) {
      const want = (at(demo)[d.code]?.central ?? 0) - (at(real)[d.code]?.central ?? 0);
      // The size-1 run floors persons; the view's value is not floored: they agree within one person.
      expect(Math.abs((d.ghostDiffPersons ?? NaN) - want)).toBeLessThanOrEqual(1);
      total += d.ghostDiffPersons ?? 0;
    }
    expect(Math.abs(total)).toBeGreaterThan(10);
  }, 240_000);
});
