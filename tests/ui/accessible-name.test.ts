import { describe, expect, it } from 'vitest';
import { districtAccessibleName } from '../../src/ui/a11y/accessible-name.ts';

const base = {
  name: 'Banqiao',
  city: 'New Taipei',
  indicator: 'Rent burden',
  unit: '%',
  decimals: 1,
  estimated: false,
} as const;

describe('districtAccessibleName', () => {
  it('reads a range value with min and max', () => {
    expect(
      districtAccessibleName({ ...base, range: { min: 20.5, central: 25, max: 30.25 } }),
    ).toBe('Banqiao, New Taipei: Rent burden 25.0 %, possible range 20.5 to 30.3');
  });

  it('appends ", estimated" for an estimated value', () => {
    expect(
      districtAccessibleName({
        ...base,
        estimated: true,
        range: { min: 20, central: 25, max: 30 },
      }),
    ).toBe('Banqiao, New Taipei: Rent burden 25.0 %, possible range 20.0 to 30.0, estimated');
  });

  it('reads the same-in-all-scenarios form', () => {
    expect(
      districtAccessibleName({ ...base, range: { min: 25, central: 25, max: 25 } }),
    ).toBe('Banqiao, New Taipei: Rent burden 25.0 %, same in all scenarios');
  });

  it('reads "no value" for a null range, without estimate suffix or data period', () => {
    expect(
      districtAccessibleName({ ...base, estimated: true, dataPeriod: '2024Q4', range: null }),
    ).toBe('Banqiao, New Taipei: Rent burden no value');
  });

  it('reads "no data" for a null lowUseHousingRate value', () => {
    expect(
      districtAccessibleName({ ...base, noData: true, dataPeriod: '2024Q4', range: null }),
    ).toBe('Banqiao, New Taipei: Rent burden no data');
  });

  it('appends the data period before the estimate suffix', () => {
    expect(
      districtAccessibleName({
        ...base,
        estimated: true,
        dataPeriod: '2024Q4',
        range: { min: 25, central: 25, max: 25 },
      }),
    ).toBe(
      'Banqiao, New Taipei: Rent burden 25.0 %, same in all scenarios, data period 2024Q4, estimated',
    );
  });
});
