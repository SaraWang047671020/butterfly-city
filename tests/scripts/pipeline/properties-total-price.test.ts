import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { quartersBetween } from '../../../scripts/lib/time.ts';
import { districtTotalPriceCells } from '../../../scripts/pipeline/indicators/median-total-price.ts';
import { cityTotalPrices } from '../../../scripts/pipeline/indicators/price-to-income.ts';
import { dedupeById, filterLvr, parseLvrCsv, type LvrFile } from '../../../scripts/pipeline/parsers/lvr.ts';

const quarters = quartersBetween();
const TAIPEI = DISTRICTS.filter((d) => d.city === 'Taipei');
const NEW_TAIPEI = DISTRICTS.filter((d) => d.city === 'New Taipei');
const CITIES = ['Taipei', 'New Taipei'] as const;

const TARGETS = ['房地(土地+建物)', '房地(土地+建物)+車位', '建物', '土地', '車位'];
const USES = ['住家用', '住宅', '商業用', '住家用/商業用', ''];

interface Row {
  readonly file: 0 | 1; // 0 = Taipei (a), 1 = New Taipei (f)
  readonly district: number; // index into the city's districts; -1 = unknown name
  readonly date: { readonly valid: true; readonly y: number; readonly m: number; readonly d: number } | { readonly valid: false; readonly text: string };
  readonly target: string;
  readonly use: string;
  readonly unit: number;
  readonly total: number;
  readonly id: string;
}

const dateArb = fc.oneof(
  { weight: 6, arbitrary: fc.record({ valid: fc.constant(true as const), y: fc.integer({ min: 2013, max: 2026 }), m: fc.integer({ min: 1, max: 12 }), d: fc.integer({ min: 1, max: 28 }) }) },
  { weight: 1, arbitrary: fc.record({ valid: fc.constant(false as const), text: fc.constantFrom('', 'abc', '1040230', '1041301', '104011', '10401011', '1040100') }) },
);

const rowArb: fc.Arbitrary<Row> = fc.record({
  file: fc.constantFrom(0 as const, 1 as const),
  district: fc.integer({ min: -1, max: 15 }),
  date: dateArb,
  target: fc.constantFrom(...TARGETS),
  use: fc.constantFrom(...USES),
  unit: fc.constantFrom(0, 0, 1, 50_000, 300_000),
  total: fc.constantFrom(0, 0, 1_000_000, 12_345_678, 30_000_000, 99_999_999),
  id: fc.constantFrom('', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'),
});

const HEADER_ZH = '鄉鎮市區,交易標的,交易年月日,主要用途,總價元,單價元平方公尺,建物移轉總面積平方公尺,編號';
const HEADER_EN = 'district,target,date,use,total,unit,area,id';

function districtOf(r: Row) {
  const list = r.file === 0 ? TAIPEI : NEW_TAIPEI;
  return r.district < 0 ? undefined : list[r.district % list.length];
}

function dateText(r: Row): string {
  if (!r.date.valid) return r.date.text;
  const { y, m, d } = r.date;
  return `${String(y - 1911).padStart(3, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

function csv(rows: readonly Row[]): string {
  const lines = rows.map((r) => {
    const d = districtOf(r);
    const name = d === undefined ? '不明區' : d.zh.slice(3);
    return [name, r.target, dateText(r), r.use, r.total, r.unit, 30, r.id].join(',');
  });
  return [HEADER_ZH, HEADER_EN, ...lines].join('\n');
}

describe('Property 34: Median total price and price-to-income count the same sales', () => {
  it(
    'district cells equal the oracle, and city lists are the union of the city districts cells',
    () => {
      fc.assert(
        fc.property(fc.array(rowArb, { minLength: 0, maxLength: 80 }), (rows) => {
          const taipeiRows = rows.filter((r) => r.file === 0);
          const newTaipeiRows = rows.filter((r) => r.file === 1);
          const files: LvrFile[] = [
            { file: '114S1_a_lvr_land_a.csv', records: parseLvrCsv(csv(taipeiRows), '114S1_a_lvr_land_a.csv', 'sale') },
            { file: '114S1_f_lvr_land_a.csv', records: parseLvrCsv(csv(newTaipeiRows), '114S1_f_lvr_land_a.csv', 'sale') },
          ];
          const { records, duplicates } = dedupeById(files);
          const { qualifying } = filterLvr(records, duplicates);

          // Oracle: first occurrence of a non-empty id wins, files in name order (a before f), then the predicate.
          const expected = new Map<string, number[]>();
          const seen = new Set<string>();
          for (const r of [...taipeiRows, ...newTaipeiRows]) {
            if (r.id !== '') {
              if (seen.has(r.id)) continue;
              seen.add(r.id);
            }
            const d = districtOf(r);
            if (d === undefined || !r.date.valid) continue;
            if (r.date.y < 2015 || r.date.y > 2025) continue;
            if (!r.use.includes('住家用') && !r.use.includes('住宅')) continue;
            if (!['房地(土地+建物)', '房地(土地+建物)+車位', '建物'].includes(r.target)) continue;
            if (!(r.unit > 0) || !(r.total > 0)) continue;
            const key = `${d.code}|${r.date.y}Q${Math.ceil(r.date.m / 3)}`;
            const list = expected.get(key);
            if (list === undefined) expected.set(key, [r.total]);
            else list.push(r.total);
          }

          const asc = (a: number, b: number) => a - b;
          const cells = districtTotalPriceCells(qualifying, DISTRICTS, quarters);
          const problems: string[] = [];
          const seenKeys = new Set<string>();
          for (const d of DISTRICTS) {
            const perQuarter = cells.get(d.code);
            quarters.forEach((q, i) => {
              const key = `${d.code}|${q}`;
              const got = [...(perQuarter?.[i] ?? [])].sort(asc);
              const want = [...(expected.get(key) ?? [])].sort(asc);
              if (want.length > 0) seenKeys.add(key);
              if (got.join() !== want.join()) problems.push(`district ${key}: got [${got}] want [${want}]`);
            });
          }
          for (const key of expected.keys()) {
            if (!seenKeys.has(key)) problems.push(`oracle key outside the quarter range: ${key}`);
          }

          const cityLists = cityTotalPrices(qualifying, DISTRICTS, quarters);
          for (const city of CITIES) {
            quarters.forEach((q, i) => {
              const union: number[] = [];
              for (const d of DISTRICTS) if (d.city === city) union.push(...(cells.get(d.code)?.[i] ?? []));
              const got = [...(cityLists.get(`${city}|${q}`) ?? [])].sort(asc);
              if (got.join() !== union.sort(asc).join()) problems.push(`city ${city}|${q}: got [${got}] want [${union}]`);
            });
          }
          for (const key of cityLists.keys()) {
            const [city, q] = key.split('|');
            if (!CITIES.includes(city as 'Taipei') || !quarters.includes(q as never)) problems.push(`unexpected city key ${key}`);
          }
          return problems.length === 0 ? true : (() => { throw new Error(problems.slice(0, 5).join('\n')); })();
        }),
        { numRuns: 200 },
      );
      expect(true).toBe(true);
    },
    120_000,
  );
});
