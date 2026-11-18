/**
 * Reads and validates data/config/backtest-cases.json (Requirement 20.1, 20.2, 20.10).
 * A case that fails validation is returned as "not computed" with a reason.
 * The secondaryContext news figures are carried through for the report only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths.ts';

export const BACKTEST_CASES_FILE = path.join(ROOT, 'data', 'config', 'backtest-cases.json');

export type QuarterPart = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface SecondaryFigure {
  readonly label: string;
  readonly percent: number;
  readonly source: string;
  readonly url: string;
  readonly note: string;
}

export interface ObservedSpec {
  readonly source: 'mrt-od-monthly';
  readonly indicator: string;
  readonly cities: readonly string[];
  readonly comparisonYear: number;
  readonly changeYear: number;
  readonly postQuarters: readonly QuarterPart[];
  readonly preQuarters: readonly QuarterPart[];
  readonly method: string;
  readonly confounders: readonly string[];
  readonly secondaryContext: readonly SecondaryFigure[];
}

export interface BacktestCase {
  readonly id: string;
  readonly title: string;
  readonly tool: string;
  readonly change: {
    readonly field: string;
    readonly cities: readonly string[];
    readonly firstQuarter: string;
    readonly before: number;
    readonly after: number;
  };
  readonly indicator: string;
  readonly areas: readonly string[];
  readonly evaluationQuarters: readonly string[];
  readonly observed: ObservedSpec;
  readonly tolerances: { readonly ratioLow: number; readonly ratioHigh: number };
  readonly parametersChangedAfterOutcome: readonly string[];
}

export type CaseEntry =
  | { readonly status: 'ok'; readonly case: BacktestCase }
  | { readonly status: 'not-computed'; readonly id: string; readonly reason: string };

type Obj = Record<string, unknown>;

const QUARTER_KEY = /^(\d{4})Q([1-4])$/;
const QUARTER_PARTS: readonly string[] = ['Q1', 'Q2', 'Q3', 'Q4'];

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function strList(v: unknown, nonEmpty: boolean): readonly string[] | undefined {
  if (!Array.isArray(v) || (nonEmpty && v.length === 0)) return undefined;
  return v.every(isStr) ? (v as string[]) : undefined;
}

function quarterList(v: unknown): readonly string[] | undefined {
  const list = strList(v, true);
  return list !== undefined && list.every((q) => QUARTER_KEY.test(q)) ? list : undefined;
}

function partList(v: unknown): readonly QuarterPart[] | undefined {
  const list = strList(v, true);
  return list !== undefined && list.every((q) => QUARTER_PARTS.includes(q))
    ? (list as readonly QuarterPart[])
    : undefined;
}

/** Validates one raw case. Returns the case, or the reason it is "not computed". */
export function validateCase(raw: unknown): CaseEntry {
  const id = isObj(raw) && isStr(raw.id) ? raw.id : '(unnamed case)';
  const fail = (reason: string): CaseEntry => ({ status: 'not-computed', id, reason });
  if (!isObj(raw)) return fail('case is not an object');
  if (!isStr(raw.id)) return fail('missing id');
  if (!isStr(raw.title)) return fail('missing title');
  if (!isStr(raw.tool)) return fail('missing tool');
  if (!isStr(raw.indicator)) return fail('missing indicator');

  const change = raw.change;
  if (!isObj(change)) return fail('missing change');
  const changeCities = strList(change.cities, true);
  if (
    !isStr(change.field) ||
    changeCities === undefined ||
    !isStr(change.firstQuarter) ||
    !QUARTER_KEY.test(change.firstQuarter) ||
    !isNum(change.before) ||
    !isNum(change.after)
  ) {
    return fail('invalid change (needs field, cities, firstQuarter, before, after)');
  }

  const areas = strList(raw.areas, true);
  if (areas === undefined) return fail('missing areas');
  const evaluationQuarters = quarterList(raw.evaluationQuarters);
  if (evaluationQuarters === undefined) return fail('missing or invalid evaluationQuarters');

  const tol = raw.tolerances;
  if (!isObj(tol) || !isNum(tol.ratioLow) || !isNum(tol.ratioHigh)) {
    return fail('missing tolerances (ratioLow, ratioHigh)');
  }
  if (tol.ratioLow <= 0 || tol.ratioLow > tol.ratioHigh) {
    return fail('tolerances must satisfy 0 < ratioLow <= ratioHigh');
  }

  const obs = raw.observed;
  if (!isObj(obs)) return fail('missing observed calculation spec');
  if (obs.source !== 'mrt-od-monthly') return fail("observed.source must be 'mrt-od-monthly'");
  const confounders = strList(obs.confounders, true);
  if (confounders === undefined) return fail('missing confounders');
  const postQuarters = partList(obs.postQuarters);
  const preQuarters = partList(obs.preQuarters);
  const obsCities = strList(obs.cities, true);
  if (
    !isStr(obs.indicator) ||
    obsCities === undefined ||
    postQuarters === undefined ||
    preQuarters === undefined ||
    !isStr(obs.method)
  ) {
    return fail('incomplete observed calculation spec');
  }
  if (!isNum(obs.comparisonYear) || !Number.isInteger(obs.comparisonYear)) {
    return fail('missing comparisonYear');
  }
  if (obs.comparisonYear >= 2020 && obs.comparisonYear <= 2022) {
    return fail(
      `comparison year ${obs.comparisonYear} is inside 2020 to 2022 (COVID-19 period); use a pre-COVID-19 year`,
    );
  }
  if (!isNum(obs.changeYear) || !Number.isInteger(obs.changeYear)) {
    return fail('missing changeYear');
  }
  if (`${obs.changeYear}${postQuarters[0] ?? ''}` !== change.firstQuarter) {
    // The first post quarter of the change year must be the first quarter of the change.
    return fail('observed postQuarters and changeYear do not start at change.firstQuarter');
  }

  const context: SecondaryFigure[] = [];
  if (obs.secondaryContext !== undefined) {
    if (!Array.isArray(obs.secondaryContext)) return fail('secondaryContext must be a list');
    for (const item of obs.secondaryContext) {
      if (
        !isObj(item) ||
        !isStr(item.label) ||
        !isNum(item.percent) ||
        !isStr(item.source) ||
        !isStr(item.url)
      ) {
        return fail('secondaryContext entry needs label, percent, source and url');
      }
      context.push({
        label: item.label,
        percent: item.percent,
        source: item.source,
        url: item.url,
        note: typeof item.note === 'string' ? item.note : '',
      });
    }
  }

  const changed = strList(raw.parametersChangedAfterOutcome, false);
  if (changed === undefined) return fail('parametersChangedAfterOutcome must be a list of strings');

  return {
    status: 'ok',
    case: {
      id: raw.id,
      title: raw.title,
      tool: raw.tool,
      change: {
        field: change.field,
        cities: changeCities,
        firstQuarter: change.firstQuarter,
        before: change.before,
        after: change.after,
      },
      indicator: raw.indicator,
      areas,
      evaluationQuarters,
      observed: {
        source: 'mrt-od-monthly',
        indicator: obs.indicator,
        cities: obsCities,
        comparisonYear: obs.comparisonYear,
        changeYear: obs.changeYear,
        postQuarters,
        preQuarters,
        method: obs.method,
        confounders,
        secondaryContext: context,
      },
      tolerances: { ratioLow: tol.ratioLow, ratioHigh: tol.ratioHigh },
      parametersChangedAfterOutcome: changed,
    },
  };
}

/** Validates a parsed case file. A malformed file gives one "not computed" entry. */
export function validateCaseFile(raw: unknown): readonly CaseEntry[] {
  if (!isObj(raw) || !Array.isArray(raw.cases)) {
    return [{ status: 'not-computed', id: '(case file)', reason: 'file has no "cases" list' }];
  }
  if (raw.cases.length === 0) {
    return [{ status: 'not-computed', id: '(case file)', reason: 'file defines no cases' }];
  }
  return raw.cases.map(validateCase);
}

/** Reads and validates the case file. A missing or unparsable file gives one "not computed" entry. */
export function readCases(file: string = BACKTEST_CASES_FILE): readonly CaseEntry[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [{ status: 'not-computed', id: '(case file)', reason: `missing input: ${path.basename(file)}` }];
  }
  try {
    return validateCaseFile(JSON.parse(text));
  } catch {
    return [{ status: 'not-computed', id: '(case file)', reason: `${path.basename(file)} is not valid JSON` }];
  }
}
