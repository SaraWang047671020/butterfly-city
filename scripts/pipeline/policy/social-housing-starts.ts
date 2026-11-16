/**
 * Social housing starts per district and quarter (Requirements 12.4, 12.5).
 *
 *   socialHousingUnitsStarted(d, q) = Σ household_num of projects of ANY status with district d and
 *                                     quarter of strStartDate (ROC yyy/mm/dd + 1911) = q
 *
 * Each `setupplan_guid` counts once. A project with an empty or unparseable start date, no detail file or a
 * TownCode outside the 41 is excluded without estimating anything, and reported with guid, reason, units and
 * the per-city totals. A start outside 2015Q1..2025Q4 counts in no quarter. Every record is observed; the
 * value is 0 when no project qualifies.
 */
import type { DistrictRef } from '../../lib/districts.ts';
import type { Quarter } from '../../lib/time.ts';
import {
  formatExclusions,
  resolveProjectDistricts,
  type ExclusionReason,
  type ProjectExclusion,
} from '../indicators/social-housing.ts';
import { parseRocSlashDate, type SocialHousingDetail, type SocialHousingProject } from '../parsers/social-housing.ts';
import { observed, type DistrictTrack } from './track.ts';

export const SOCIAL_HOUSING_STARTS_SOURCE = 'social-housing/nlma-portal';

export interface SocialHousingStartsResult {
  readonly series: DistrictTrack;
  readonly exclusions: readonly ProjectExclusion[];
  /** Printed lines for the excluded projects, with per-city totals. */
  readonly notes: readonly string[];
}

export function buildSocialHousingStarts(
  projects: readonly SocialHousingProject[],
  details: ReadonlyMap<string, SocialHousingDetail>,
  districts: readonly DistrictRef[],
  quarters: readonly Quarter[],
): SocialHousingStartsResult {
  const counts = new Map<string, number[]>(districts.map((d) => [d.code, quarters.map(() => 0)]));
  const exclusions: ProjectExclusion[] = [];

  for (const r of resolveProjectDistricts(projects, details, districts)) {
    const p = r.project;
    const exclude = (reason: ExclusionReason): void => {
      exclusions.push({ guid: p.guid, reason, units: p.householdNum, city: p.city ?? 'unknown' });
    };
    if (p.strStartDate === '') {
      exclude('empty start date');
      continue;
    }
    const date = parseRocSlashDate(p.strStartDate);
    if (date === undefined) {
      exclude('unparseable start date');
      continue;
    }
    if (r.districtCode === undefined) {
      exclude(r.districtProblem!);
      continue;
    }
    const k = quarters.indexOf(`${date.year}Q${date.quarter}`);
    if (k >= 0) counts.get(r.districtCode)![k]! += p.householdNum;
  }

  const series: DistrictTrack = {};
  for (const d of districts) {
    series[d.code] = counts.get(d.code)!.map((v) => observed(v, SOCIAL_HOUSING_STARTS_SOURCE));
  }
  return { series, exclusions, notes: formatExclusions('social housing starts', exclusions) };
}
