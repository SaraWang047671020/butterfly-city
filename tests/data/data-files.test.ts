import { describe, expect, it } from 'vitest';
import {
  CITY_NAMES,
  INDICATOR_KINDS,
  POLICY_TOOL_IDS,
  SCHEMA_VERSION,
} from '../../src/types/data-files.ts';

describe('data-files constants', () => {
  it('exposes the schema version, cities, indicator kinds and policy tools', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect([...CITY_NAMES]).toEqual(['Taipei', 'New Taipei']);
    expect(INDICATOR_KINDS).toHaveLength(5);
    expect(POLICY_TOOL_IDS).toHaveLength(5);
    expect(new Set(POLICY_TOOL_IDS).size).toBe(5);
  });
});
