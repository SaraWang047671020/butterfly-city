// Tool domains, Active/Coming_Soon detection and Tool_Field metadata (Requirements 8.1-8.3, 9.10).
// Holds no simulation formulas. Nothing here lists Coming_Soon ids: a tool is coming soon exactly
// when the Rule_Registry has no rule for its id.

import { TRACK_FIELDS } from '../../data/expected.ts';
import type { PolicyToolId } from '../../types/data-files.ts';
import type { RuleRegistry, ToolField, ToolRule } from '../../types/simulation.ts';

export type ToolDomain = 'housing' | 'transit';
export type ToolStatus = 'active' | 'coming-soon';

/** Domain of every Policy_Tool. Order of the Policy_Panel comes from POLICY_TOOL_IDS filtered by domain. */
export const TOOL_DOMAINS: Readonly<Record<PolicyToolId, ToolDomain>> = {
  socialHousing: 'housing',
  sublease: 'housing',
  rentSubsidy: 'housing',
  holdingTax: 'housing',
  commuterPass: 'transit',
};

/** Active when the Rule_Registry has a rule with this id, otherwise coming soon (8.2). */
export function toolStatus(registry: RuleRegistry, id: PolicyToolId): ToolStatus {
  return registry.tools.some((rule) => rule.id === id) ? 'active' : 'coming-soon';
}

/** Id of the unit-cost Parameter of a rule: the spec with role 'cost', or null when it declares none. */
export function unitCostParameterId(rule: ToolRule): string | null {
  const spec = rule.parameters().find((p) => p.role === 'cost');
  return spec === undefined ? null : spec.id;
}

/** Unit strings of the policy series, keyed by series id, as loaded from policy-track.json (`unit` field). */
export type SeriesUnits = Readonly<Record<string, string>>;

export interface FieldMeta {
  readonly tool: string;
  readonly field: string;
  /** Scope of one value: a district or a city (Area). */
  readonly scope: 'district' | 'city';
  /** Count_Field: only integers are accepted (9.10). */
  readonly countField: boolean;
  readonly limitScope: 'quarter' | 'city-year';
  /** Unit string exactly as written in the series data. */
  readonly unit: string;
}

/** Unit of a Tool_Field from the policy series mapped to it in TRACK_FIELDS; undefined when no series or unit exists. */
export function fieldUnit(units: SeriesUnits, tool: string, field: string): string | undefined {
  for (const [seriesId, target] of Object.entries(TRACK_FIELDS)) {
    if (target.tool === tool && target.field === field) {
      const unit = units[seriesId];
      return unit === undefined || unit.trim() === '' ? undefined : unit;
    }
  }
  return undefined;
}

/**
 * Metadata of one Tool_Field declared by a rule. Count_Field comes from the rule's `integer` flag.
 * Returns undefined when the data has no unit for the field; callers must handle it (no default unit).
 */
export function fieldMeta(rule: ToolRule, field: ToolField, units: SeriesUnits): FieldMeta | undefined {
  const unit = fieldUnit(units, rule.id, field.id);
  if (unit === undefined) return undefined;
  return {
    tool: rule.id,
    field: field.id,
    scope: field.area,
    countField: field.integer === true,
    limitScope: field.limitScope,
    unit,
  };
}

/** Metadata of every editable field of a rule, in the rule's order; fields without a data unit are listed in `missingUnits`. */
export function fieldsMeta(
  rule: ToolRule,
  units: SeriesUnits,
): { readonly fields: readonly FieldMeta[]; readonly missingUnits: readonly string[] } {
  const fields: FieldMeta[] = [];
  const missingUnits: string[] = [];
  for (const f of rule.fields) {
    const meta = fieldMeta(rule, f, units);
    if (meta === undefined) missingUnits.push(`${rule.id}.${f.id}`);
    else fields.push(meta);
  }
  return { fields, missingUnits };
}