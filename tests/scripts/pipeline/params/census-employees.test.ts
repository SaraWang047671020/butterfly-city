import fs from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../../scripts/lib/districts.ts';
import { DataError, ParseError } from '../../../../scripts/pipeline/errors.ts';
import {
  CENSUS_EMPLOYEES_TABLE,
  CENSUS_TOTALS_TABLE,
  censusCheckStep,
  checkCensusTotals,
  parseCensusEmployees,
  parseCensusTotals,
} from '../../../../scripts/pipeline/params/census-employees.ts';

const HEADER = 'district_code,employees,source_url,table_id,page';
const TOTAL_HEADER = 'city,employees,source_url,table_id,page';

function employeesCsv(values: readonly number[], skip: readonly string[] = []): string {
  const lines = [HEADER];
  DISTRICTS.forEach((d, i) => {
    if (!skip.includes(d.code)) lines.push(`${d.code},${values[i]},https://example.org/a.pdf,10,140`);
  });
  return lines.join('\n') + '\n';
}

const ones = DISTRICTS.map(() => 1);
const totalsCsv = (t: number, n: number) =>
  `${TOTAL_HEADER}\nTaipei,${t},https://example.org/a.pdf,10,140\nNew Taipei,${n},https://example.org/b.pdf,10,140\n`;

function check(values: readonly number[], t: number, n: number): void {
  checkCensusTotals(parseCensusEmployees(employeesCsv(values)), parseCensusTotals(totalsCsv(t, n)));
}

describe('parseCensusEmployees', () => {
  it('parses a valid table', () => {
    const rows = parseCensusEmployees(employeesCsv(ones));
    expect(rows).toHaveLength(41);
    expect(rows[0]).toMatchObject({ districtCode: '63000010', employees: 1, tableId: '10', page: 140 });
  });

  it('rejects a missing column', () => {
    expect(() => parseCensusEmployees('district_code,employees\n63000010,1\n')).toThrow(ParseError);
  });

  it('rejects a missing District_Code', () => {
    expect(() => parseCensusEmployees(employeesCsv(ones, ['65000290']))).toThrow(/missing district_code/);
  });

  it('rejects a duplicate and an unknown District_Code', () => {
    const dup = employeesCsv(ones) + '65000290,1,https://example.org/a.pdf,10,140\n';
    expect(() => parseCensusEmployees(dup)).toThrow(/duplicate district_code 65000290/);
    const unknown = `${HEADER}\n99999999,1,https://example.org/a.pdf,10,140\n`;
    expect(() => parseCensusEmployees(unknown)).toThrow(/unknown district_code/);
  });

  it('rejects negative, non-integer, empty-source and zero-page values', () => {
    const bad = (line: string) => () => parseCensusEmployees(`${HEADER}\n${line}\n`);
    expect(bad('63000010,-1,https://example.org/a.pdf,10,140')).toThrow(DataError);
    expect(bad('63000010,1.5,https://example.org/a.pdf,10,140')).toThrow(DataError);
    expect(bad('63000010,1,,10,140')).toThrow(/source_url is empty/);
    expect(bad('63000010,1,https://example.org/a.pdf,,140')).toThrow(/table_id is empty/);
    expect(bad('63000010,1,https://example.org/a.pdf,10,0')).toThrow(/page/);
  });
});

describe('checkCensusTotals', () => {
  it('accepts matching sums (12 Taipei + 29 New Taipei districts)', () => {
    expect(() => check(ones, 12, 29)).not.toThrow();
  });

  it('names the city, both figures and the difference on a mismatch', () => {
    expect(() => check(ones, 12, 30)).toThrow(/New Taipei: sum 29, printed total 30, difference -1/);
    expect(() => check(ones, 15, 29)).toThrow(/Taipei: sum 12, printed total 15, difference -3/);
  });

  it('property: accepts any table whose sums equal the totals and rejects it when one value changes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 41, maxLength: 41 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 1, max: 1000 }),
        (values, index, delta) => {
          const t = values.slice(0, 12).reduce((a, b) => a + b, 0);
          const n = values.slice(12).reduce((a, b) => a + b, 0);
          expect(() => check(values, t, n)).not.toThrow();
          const changed = values.map((v, i) => (i === index ? v + delta : v));
          expect(() => check(changed, t, n)).toThrow(DataError);
        },
      ),
    );
  });
});

describe('committed 2021 census tables', () => {
  const employees = parseCensusEmployees(fs.readFileSync(CENSUS_EMPLOYEES_TABLE, 'utf8'));
  const totals = parseCensusTotals(fs.readFileSync(CENSUS_TOTALS_TABLE, 'utf8'));

  it('sums to 1,885,704 for the 12 Taipei and 1,415,275 for the 29 New Taipei districts', () => {
    const sum = (prefix: string) => employees.filter((e) => e.districtCode.startsWith(prefix)).reduce((a, e) => a + e.employees, 0);
    expect(employees.filter((e) => e.districtCode.startsWith('63'))).toHaveLength(12);
    expect(employees.filter((e) => e.districtCode.startsWith('65'))).toHaveLength(29);
    expect(sum('63')).toBe(1_885_704);
    expect(sum('65')).toBe(1_415_275);
    expect(totals.map((t) => [t.city, t.employees, t.tableId, t.page])).toEqual([
      ['Taipei', 1_885_704, '10', 140],
      ['New Taipei', 1_415_275, '10', 140],
    ]);
    expect(() => checkCensusTotals(employees, totals)).not.toThrow();
  });

  it('the census-check step passes on the committed tables', () => {
    const step = censusCheckStep();
    expect(step.name).toBe('census-check');
    expect(() => step.run({} as never, {} as never)).not.toThrow();
  });
});
