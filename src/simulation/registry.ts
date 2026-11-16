// Rule_Registry (Requirement 16): 3 tool rules and 7 indicator rules in a fixed order.
// The registry order drives every iteration in the engine (tools, then indicators by stage).

import type { ParameterSpec, RuleRegistry } from '../types/simulation.ts';
import { commuterPassRule } from './rules/commuter-pass.ts';
import { ghostCountRule } from './rules/ghost-count.ts';
import { meanCommuteTimeRule } from './rules/mean-commute-time.ts';
import { mrtEntriesRule } from './rules/mrt-entries.ts';
import { populationRule } from './rules/population.ts';
import { rentBurdenRule } from './rules/rent-burden.ts';
import { rentSubsidyRule } from './rules/rent-subsidy.ts';
import { rentRule } from './rules/rent.ts';
import { socialHousingStockRule } from './rules/social-housing-stock.ts';
import { socialHousingRule } from './rules/social-housing.ts';

export const RULE_REGISTRY: RuleRegistry = Object.freeze({
  tools: Object.freeze([socialHousingRule, commuterPassRule, rentSubsidyRule]),
  indicators: Object.freeze([
    // pre-migration
    socialHousingStockRule,
    rentRule,
    mrtEntriesRule,
    meanCommuteTimeRule,
    rentBurdenRule,
    // post-migration
    populationRule,
    ghostCountRule,
  ]),
});

/**
 * Every ParameterSpec of the registry's rules, in registry order. Several rules name the same
 * parameter (housing.*, migration.*, ghost.*); the first spec of an id is kept.
 */
export function collectParameterSpecs(registry: RuleRegistry): readonly ParameterSpec[] {
  const seen = new Set<string>();
  const out: ParameterSpec[] = [];
  const rules = [...registry.tools, ...registry.indicators];
  for (const rule of rules) {
    for (const spec of rule.parameters()) {
      if (seen.has(spec.id)) continue;
      seen.add(spec.id);
      out.push(spec);
    }
  }
  return out;
}
