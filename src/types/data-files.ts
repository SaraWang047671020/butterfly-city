// Schema types and constants for public/data/*.json, shared by the pipeline scripts and the web app.
// Pure types and small constant arrays only. No DOM or Node APIs, erasable syntax only.

export const SCHEMA_VERSION = 1;

export type QuarterKey = `${number}Q${1 | 2 | 3 | 4}`; // same shape as scripts/lib/time.ts Quarter
export type DistrictCode = string; // 8-digit official TOWNCODE
export type CityName = 'Taipei' | 'New Taipei';

export const CITY_NAMES = ['Taipei', 'New Taipei'] as const satisfies readonly CityName[];

/** One value for one district or city and one quarter. Aligned by index with HistoryFile.quarters. */
export type ValueRecord =
  | { readonly value: number; readonly estimated: false }
  | { readonly value: number; readonly estimated: true; readonly method: string }
  | { readonly value: null; readonly estimated: true; readonly method: string }; // allowed by schema (Req 4.8), never emitted

export type IndicatorKind = 'count' | 'positive' | 'non-negative' | 'percent' | 'index-0-100';

export const INDICATOR_KINDS = [
  'count',
  'positive',
  'non-negative',
  'percent',
  'index-0-100',
] as const satisfies readonly IndicatorKind[];

interface IndicatorBase {
  readonly id: string; // camelCase, unique across all indicators
  readonly unit: string; // e.g. "persons", "TWD per m² per month"
  readonly kind: IndicatorKind; // drives the range check
  readonly decimals: number; // 0..6
  readonly description: string; // English, 1..200 characters, neutral wording
  readonly sources: readonly string[]; // Source_Ids, at least one
}
export interface DistrictIndicator extends IndicatorBase {
  readonly level: 'district';
  readonly series: Readonly<Record<DistrictCode, readonly ValueRecord[]>>; // 41 keys × 44 records
}
export interface CityIndicator extends IndicatorBase {
  readonly level: 'city';
  readonly series: Readonly<Record<CityName, readonly ValueRecord[]>>; // 2 keys × 44 records
}
export type Indicator = DistrictIndicator | CityIndicator;

export interface SourceEntry {
  readonly id: string; // "<download-id>/<dataset>", e.g. "income/fia-103066" (Decision D15)
  readonly agency: string;
  readonly dataset: string; // dataset name as published (may be Chinese)
  readonly datasetEn?: string; // English gloss for SOURCES.md
  readonly url: string; // absolute http(s); credentials replaced by "REDACTED"
  readonly years: readonly [number, number]; // first ≤ last
  readonly license: string; // as stated, or the literal "not stated"
  readonly wikipedia?: { readonly title: string }; // renders the CC BY-SA attribution (Req 15.7)
}

export type MethodKind = 'interpolation' | 'estimation' | 'missing-reason';
export interface MethodEntry {
  readonly id: string; // kebab-case, e.g. "interp-annual-quarterly"
  readonly kind: MethodKind;
  readonly title: string;
  readonly inputs: readonly string[]; // Source_Ids
  readonly steps: readonly string[]; // calculation steps, plain English
  readonly appliesTo: readonly string[]; // indicator ids
  readonly quarters: string; // e.g. "2015Q1–2025Q4" or "2024Q1–2025Q4"
  readonly setsEstimated: true;
  readonly citations?: readonly { readonly label: string; readonly url: string }[];
}

export interface HistoryFile {
  readonly schemaVersion: 1;
  readonly quarters: readonly QuarterKey[]; // the 44 keys
  readonly indicators: readonly Indicator[]; // fixed order, district indicators first
  readonly sources: readonly SourceEntry[]; // every source referenced in this file
  readonly methods: readonly MethodEntry[]; // every method referenced in this file
}

export type Ring = readonly (readonly [number, number])[];
export type Geometry =
  | { readonly type: 'Polygon'; readonly coordinates: readonly Ring[] }
  | { readonly type: 'MultiPolygon'; readonly coordinates: readonly (readonly Ring[])[] };

export interface DistrictEntry {
  readonly code: DistrictCode;
  readonly city: CityName;
  readonly name: string; // romanized display name
  readonly areaKm2: number; // 2 decimals
  readonly centroid: readonly [number, number]; // [lon, lat], 5 decimals
  readonly geometry: Geometry; // exterior clockwise (d3-geo convention)
}

export interface FieldProvenance {
  readonly sources: readonly string[];
  readonly method?: string; // e.g. "boundary-simplify", "district-area"
}

export interface DistrictsFile {
  readonly schemaVersion: 1;
  readonly provenance: {
    readonly code: FieldProvenance;
    readonly city: FieldProvenance;
    readonly name: FieldProvenance;
    readonly areaKm2: FieldProvenance;
    readonly centroid: FieldProvenance;
    readonly geometry: FieldProvenance;
  };
  readonly districts: readonly DistrictEntry[]; // 41, ascending code
  readonly sources: readonly SourceEntry[];
  readonly methods: readonly MethodEntry[];
}

export type PolicyToolId = 'socialHousing' | 'sublease' | 'rentSubsidy' | 'holdingTax' | 'commuterPass';

export const POLICY_TOOL_IDS = [
  'socialHousing',
  'sublease',
  'rentSubsidy',
  'holdingTax',
  'commuterPass',
] as const satisfies readonly PolicyToolId[];

/** One real value of a policy series for one district or city and one quarter. */
export type TrackRecord =
  | { readonly value: number; readonly source: string; readonly estimated: false }
  | { readonly value: number; readonly source: string; readonly estimated: true; readonly method: string };

interface PolicySeriesBase {
  readonly id: string; // camelCase, unique across indicators and policy series
  readonly tool: PolicyToolId;
  readonly unit: string;
  readonly kind: IndicatorKind; // drives the range check
  readonly decimals: number; // 0..6
  readonly description: string; // English, 1..200 characters, neutral wording
  readonly sources: readonly string[]; // Source_Ids, at least one
}
export interface DistrictPolicySeries extends PolicySeriesBase {
  readonly level: 'district';
  readonly series: Readonly<Record<DistrictCode, readonly TrackRecord[]>>; // 41 keys × 44 records
}
export interface CityPolicySeries extends PolicySeriesBase {
  readonly level: 'city';
  readonly series: Readonly<Record<CityName, readonly TrackRecord[]>>; // 2 keys × 44 records
}
export type PolicySeries = DistrictPolicySeries | CityPolicySeries;

export interface PolicyTrackFile {
  readonly schemaVersion: 1;
  readonly quarters: readonly QuarterKey[]; // the 44 keys
  readonly policySeries: readonly PolicySeries[]; // fixed order, see the Policy series table
  readonly sources: readonly SourceEntry[];
  readonly methods: readonly MethodEntry[];
}
