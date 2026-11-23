/**
 * Income_Spread (story-layer Requirement 2.7 to 2.10, task 2): the sigma of the district household income
 * distribution, sigma = (ln Q3 − ln Q1) / (2 × 0.6745), from the FIA quartiles of income year 2023, the same
 * input and formula as the rent ghost rule in `scripts/pipeline/params/ghost.ts`.
 */
import { checkQuartiles, GHOST_REFERENCE_YEAR, QUARTILE_Z } from '../pipeline/params/ghost.ts';
import type { FiaQuartileRow } from '../pipeline/parsers/income.ts';

export interface IncomeSpreadFile {
  readonly schemaVersion: 1;
  readonly incomeYear: number;
  readonly source: { readonly citation: string; readonly dataset: '103066'; readonly license: string };
  readonly method: string;
  readonly sigma: Readonly<Record<string, number>>;
}

export const INCOME_SPREAD_METHOD =
  'sigma = (ln Q3 − ln Q1) / (2 × 0.6745), from the first and third quartile of the district total row of the FIA comprehensive income tax statistics by village, income year 2023. ' +
  'The household income of a citizen at percentile p is the district householdIncome × exp(sigma × z(p)). Limits: FIA income is per tax unit, not per household, and excludes transfer income; ' +
  'the log-normal shape is an approximation. Same input and formula as the rent ghost rule (scripts/pipeline/params/ghost.ts).';

/** Sigma of every district code in `codes`, rounded to 4 decimals. Throws when a district has no row or bad quartiles. */
export function incomeSpreadOf(rows: readonly FiaQuartileRow[], codes: readonly string[]): IncomeSpreadFile {
  const byCode = new Map(rows.map((r) => [r.districtCode, r]));
  const sigma: Record<string, number> = {};
  for (const code of codes) {
    const r = byCode.get(code);
    if (r === undefined) throw new Error(`income spread: no FIA district total row for ${code}`);
    checkQuartiles(code, r.q1, r.q3);
    sigma[code] = Math.round(((Math.log(r.q3) - Math.log(r.q1)) / (2 * QUARTILE_Z)) * 1e4) / 1e4;
  }
  return {
    schemaVersion: 1,
    incomeYear: GHOST_REFERENCE_YEAR,
    source: {
      citation: 'Fiscal Information Agency, Ministry of Finance: comprehensive income tax statistics by village (綜合所得稅所得總額各縣市鄉鎮村里統計分析表), income year 2023',
      dataset: '103066',
      license: 'Open Government Data License, version 1.0',
    },
    method: INCOME_SPREAD_METHOD,
    sigma,
  };
}

export function serializeIncomeSpread(f: IncomeSpreadFile): string {
  return `${JSON.stringify(f, null, 2)}\n`;
}
