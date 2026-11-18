// Shared generator of valid Saves over the real Rule_Registry and the fixture districts.

import fc from 'fast-check';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import { MAP_INDICATOR_IDS } from '../../src/types/save.ts';
import type { PolicyDiffSeries, Save, TimelineEntry } from '../../src/types/save.ts';
import type { SaveValidationContext } from '../../src/save/validate-save.ts';
import type { QuarterKey } from '../../src/types/data-files.ts';
import type { AreaKey } from '../../src/types/simulation.ts';
import { CITIES, DISTRICTS, DISTRICT_CODES } from '../simulation/fixtures/districts.ts';

export const SAVE_CTX: SaveValidationContext = {
  registry: RULE_REGISTRY,
  districts: DISTRICTS.map((d) => ({ code: d.code, city: d.city })),
};

export const QUARTER_KEYS: readonly QuarterKey[] = Array.from({ length: 44 }, (_, i) => {
  return `${2015 + Math.floor(i / 4)}Q${(i % 4) + 1}` as QuarterKey;
});

interface FieldChoice {
  readonly tool: string;
  readonly field: string;
  readonly area: AreaKey;
  readonly integer: boolean;
}

const CHOICES: readonly FieldChoice[] = RULE_REGISTRY.tools.flatMap((rule) =>
  rule.fields.flatMap((f) =>
    (f.area === 'district' ? DISTRICT_CODES : CITIES).map((area) => ({
      tool: rule.id,
      field: f.id,
      area,
      integer: f.integer === true,
    })),
  ),
);

const noNegZero = (n: number): number => (Object.is(n, -0) ? 0 : n);
const realNumber = fc.double({ noNaN: true, noDefaultInfinity: true }).map(noNegZero);
const intNumber = fc.integer({ min: -1_000_000, max: 1_000_000 });
const valueOf = (integer: boolean) => (integer ? intNumber : realNumber);

const seriesArb: fc.Arbitrary<PolicyDiffSeries> = fc
  .constantFrom(...CHOICES)
  .chain((c) =>
    fc
      .array(valueOf(c.integer), { minLength: 44, maxLength: 44 })
      .filter((diffs) => diffs.some((d) => d !== 0))
      .map((diffs) => ({ tool: c.tool, field: c.field, area: c.area, diffs })),
  );

const entryArb: fc.Arbitrary<TimelineEntry> = fc
  .tuple(fc.constantFrom(...CHOICES), fc.constantFrom(...QUARTER_KEYS), fc.boolean())
  .chain(([c, quarter, real]) =>
    fc.tuple(valueOf(c.integer), valueOf(c.integer)).map(([before, after]): TimelineEntry => {
      const base = { quarter, tool: c.tool, field: c.field, area: c.area, before };
      return real ? { kind: 'real-track', ...base, after: null } : { kind: 'value', ...base, after };
    }),
  );

const keyOf = (s: PolicyDiffSeries): string => JSON.stringify([s.tool, s.field, s.area]);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const saveArb: fc.Arbitrary<Save> = fc
  .tuple(
    fc.uniqueArray(seriesArb, { selector: keyOf, maxLength: 6 }),
    fc.constantFrom<QuarterKey | 'complete'>(...QUARTER_KEYS, 'complete'),
    fc.array(entryArb, { maxLength: 12 }),
    fc.constantFrom(...MAP_INDICATOR_IDS),
    fc.option(fc.constantFrom(...DISTRICT_CODES), { nil: null }),
    fc.boolean(),
    fc.integer({ min: 0, max: 2 ** 31 - 1 }),
    fc.string({ minLength: 1, maxLength: 12 }),
  )
  .map(([series, next, entries, mapIndicator, selectedDistrict, demo, seed, engineVersion]) => {
    // Timeline entries must not be after the next quarter (validation step i).
    const limit = next === 'complete' ? 43 : QUARTER_KEYS.indexOf(next);
    const timeline = entries.filter((e) => QUARTER_KEYS.indexOf(e.quarter) <= limit);
    const policy = [...series].sort((a, b) => cmp(keyOf(a), keyOf(b)));
    return {
      schemaVersion: 1,
      engineVersion,
      next,
      policy,
      timeline,
      mapIndicator,
      selectedDistrict,
      demo,
      seed,
    } satisfies Save;
  });
