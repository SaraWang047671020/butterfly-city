// Shape of the generated metro data (src/ui/city/metro/station-data.ts, city-3d Requirement 8.5). Types only.

export interface MetroStation {
  readonly key: string;
  readonly name: string;
  readonly ids: readonly string[];
  readonly lines: readonly string[];
  readonly lon: number;
  readonly lat: number;
  readonly district: string;
  /** Opening date when the station opened after 2014, else null (open in every quarter of the game). */
  readonly opened: string | null;
}

export interface MetroSegment {
  readonly line: string;
  readonly from: string;
  readonly to: string;
  /** Opening date when the segment opened after 2014, else null. */
  readonly opened: string | null;
}

export interface MetroData {
  readonly lines: readonly { readonly id: string; readonly name: string }[];
  readonly stations: readonly MetroStation[];
  readonly segments: readonly MetroSegment[];
}
