// Save and demo summary types. Types and constants only.
import type { DistrictCode, QuarterKey } from './data-files.ts';
import type { AreaKey, ToolId } from './simulation.ts';

export const SAVE_SCHEMA_VERSION = 1;
/** Design decision G8. Provisional: the cap and its rejection message await user confirmation. */
export const MAX_TIMELINE_ENTRIES = 500;

export const MAP_INDICATOR_IDS = ['rentBurden', 'priceToIncome', 'commuteTime', 'populationChange', 'lowUseHousingRate'] as const;
export type MapIndicatorId = (typeof MAP_INDICATOR_IDS)[number];

/** Policy_Differences of one tool field and Area, one slot per quarter 2015Q1..2025Q4. */
export interface PolicyDiffSeries {
  readonly tool: ToolId;
  readonly field: string;
  readonly area: AreaKey;
  readonly diffs: readonly number[]; // length 44
}

export type TimelineEntry =
  | {
      readonly kind: 'value';
      readonly quarter: QuarterKey;
      readonly tool: ToolId;
      readonly field: string;
      readonly area: AreaKey;
      readonly before: number;
      readonly after: number;
    }
  | {
      readonly kind: 'real-track';
      readonly quarter: QuarterKey;
      readonly tool: ToolId;
      readonly field: string;
      readonly area: AreaKey;
      readonly before: number;
      readonly after: null;
    };

export interface Save {
  readonly schemaVersion: 1;
  readonly engineVersion: string; // ENGINE_VERSION at write time
  readonly next: QuarterKey | 'complete'; // Planning_Quarter or the Completed_Marker
  readonly policy: readonly PolicyDiffSeries[]; // sorted by tool, field, area; no all-zero series
  readonly timeline: readonly TimelineEntry[]; // applied order
  readonly mapIndicator: MapIndicatorId;
  readonly selectedDistrict: DistrictCode | null;
  readonly demo: boolean; // Demo_Flag
  readonly seed: number; // integer; 0 in Historical mode
}

export interface DemoSummary {
  readonly comparisonQuarter: '2021Q1';
  readonly fallbackStep: 0 | 1 | 2;
  readonly ghostDifference: { readonly central: number; readonly min: number; readonly max: number };
  readonly ghostThreshold: number;
  readonly rentBurden: { readonly district: DistrictCode; readonly difference: number }; // largest absolute, central
  readonly rentBurdenThreshold: number;
}
