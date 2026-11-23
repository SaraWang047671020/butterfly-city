// story-layer task 4 (Requirements 4.1 to 4.8) on the real Data_Files: Persona numbers, states and Story_Values.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { convert } from '../../src/data/convert.ts';
import { validateCitizenFile, validateIncomeSpread, type CitizenFile, type IncomeSpread } from '../../src/data/story-loader.ts';
import { playerTimeline } from '../../src/game/core/policy.ts';
import { newSession } from '../../src/game/core/session.ts';
import { buildStoryFacts } from '../../src/game/story-facts.ts';
import { storyLines } from '../../src/narrative/select.ts';
import { runRange } from '../../src/simulation/engine.ts';
import { normalQuantile, personaRentBurden } from '../../src/simulation/persona.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';

const json = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8')) as never;
const data = convert({
  districts: json('public/data/districts.json'),
  history: json('public/data/history.json'),
  policyTrack: json('public/data/policy-track.json'),
  events: json('public/data/events.json'),
  params: json('public/data/params.json'),
  commute: json('public/data/commute-matrix.json'),
});
const codes = new Set(data.districts.map((d) => d.code));
const c = validateCitizenFile(json('data/config/citizens.json'), codes);
const s = validateIncomeSpread(json('public/data/income-spread.json'), codes);
if (!c.ok || !s.ok) throw new Error('story files invalid');
const citizens: CitizenFile = c.value;
const spread: IncomeSpread = s.value;

const history = (id: 'rent' | 'householdIncome', code: string, qi: number): number | null => {
  const ind = data.history.indicators.find((i) => i.id === id);
  if (ind === undefined || ind.level !== 'district') return null;
  return ind.series[code]?.[qi]?.value ?? null;
};
const fmt = (x: number, d: number) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

describe('Persona numbers', () => {
  it('normalQuantile matches known values', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.1)).toBeCloseTo(-1.281552, 5);
    expect(normalQuantile(0.01)).toBeCloseTo(-2.326348, 5);
    expect(() => normalQuantile(0)).toThrow();
  });

  it('a Persona at percentile 50 has the median household burden 1200 × rent × size / income', () => {
    const b = personaRentBurden({ rentPerM2: 500, dwellingSize: 40, householdIncome: 1_200_000, sigma: 1, incomePercentile: 50 });
    expect(b).toBeCloseTo((500 * 40 * 1200) / 1_200_000, 9);
    const poorer = personaRentBurden({ rentPerM2: 500, dwellingSize: 40, householdIncome: 1_200_000, sigma: 1, incomePercentile: 10 });
    expect(poorer).toBeGreaterThan(b);
  });
});

describe('Story_Facts on the real data (real track computed to 2016Q4)', () => {
  const session = newSession(data, RULE_REGISTRY);
  const run = runRange(playerTimeline(session.realTrack, []), session.events, session.params, session.baseline, session.realTrack, session.commute, '2016Q4', {
    registry: RULE_REGISTRY,
  });
  if (!run.ok) throw new Error('engine run failed');

  it(
    'every Persona gets a rent state, a commute state and fully filled lines; with no policy change the comparison is "same"',
    () => {
      for (const persona of citizens.personas) {
        const facts = buildStoryFacts({
          persona,
          citizens,
          spread,
          params: session.params,
          commute: session.commute,
          history,
          ranges: run.ranges,
          displayed: run.ranges.length - 1,
          quarters: data.history.quarters,
          format: fmt,
        });
        expect(facts).not.toBeNull();
        if (facts === null) continue;
        expect(facts.state.comparison).toBe('same');
        expect(facts.state.commute === 'none').toBe(persona.workCode === null || persona.workCode === persona.homeCode);
        const burden = Number(facts.values['rentBurden']);
        expect(burden).toBeGreaterThan(1);
        expect(burden).toBeLessThan(200);
        const lines = storyLines(citizens.templates, facts.state, facts.values);
        for (const l of lines) expect('error' in l ? `${l.id}: ${l.error.placeholder}` : 'ok').toBe('ok');
        expect(facts.endingValues).toBeNull(); // not all 44 quarters computed
      }
    },
    120_000,
  );

  it('leaves a value out instead of using 0 when the income spread of the home district is missing (4.8)', () => {
    const persona = citizens.personas[0]!;
    const sigma = { ...spread.sigma };
    delete sigma[persona.homeCode];
    const facts = buildStoryFacts({
      persona,
      citizens,
      spread: { ...spread, sigma },
      params: session.params,
      commute: session.commute,
      history,
      ranges: run.ranges,
      displayed: 0,
      quarters: data.history.quarters,
      format: fmt,
    });
    expect(facts?.values['rentBurden']).toBeUndefined();
    expect(facts?.values['name']).toBe(persona.name);
  });
});
