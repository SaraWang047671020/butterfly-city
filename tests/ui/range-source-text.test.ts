import { describe, expect, it } from 'vitest';
import { rangeSourceText } from '../../src/ui/explain/range-source-text.ts';
import type { ParameterAssumptionView, RangeSourceView } from '../../src/types/view.ts';

function valueView(min: number, central: number, max: number) {
  return {
    ref: { indicator: 'rent', district: '63000010', quarter: '2020Q1' },
    range: { min, central, max },
    unit: '%',
    decimals: 1,
    comparison: { value: null, label: 'real' },
    estimated: null,
  } as unknown as RangeSourceView['value'];
}

const lowA: ParameterAssumptionView = {
  parameterId: 'commuterPass.elasticity',
  value: 0.2,
  unit: 'ratio',
  citation: 'Study Low 2019',
  url: 'https://example.org/low',
};
const highA: ParameterAssumptionView = {
  parameterId: 'rentSubsidy.passThrough',
  value: 0.8,
  unit: 'share',
  citation: 'Study High 2021',
  url: 'https://example.org/high',
};

function rangeView(low: ParameterAssumptionView[], high: ParameterAssumptionView[]): RangeSourceView {
  return {
    value: valueView(10, 12, 14),
    same: false,
    lowest: { value: 10, assumptions: low },
    highest: { value: 14, assumptions: high },
  };
}

describe('rangeSourceText', () => {
  it('lists lowest and highest sections with equal detail and no Scenario name', () => {
    const t = rangeSourceText(rangeView([lowA], [highA]));
    expect(t.title).toBe('Why this range?');
    expect(t.display).toBe('12.0 % (possible range 10.0–14.0 %)');
    expect(t.sameText).toBeNull();
    expect(t.sections.map((s) => s.heading)).toEqual(['Lowest result', 'Highest result']);
    expect(t.sections[0]!.resultText).toBe('10.0 %');
    expect(t.sections[1]!.resultText).toBe('14.0 %');
    expect(t.sections[0]!.assumptions[0]!).toEqual({
      name: 'Commuter pass demand elasticity',
      line: 'Commuter pass demand elasticity: 0.2 ratio',
      citation: 'Study Low 2019',
      url: 'https://example.org/low',
      urlText: 'No source recorded',
    });
    expect(t.sections[1]!.assumptions[0]!.line).toBe('Share of rent subsidy passed into rents: 0.8 share');
    expect(t.sections[1]!.assumptions[0]!.citation).toBe('Study High 2021');
    expect(JSON.stringify(t)).not.toMatch(/scenario(?! range)/i);
    expect(t.causeBreakdown.disabled).toBe(true);
  });

  it('gives the same-value text when every result is equal', () => {
    const t = rangeSourceText({
      value: valueView(12, 12, 12),
      same: true,
      lowest: null,
      highest: null,
    });
    expect(t.sameText).toBe('This value is the same under every parameter assumption in the model.');
    expect(t.display).toBe('12.0 %');
    expect(t.sections).toEqual([]);
  });

  it('shows "No source recorded" for a missing citation and a missing URL', () => {
    const t = rangeSourceText(
      rangeView(
        [{ ...lowA, citation: null, url: null }],
        [{ ...highA, citation: '  ', url: '' }],
      ),
    );
    for (const s of t.sections) {
      expect(s.assumptions[0]!.citation).toBe('No source recorded');
      expect(s.assumptions[0]!.url).toBeNull();
      expect(s.assumptions[0]!.urlText).toBe('No source recorded');
    }
  });

  it('cites the highest-result source on the highest side for a high-is-strongest parameter', () => {
    // A parameter where the high value gives the strongest effect: its high-end citation
    // belongs to the "Highest result" section, the low-end citation to "Lowest result".
    const t = rangeSourceText(
      rangeView(
        [{ ...highA, value: 0.3, citation: 'Source at low end', url: 'https://example.org/l' }],
        [{ ...highA, value: 0.9, citation: 'Source at high end', url: 'https://example.org/h' }],
      ),
    );
    const lowest = t.sections.find((s) => s.heading === 'Lowest result');
    const highest = t.sections.find((s) => s.heading === 'Highest result');
    expect(lowest?.assumptions[0]!.line).toBe('Share of rent subsidy passed into rents: 0.3 share');
    expect(lowest?.assumptions[0]!.citation).toBe('Source at low end');
    expect(highest?.assumptions[0]!.line).toBe('Share of rent subsidy passed into rents: 0.9 share');
    expect(highest?.assumptions[0]!.citation).toBe('Source at high end');
    expect(highest?.assumptions[0]!.url).toBe('https://example.org/h');
  });
});
