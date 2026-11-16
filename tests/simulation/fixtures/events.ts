// Event fixtures. Real-style events carry no modifier; synthetic events carry modifiers and are used
// only with a table from `withModifierParameters` (Requirement 11.9).

import type { QuarterKey } from '../../../src/types/data-files.ts';
import type { SimEvent, ToolId } from '../../../src/types/simulation.ts';

export function makeEvent(
  id: string,
  firstQuarter: QuarterKey,
  lastQuarter: QuarterKey,
  modifiers: readonly { readonly tool: ToolId; readonly parameterId: string }[] = [],
): SimEvent {
  return {
    id,
    type: 'test',
    firstQuarter,
    lastQuarter,
    affectedIndicators: ['rent'],
    magnitude: { text: 'Fixture magnitude, display only.', value: 1, unit: 'percent' },
    sources: ['src.rent'],
    modifiers,
  };
}

/** Real-style events: known ids and quarters, no modifier, no modifier parameter in the table. */
export function buildRealStyleEvents(): readonly SimEvent[] {
  return [
    makeEvent('house-land-tax-2016', '2016Q1', '2016Q1'),
    makeEvent('covid-19', '2020Q1', '2021Q4'),
    makeEvent('credit-controls-2020', '2020Q4', '2020Q4'),
    makeEvent('rate-hikes-2022', '2022Q1', '2023Q1'),
    makeEvent('tpass-launch', '2023Q1', '2023Q1'),
  ];
}

/**
 * Synthetic events that carry modifiers. Event `i` covers the quarters given and uses the parameters
 * `test.modifier.<n>` listed for it; add the matching parameters with `withModifierParameters`.
 */
export function buildSyntheticEvents(
  specs: readonly {
    readonly id: string;
    readonly first: QuarterKey;
    readonly last: QuarterKey;
    readonly modifiers: readonly { readonly tool: ToolId; readonly n: number }[];
  }[],
): readonly SimEvent[] {
  return specs.map((s) =>
    makeEvent(
      s.id,
      s.first,
      s.last,
      s.modifiers.map((m) => ({ tool: m.tool, parameterId: `test.modifier.${m.n}` })),
    ),
  );
}
