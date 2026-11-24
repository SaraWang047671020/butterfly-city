// District_Card rows (play-loop Requirement 7.5): the card shows the District_Panel's value and its difference from
// the comparison value, in the panel's decimals and units.
import { describe, expect, it } from 'vitest';
import type { PanelRowView } from '../../src/types/view.ts';
import { cardRow } from '../../src/ui/district-card.ts';

const row = (central: number, comparison: number | null, percentRow = true): PanelRowView =>
  ({
    id: 'rentBurden',
    unit: 'percent of household income',
    decimals: 1,
    simulated: {
      ref: { kind: 'district', district: '63000030', row: 'rentBurden' },
      range: { min: central, central, max: central },
      unit: 'percent of household income',
      decimals: 1,
      comparison: { value: comparison, label: 'derived-baseline' },
      estimated: null,
    },
    realOnly: null,
    percentRow,
    sourceNames: [],
    modelEstimate: false,
  }) as unknown as PanelRowView;

describe('cardRow', () => {
  it('shows the value and the difference above real history in percentage points', () => {
    expect(cardRow(row(30.24, 29.6))).toEqual({ value: '30.2 percent of household income', diff: '0.6 percentage points above real history' });
  });

  it('says same as real history when the shown difference rounds to 0', () => {
    expect(cardRow(row(30.24, 30.22)).diff).toBe('same as real history');
  });

  it('shows no difference without a comparison value', () => {
    expect(cardRow(row(30.2, null)).diff).toBeNull();
  });
});
