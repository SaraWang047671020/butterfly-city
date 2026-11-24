/**
 * The Wage_File (play-loop Requirement 3.4): for each occupation industry of the Character_File and each year
 * 2015 to 2025, the regular monthly earnings per employee of that industry (DGBAS, data.gov.tw 9663).
 *
 * Method: the year record of the file (a bare 4-digit period), the annual figure DGBAS publishes, which weights the
 * months by employment. Check: it must lie within 0.5% of the plain mean of the 12 monthly records (measured
 * 2026-11-24: at most 0.13% apart for these industries and years). Revision marks (Ⓡ, Ⓟ) are removed; "-" is no value.
 */
import { ParseError } from '../pipeline/errors.ts';

/** DGBAS industry section → the English part of the XML field name (fields end in _金額_新臺幣元). */
export const WAGE_INDUSTRIES: Readonly<Record<string, { readonly zh: string; readonly field: string }>> = {
  C: { zh: '製造業', field: 'Manufacturing' },
  G: { zh: '批發及零售業', field: 'Wholesale_and_retail_trade' },
  H: { zh: '運輸及倉儲業', field: 'Transportation_and_storage' },
  I: { zh: '住宿及餐飲業', field: 'Accommodation_and_food_service_activities' },
  J: { zh: '出版影音及資通訊業', field: 'Information_and_communication' },
  K: { zh: '金融及保險業', field: 'Financial_and_insurance_activities' },
  P: { zh: '教育業', field: 'Education' },
  Q: { zh: '醫療保健及社會工作服務業', field: 'Human_health_and_social_work_activities' },
};

export const WAGE_YEARS: readonly number[] = Array.from({ length: 11 }, (_, i) => 2015 + i);

export interface WageRecord {
  /** "2015" (year record) or "201501" (month record). */
  readonly period: string;
  /** Value by industry section; null for "-" or a missing field. */
  readonly values: Readonly<Record<string, number | null>>;
}

const clean = (s: string): string => s.replace(/[ⓇⓅ]/g, '').replace(/,/g, '').trim();

/** Parses the DGBAS 9663 XML into records with the industries of WAGE_INDUSTRIES. */
export function parseWagesXml(xml: string, file: string): WageRecord[] {
  const blocks = [...xml.matchAll(/<每人每月經常性薪資>([\s\S]*?)<\/每人每月經常性薪資>/g)];
  if (blocks.length === 0) {
    throw new ParseError(file, undefined, ['<每人每月經常性薪資> records'], ['none'], 'no record element in the XML');
  }
  return blocks.map((b, i) => {
    const body = b[1] ?? '';
    const period = clean(/<年月別_Year_and_month>([^<]*)<\/年月別_Year_and_month>/.exec(body)?.[1] ?? '');
    if (!/^\d{4}(\d{2})?$/.test(period)) {
      throw new ParseError(file, i + 1, ['年月別_Year_and_month as YYYY or YYYYMM'], [period], 'period not readable');
    }
    const values: Record<string, number | null> = {};
    for (const [code, ind] of Object.entries(WAGE_INDUSTRIES)) {
      const tag = `${ind.zh}_${ind.field}_金額_新臺幣元`;
      const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(body);
      const text = clean(m?.[1] ?? '-');
      const v = text === '-' || text === '' ? null : Number(text);
      values[code] = v !== null && Number.isFinite(v) ? v : null;
    }
    return { period, values };
  });
}

export interface WageFile {
  readonly schemaVersion: 1;
  readonly unit: string;
  readonly source: { readonly citation: string; readonly url: string; readonly license: string };
  readonly method: string;
  readonly coverage: string;
  /** Industry section → year → TWD per month. */
  readonly earnings: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** Builds the Wage_File; throws when a year lacks a month or a year record, or the year record is far from the monthly mean. */
export function wageFileOf(records: readonly WageRecord[], file: string): WageFile {
  const earnings: Record<string, Record<string, number>> = {};
  for (const code of Object.keys(WAGE_INDUSTRIES)) {
    earnings[code] = {};
    for (const year of WAGE_YEARS) {
      const months = records.filter((r) => r.period.length === 6 && r.period.startsWith(String(year))).map((r) => r.values[code] ?? null);
      if (months.length !== 12 || months.some((v) => v === null)) {
        throw new ParseError(file, undefined, [`12 monthly values of ${code} in ${year}`], [`${months.filter((v) => v !== null).length}`], 'incomplete year');
      }
      const mean = Math.round((months as number[]).reduce((a, b) => a + b, 0) / 12);
      const yearRecord = records.find((r) => r.period === String(year))?.values[code] ?? null;
      if (yearRecord === null) {
        throw new ParseError(file, undefined, [`year record of ${code} ${year}`], ['none'], 'no year record');
      }
      if (Math.abs(yearRecord - mean) / mean > 0.005) {
        throw new ParseError(file, undefined, [`year record of ${code} ${year} within 0.5% of the monthly mean ${mean}`], [String(yearRecord)], 'year record differs');
      }
      earnings[code][String(year)] = yearRecord;
    }
  }
  return {
    schemaVersion: 1,
    unit: 'TWD per month',
    source: {
      citation: 'DGBAS, 歷年受僱員工每人每月經常性薪資 (regular monthly earnings per employee by industry), data.gov.tw 9663',
      url: 'https://data.gov.tw/dataset/9663',
      license: 'Open Government Data License, version 1.0',
    },
    method: 'Annual regular monthly earnings per employee of the year as published by DGBAS (industry and service sector earnings survey; the year record of the file, checked against the mean of its 12 months). Regular earnings exclude bonuses and overtime pay. An industry mean is above the median of most industries.',
    coverage:
      'Not covered by the survey: agriculture, government, schools above primary level, religious and occupational organisations. Education covered only supplementary and other education (cram schools and similar) up to 2018; health covered only human health before 2018.',
    earnings,
  };
}

export function serializeWageFile(w: WageFile): string {
  return `${JSON.stringify(w, null, 2)}\n`;
}
