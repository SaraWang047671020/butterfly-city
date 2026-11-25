// View-model types passed from src/game to src/ui. Types only, erasable syntax.
// Values are numbers, ids, flags and Data_File text. No formatted string and no Scenario id (Requirement 5.3).
import type { CityName, DistrictCode, PolicyToolId, QuarterKey } from './data-files.ts';
import type { MapIndicatorId } from './save.ts';
import type { AreaKey, EngineError, ParameterStatus, ToolId } from './simulation.ts';

export type FieldKey = string; // `${tool}|${field}|${area}`

export interface ValueRange {
  readonly min: number;
  readonly central: number;
  readonly max: number;
}

/** Identifies one displayed simulated value; opens the Range_Source_View. */
export interface ValueRef {
  readonly indicator: PanelRowId;
  readonly district: DistrictCode;
  readonly quarter: QuarterKey;
}

export interface MethodRefView {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly string[];
}

export type ComparisonLabel = 'real' | 'derived-baseline';

export interface SimulatedValueView {
  readonly ref: ValueRef;
  readonly range: ValueRange;
  readonly unit: string;
  readonly decimals: number;
  readonly comparison: { readonly value: number | null; readonly label: ComparisonLabel };
  readonly estimated: { readonly methods: readonly MethodRefView[] } | null;
}

export type PanelRowId =
  | 'rentBurden'
  | 'priceToIncome'
  | 'commuteTime'
  | 'populationChange'
  | 'rent'
  | 'population'
  | 'socialHousingStock'
  | 'mrtEntries'
  | 'ghostCount';

export interface PanelRowView {
  readonly id: PanelRowId;
  readonly unit: string;
  readonly decimals: number;
  readonly simulated: SimulatedValueView | null; // null for Price_To_Income and before any quarter
  readonly realOnly: { readonly value: number | null; readonly label: ComparisonLabel } | null;
  readonly percentRow: boolean; // differences in percentage points
  readonly sourceNames: readonly string[]; // empty: "source not listed"
  readonly modelEstimate: boolean; // Commute_Time
}

export interface DistrictPanelView {
  readonly mode: 'prompt' | 'real-2015Q1' | 'quarter';
  readonly district: { readonly code: DistrictCode; readonly name: string; readonly city: CityName } | null;
  readonly quarter: QuarterKey | null;
  readonly rows: readonly PanelRowView[]; // 9 rows, empty for 'prompt'
  readonly ghostSize: number;
}

export interface ParameterRefView {
  readonly parameterId: string;
  readonly value: number;
  readonly unit: string;
  readonly citation: string | null; // null: "No source recorded"
  readonly url: string | null;
  readonly status: ParameterStatus;
  readonly estimatedMethod: string | null;
  readonly assumption: string | null;
}

export type LimitProblem = {
  readonly side: 'lower' | 'upper';
  readonly limit: number;
  readonly unit: string;
  readonly period: QuarterKey | number; // quarter, or the year for a city-year field
  readonly ref: ParameterRefView | null;
};

export interface BudgetFiguresView {
  readonly year: number;
  readonly annualBudget: number;
  readonly committed: number;
  readonly remaining: number;
}

/** One tool's share of the Annual_Budget of a year (housing-tools Requirement 3). */
export interface BudgetToolView {
  readonly tool: string;
  /** Charges of the year in quarters already computed. */
  readonly spent: number;
  /** Charges of the year committed for its later quarters (for example social housing paid over time). */
  readonly later: number;
}

/** The Budget_Bar of the Planning_Quarter's year (housing-tools Requirement 3.1). */
export interface BudgetBarView {
  readonly year: number;
  readonly annualBudget: number;
  readonly remaining: number;
  readonly tools: readonly BudgetToolView[];
}

export type BudgetProblemView = {
  readonly reason: 'annual-budget' | 'tool-ceiling';
  readonly year: number;
  readonly budget: number;
  readonly over: number; // > 0
};

/**
 * The calendar year of the Planning_Quarter if the edited value is kept for the rest of the year (play-loop task 9).
 * `overrun` is the first quarter whose spending exceeds the Annual_Budget or a tool ceiling; computing will stop
 * before it (game-ui Requirement 9.8) unless the value is changed before then. A warning, not a rejection.
 */
export interface YearEndView {
  readonly year: number;
  readonly committed: number;
  readonly remaining: number;
  readonly overrun: { readonly quarter: QuarterKey; readonly over: number } | null;
}

export type EditCheckView =
  | { readonly status: 'fixed-quarter'; readonly planning: QuarterKey | null }
  | { readonly status: 'invalid-format'; readonly expected: 'integer' | 'number' }
  | { readonly status: 'timeline-full' }
  | { readonly status: 'unchanged'; readonly budget: BudgetFiguresView | null }
  | { readonly status: 'limit'; readonly limit: LimitProblem; readonly budget: BudgetFiguresView | null }
  | { readonly status: 'budget'; readonly problem: BudgetProblemView }
  | { readonly status: 'pending-range'; readonly budget: BudgetFiguresView; readonly yearEnd?: YearEndView; readonly budgetBefore?: BudgetFiguresView; readonly costYear?: number; readonly costTotal?: number }
  | { readonly status: 'engine'; readonly error: EngineError; readonly budget: BudgetFiguresView }
  | { readonly status: 'ok'; readonly budget: BudgetFiguresView; readonly yearEnd?: YearEndView; readonly budgetBefore?: BudgetFiguresView; readonly costYear?: number; readonly costTotal?: number };

export interface FieldView {
  readonly key: FieldKey;
  readonly tool: ToolId;
  readonly field: string;
  readonly area: AreaKey;
  readonly countField: boolean;
  readonly editable: 'yes' | 'select-district' | 'no-pass-product';
  readonly real: { readonly value: number; readonly estimated: boolean } | null; // null: "No real value recorded"
  readonly player: number | null;
  readonly unit: string; // read from the policy-track.json series, no default
  readonly unitCost: ParameterRefView | null;
  readonly lag: ParameterRefView;
  readonly limits: {
    readonly lower: number;
    readonly upper: number;
    readonly scope: 'quarter' | 'city-year';
    readonly lowerRef: ParameterRefView | null;
    readonly upperRef: ParameterRefView | null;
  };
  readonly cityYearTotal: number | null;
  /** Upper end of the slider: `limits.upper`, or for a city-year limit what is left of it for this district. */
  readonly sliderUpper: number;
  readonly remainingCeiling: number;
  readonly draft: { readonly text: string; readonly check: EditCheckView } | null;
  readonly applyEnabled: boolean;
  readonly setToRealEnabled: boolean;
}

export type ToolView =
  | {
      readonly kind: 'coming-soon';
      readonly id: PolicyToolId;
      readonly realValues: readonly {
        readonly seriesId: string;
        readonly area: AreaKey;
        readonly value: number;
        readonly unit: string;
        readonly decimals: number;
        readonly estimated: boolean;
      }[];
    }
  | { readonly kind: 'active'; readonly id: PolicyToolId; readonly fields: readonly FieldView[] };

export interface ConstructionRowView {
  readonly district: DistrictCode;
  readonly districtName: string;
  readonly committed: QuarterKey;
  readonly effect: QuarterKey;
  readonly difference: number; // > 0 more units than real, < 0 fewer
  readonly lag: number;
  readonly progress: number; // 0 <= progress <= lag - 1
  readonly afterEnd: boolean; // completes after 2025Q4
}

export interface ParameterAssumptionView {
  readonly parameterId: string;
  readonly value: number;
  readonly unit: string;
  readonly citation: string | null;
  readonly url: string | null;
}

export interface RangeSourceView {
  readonly value: SimulatedValueView;
  readonly same: boolean;
  readonly lowest: { readonly value: number; readonly assumptions: readonly ParameterAssumptionView[] } | null;
  readonly highest: { readonly value: number; readonly assumptions: readonly ParameterAssumptionView[] } | null;
}

/** A carried value that breaks a limit or the budget (Requirement 9.8). */
export interface CarriedProblemView {
  readonly key: FieldKey;
  readonly quarter: QuarterKey;
  readonly value: number;
  readonly problem: { readonly kind: 'limit'; readonly limit: LimitProblem } | { readonly kind: 'budget'; readonly budget: BudgetProblemView };
}

export interface PolicyPanelView {
  readonly domains: readonly { readonly domain: 'housing' | 'transit'; readonly tools: readonly ToolView[] }[];
  readonly budget: BudgetFiguresView | null;
  /** The same year by tool, for the Budget_Bar in the menu and the dialogs; null when the game is complete. */
  readonly budgetBar: BudgetBarView | null;
  readonly construction: readonly ConstructionRowView[];
  readonly carried: CarriedProblemView | null;
}

export interface TurnBarView {
  readonly planning: QuarterKey | null;
  readonly displayed: QuarterKey | null;
  readonly turn: number; // 1-based index of the Planning_Quarter, 44 when complete
  readonly complete: boolean;
  readonly busy: boolean;
  readonly demo: boolean;
  readonly storageWarning: boolean;
  readonly versionNotice: { readonly saved: string; readonly current: string } | null;
  readonly engineError: { readonly quarter: QuarterKey; readonly error: EngineError } | null;
  readonly nextEnabled: boolean;
  readonly fastForwardEnabled: boolean;
  /** The Budget_Bar of the Planning_Quarter's year; null before a game or when it is complete. */
  readonly budget: BudgetBarView | null;
}

export interface LegendView {
  readonly indicator: MapIndicatorId;
  readonly unit: string;
  readonly decimals: number;
  readonly bounds: readonly number[]; // ascending inner bounds
}

export interface MapDistrictView {
  readonly code: DistrictCode;
  readonly name: string;
  readonly city: CityName;
  readonly central: number | null; // null: "no value"
  readonly range: ValueRange | null;
  readonly estimated: boolean;
  readonly classIndex: number | null;
  /** Period of a periodic value (lowUseHousingRate, for example `2023H2`); null otherwise and for a null value. */
  readonly dataPeriod: string | null;
  readonly selected: boolean;
  /** Ghost count of the central Scenario in the Displayed_Quarter; null before any quarter is computed (city-3d 2.2). */
  readonly ghosts: number | null;
  /**
   * People above a ghost line in the central Scenario minus the same in real history, in persons, not floored
   * (city-3d Requirement 6): the sum of the policy Causes of the Ghost count × Ghost_Size. Positive: more people
   * pushed out than in real history. Null before any quarter is computed.
   */
  readonly ghostDiffPersons: number | null;
  /**
   * Central simulated value minus its comparison value (real history or Derived_Baseline) for the selected
   * Map_Indicator, in the indicator's unit (percentage points for percent indicators). Null when not simulated
   * (Price_To_Income, Low_Use_Housing_Rate) or before any quarter is computed.
   */
  readonly difference: number | null;
  /** salePrice of the displayed quarter ÷ salePrice of 2015Q1; null when either is missing or the 2015Q1 value is 0 (city-3d 2.2). */
  readonly priceIndex: number | null;
}

export interface MapViewModel {
  readonly indicator: MapIndicatorId;
  readonly labelMode: 'real-2015Q1' | 'quarter';
  readonly quarter: QuarterKey | null;
  readonly districts: readonly MapDistrictView[];
  readonly legend: LegendView;
}

/** Static district data for the City_View, built once per game (city-3d Requirement 2.1). */
export interface CityStaticDistrict {
  readonly code: DistrictCode;
  readonly city: CityName;
  readonly name: string;
  readonly areaKm2: number;
  readonly centroid: readonly [number, number]; // [lon, lat]
  /** Polygons, each a list of rings of [lon, lat], outer ring first. */
  readonly polygons: readonly (readonly (readonly (readonly [number, number])[])[])[];
  /** 2015Q1 population, or 0 when the record is missing. */
  readonly population2015: number;
}

export interface CityStaticView {
  readonly districts: readonly CityStaticDistrict[]; // ascending District_Code
}

export interface DistrictListView {
  readonly groups: readonly {
    readonly city: CityName;
    readonly districts: readonly { readonly code: DistrictCode; readonly name: string }[];
  }[];
  readonly selected: DistrictCode | null;
}

export interface EventCardView {
  readonly id: string;
  readonly type: string;
  readonly firstQuarter: QuarterKey;
  readonly lastQuarter: QuarterKey;
  readonly title: string;
  readonly description: string;
  readonly sources: readonly { readonly name: string; readonly url: string }[];
  readonly major: boolean;
}

export interface CompletionItemView {
  readonly district: DistrictCode;
  readonly districtName: string;
  readonly committed: QuarterKey;
  readonly effect: QuarterKey;
  readonly difference: number;
}

export type TimelineItemView =
  | { readonly kind: 'event'; readonly card: EventCardView; readonly major: boolean }
  | { readonly kind: 'completion'; readonly item: CompletionItemView; readonly major: false }
  | {
      readonly kind: 'entry';
      readonly index: number; // position in the saved timeline, for selectTimelineEntry
      readonly entryKind: 'value' | 'real-track';
      readonly tool: ToolId;
      readonly field: string;
      readonly area: AreaKey;
      readonly before: number;
      readonly after: number | null;
      readonly major: false;
    };

export interface TimelineQuarterView {
  readonly quarter: QuarterKey;
  readonly items: readonly TimelineItemView[];
}

export interface StoredProblemView {
  readonly kind: 'invalid' | 'unavailable';
  readonly step: string | null;
  readonly path: string | null;
  readonly reason: string | null;
}

export interface DemoDescriptionView {
  readonly entries: readonly {
    readonly quarter: QuarterKey;
    readonly tool: ToolId;
    readonly field: string;
    readonly area: AreaKey;
    readonly kind: 'value' | 'real-track';
    readonly value: number | null; // null for 'real-track'
  }[];
  readonly fallbackStep: 0 | 1 | 2;
  readonly comparisonQuarter: '2021Q1';
  readonly ghostDifference: ValueRange;
  readonly rentBurden: { readonly district: DistrictCode; readonly districtName: string; readonly difference: number };
}

export type DialogView =
  | { readonly kind: 'confirm'; readonly action: 'new-game' | 'load-demo' | 'import' }
  | { readonly kind: 'import'; readonly error: { readonly step: string; readonly path: string; readonly reason: string } | null }
  | { readonly kind: 'export'; readonly text: string; readonly copyFailed: boolean }
  | { readonly kind: 'stored-export'; readonly text: string; readonly copyFailed: boolean }
  | { readonly kind: 'event-cards'; readonly cards: readonly EventCardView[] }
  | { readonly kind: 'range-source'; readonly source: RangeSourceView }
  | { readonly kind: 'demo'; readonly demo: DemoDescriptionView | null; readonly unavailableReason: string | null };

export interface Announcement {
  readonly id: number;
  readonly politeness: 'polite' | 'assertive';
  readonly quarter: QuarterKey | null;
  readonly eventTitles: readonly string[];
  readonly engineError: EngineError | null;
}

/** One line of the Quarter_Brief (play-loop Requirement 6). Numbers are already rounded to the display decimals. */
export type BriefItemView =
  | { readonly kind: 'completion'; readonly district: DistrictCode; readonly districtName: string; readonly units: number }
  | { readonly kind: 'major-event'; readonly id: string; readonly title: string }
  | {
      readonly kind: 'change';
      readonly district: DistrictCode;
      readonly districtName: string;
      readonly indicator: MapIndicatorId;
      readonly value: number;
      /** Difference from real history in the brief quarter, and its change since the previous quarter. */
      readonly diff: number;
      readonly change: number;
      readonly unit: string;
      /** True when the difference is in percentage points (percent indicators). */
      readonly percentPoints: boolean;
      readonly decimals: number;
    }
  | {
      /** People above a rent or commute line compared with real history (persons), and the change since last quarter. */
      readonly kind: 'people';
      readonly district: DistrictCode;
      readonly districtName: string;
      readonly persons: number;
      readonly change: number;
    };

/** The Quarter_Brief of the last Computation_Run; null when it is not shown. */
export interface BriefView {
  readonly quarter: QuarterKey;
  readonly items: readonly BriefItemView[];
}

export interface GameView {
  readonly turnBar: TurnBarView;
  /** The Quarter_Brief after a Computation_Run until the player closes it (play-loop Requirement 4). */
  readonly brief: BriefView | null;
  readonly map: MapViewModel;
  readonly districtList: DistrictListView;
  readonly districtPanel: DistrictPanelView;
  readonly policyPanel: PolicyPanelView;
  readonly timeline: readonly TimelineQuarterView[];
  readonly dialog: DialogView | null;
  readonly announcement: Announcement | null;
  readonly focusRequest: { readonly id: number; readonly key: FieldKey } | null; // one-shot (Requirement 11.6)
}

export type ScreenView =
  | { readonly kind: 'loading'; readonly loaded: number; readonly total: 6 }
  | { readonly kind: 'load-error'; readonly failures: readonly { readonly file: string; readonly message: string }[] }
  | {
      readonly kind: 'start';
      readonly options: readonly ('continue' | 'new' | 'demo')[];
      readonly storedProblem: StoredProblemView | null;
    }
  | { readonly kind: 'game'; readonly game: GameView };

export interface UiActions {
  startNew(): void;
  continueStored(): void;
  openDemo(): void;
  confirmDemo(): void;
  confirm(answer: boolean): void;
  nextQuarter(): void;
  fastForward(): void;
  dismissEventCards(): void;
  /** Closes the Quarter_Brief (play-loop Requirement 4.4). */
  dismissBrief(): void;
  selectDistrict(code: DistrictCode): void;
  setMapIndicator(id: MapIndicatorId): void;
  editField(key: FieldKey, text: string): void;
  applyField(key: FieldKey): void;
  setToReal(key: FieldKey): void;
  selectTimelineEntry(index: number): void;
  openRangeSource(ref: ValueRef): void;
  closeDialog(): void;
  exportSaveCode(): void;
  openImport(): void;
  importSaveCode(text: string): void;
  exportStoredText(): void;
  reportCopyFailed(): void;
}
