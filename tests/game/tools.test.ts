import { describe, expect, it } from 'vitest';

import { fieldUnit, fieldsMeta, toolStatus } from '../../src/game/core/tools.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import { TRACK_FIELDS } from '../../src/data/expected.ts';
import type { PolicyToolId } from '../../src/types/data-files.ts';
import type { RuleRegistry, ToolRule } from '../../src/types/simulation.ts';

const IDS: readonly PolicyToolId[] = ['socialHousing', 'sublease', 'rentSubsidy', 'holdingTax', 'commuterPass'];

describe('toolStatus (19.6, 8.2)', () => {
  it('real registry: sublease and holdingTax are coming soon, the other three active', () => {
    const status = Object.fromEntries(IDS.map((id) => [id, toolStatus(RULE_REGISTRY, id)]));
    expect(status).toEqual({
      socialHousing: 'active',
      sublease: 'coming-soon',
      rentSubsidy: 'active',
      holdingTax: 'coming-soon',
      commuterPass: 'active',
    });
  });

  it('a registry copy with a stub sublease rule makes sublease active', () => {
    const stub = { ...RULE_REGISTRY.tools[0]!, id: 'sublease' } as unknown as ToolRule;
    const registry: RuleRegistry = { ...RULE_REGISTRY, tools: [...RULE_REGISTRY.tools, stub] };
    expect(toolStatus(registry, 'sublease')).toBe('active');
    expect(toolStatus(registry, 'holdingTax')).toBe('coming-soon');
  });

  it('a registry copy without one tool id makes that tool coming soon', () => {
    const registry: RuleRegistry = {
      ...RULE_REGISTRY,
      tools: RULE_REGISTRY.tools.filter((rule) => rule.id !== 'commuterPass'),
    };
    expect(toolStatus(registry, 'commuterPass')).toBe('coming-soon');
    expect(toolStatus(registry, 'socialHousing')).toBe('active');
  });
});

describe('fieldUnit and fieldsMeta (no default unit)', () => {
  const units: Record<string, string> = Object.fromEntries(Object.keys(TRACK_FIELDS).map((id) => [id, `unit-${id}`]));

  it('reads units from the series mapped to the field', () => {
    expect(fieldUnit(units, 'socialHousing', 'unitsStarted')).toBe('unit-socialHousingUnitsStarted');
    expect(fieldUnit(units, 'socialHousing', 'nope')).toBeUndefined();
  });

  it('treats a blank unit as absent', () => {
    expect(fieldUnit({ socialHousingUnitsStarted: '  ' }, 'socialHousing', 'unitsStarted')).toBeUndefined();
  });

  it('fieldsMeta carries units of every field when all series have one', () => {
    for (const rule of RULE_REGISTRY.tools) {
      const { fields, missingUnits } = fieldsMeta(rule, units);
      expect(missingUnits).toEqual([]);
      expect(fields.map((f) => f.field)).toEqual(rule.fields.map((f) => f.id));
      for (const f of fields) expect(f.unit.startsWith('unit-')).toBe(true);
    }
  });

  it('fieldsMeta reports missingUnits when a series unit is absent', () => {
    const rule = RULE_REGISTRY.tools.find((r) => r.id === 'socialHousing')!;
    const { fields, missingUnits } = fieldsMeta(rule, {});
    expect(fields).toEqual([]);
    expect(missingUnits).toEqual(rule.fields.map((f) => `socialHousing.${f.id}`));
    expect(missingUnits).toContain('socialHousing.unitsStarted');
  });
});
