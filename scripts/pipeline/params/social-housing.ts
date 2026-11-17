/**
 * Social housing Parameter_Entries (Requirements 21.9, 22.1 to 22.4, 22.12).
 *
 *   socialHousing.lag         median (range: Q1 and Q3) of start-to-completion whole quarters of completed NLMA projects
 *   socialHousing.unitCost    middle (range: smallest and largest) stated per-dwelling cost of three Taipei projects
 *   socialHousing.rentPerUnit {-2.5 %, 0, +6.5 %} * median 2024 rent / median unit count of completed projects
 *
 * Pure builders take parsed projects, the rent series and the committed table text. `socialHousingParams`
 * runs every entry through `checkParameterEntry`.
 */
import { checkParameterEntry } from '../../../src/data/validate-params.ts';
import type { ScalarParameter } from '../../../src/types/simulation.ts';
import { parseCsv } from '../../lib/csv.ts';
import type { Quarter } from '../../lib/time.ts';
import { DataError, ParseError, PipelineError } from '../errors.ts';
import type { DistrictSeries } from '../indicators/series.ts';
import { median } from '../numeric.ts';
import {
  parseRocSlashDate,
  STATUS_COMPLETED,
  type SocialHousingProject,
} from '../parsers/social-housing.ts';
import type { CommittedReader } from '../policy/step.ts';

export const UNIT_COST_CASES_FILE = 'data/config/social-housing-unit-cost-cases.csv';

const NLMA_SOURCE = {
  citation: 'National Land Management Agency, MOI: social housing real-time information portal (project list)',
  url: 'https://socialhousing.nlma.gov.tw/CPA_SocialHousing_Portal/',
} as const;

const DIAMOND_MCQUADE_SOURCE = {
  citation: 'Diamond and McQuade (2019), Who Wants Affordable Housing in Their Backyard?, Journal of Political Economy 127(3)',
  url: 'https://www.nber.org/papers/w22204',
} as const;

/** Relative price effects of Requirement 22 criterion 3 (Diamond and McQuade 2019). */
export const PRICE_EFFECT_LOW = -0.025;
export const PRICE_EFFECT_HIGH = 0.065;

/** First quarter index (2015Q1) and last (2025Q4) of the completion window. */
const WINDOW_FIRST = 2015 * 4;
const WINDOW_LAST = 2025 * 4 + 3;

export const MIN_LAG_PROJECTS = 10;

export type LagExclusionReason =
  | 'empty start date'
  | 'unparseable start date'
  | 'empty end date'
  | 'unparseable end date'
  | 'completion outside 2015Q1-2025Q4'
  | 'end before start';

export interface LagDerivation {
  readonly entry: ScalarParameter;
  /** Start-to-completion whole quarters of the qualifying projects, in input order. */
  readonly durations: readonly number[];
  readonly qualifying: number;
  /** `setupplan_guid` of the qualifying projects with a 0-quarter lag (kept in the median), in input order. */
  readonly zeroLagGuids: readonly string[];
  /** Completed projects (each guid once) that did not qualify, by reason. */
  readonly excluded: Readonly<Record<LagExclusionReason, number>>;
  readonly notes: readonly string[];
}

/** Quantile by linear interpolation between order statistics (type 7). */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('quantile: empty input');
  const s = [...values].sort((a, b) => a - b);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return (s[lo] as number) + (h - lo) * ((s[hi] as number) - (s[lo] as number));
}

function quarterIndex(year: number, quarter: number): number {
  return year * 4 + (quarter - 1);
}

/** Each guid once (first occurrence), status 已完工 only. */
function completedOnce(projects: readonly SocialHousingProject[]): SocialHousingProject[] {
  const seen = new Set<string>();
  const out: SocialHousingProject[] = [];
  for (const p of projects) {
    if (p.status !== STATUS_COMPLETED || seen.has(p.guid)) continue;
    seen.add(p.guid);
    out.push(p);
  }
  return out;
}

export function deriveSocialHousingLag(projects: readonly SocialHousingProject[]): LagDerivation {
  const excluded: Record<LagExclusionReason, number> = {
    'empty start date': 0,
    'unparseable start date': 0,
    'empty end date': 0,
    'unparseable end date': 0,
    'completion outside 2015Q1-2025Q4': 0,
    'end before start': 0,
  };
  const durations: number[] = [];
  const zeroLagGuids: string[] = [];
  for (const p of completedOnce(projects)) {
    if (p.strStartDate === '') {
      excluded['empty start date']++;
      continue;
    }
    const start = parseRocSlashDate(p.strStartDate);
    if (start === undefined) {
      excluded['unparseable start date']++;
      continue;
    }
    if (p.strEndDate === '') {
      excluded['empty end date']++;
      continue;
    }
    const end = parseRocSlashDate(p.strEndDate);
    if (end === undefined) {
      excluded['unparseable end date']++;
      continue;
    }
    const endIdx = quarterIndex(end.year, end.quarter);
    if (endIdx < WINDOW_FIRST || endIdx > WINDOW_LAST) {
      excluded['completion outside 2015Q1-2025Q4']++;
      continue;
    }
    const d = endIdx - quarterIndex(start.year, start.quarter);
    if (d < 0) {
      excluded['end before start']++;
      continue;
    }
    durations.push(d);
    if (d === 0) zeroLagGuids.push(p.guid);
  }

  const reasons = Object.entries(excluded).map(([reason, n]) => `${reason}: ${n}`);
  const qualifying = durations.length;
  if (qualifying < MIN_LAG_PROJECTS) {
    throw new DataError('social-housing-lag-too-few-projects', `${qualifying} qualifying projects (need ${MIN_LAG_PROJECTS})`, [
      `qualifying projects: ${qualifying}`,
      ...reasons.map((r) => `excluded, ${r}`),
    ]);
  }

  const value = Math.round(median(durations));
  const low = Math.round(quantile(durations, 0.25));
  const high = Math.round(quantile(durations, 0.75));
  const entry: ScalarParameter = {
    kind: 'scalar',
    value,
    unit: 'quarters',
    status: 'secondary',
    source: NLMA_SOURCE,
    range: { low, high, lowSource: NLMA_SOURCE, highSource: NLMA_SOURCE },
    estimated: {
      method: `NLMA social housing portal: median of start-to-completion quarters of ${qualifying} completed projects 2015Q1-2025Q4; range is the first and third quartile`,
    },
  };
  return {
    entry,
    durations,
    qualifying,
    zeroLagGuids,
    excluded,
    notes: [
      `socialHousing.lag: ${qualifying} qualifying projects`,
      `socialHousing.lag: ${zeroLagGuids.length} qualifying projects with a 0-quarter lag (kept in the median): ${zeroLagGuids.join(', ')}`,
      ...reasons.map((r) => `socialHousing.lag: excluded, ${r}`),
    ],
  };
}

export interface UnitCostCase {
  readonly project: string;
  readonly totalTwd: number;
  readonly dwellings: number;
  readonly statedPerDwellingTwd: number;
}

const UNIT_COST_COLUMNS = ['project', 'total_twd', 'dwellings', 'stated_per_dwelling_twd'] as const;

/** The three sources of the table. The research notes do not map a source to a project, so all three apply to every row. */
const UNIT_COST_SOURCE_URLS = [
  'https://www.storm.mg/article/3088809',
  'https://www.cna.com.tw/news/aloc/202512040148.aspx',
  'https://www.cy.gov.tw/AP_Home/Op_Upload/eDoc/%E5%87%BA%E7%89%88%E5%93%81/109/1090000021010801895p.pdf',
] as const;
/** The three sources by name, in the order of `UNIT_COST_SOURCE_URLS` (rendered in SOURCES.md). */
export const UNIT_COST_SOURCE_LIST: readonly { readonly name: string; readonly url: string }[] = [
  { name: 'Storm Media', url: UNIT_COST_SOURCE_URLS[0] },
  { name: 'Central News Agency', url: UNIT_COST_SOURCE_URLS[1] },
  { name: 'Control Yuan report', url: UNIT_COST_SOURCE_URLS[2] },
];
const UNIT_COST_SOURCE = {
  citation: `Project totals and dwelling counts of Jingfeng, Dongxin and Peiying (budget), from three sources taken together: Storm Media (${UNIT_COST_SOURCE_URLS[0]}), Central News Agency (${UNIT_COST_SOURCE_URLS[1]}), Control Yuan report (${UNIT_COST_SOURCE_URLS[2]}); table in ${UNIT_COST_CASES_FILE}`,
  url: UNIT_COST_SOURCE_URLS[0],
} as const;

function positiveInt(text: string, column: string, file: string, row: number): number {
  const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new ParseError(file, row, UNIT_COST_COLUMNS, [], `${column} ${JSON.stringify(text)} is not a positive integer`);
  }
  return n;
}

export function parseUnitCostCases(text: string, file: string): UnitCostCase[] {
  const [rawHeader, ...rest] = parseCsv(text);
  const header = (rawHeader ?? []).map((h) => h.trim());
  const missing = UNIT_COST_COLUMNS.find((c) => !header.includes(c));
  if (missing !== undefined) throw new ParseError(file, 1, UNIT_COST_COLUMNS, header, `missing required column ${missing}`);
  const out: UnitCostCase[] = [];
  rest.forEach((r, i) => {
    if (r.length === 1 && (r[0] ?? '').trim() === '') return;
    const row = i + 2;
    const cells = Object.fromEntries(header.map((h, k) => [h, (r[k] ?? '').trim()]));
    const project = cells['project'] as string;
    if (project === '') throw new ParseError(file, row, UNIT_COST_COLUMNS, header, 'project is empty');
    out.push({
      project,
      totalTwd: positiveInt(cells['total_twd'] as string, 'total_twd', file, row),
      dwellings: positiveInt(cells['dwellings'] as string, 'dwellings', file, row),
      statedPerDwellingTwd: positiveInt(cells['stated_per_dwelling_twd'] as string, 'stated_per_dwelling_twd', file, row),
    });
  });
  return out;
}

/** Largest relative difference between total / dwellings and the stated figure that is accepted. */
export const UNIT_COST_TOLERANCE = 0.01;

export interface UnitCostDerivation {
  readonly entry: ScalarParameter;
  /** total / dwellings per case, in table order (for the build report). */
  readonly quotients: readonly number[];
}

export function deriveUnitCost(cases: readonly UnitCostCase[]): UnitCostDerivation {
  if (cases.length !== 3) {
    throw new DataError('social-housing-unit-cost-case-count', `${cases.length} projects in ${UNIT_COST_CASES_FILE} (need 3)`);
  }
  const quotients = cases.map((c) => c.totalTwd / c.dwellings);
  cases.forEach((c, i) => {
    const q = quotients[i] as number;
    if (Math.abs(q - c.statedPerDwellingTwd) / c.statedPerDwellingTwd > UNIT_COST_TOLERANCE) {
      throw new DataError('social-housing-unit-cost-mismatch', c.project, [
        `total ${c.totalTwd} / ${c.dwellings} dwellings = ${q} TWD per dwelling`,
        `stated per-dwelling figure: ${c.statedPerDwellingTwd} TWD`,
      ]);
    }
  });
  const sorted = [...cases].sort((a, b) => a.statedPerDwellingTwd - b.statedPerDwellingTwd);
  const [lowCase, midCase, highCase] = sorted as [UnitCostCase, UnitCostCase, UnitCostCase];
  const cite = (c: UnitCostCase): { citation: string; url: string } => ({
    citation: `${c.project}: total cost TWD ${c.totalTwd} for ${c.dwellings} dwellings. ${UNIT_COST_SOURCE.citation}`,
    url: UNIT_COST_SOURCE.url,
  });
  const entry: ScalarParameter = {
    kind: 'scalar',
    value: midCase.statedPerDwellingTwd,
    unit: 'TWD per dwelling',
    status: 'secondary',
    source: cite(midCase),
    range: {
      low: lowCase.statedPerDwellingTwd,
      high: highCase.statedPerDwellingTwd,
      lowSource: cite(lowCase),
      highSource: cite(highCase),
    },
    estimated: {
      method: `Per-dwelling cost of three Taipei social housing projects (${sorted.map((c) => c.project).join(', ')}) from the committed table; value is the middle figure, range ends are the smallest and largest. The sources (Storm Media, Central News Agency, Control Yuan) are cited together for all three projects because the research notes do not state which source covers which project. Three projects only; Peiying is a budget figure.`,
    },
  };
  return { entry, quotients };
}

export interface RentPerUnitDerivation {
  readonly entry: ScalarParameter;
  /** Median monthly rent per m² over the 41 districts and the four quarters of 2024. */
  readonly rentRef: number;
  /** Median `household_num` of the completed projects (each guid once). */
  readonly unitsPerProject: number;
  readonly projectCount: number;
}

export function deriveRentPerUnit(
  projects: readonly SocialHousingProject[],
  rent: DistrictSeries,
  quarters: readonly Quarter[],
): RentPerUnitDerivation {
  const idx2024 = quarters.flatMap((q, i) => (q.startsWith('2024') ? [i] : []));
  if (idx2024.length !== 4) throw new Error(`deriveRentPerUnit: expected 4 quarters of 2024, found ${idx2024.length}`);
  const values: number[] = [];
  for (const [code, records] of Object.entries(rent)) {
    for (const i of idx2024) {
      const v = records[i]?.value;
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new DataError('social-housing-rent-missing', `district ${code}, quarter ${quarters[i]}`);
      }
      values.push(v);
    }
  }
  if (values.length === 0) throw new Error('deriveRentPerUnit: the rent series has no district');
  const rentRef = median(values);

  const completed = completedOnce(projects);
  if (completed.length === 0) throw new DataError('social-housing-no-completed-projects', 'rentPerUnit needs completed projects');
  const unitsPerProject = median(completed.map((p) => p.householdNum));
  if (!(unitsPerProject > 0)) throw new DataError('social-housing-median-units-not-positive', String(unitsPerProject));

  const perUnit = (effect: number): number => (effect === 0 ? 0 : (effect * rentRef) / unitsPerProject);
  const entry: ScalarParameter = {
    kind: 'scalar',
    value: 0,
    unit: 'TWD per m² per month per dwelling of stock difference',
    status: 'secondary',
    source: DIAMOND_MCQUADE_SOURCE,
    range: {
      low: perUnit(PRICE_EFFECT_LOW),
      high: perUnit(PRICE_EFFECT_HIGH),
      lowSource: { citation: `${DIAMOND_MCQUADE_SOURCE.citation}: -2.5 % price effect in high-income areas`, url: DIAMOND_MCQUADE_SOURCE.url },
      highSource: { citation: `${DIAMOND_MCQUADE_SOURCE.citation}: +6.5 % price effect in low-income areas`, url: DIAMOND_MCQUADE_SOURCE.url },
    },
    estimated: {
      method:
        `Price effects -2.5 %, 0 and +6.5 % (US evidence) times the median 2024 rent per m² per month over the 41 districts (${rentRef.toFixed(2)} TWD) divided by the median unit count of ${completed.length} completed NLMA projects (${unitsPerProject} dwellings). ` +
        'The asymmetry between the two ends comes from the cited study: Diamond and McQuade (2019), Journal of Political Economy 127(3), report +6.5 % in low-income areas and -2.5 % in high-income areas, so the ratio of the two ends (2.60) equals 6.5 / 2.5; average effect about 0 (effect within 0.1 mile). ' +
        'Assumptions: rent changes in the same proportion as price (the study measures price), and the effect of one project is spread evenly over its units.',
    },
  };
  return { entry, rentRef, unitsPerProject, projectCount: completed.length };
}

export interface SocialHousingParamsInput {
  readonly projects: readonly SocialHousingProject[];
  /** The rent Indicator, 41 districts by 44 quarters. */
  readonly rent: DistrictSeries;
  readonly quarters: readonly Quarter[];
  readonly readCommitted: CommittedReader;
}

export interface SocialHousingParamsResult {
  readonly entries: Readonly<Record<string, ScalarParameter>>;
  readonly notes: readonly string[];
  /** `setupplan_guid` of the qualifying projects with a 0-quarter lag (also in `notes`). */
  readonly zeroLagGuids: readonly string[];
}

function checked(id: string, entry: ScalarParameter): ScalarParameter {
  const issues = checkParameterEntry(id, entry);
  if (issues.length > 0) {
    throw new PipelineError(`${id}: parameter entry fails the check`, issues.map((i) => i.problem));
  }
  return entry;
}

export function socialHousingParams(input: SocialHousingParamsInput): SocialHousingParamsResult {
  const lag = deriveSocialHousingLag(input.projects);
  const cases = parseUnitCostCases(input.readCommitted(UNIT_COST_CASES_FILE), UNIT_COST_CASES_FILE);
  const unitCost = deriveUnitCost(cases);
  const rentPerUnit = deriveRentPerUnit(input.projects, input.rent, input.quarters);
  return {
    zeroLagGuids: lag.zeroLagGuids,
    entries: {
      'socialHousing.lag': checked('socialHousing.lag', lag.entry),
      'socialHousing.rentPerUnit': checked('socialHousing.rentPerUnit', rentPerUnit.entry),
      'socialHousing.unitCost': checked('socialHousing.unitCost', unitCost.entry),
    },
    notes: [
      ...lag.notes,
      `socialHousing.unitCost: total / dwellings ${unitCost.quotients.map((q) => Math.round(q)).join(', ')} TWD`,
      `socialHousing.rentPerUnit: median 2024 rent ${rentPerUnit.rentRef.toFixed(2)} TWD per m² per month, median units ${rentPerUnit.unitsPerProject} of ${rentPerUnit.projectCount} completed projects`,
    ],
  };
}
