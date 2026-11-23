// Brief_Items of the Quarter_Brief (play-loop Requirement 6.2). Pure. The candidates are the completions of
// Construction_Entries, the Major_Events and, per district, (a) for each simulated Map_Indicator the change since the
// previous quarter of the difference from real history, scored by that change divided by the indicator's outer change
// bound, and (b) the change of the number of people above a rent or commute line compared with real history (the
// Ghost difference in persons), scored by that change divided by PEOPLE_CHANGE_BOUND. (b) was added on 2026-11-23
// because a rent subsidy change often moves rent burden by less than the 0.1 point the brief can show.
// Completions and Major_Events come first, then the other candidates by score, then by name; at most 3.
import type { DistrictCode, QuarterKey } from '../types/data-files.ts';
import type { MapIndicatorId } from '../types/save.ts';
import { outerChangeBound, PEOPLE_CHANGE_BOUND } from './core/change-bounds.ts';

export const BRIEF_LIMIT = 3;

export type BriefCandidate =
  | { readonly kind: 'completion'; readonly district: DistrictCode; readonly districtName: string; readonly units: number }
  | { readonly kind: 'major-event'; readonly id: string; readonly title: string; readonly firstQuarter: QuarterKey }
  | {
      readonly kind: 'change';
      readonly district: DistrictCode;
      readonly districtName: string;
      readonly indicator: MapIndicatorId;
      /** Shown difference from real history in the previous and the brief quarter, rounded to the display decimals. */
      readonly prevDiff: number;
      readonly diff: number;
      /** Central value of the brief quarter. */
      readonly value: number;
    }
  | {
      /** People above a rent or commute line, difference from real history in persons (rounded), now and before. */
      readonly kind: 'people';
      readonly district: DistrictCode;
      readonly districtName: string;
      readonly prev: number;
      readonly now: number;
    };

export type BriefItem = BriefCandidate & { readonly score: number };

/** Score of a candidate: Infinity for completions and Major_Events, else |diff − prevDiff| ÷ outer bound. */
export function scoreOf(c: BriefCandidate): number {
  if (c.kind === 'people') return Math.abs(c.now - c.prev) / PEOPLE_CHANGE_BOUND;
  if (c.kind !== 'change') return Number.POSITIVE_INFINITY;
  return Math.abs(c.diff - c.prevDiff) / outerChangeBound(c.indicator);
}

const rank = (c: BriefCandidate): number => (c.kind === 'completion' ? 0 : c.kind === 'major-event' ? 1 : 2);
const nameOf = (c: BriefCandidate): string => (c.kind === 'major-event' ? c.title : c.districtName);

/** The Brief_Items: candidates with a score above 0, in the order of the rule, at most BRIEF_LIMIT. */
export function briefItems(candidates: readonly BriefCandidate[]): BriefItem[] {
  return candidates
    .map((c) => ({ ...c, score: scoreOf(c) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.score - a.score : 0) || nameOf(a).localeCompare(nameOf(b)))
    .slice(0, BRIEF_LIMIT);
}
