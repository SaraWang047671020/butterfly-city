// In-memory district list for engine tests: the 41 official codes of Taipei (12) and New Taipei (29).
// No file I/O (Requirement 17.6); the codes are copied here as literals.

import type { CityName, DistrictCode } from '../../../src/types/data-files.ts';

const TAIPEI_CODES = [
  '63000010', '63000020', '63000030', '63000040', '63000050', '63000060',
  '63000070', '63000080', '63000090', '63000100', '63000110', '63000120',
] as const;

const NEW_TAIPEI_CODES = [
  '65000010', '65000020', '65000030', '65000040', '65000050', '65000060', '65000070',
  '65000080', '65000090', '65000100', '65000110', '65000120', '65000130', '65000140',
  '65000150', '65000160', '65000170', '65000180', '65000190', '65000200', '65000210',
  '65000220', '65000230', '65000240', '65000250', '65000260', '65000270', '65000280',
  '65000290',
] as const;

export interface FixtureDistrict {
  readonly code: DistrictCode;
  readonly city: CityName;
}

/** 41 districts in ascending code order. */
export const DISTRICTS: readonly FixtureDistrict[] = [
  ...TAIPEI_CODES.map((code): FixtureDistrict => ({ code, city: 'Taipei' })),
  ...NEW_TAIPEI_CODES.map((code): FixtureDistrict => ({ code, city: 'New Taipei' })),
];

export const DISTRICT_CODES: readonly DistrictCode[] = DISTRICTS.map((d) => d.code);

export const CITIES: readonly CityName[] = ['Taipei', 'New Taipei'];

export function cityOf(code: DistrictCode): CityName {
  return code.startsWith('63') ? 'Taipei' : 'New Taipei';
}

export function districtsOf(city: CityName): readonly DistrictCode[] {
  return DISTRICTS.filter((d) => d.city === city).map((d) => d.code);
}
