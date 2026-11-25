// Engine input, output, error and rule types for src/simulation/.
// Types only: no runtime code. Erasable syntax only (no enum, namespace or parameter properties).
// Every property is readonly and every array is a readonly array, at every nesting level (Requirement 1.9).

import type { CityName, DistrictCode, QuarterKey } from './data-files.ts';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type ToolId = string; // 'socialHousing' | 'commuterPass' | 'rentSubsidy' in this spec
export type IndicatorId = string;
export type AreaKey = DistrictCode | CityName;

export interface Citation {
  readonly citation: string;
  readonly url: string;
}

export interface ParameterRange {
  readonly low: number;
  readonly high: number;
  readonly lowSource: Citation;
  readonly highSource: Citation;
}

export type ParameterStatus = 'verified' | 'check' | 'secondary' | 'gap';

export interface Estimated {
  readonly method: string;
}

export interface ScalarParameter {
  readonly kind: 'scalar';
  readonly value: number;
  readonly unit: string;
  readonly source: Citation;
  readonly status: ParameterStatus; // required, checked in stage 0
  readonly range?: ParameterRange;
  readonly estimated?: Estimated; // required for status secondary and gap
  readonly assumption?: string; // required for a gap parameter that has a value
}

export interface ScheduleParameter {
  readonly kind: 'schedule';
  readonly offsets: readonly number[];
  readonly shares: readonly number[];
  readonly unit: string;
  readonly source: Citation;
  readonly status: ParameterStatus;
  readonly estimated?: Estimated;
  readonly assumption?: string;
}

export type ParameterTable = Readonly<Record<string, ScalarParameter | ScheduleParameter>>;

export interface EngineBaseline {
  readonly quarters: readonly QuarterKey[]; // consecutive from 2015Q1, 1 to 44
  readonly districts: readonly {
    readonly code: DistrictCode;
    readonly city: CityName;
  }[]; // 41, ascending code
  readonly indicators: Readonly<
    Record<string, Readonly<Record<DistrictCode, readonly (number | null)[]>>>
  >;
  readonly indicatorSources: Readonly<Record<string, readonly string[]>>;
  readonly sourceIds: readonly string[]; // the Baseline source registry
}

/** field -> area -> value */
export type ToolSetting = Readonly<Record<string, Readonly<Record<AreaKey, number>>>>;

export interface PolicySetting {
  readonly quarter: QuarterKey;
  readonly tools: Readonly<Record<ToolId, ToolSetting>>;
}

/** Looked up by quarter, any order. */
export type PolicyTimeline = readonly PolicySetting[];

export interface CommuteMatrix {
  readonly codes: readonly DistrictCode[];
  readonly minutes: readonly (readonly number[])[]; // 41 x 41
}

export interface SimEvent {
  readonly id: string;
  readonly type: string;
  readonly firstQuarter: QuarterKey;
  readonly lastQuarter: QuarterKey;
  readonly affectedIndicators: readonly string[]; // display only
  readonly magnitude: {
    readonly text: string;
    readonly value?: number;
    readonly unit?: string;
  }; // display only
  readonly sources: readonly string[];
  readonly modifiers: readonly {
    readonly tool: ToolId;
    readonly parameterId: string;
  }[];
}

export interface EngineOptions {
  readonly registry?: RuleRegistry;
  readonly seed?: number; // accepted and unused in this spec
  readonly budgetMode?: 'enforce' | 'record'; // default 'enforce'; 'record' only for the backtest
}

export type ScenarioName = 'central' | 'low' | 'high';

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type ValueKind = 'count' | 'bounded' | 'non-negative';

export type GhostGroupId =
  | 'ghost-rent-housed'
  | 'ghost-rent-spillover'
  | 'ghost-rent-subsidy'
  | 'ghost-rent-sublease'
  | 'ghost-commute'
  | 'ghost-overlap'
  | 'ghost-displaced';

export interface CauseParameter {
  readonly parameterId: string;
  readonly status: ParameterStatus;
  readonly estimated?: Estimated;
  readonly range?: ParameterRange;
}

export interface Cause {
  readonly kind: 'baseline' | 'tool' | 'event' | 'migration' | 'ghost-group' | 'bound';
  /** 'baseline', a tool id, an event id, 'migration', 'bound', or a Ghost group id. */
  readonly id: string | GhostGroupId;
  readonly contribution: number;
  readonly parameterIds: readonly string[]; // sorted
  readonly sourceIds: readonly string[]; // sorted
  readonly parameters: readonly CauseParameter[]; // one per parameter id used, sorted by id
}

export interface CauseBreakdown {
  readonly indicator: IndicatorId;
  readonly district: DistrictCode;
  readonly quarter: QuarterKey;
  readonly value: number;
  readonly causes: readonly Cause[];
}

export interface LagEntry {
  readonly tool: ToolId;
  readonly area: AreaKey;
  readonly committed: QuarterKey;
  readonly effect: QuarterKey;
  readonly value: number;
}

export interface BudgetPlan {
  /** The real settings, by quarter. */
  readonly real: PolicyTimeline;
  /** Per tool and quarter: the 44-slot increments of the real charge after the Cost_Schedule. */
  readonly realCharges: Readonly<Record<ToolId, readonly (readonly number[])[]>>;
  /** 11 years: sum of the real charges of the tools falling into the year. */
  readonly annualBudget: readonly number[];
  /** 11 years: the budget.ceiling parameter, else the Annual_Budget. */
  readonly ceilings: Readonly<Record<ToolId, readonly number[]>>;
}

export interface BudgetLedger {
  readonly plan: BudgetPlan;
  /** Last quarter whose charges are in `committed`. */
  readonly through: QuarterKey | null;
  /** 44 slots per tool, real plus difference charges. */
  readonly committed: Readonly<Record<ToolId, readonly number[]>>;
  /** Year of the Sim_State quarter. */
  readonly year: number;
  /** annualBudget[year] minus the sum of committed in that year. */
  readonly remaining: number;
}

export interface SimState {
  readonly quarter: QuarterKey;
  readonly indicators: readonly {
    readonly id: IndicatorId;
    readonly unit: string;
    readonly kind: ValueKind;
  }[];
  readonly values: Readonly<Record<IndicatorId, Readonly<Record<DistrictCode, number>>>>;
  readonly causes: Readonly<Record<IndicatorId, Readonly<Record<DistrictCode, CauseBreakdown>>>>;
  readonly lagPipeline: readonly LagEntry[];
  readonly ledger: BudgetLedger;
  readonly migration: {
    readonly displaced: Readonly<Record<DistrictCode, number>>;
    readonly movedIn: Readonly<Record<DistrictCode, number>>;
    readonly exits: number;
  };
  readonly carry: {
    readonly stock: Readonly<Record<ToolId, Readonly<Record<AreaKey, number>>>>;
  };
}

export interface ResultRange {
  readonly min: number;
  readonly central: number;
  readonly max: number;
}

export interface QuarterRanges {
  readonly quarter: QuarterKey;
  readonly ranges: Readonly<Record<IndicatorId, Readonly<Record<DistrictCode, ResultRange>>>>;
}

// ---------------------------------------------------------------------------
// Errors and results
// ---------------------------------------------------------------------------

export type EngineErrorCode =
  | 'quarter-invalid'
  | 'no-later-quarter'
  | 'registry-duplicate'
  | 'rule-reference-missing'
  | 'parameters-invalid'
  | 'commute-matrix-invalid'
  | 'baseline-missing'
  | 'baseline-invalid'
  | 'track-missing'
  | 'policy-value-invalid'
  | 'limit-exceeded'
  | 'real-net-price-zero'
  | 'households-exceed-renters'
  | 'derived-input-invalid'
  | 'event-invalid'
  | 'event-reference-unknown'
  | 'budget-exceeded'
  | 'ceiling-exceeded'
  | 'stock-negative'
  | 'non-finite';

export type ParameterProblem =
  | 'missing'
  | 'non-finite'
  | 'unit-empty'
  | 'source-empty'
  | 'range-invalid'
  | 'value-outside-range'
  | 'out-of-bounds'
  | 'schedule-invalid'
  | 'limit-invalid'
  | 'group-invalid'
  | 'status-missing'
  | 'status-unknown'
  | 'estimated-missing'
  | 'estimated-method-empty'
  | 'assumption-missing'
  | 'lag-derivation-missing'
  | 'range-not-allowed';

export interface ParameterIssue {
  readonly parameterId: string;
  readonly problem: ParameterProblem;
}

export interface EngineError {
  readonly code: EngineErrorCode;
  /** English, developer-facing, names every offending value. */
  readonly message: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  /** parameters-invalid only, sorted by parameter id, then problem. */
  readonly issues?: readonly ParameterIssue[];
}

export type StepResult =
  | { readonly ok: true; readonly state: SimState }
  | { readonly ok: false; readonly error: EngineError };

export type RunResult =
  | { readonly ok: true; readonly states: readonly SimState[] }
  | { readonly ok: false; readonly error: EngineError; readonly quarter: QuarterKey | null };

export type RangeResult =
  | {
      readonly ok: true;
      readonly central: readonly SimState[];
      readonly low: readonly SimState[];
      readonly high: readonly SimState[];
      readonly ranges: readonly QuarterRanges[];
    }
  | {
      readonly ok: false;
      readonly scenario: ScenarioName;
      readonly quarter: QuarterKey | null;
      readonly error: EngineError;
    };

export type BudgetCheck =
  | {
      readonly ok: true;
      readonly year: number;
      readonly annualBudget: number;
      readonly committed: number;
      readonly remaining: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'annual-budget';
      readonly year: number;
      readonly annualBudget: number;
      readonly committed: number;
      readonly over: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'tool-ceiling';
      readonly tool: ToolId;
      readonly year: number;
      readonly ceiling: number;
      readonly committed: number;
      readonly over: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'wrong-quarter';
      readonly expected: QuarterKey;
      readonly received: QuarterKey;
    };

export interface LimitInfo {
  readonly lower: number;
  readonly upper: number;
  readonly lowerParameterId: string | null;
  readonly upperParameterId: string | null;
  readonly lowerSource: Citation | null;
  readonly upperSource: Citation | null;
  readonly scope: 'quarter' | 'city-year';
  readonly ceiling: number;
  readonly remainingCeiling: number;
}

// ---------------------------------------------------------------------------
// Rule interfaces
// ---------------------------------------------------------------------------

export type ParameterRole =
  | 'effect'
  | 'derivation'
  | 'lag'
  | 'cost'
  | 'schedule'
  | 'limit'
  | 'ceiling'
  | 'ghost-size'
  | 'reference';

export type ParameterCheck =
  | { readonly kind: 'finite' }
  | { readonly kind: 'non-negative' }
  | { readonly kind: 'positive' }
  | { readonly kind: 'share' }
  /** Finite, greater than 0, at most 1; a `range` must lie inside 0 to 1. */
  | { readonly kind: 'unit-share' }
  | { readonly kind: 'integer'; readonly min: number; readonly max: number }
  | { readonly kind: 'schedule' };

export interface ParameterSpec {
  readonly id: string;
  readonly role: ParameterRole;
  readonly check: ParameterCheck;
  readonly optional?: boolean;
}

/** Parameter ids and Source_Ids that a contribution links to. */
export interface CauseLinks {
  readonly parameterIds: readonly string[];
  readonly sourceIds: readonly string[];
}

/** One signed contribution to an indicator value, with its links. */
export interface Contribution {
  readonly value: number;
  readonly links: CauseLinks;
}

export interface CauseDraft {
  readonly kind: ValueKind;
  /** The Baseline or Derived_Baseline value and its links. */
  readonly start: Contribution;
  /** One per registry tool, in registry order. */
  readonly tools: readonly (Contribution & { readonly tool: ToolId })[];
  readonly events: readonly (Contribution & { readonly eventId: string })[];
  readonly migration: Contribution;
  /** Ghost count only; replaces tools, events and migration. */
  readonly groups?: readonly (Contribution & { readonly groupId: GhostGroupId })[];
}

/** One entry per Rent_Group_Source of a district. */
export interface GhostGroupContribution {
  readonly source: 'housed' | 'spillover' | 'subsidy' | 'sublease';
  /** Persons in the group. */
  readonly persons: number;
  /** Burden change of the group in percentage points. */
  readonly burdenChangePp: number;
  /** persons x burdenChangePp in totals form; exactly 0 at zero differences. */
  readonly personPp: number;
  readonly links: CauseLinks;
}

export interface ToolEffects {
  readonly deltas: Readonly<Record<IndicatorId, Readonly<Record<DistrictCode, number>>>>;
  readonly links: Readonly<Record<IndicatorId, CauseLinks>>;
  /** TWD per month, by origin district (Requirement 5.5). */
  readonly commuteCostDelta?: Readonly<Record<DistrictCode, number>>;
  readonly ghostGroups?: Readonly<Record<DistrictCode, readonly GhostGroupContribution[]>>;
}

export interface ToolField {
  readonly id: string;
  readonly area: 'district' | 'city';
  readonly integer?: boolean;
  readonly limitScope: 'quarter' | 'city-year';
}

/** Read-only inputs shared by every rule call in one run. */
export interface RuleContext {
  readonly params: ParameterTable;
  readonly baseline: EngineBaseline;
  readonly realTrack: PolicyTimeline;
  readonly commute: CommuteMatrix;
}

export interface ToolRule {
  readonly id: ToolId;
  readonly level: 'district' | 'city';
  readonly effect: 'stock' | 'flow';
  /** Player-editable fields. */
  readonly fields: readonly ToolField[];
  /** Read from the Real_Policy_Track only (for example passesSold). */
  readonly trackOnlyFields: readonly string[];
  readonly lagParameterId: string;
  /** Indicators an Event modifier may scale. */
  readonly modifiable: readonly IndicatorId[];
  parameters(): readonly ParameterSpec[];
  checkSetting(
    player: ToolSetting,
    real: ToolSetting,
    quarter: QuarterKey,
    ctx: RuleContext,
  ): EngineError | null;
  /** Exactly 0 when player equals real. */
  difference(
    player: ToolSetting,
    real: ToolSetting,
    quarter: QuarterKey,
    ctx: RuleContext,
  ): Readonly<Record<AreaKey, number>>;
  /** Whole TWD, before the Cost_Schedule. */
  charge(
    player: ToolSetting,
    real: ToolSetting,
    quarter: QuarterKey,
    ctx: RuleContext,
  ): { readonly real: number; readonly difference: number };
  effects(
    active: Readonly<Record<AreaKey, number>>,
    t: QuarterKey,
    ctx: RuleContext,
  ): ToolEffects;
}

/** Everything computed earlier in the quarter, passed to indicator rules. */
export interface QuarterWork {
  readonly quarter: QuarterKey;
  readonly quarterIndex: number;
  readonly ctx: RuleContext;
  /** Tool effects after Event modifiers, by tool id. */
  readonly effects: Readonly<Record<ToolId, ToolEffects>>;
  /** Event Causes by tool id, indicator id and district. */
  readonly eventContributions: Readonly<
    Record<
      ToolId,
      Readonly<
        Record<
          IndicatorId,
          Readonly<
            Record<DistrictCode, readonly (Contribution & { readonly eventId: string })[]>
          >
        >
      >
    >
  >;
  /** Reported values of indicators computed earlier in the quarter. */
  readonly values: Readonly<Record<IndicatorId, Readonly<Record<DistrictCode, number>>>>;
  readonly migration: {
    readonly net: Readonly<Record<DistrictCode, number>>;
    readonly displaced: Readonly<Record<DistrictCode, number>>;
    readonly movedIn: Readonly<Record<DistrictCode, number>>;
    readonly exits: number;
  } | null;
  readonly carry: Readonly<Record<ToolId, Readonly<Record<AreaKey, number>>>>;
}

export interface IndicatorRule {
  readonly id: IndicatorId;
  readonly unit: string;
  readonly valueKind: ValueKind;
  readonly stage: 'pre-migration' | 'post-migration';
  parameters(): readonly ParameterSpec[];
  /** Start value, tool deltas, migration and links for one district. */
  draft(d: DistrictCode, work: QuarterWork): CauseDraft;
  /**
   * Optional reported value that replaces the summed Causes (Ghost count: the floored count).
   * The engine passes it to `finish` as `valueOverride`.
   */
  valueOverride?(d: DistrictCode, work: QuarterWork): number;
}

export interface RuleRegistry {
  /** socialHousing, commuterPass, rentSubsidy. */
  readonly tools: readonly ToolRule[];
  readonly indicators: readonly IndicatorRule[];
}
