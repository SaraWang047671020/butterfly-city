// Range_Source helpers (Requirements 20.2, 20.3, 20.5, 5.3). Pure; no Scenario name leaves this module.

import { SCENARIO_EFFECT_IDS, SCENARIO_EFFECT_PARAMETERS, scenarioTable } from '../../simulation/params.ts';
import type { ParameterTable, ScenarioName } from '../../types/simulation.ts';
import type { ParameterAssumptionView } from '../../types/view.ts';

/** First of low, high, central whose value equals the minimum. */
export function scenarioOfMin(v: Readonly<Record<ScenarioName, number>>): ScenarioName {
  const min = Math.min(v.low, v.high, v.central);
  if (v.low === min) return 'low';
  if (v.high === min) return 'high';
  return 'central';
}

/** First of high, low, central whose value equals the maximum. */
export function scenarioOfMax(v: Readonly<Record<ScenarioName, number>>): ScenarioName {
  const max = Math.max(v.low, v.high, v.central);
  if (v.high === max) return 'high';
  if (v.low === max) return 'low';
  return 'central';
}

function orNull(text: string | undefined): string | null {
  return text === undefined || text.trim() === '' ? null : text;
}

/**
 * Scalar Scenario effect parameters of one Scenario's table, in `SCENARIO_EFFECT_IDS` order.
 * A ranged value cites the end of its range that the table value was taken from
 * (the Scenario's `low` Scenario takes the strongest end, which is `range.high` for a
 * high-is-strongest parameter), so the citation always belongs to the listed value.
 */
export function assumptionsFor(params: ParameterTable, scenario: ScenarioName): readonly ParameterAssumptionView[] {
  const table = scenarioTable(params, scenario);
  const out: ParameterAssumptionView[] = [];
  for (const id of SCENARIO_EFFECT_IDS) {
    const p = table[id];
    if (p === undefined || p.kind !== 'scalar') continue;
    let cite = p.source;
    if (scenario !== 'central' && p.range !== undefined) {
      const direction = SCENARIO_EFFECT_PARAMETERS.find((e) => e.id === id)?.direction;
      const lowEnd = (scenario === 'low') === (direction === 'low-is-strongest');
      cite = lowEnd ? p.range.lowSource : p.range.highSource;
    }
    out.push({ parameterId: id, value: p.value, unit: p.unit, citation: orNull(cite.citation), url: orNull(cite.url) });
  }
  return out;
}
