// Engine round-trip with the real event cards (event-library Requirement 3.3, task 6.3).
// The 35 cards of public/data/events.json, mapped to engine events the way src/data/convert.ts does,
// give the same Sim_States as an empty event list, with every tool at its real value.

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/simulation/engine.ts';
import type { EventsFile } from '../../src/types/events-file.ts';
import type { SimEvent } from '../../src/types/simulation.ts';
import { buildBaseline, buildCommuteMatrix, buildParams, buildRealTrack } from './fixtures/index.ts';

const file = JSON.parse(fs.readFileSync('public/data/events.json', 'utf8')) as EventsFile;
const events: SimEvent[] = file.events.map((card) => ({
  id: card.id,
  type: card.type,
  firstQuarter: card.firstQuarter,
  lastQuarter: card.lastQuarter,
  affectedIndicators: [],
  magnitude: { text: '' },
  sources: [],
  modifiers: [],
}));

describe('real event cards in the engine', () => {
  it('give Sim_States deep-equal to the empty event list, and no Event Cause moves a value', () => {
    const baseline = buildBaseline({ quarters: 44 });
    const realTrack = buildRealTrack({ quarters: 44 });
    const params = buildParams();
    const commute = buildCommuteMatrix();
    const withEvents = run(realTrack, events, params, baseline, realTrack, commute, '2025Q4');
    const without = run(realTrack, [], params, baseline, realTrack, commute, '2025Q4');
    expect(events).toHaveLength(35);
    expect(withEvents.ok).toBe(true);
    expect(without.ok).toBe(true);
    if (!withEvents.ok || !without.ok) return;
    expect(withEvents.states.map((s) => s.values)).toEqual(without.states.map((s) => s.values));
  });
});
