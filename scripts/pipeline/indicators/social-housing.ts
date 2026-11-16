/**
 * Social housing completions and stock per district and quarter (Requirement 13).
 *
 * Pure builder `buildSocialHousing` plus the loader `loadSocialHousing` and the thin step
 * `socialHousingStep`. The same parsed projects feed the policy track "social housing starts" series
 * (task 12.1), so the loader parses once and `resolveProjectDistricts` is shared.
 *
 *   projects         = list rows with status 已完工, deduplicated by setupplan_guid (first in sorted file order)
 *   district(p)      = the district behind CityCode + TownCode in nlma-portal-dashboard/{guid}.json
 *   quarter(p)       = quarter of strEndDate (ROC yyy/mm/dd + 1911)
 *   completions(d,q) = Σ household_num of projects of district d completed in quarter q
 *   stock(d,q)       = stockBefore2015(d) + Σ_{q' ≤ q} completions(d, q')
 *
 * Projects completed before the first quarter (back to 1971) form the stock base. A project completed after
 * the last quarter counts in neither series. A completed project with an empty or unparseable end date, no
 * detail file or a TownCode outside the 41 districts is excluded and reported (Requirement 13.5). All records
 * have `estimated: false`.
 */
import type { ValueRecord } from '../../../src/types/data-files.ts';
import type { DistrictRef } from '../../lib/districts.ts';
import type { Quarter } from '../../lib/time.ts';
import type { BuildContext } from '../context.ts';
import { ParseError } from '../errors.ts';
import {
  parseProjectDetail,
  parseRocSlashDate,
  parseScheduleList,
  STATUS_COMPLETED,
  type SocialHousingDetail,
  type SocialHousingProject,
} from '../parsers/social-housing.ts';
import type { Step } from '../run.ts';
import { PORTAL_CITY_LETTERS, PORTAL_TOWN_CODES } from '../tables/social-housing-towns.ts';
import type { DistrictSeries } from './series.ts';

export const SOCIAL_HOUSING_LIST_FILES = [
  'social-housing/nlma-portal-GetScheduleData-A.json',
  'social-housing/nlma-portal-GetScheduleData-F.json',
] as const;
export const SOCIAL_HOUSING_DETAIL_DIR = 'social-housing/nlma-portal-dashboard';

export type ExclusionReason =
  | 'empty end date'
  | 'unparseable end date'
  | 'empty start date'
  | 'unparseable start date'
  | 'no detail file'
  | 'TownCode outside the 41';

export interface ProjectExclusion {
  readonly guid: string;
  readonly reason: ExclusionReason;
  readonly units: number;
  /** City of the list row, or 'unknown' when the list row names neither city. */
  readonly city: string;
}

export interface SocialHousingLoad {
  /** Every list row of every file, deduplicated by guid (first occurrence in sorted file order). */
  readonly projects: readonly SocialHousingProject[];
  /** Detail records by project guid (exactly as written in the list); a project without a file has no entry. */
  readonly details: ReadonlyMap<string, SocialHousingDetail>;
  /** Display paths of the list files read, in sorted order. */
  readonly listFiles: readonly string[];
}

/** Keeps the first project of each guid, in the order given. */
export function dedupeProjects(projects: readonly SocialHousingProject[]): SocialHousingProject[] {
  const seen = new Set<string>();
  const out: SocialHousingProject[] = [];
  for (const p of projects) {
    if (seen.has(p.guid)) continue;
    seen.add(p.guid);
    out.push(p);
  }
  return out;
}

export interface ResolvedProject {
  readonly project: SocialHousingProject;
  /** District code, or undefined when the project has no detail file or an unknown TownCode. */
  readonly districtCode: string | undefined;
  /** Set exactly when `districtCode` is undefined. */
  readonly districtProblem: 'no detail file' | 'TownCode outside the 41' | undefined;
}

/** District code of a portal detail record: a direct 8-digit code of the 41, or `<CityCode><TownCode>` via the table. */
export function districtOf(detail: SocialHousingDetail, districts: readonly DistrictRef[]): string | undefined {
  const direct = districts.find((d) => d.code === detail.townCode);
  if (direct !== undefined) return direct.code;
  const name = PORTAL_TOWN_CODES[`${detail.cityCode}${detail.townCode}`];
  if (name === undefined) return undefined;
  const city = PORTAL_CITY_LETTERS[detail.cityCode];
  return districts.find((d) => d.name === name && d.city === city)?.code;
}

/**
 * Deduplicates the projects and resolves each one's district from its detail file. Shared by the completions
 * and stock builder and by the policy track starts builder.
 */
export function resolveProjectDistricts(
  projects: readonly SocialHousingProject[],
  details: ReadonlyMap<string, SocialHousingDetail>,
  districts: readonly DistrictRef[],
): ResolvedProject[] {
  return dedupeProjects(projects).map((project): ResolvedProject => {
    const detail = details.get(project.guid);
    if (detail === undefined) return { project, districtCode: undefined, districtProblem: 'no detail file' };
    const districtCode = districtOf(detail, districts);
    return districtCode === undefined
      ? { project, districtCode: undefined, districtProblem: 'TownCode outside the 41' }
      : { project, districtCode, districtProblem: undefined };
  });
}

function quarterIndex(year: number, quarter: number): number {
  return year * 4 + (quarter - 1);
}

/** Per-exclusion lines and per-city unit totals, in the order given (Requirement 13.5 and 12.5). */
export function formatExclusions(label: string, exclusions: readonly ProjectExclusion[]): string[] {
  if (exclusions.length === 0) return [`${label}: no projects excluded`];
  const lines = exclusions.map((e) => `${label}: excluded ${e.guid}: ${e.reason}, ${e.units} units, ${e.city}`);
  const totals = new Map<string, number>();
  for (const e of exclusions) totals.set(e.city, (totals.get(e.city) ?? 0) + e.units);
  const cities = [...totals.keys()].sort();
  lines.push(`${label}: excluded ${exclusions.length} projects, units per city: ${cities.map((c) => `${c} ${totals.get(c)}`).join(', ')}`);
  return lines;
}

export interface SocialHousingInput {
  readonly projects: readonly SocialHousingProject[];
  readonly details: ReadonlyMap<string, SocialHousingDetail>;
  readonly districts: readonly DistrictRef[];
  readonly quarters: readonly Quarter[];
}

export interface SocialHousingResult {
  readonly completions: DistrictSeries;
  readonly stock: DistrictSeries;
  readonly exclusions: readonly ProjectExclusion[];
  /** Printed lines for the excluded projects, with per-city totals. */
  readonly notes: readonly string[];
}

export function buildSocialHousing(
  projects: readonly SocialHousingProject[],
  details: ReadonlyMap<string, SocialHousingDetail>,
  districts: readonly DistrictRef[],
  quarters: readonly Quarter[],
): SocialHousingResult {
  const firstQuarter = quarters[0];
  if (firstQuarter === undefined) throw new Error('buildSocialHousing needs at least one quarter');
  const qIndex = quarters.map((q) => quarterIndex(Number(q.slice(0, 4)), Number(q.slice(5))));
  const first = qIndex[0]!;
  const last = qIndex[qIndex.length - 1]!;

  const base = new Map<string, number>();
  const perQuarter = new Map<string, number[]>();
  for (const d of districts) {
    base.set(d.code, 0);
    perQuarter.set(d.code, quarters.map(() => 0));
  }
  const exclusions: ProjectExclusion[] = [];

  for (const r of resolveProjectDistricts(projects, details, districts)) {
    const p = r.project;
    if (p.status !== STATUS_COMPLETED) continue;
    const exclude = (reason: ExclusionReason): void => {
      exclusions.push({ guid: p.guid, reason, units: p.householdNum, city: p.city ?? 'unknown' });
    };
    if (p.strEndDate === '') {
      exclude('empty end date');
      continue;
    }
    const date = parseRocSlashDate(p.strEndDate);
    if (date === undefined) {
      exclude('unparseable end date');
      continue;
    }
    if (r.districtCode === undefined) {
      exclude(r.districtProblem!);
      continue;
    }
    const idx = quarterIndex(date.year, date.quarter);
    if (idx < first) base.set(r.districtCode, base.get(r.districtCode)! + p.householdNum);
    else if (idx <= last) {
      const row = perQuarter.get(r.districtCode)!;
      row[qIndex.indexOf(idx)]! += p.householdNum;
    }
  }

  const completions: DistrictSeries = {};
  const stock: DistrictSeries = {};
  for (const d of districts) {
    const row = perQuarter.get(d.code)!;
    let running = base.get(d.code)!;
    completions[d.code] = row.map((value): ValueRecord => ({ value, estimated: false }));
    stock[d.code] = row.map((value): ValueRecord => {
      running += value;
      return { value: running, estimated: false };
    });
  }
  return { completions, stock, exclusions, notes: formatExclusions('social housing', exclusions) };
}

/** Reads and parses the list files and the detail files. A missing detail file is not an error. */
export function loadSocialHousing(ctx: Pick<BuildContext, 'reader'>): SocialHousingLoad {
  const { reader } = ctx;
  const all: SocialHousingProject[] = [];
  const listFiles: string[] = [];
  for (const f of SOCIAL_HOUSING_LIST_FILES) {
    const file = reader.display(f);
    all.push(...parseScheduleList(reader.readText(f), file));
    listFiles.push(file);
  }
  const projects = dedupeProjects(all);
  const details = new Map<string, SocialHousingDetail>();
  for (const p of projects) {
    const rel = `${SOCIAL_HOUSING_DETAIL_DIR}/${p.guid}.json`;
    if (!reader.exists(rel)) continue;
    const file = reader.display(rel);
    const detail = parseProjectDetail(reader.readText(rel), file);
    if (detail.guid.toLowerCase() !== p.guid.toLowerCase()) {
      throw new ParseError(file, undefined, [`SetupplanGuid = ${p.guid}`], [detail.guid], 'detail file belongs to another project');
    }
    details.set(p.guid, detail);
  }
  return { projects, details, listFiles };
}

export function socialHousingStep(): Step {
  return {
    name: 'social-housing',
    run(ctx: BuildContext, state) {
      const load = loadSocialHousing(ctx);
      const result = buildSocialHousing(load.projects, load.details, ctx.districts, ctx.quarters);
      state.socialHousing = load;
      state.socialHousingCompletions = result.completions;
      state.socialHousingStock = result.stock;
      state.socialHousingExclusions = result.exclusions;
      state.notes.push(...result.notes);
    },
  };
}
