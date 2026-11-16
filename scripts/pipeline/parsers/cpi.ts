/**
 * Parsers for the two CPI rent (房租) sub-index sources (pure: text in, monthly rows out).
 *
 * Taipei DBAS 131822 (`taipei-A21000102-cpi-monthly.csv`): columns `統計期` (ROC `103年 1月`), `基本分類`,
 * `原始值[統計數值]`, `年增率[%]`, `縣市別代碼`. The rent rows have `基本分類` `(一)房租` and `縣市別代碼` 63000
 * (the only code in the file); the leading `(一)` numbering is ignored so `房租` and `1.房租` match as well.
 *
 * DGBAS 6019 (`dgbas-pr0101a1m-cpi-basic.xml`): `<Obs>` elements with `<Item>` (`1.房租(指數基期：民國110年=100)`),
 * `<TIME_PERIOD>` (`YYYYMmm`), `<FREQ>`, `<TYPE>` and `<Item_VALUE>`. Rows with `TYPE` `原始值` (the index level,
 * not the year-on-year rate) of the rent item are returned. An `<Item_VALUE>` that is empty is treated as an absent
 * month and omitted, so the rent builder reports it with the series name (Requirement 9.9).
 *
 * Output months are `YYYY-MM` strings (Gregorian), sorted ascending. Missing months are not detected here.
 *
 * A missing column, element or attribute throws `ParseError` (file, row, expected, found). For XML the row is the
 * 1-based position of the `<Obs>` element and `expected`/`found` describe the elements.
 */
import { parseCsv, parseNumber } from '../../lib/csv.ts';
import { rocToAd } from '../../lib/time.ts';
import { ParseError } from '../errors.ts';

export interface CpiRentRow {
  /** Gregorian month, e.g. "2024-03". */
  readonly yearMonth: string;
  /** Rent sub-index value (index level, base year as published). */
  readonly value: number;
}

const TAIPEI_CITY_CODE = '63000';
const TAIPEI_COLUMNS = { period: '統計期', category: '基本分類', value: '原始值[統計數值]', city: '縣市別代碼' } as const;

/** True for a rent category label such as `(一)房租`, `1.房租` or `房租`. */
function isRentLabel(label: string): boolean {
  return label.trim().replace(/^[(（][^)）]*[)）]\s*/, '').replace(/^\d+\.\s*/, '') === '房租';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function sortedRows(byMonth: Map<string, number>): CpiRentRow[] {
  return [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([yearMonth, value]) => ({ yearMonth, value }));
}

/** Monthly rent sub-index of the Taipei City series (rent rows, `縣市別代碼` 63000) from the DBAS CSV. */
export function parseTaipeiCpiRent(text: string, file: string): CpiRentRow[] {
  const [header, ...rest] = parseCsv(text.replace(/^\uFEFF/, ''));
  const names = (header ?? []).map((h) => h.trim());
  const expected = Object.values(TAIPEI_COLUMNS);
  const idx = Object.fromEntries(Object.entries(TAIPEI_COLUMNS).map(([k, n]) => [k, names.indexOf(n)])) as Record<keyof typeof TAIPEI_COLUMNS, number>;
  for (const [key, n] of Object.entries(TAIPEI_COLUMNS)) {
    if (idx[key as keyof typeof TAIPEI_COLUMNS] < 0) throw new ParseError(file, 1, expected, names, `missing required column ${n}`);
  }
  const byMonth = new Map<string, number>();
  let seenRentLabel = false;
  rest.forEach((cells, i) => {
    const row = i + 2;
    if (cells.length === 0 || (cells.length === 1 && cells[0] === '')) return;
    const cell = (key: keyof typeof TAIPEI_COLUMNS): string => {
      const v = cells[idx[key]];
      if (v === undefined) throw new ParseError(file, row, expected, names, `row has no value for ${TAIPEI_COLUMNS[key]}`);
      return v.trim();
    };
    if (!isRentLabel(cell('category'))) return;
    seenRentLabel = true;
    if (cell('city') !== TAIPEI_CITY_CODE) return;
    const period = cell('period');
    const m = /^(\d{2,3})年\s*(\d{1,2})月$/.exec(period);
    const month = m ? Number(m[2]) : 0;
    if (!m || month < 1 || month > 12) {
      throw new ParseError(file, row, [`${TAIPEI_COLUMNS.period}: ROC "yyy年 m月"`], [`${TAIPEI_COLUMNS.period}: ${JSON.stringify(period)}`], 'period is not an ROC year and month');
    }
    const value = parseNumber(cell('value'));
    if (!(value > 0)) {
      throw new ParseError(file, row, [`${TAIPEI_COLUMNS.value}: positive number`], [`${TAIPEI_COLUMNS.value}: ${JSON.stringify(cells[idx.value])}`], 'index value is not a positive number');
    }
    const yearMonth = `${rocToAd(Number(m[1]))}-${pad2(month)}`;
    if (byMonth.has(yearMonth)) {
      throw new ParseError(file, row, ['one rent row per month'], [`duplicate month ${yearMonth}`], 'duplicate month');
    }
    byMonth.set(yearMonth, value);
  });
  if (byMonth.size === 0) {
    throw new ParseError(
      file,
      undefined,
      [`${TAIPEI_COLUMNS.category} 房租 with ${TAIPEI_COLUMNS.city} ${TAIPEI_CITY_CODE}`],
      [seenRentLabel ? `rent rows without ${TAIPEI_COLUMNS.city} ${TAIPEI_CITY_CODE}` : `no ${TAIPEI_COLUMNS.category} 房租 row`],
      'no rent rows for the Taipei series',
    );
  }
  return sortedRows(byMonth);
}

function xmlText(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

const OBS_ELEMENTS = ['Item', 'TIME_PERIOD', 'TYPE', 'Item_VALUE'] as const;

/** Monthly rent sub-index (`TYPE` 原始值) of the DGBAS national CPI basic-group XML. */
export function parseDgbasCpiRent(xml: string, file: string): CpiRentRow[] {
  const observations = [...xml.matchAll(/<Obs(?:\s[^>]*)?>([\s\S]*?)<\/Obs>/g)];
  if (observations.length === 0) {
    throw new ParseError(file, undefined, ['<Obs> elements with <Item>, <TIME_PERIOD>, <TYPE>, <Item_VALUE>'], ['no <Obs> element'], 'no <Obs> element in the XML');
  }
  const byMonth = new Map<string, number>();
  let rentObs = 0;
  observations.forEach((obs, i) => {
    const row = i + 1;
    const body = obs[1] ?? '';
    const get = (name: (typeof OBS_ELEMENTS)[number]): string => {
      const m = new RegExp(`<${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${name}>)`).exec(body);
      if (!m) {
        const present = [...body.matchAll(/<([A-Za-z_][\w.-]*)/g)].map((x) => `<${x[1]}>`);
        throw new ParseError(file, row, OBS_ELEMENTS.map((n) => `<${n}>`), present, `<Obs> ${row} has no <${name}> element`);
      }
      return xmlText(m[1] ?? '');
    };
    const item = get('Item');
    if (!/^(?:\d+\.\s*)?房租(?:[(（].*)?$/.test(item)) return;
    const type = get('TYPE');
    if (type !== '原始值') return;
    rentObs++;
    const period = get('TIME_PERIOD');
    const m = /^(\d{4})M(\d{2})$/.exec(period);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
      throw new ParseError(file, row, ['<TIME_PERIOD>: YYYYMmm'], [`<TIME_PERIOD>: ${JSON.stringify(period)}`], 'TIME_PERIOD is not YYYYMmm');
    }
    const raw = get('Item_VALUE');
    if (raw === '') return;
    const value = parseNumber(raw);
    if (!(value > 0)) {
      throw new ParseError(file, row, ['<Item_VALUE>: positive number'], [`<Item_VALUE>: ${JSON.stringify(raw)}`], 'index value is not a positive number');
    }
    const yearMonth = `${m[1]}-${m[2]}`;
    if (byMonth.has(yearMonth)) {
      throw new ParseError(file, row, ['one rent observation per month'], [`duplicate month ${yearMonth}`], 'duplicate month');
    }
    byMonth.set(yearMonth, value);
  });
  if (rentObs === 0) {
    throw new ParseError(file, undefined, ['<Item> 房租 with <TYPE> 原始值'], ['no such <Obs> element'], 'no rent observations in the XML');
  }
  return sortedRows(byMonth);
}
