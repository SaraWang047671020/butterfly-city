import { describe, expect, it } from 'vitest';

import { convert } from '../../src/data/convert.ts';
import { applyAdjustment } from '../../src/game/core/checks.ts';
import type { EditRequest } from '../../src/game/core/checks.ts';
import { newSession } from '../../src/game/core/session.ts';
import { computeNext } from '../../src/game/core/turns.ts';
import { buildGameView, buildRangeSourceView } from '../../src/game/core/views.ts';
import type { ControllerUiState } from '../../src/game/core/views.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import type { EditCheckView, RangeSourceView } from '../../src/types/view.ts';
import { readFixture } from '../data/fixtures/index.ts';

const data = convert({
  districts: readFixture('districts.json'),
  history: readFixture('history.json'),
  policyTrack: readFixture('policy-track.json'),
  events: readFixture('events.json'),
  params: readFixture('params.json'),
  commute: readFixture('commute-matrix.json'),
});

const SCENARIO_ID = /^\s*(central|low|high)\s*$/i;
const SCENARIO_LABEL = /\b(central|low|high)\s+scenario\b|\bscenario\s*[:=-]?\s*(central|low|high)\b/i;

/** Every string value (not key) in `x` that is a Scenario id or label. */
function scenarioStrings(x: unknown, path = '$', out: string[] = []): string[] {
  if (typeof x === 'string') {
    if (SCENARIO_ID.test(x) || SCENARIO_LABEL.test(x)) out.push(`${path} = ${JSON.stringify(x)}`);
  } else if (Array.isArray(x)) {
    x.forEach((v, i) => scenarioStrings(v, `${path}[${i}]`, out));
  } else if (x instanceof Map) {
    for (const [k, v] of x) scenarioStrings(v, `${path}.${String(k)}`, out);
  } else if (x !== null && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) scenarioStrings(v, `${path}.${k}`, out);
  }
  return out;
}

const idleUi: ControllerUiState = {
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

describe('GameView holds no Scenario id or label as display text (19.13, 5.3, 20.3)', () => {
  it('fixture sessions with an open Range_Source_View and a rejected edit', { timeout: 120_000 }, () => {
    const fresh = newSession(data, RULE_REGISTRY);
    expect(scenarioStrings(buildGameView(null, idleUi, data))).toEqual([]);
    expect(scenarioStrings(buildGameView(fresh, idleUi, data))).toEqual([]);

    const outcome = computeNext(fresh);
    expect(outcome.engineError).toBeNull();
    const session = { ...outcome.session, selectedDistrict: data.districts[0]?.code ?? null };
    const quarter = session.computed?.central[session.computed.central.length - 1]?.quarter;
    expect(quarter).toBe('2015Q1');

    // Rejected edit: a negative value for a count field.
    const req: EditRequest = {
      target: { tool: 'rentSubsidy', field: 'households', area: 'Taipei' },
      kind: 'value',
      text: '-1000000000',
    };
    const { check } = applyAdjustment(session, req);
    expect(check.status).not.toBe('ok');
    const draft: { text: string; check: EditCheckView } = { text: req.text, check };

    // Open Range_Source_View for every map indicator on the first district.
    const code = session.selectedDistrict as string;
    const sources: RangeSourceView[] = [];
    for (const indicator of ['rentBurden', 'commuteTime', 'populationChange'] as const) {
      const src = buildRangeSourceView(session, data, { indicator, district: code, quarter: '2015Q1' });
      if (src !== null) sources.push(src);
    }
    expect(sources.length).toBeGreaterThan(0);

    const views = [
      buildGameView(session, idleUi, data),
      buildGameView(
        session,
        { ...idleUi, drafts: new Map([['rentSubsidy|households|Taipei', draft]]) },
        data,
      ),
      ...sources.map((source) => buildGameView(session, { ...idleUi, dialog: { kind: 'range-source', source } }, data)),
    ];
    for (const v of views) expect(scenarioStrings(v)).toEqual([]);
  });

  it('the scanner flags Scenario ids and labels', () => {
    expect(scenarioStrings({ a: ['Low'], b: { c: 'High Scenario' } })).toHaveLength(2);
    expect(scenarioStrings({ central: 1, text: 'Lowest value' })).toEqual([]);
  });
});
