/**
 * Calendar helpers. Taiwan government data uses the ROC (Minguo) calendar: ROC year = AD year − 1911.
 * Quarters are written as "2015Q1" everywhere in this project.
 */

export const ROC_OFFSET = 1911;
export const FIRST_YEAR = 2015;
export const LAST_YEAR = 2025;

export type Quarter = `${number}Q${1 | 2 | 3 | 4}`;

export function rocToAd(rocYear: number): number {
  return rocYear + ROC_OFFSET;
}

export function adToRoc(adYear: number): number {
  return adYear - ROC_OFFSET;
}

/** All quarters from `from` to `to` inclusive (AD years). */
export function quartersBetween(from = FIRST_YEAR, to = LAST_YEAR): Quarter[] {
  const out: Quarter[] = [];
  for (let y = from; y <= to; y++) for (const q of [1, 2, 3, 4] as const) out.push(`${y}Q${q}`);
  return out;
}

/** All months from `from` to `to` inclusive as ROC "yyymm" strings, e.g. "10401" for 2015-01. */
export function rocMonthsBetween(from = FIRST_YEAR, to = LAST_YEAR): string[] {
  const out: string[] = [];
  for (let y = from; y <= to; y++) {
    for (let m = 1; m <= 12; m++) out.push(`${adToRoc(y)}${String(m).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Converts an ROC date "yyymmdd" or "yymmdd" (e.g. "1121108" = 2023-11-08) to a quarter.
 * Returns undefined for malformed values.
 */
export function rocDateToQuarter(value: string): Quarter | undefined {
  const s = value.trim();
  if (!/^\d{6,7}$/.test(s)) return undefined;
  const year = rocToAd(Number(s.slice(0, s.length - 4)));
  const month = Number(s.slice(-4, -2));
  if (month < 1 || month > 12) return undefined;
  return `${year}Q${Math.ceil(month / 3) as 1 | 2 | 3 | 4}`;
}
