# Implementation Plan: Game UI (Historical mode)

## Overview

The plan follows the phase plan of the design.

- **Phase A (tasks 1 to 11)** builds everything that is allowed before the design approval: dependencies and build configuration, `src/types/save.ts` and `src/types/view.ts`, the Data_Loader (`src/data/`), the Save_Store (`src/save/`), the Game core and Game_Controller (`src/game/`), the Demo_Script (`scripts/build-demo.ts`, `scripts/demo/`) and their tests. Phase A runs on fixtures: the engine fixtures in `tests/simulation/fixtures/` and fixture Data_Files that include `medianTotalPrice`.
- **Phase B (task 12)** prepares the Design_Proposal artifact and records the user's approval in `KIRO-LOG.md` (Requirement 1). **Task 12 blocks every task that creates a file in `src/ui/` or `src/styles/` (tasks 13 to 18).**
- **Phase C (tasks 13 to 18)** builds the Token_File, the UI_Strings_Module, the pure UI functions, the components and the wiring in `src/main.ts` and `index.html`.
- **Phase D (tasks 19 to 21)** needs inputs that do not exist yet: the real `params.json`, `commute-matrix.json`, `events.json` and the district `medianTotalPrice` field. It generates the committed Demo_Save, adds the real-file tests and ends with the manual checks of Requirement 19.11.

All code is TypeScript in `strict` mode. Modules imported by the Demo_Script (`src/game/`, `src/save/`, `src/data/`, `src/types/`) use erasable syntax only (no `enum`, `namespace` or parameter properties). The agent does not start long-running processes; the user runs `npm run dev` and `npm run preview`.

### Blocked inputs

| Input | State | Tasks that wait for it |
|---|---|---|
| `src/types/events-file.ts`, `src/data/validate-events.ts` | event-library tasks 1.1 and 1.3, not built | 3.5, 3.7 (the events step of the Data_Loader) |
| Real `public/data/params.json` | not produced (Open Question 15, TODO) | 19.1 to 19.4 (Demo_Save values and generation). The Demo_Script and its tests (task 10) are built and tested on fixtures. |
| Real `public/data/commute-matrix.json` | not produced | 19.1 to 19.5 |
| Real `public/data/events.json` | event-library spec, not built | 19.1 to 19.5 |
| District `medianTotalPrice` in `history.json` | data-pipeline tasks 16 to 21, not executed | 19.5 (Price_To_Income on real data). Until then the Data_Loader reports `history.json` as lacking `medianTotalPrice` (Requirement 2.5). |

## Tasks

- [x] 1. Dependencies, build configuration and the boundary test
  - [x] 1.1 Add `vite`, `d3-geo` and `@types/d3-geo` at exact pinned versions
    - Approved by the user on 2026-11-16 (Requirement 18.9, Open Question 2). Install with `npm install --save-exact` (`.npmrc` already has `save-exact=true`): `d3-geo` under `dependencies`, `vite` and `@types/d3-geo` under `devDependencies`. No `^` or `~`. Commit `package-lock.json`
    - Add no other package, and no DOM test package such as `jsdom` or `happy-dom` (Requirement 18.10)
    - Add the scripts `"dev": "vite"`, `"build": "vite build"`, `"preview": "vite preview"` and `"demo": "node scripts/build-demo.ts"`; they must work in PowerShell and Git Bash (no POSIX-only commands, no inline `VAR=value`)
    - Create `vite.config.ts` with `base: '/butterfly-city/'`
    - Add `"vite/client"` to `compilerOptions.types` in `tsconfig.json`, keeping `"node"` and any type package already in effect, so `npm run typecheck` still passes for `scripts/` and `tests/`
    - Record in `KIRO-LOG.md` the approval with the date 2026-11-16, the three package names and their pinned versions (Requirement 18.9)
    - _Requirements: 18.8, 18.9, 18.10_

  - [x] 1.2 Write the static boundary test `tests/static/boundaries.test.ts`
    - Parse `import … from '…'`, `import type … from '…'`, `export … from '…'` and dynamic `import('…')` in every `src/**/*.ts` with regular expressions over the source text; resolve relative paths
    - Fail with file name and import path for each violation of: `src/ui/` imports `src/simulation/` only with `import type` and nothing from `src/save/` or `src/data/` (18.1); `src/save/` imports nothing from `src/ui/` (18.3); `src/simulation/` imports nothing from `src/ui/`, `src/game/`, `src/save/`, `src/data/` (18.6); nothing in `src/` imports `scripts/` (18.7)
    - The test passes with no `src/ui/` folder present, so it runs in Phase A
    - _Requirements: 18.2, 18.1, 18.3, 18.6, 18.7, 19.7_

- [x] 2. Shared types
  - [x] 2.1 Create `src/types/save.ts`
    - `SAVE_SCHEMA_VERSION = 1`, `MAX_TIMELINE_ENTRIES = 500` (design decision G8, decided 2026-11-18, design "Open items" 1), `MAP_INDICATOR_IDS` (5 ids, including `lowUseHousingRate`; updated 2026-11-18), `MapIndicatorId`, `PolicyDiffSeries`, `TimelineEntry` (kinds `value` and `real-track`), `Save` and `DemoSummary` exactly as in the design "Data Models"
    - Types and constants only, every property `readonly`, erasable syntax only
    - _Requirements: 12.1, 13.1, 14.25_

  - [x] 2.2 Create `src/types/view.ts`
    - `ScreenView`, `GameView`, `ValueRange`, `ValueRef`, `FieldKey`, `SimulatedValueView`, `PanelRowView`, `DistrictPanelView`, `ParameterRefView`, `FieldView`, `ToolView`, `ConstructionRowView`, `RangeSourceView`, `ParameterAssumptionView`, `TurnBarView`, `MapViewModel`, `MapDistrictView`, `LegendView`, `TimelineQuarterView`, `TimelineItemView`, `EditCheckView`, `DialogView`, `Announcement`, `DemoDescriptionView`, `StoredProblemView` and `UiActions`, as listed in the design
    - View types hold numbers, ids, flags and Data_File text only: no formatted string and no Scenario id
    - _Requirements: 5.3, 18.1_

- [x] 3. Data_Loader (`src/data/`)
  - [x] 3.1 Create `src/data/expected.ts`
    - `DATA_FILE_NAMES` (the 6 names, matrix file `commute-matrix.json`), `DataFileName`, `EXPECTED_POLICY_SERIES_IDS`, `REQUIRED_HISTORY_INDICATORS` (`population`, `householdIncome`, `rent`, `mrtEntries`, `socialHousingStock`, `medianTotalPrice`), `TRACK_FIELDS`, `PASS_PRICE_SERIES`
    - Import nothing from `scripts/` (Requirement 18.7); the parity with the scripts' tables is checked in 3.4
    - _Requirements: 2.1, 2.5_

  - [x] 3.2 Implement `validateParamsFile` (`src/data/validate-params.ts`)
    - Pure, never throw, return `ValidationError[]` in the style of `validate.ts`
    - `params.json`: `{ schemaVersion: 1, parameters }`; per entry `kind`, field types, finite numbers, non-empty `unit`, `source.citation` and `source.url` strings, `range` shape, `status` in the 4 values. Semantic checks stay with Engine stage 0
    - `commute-matrix.json`: no new validator and no `schemaVersion` check. The file has exactly the keys `codes` and `minutes` (data-pipeline Requirement 24.1); the Data_Loader uses the existing `validateCommuteMatrix` in `src/data/validate.ts`
    - `'params.json'` and `'commute-matrix.json'` are in `ValidationError.file` in `src/data/validate.ts`; add either one only if it is missing (event-library task 1.3 adds `'events.json'` to the same union; merge, do not overwrite)
    - _Requirements: 2.2_

  - [x] 3.3 Create fixture Data_Files in `tests/data/fixtures/`
    - The 6 Data_Files as JSON, built from the engine fixtures in `tests/simulation/fixtures/`, with a `history.json` that includes `medianTotalPrice` and estimate flags, an `events.json` with at least one Major_Event, a `params.json` and a `commute-matrix.json` in the shapes fixed by the design
    - A small fixture helper that reads them for tests in Node
    - _Requirements: 2.1, 2.5_

  - [ ]* 3.4 Write unit tests for the new validators and `expected.ts`
    - One minimal bad input per rule of `validateParamsFile`; valid fixture files give no error (the commute matrix fixture is checked with the existing `validateCommuteMatrix`)
    - `EXPECTED_POLICY_SERIES_IDS` equals `POLICY_SERIES_SPECS.map(s => s.id)` and `TRACK_FIELDS` equals the table of `scripts/backtest/adapt.ts` (tests may import `scripts/`)
    - _Requirements: 2.2_

  - [x] 3.5 Implement `convert(files)` in `src/data/convert.ts`
    - `LoadedFiles`, `EngineInputs`, `LoadedData` as in the design; baseline as in `buildBaseline`, 44 real `PolicySetting`s from `TRACK_FIELDS` including `commuterPass.passesSold`, the merged Parameter_Table with `commuterPass.price.<city>.<quarter>` entries from `commuterPassPrice`, `paramsFileTable` as read, one `SimEvent` per Event_Card with no modifier
    - Display data (`DistrictEntry` list ascending by code, `HistoryFile`, `PolicyTrackFile`, `EventCard`s) passed through unchanged
    - **Depends on event-library task 1.1** (`src/types/events-file.ts`)
    - _Requirements: 2.4, 7.14_

  - [ ]* 3.6 Write the conversion parity test
    - `convert` and `adaptInputs` of `scripts/backtest/adapt.ts` give deep-equal Engine inputs for the fixture files
    - _Requirements: 2.4_

  - [x] 3.7 Implement `loadDataFiles` in `src/data/loader.ts`
    - Ports `FetchPort`, `TimerPort`; result `LoadResult` with one `LoadFailure` per failing file in file order
    - Requests exactly `${baseUrl}data/<name>` for the 6 names in parallel; per-request `AbortController`; 15,000 ms timeout measured until `text()` resolves; `onProgress(n)` after each complete body
    - Per file the first failing check: HTTP status, timeout, JSON parse, first `ValidationError` as `<path>: <message>`, first missing id of `REQUIRED_HISTORY_INDICATORS` (`lacks the indicator medianTotalPrice`)
    - Validation contexts from the design (district codes read from `districts.json`, the 44 quarters, indicator ids read from `history.json`, `EXPECTED_POLICY_SERIES_IDS`)
    - After all 6 pass: the code-set check of `districts.json`, `history.json` series keys and `commute-matrix.json` `codes`, naming the first missing or extra code; then `convert`
    - No state kept, so Retry is a second call
    - **Depends on event-library task 1.3** (`validateEventsFile`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 2.9, 18.12_

  - [x] 3.8 Write Data_Loader tests `tests/data/loader.test.ts`
    - Missing file (HTTP 404), unparsable file, invalid file, `history.json` without `medianTotalPrice`, a timeout with a fake `TimerPort`, a code-set mismatch, a Retry that succeeds, progress counts 0 to 6
    - A recording `FetchPort` sees exactly the 6 URLs under `/butterfly-city/data/` and no other URL
    - _Requirements: 19.10, 2.5, 2.7, 2.8, 18.12_

- [x] 4. Save_Store (`src/save/`)
  - [x] 4.1 Implement `src/save/base64url.ts` and `src/save/canonical-json.ts`
    - base64url alphabet `A–Z a–z 0–9 - _`, no padding; strict decoding (alphabet only, length mod 4 ≠ 1, unused trailing bits 0); UTF-8 via `TextEncoder` and `new TextDecoder('utf-8', { fatal: true })`
    - Canonical JSON: object keys sorted by UTF-16 code unit order at every level, arrays in order, no whitespace, numbers via `JSON.stringify`
    - _Requirements: 13.1, 13.2_

  - [x] 4.2 Implement `src/save/validate-save.ts` and `src/save/codec.ts`
    - `SAVE_CODE_PREFIX`, `MAX_SAVE_CODE_LENGTH`, `encodeSave`, `decodeSaveCode(text, ctx)`, `SaveValidationContext`, `DecodeResult`, `SaveCodeError { step, path, reason }`
    - Trim the text, then the 16 steps a to p of the design table in order (`prefix`, `length`, `encoding`, `json`, `schema-version`, `structure`, `types`, `quarters`, `timeline-order`, `registry`, `districts`, `map-indicator`, `selected-district`, `demo-flag`, `seed`, `finite`); first failure returned with a path such as `timeline[3].quarter`
    - `schemaVersion` other than 1 gives "This save code was made by a different version of Butterfly City."
    - One outer `try`/`catch` turns any unexpected exception into `{ step: 'structure', path: '$', reason: 'unreadable save code' }`
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.6, 13.7, 13.9_

  - [x] 4.3 Write Property 2 and the shared Save generator
    - `tests/save/arbitraries.ts`: a valid `Save` generator over the fixture registry and districts (both Timeline_Entry kinds, Count_Field integers, 44-slot diffs, `next` a Quarter_Key or `'complete'`)
    - `tests/save/codec-roundtrip.property.test.ts`, at least 100 runs
    - **Property 2: Save_Code round trip**
    - **Validates: Requirements 13.3, 13.4, 11.8, 19.3**

  - [ ]* 4.4 Write Property 1 in `tests/save/codec-format.property.test.ts`
    - **Property 1: Save_Code format**
    - **Validates: Requirements 13.1**

  - [ ]* 4.5 Write Property 3 in `tests/save/codec-canonical.property.test.ts`
    - Reorder object keys at every level and compare codes
    - **Property 3: Equal Saves encode identically**
    - **Validates: Requirements 13.2**

  - [x] 4.6 Write Property 4 in `tests/save/codec-never-throws.property.test.ts`
    - Three generators of at least 100 cases each: size-limited arbitrary strings, `BC1.` followed by arbitrary characters, arbitrary JSON values encoded with a valid prefix; plus one fixed example longer than 200,000 characters; each invalid input gives `ok: false`
    - **Property 4: Decode never throws**
    - **Validates: Requirements 13.9, 19.4**

  - [ ]* 4.7 Write Property 5 in `tests/save/codec-order.property.test.ts`
    - One corruption builder per step a to p that keeps every earlier step valid
    - **Property 5: Validation order**
    - **Validates: Requirements 13.5, 13.6**

  - [x] 4.8 Write validation example tests `tests/save/validate-save.test.ts`
    - One example per step a to p, the path example `timeline[3].quarter`, the schema-version message of 13.7, each checking the first failing step and path and that the input game object stays unchanged
    - The worst-case Save of design decision G8 (47 series, longest numbers and ids, 500 entries) encodes to at most 200,000 characters
    - _Requirements: 19.5, 13.5, 13.6, 13.7, 13.1_

  - [x] 4.9 Implement `SaveStore` in `src/save/store.ts`
    - `SAVE_KEY = 'butterflycity.save.v1'`, `StoragePort`, `StoredRead` (`none`, `unavailable`, `text`), `readStored()`, `write(save)` that stores `encodeSave(save)` under the one key inside `try`/`catch` and returns `{ ok }`
    - Never removes or rewrites stored text on its own
    - _Requirements: 12.3, 12.7, 12.9_

  - [x] 4.10 Write Save_Store tests `tests/save/store.test.ts`
    - `null` port (`localStorage` unavailable), a throwing `setItem`, invalid stored text returned unchanged by `readStored`, one key only
    - _Requirements: 19.9, 12.3, 12.7, 12.9_

- [x] 5. Checkpoint - Data_Loader and Save_Store
  - Run `npx vitest --run` and `npm run typecheck`; both exit 0 with no skipped, todo or `.only` test. Ensure all tests pass, ask the user if questions arise.

- [x] 6. Game core: tools, policy differences and edit checks (`src/game/core/`)
  - [x] 6.1 Implement `src/game/core/tools.ts`
    - `TOOL_DOMAINS` for all 5 `POLICY_TOOL_IDS`, `toolStatus(registry, id)` from `registry.tools`, `unitCostParameterId(rule)`, field metadata (scope, Count_Field flag, unit)
    - No list of coming-soon ids anywhere
    - _Requirements: 8.1, 8.2, 8.3, 9.10_

  - [x] 6.2 Write the Coming_Soon_Tool test `tests/game/tools.test.ts`
    - Real Rule_Registry: `sublease` and `holdingTax` coming soon, the other three active; a registry copy with a stub `sublease` rule makes it active; a copy without one tool id makes that tool coming soon
    - _Requirements: 19.6, 8.2_

  - [x] 6.3 Implement `src/game/core/policy.ts`
    - `FieldTarget`, `realValue`, `playerValue` (`real + diff`, design decision G1), `playerTimeline`, `withValue`, `withRealTrack`, `followsRealTrack`
    - Differences stored as `value − real` without rounding (G2); slots before `from` untouched; all-zero series dropped so equal timelines give equal `PolicyDiffs`
    - _Requirements: 9.6, 9.14, 8.10, 12.1, 13.2_

  - [x] 6.4 Implement `src/game/core/checks.ts`
    - `parseInput(text, countField)` with `/^-?\d+(\.\d+)?$/` and `/^-?\d+$/`
    - `checkEditSync` (phase 1, no Engine run): fixed-quarter, invalid-format, timeline-full (G8), unchanged, limit verdict by `checkLimit` plus the running city-year rule of engine Decision D6 (design decision G5), budget verdict by `checkBudget`, otherwise `pending-range`; budget figures on every result where `checkBudget` can run
    - `checkEditRange` (phase 2): `runRange` to the Planning_Quarter on the candidate timeline; an Engine_Error in any Scenario gives `engine` with the Scenario name dropped
    - `applyAdjustment(session, req)`: re-runs both phases on the request and, on `ok`, returns the session with the new diffs and exactly one Timeline_Entry; otherwise returns the check and the unchanged session. This is the one write path used by the Game_Controller and the Demo_Script (design decision G3)
    - Limit messages carry side, limit value, unit, period, Parameter id, citation, URL, `status`, estimate method and `assumption` text (**the "reason given in its source" mapping is design "Open items" 2; confirm with the user or add a `reason` field in the `params.json` task**)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.9, 9.10, 9.11, 9.12, 9.14, 9.15, 8.5_

  - [ ]* 6.5 Write Property 15 in `tests/game/parse-input.property.test.ts`
    - **Property 15: Input format**
    - **Validates: Requirements 9.9, 9.10**

  - [ ]* 6.6 Write Property 14 in `tests/game/checks.property.test.ts`
    - Compare the phase-1 limit verdict with `run` to t on the same fixture timeline (side and limit value of the `limit-exceeded` Engine_Error)
    - **Property 14: Controller limit verdict agrees with the Engine**
    - **Validates: Requirements 9.2, 9.8**

  - [ ]* 6.7 Write Property 11 in `tests/game/value-adjustment.property.test.ts`
    - **Property 11: Value_Adjustment semantics**
    - **Validates: Requirements 9.6, 11.4**

  - [ ]* 6.8 Write Property 12 in `tests/game/real-track.property.test.ts`
    - **Property 12: Real_Track_Adjustment semantics**
    - **Validates: Requirements 9.14, 8.10, 11.4**

- [x] 7. Game core: turns and session
  - [x] 7.1 Implement `src/game/core/turns.ts`
    - `StopReason`, `TurnOutcome`, `computeNext`, `fastForward(session, afterQuarter?)`, `carriedCheck`, `recompute`
    - The loop of the design: carried check before the Engine run, one `runRange` from 2015Q1 to t per computed quarter (G4), stops after 4 quarters, 2025Q4, a Major_Event `firstQuarter` (including the first quarter of the run), an Engine_Error (failed quarter discarded) or a carried-value break; `afterQuarter` called after each computed quarter
    - Carried-check targets in registry, field and Area order (District_Code ascending, then Taipei, New Taipei)
    - _Requirements: 5.1, 7.1, 7.2, 7.5, 7.7, 7.8, 9.8_

  - [x] 7.2 Implement `src/game/core/session.ts`
    - `PolicyDiffs`, `ComputedRun`, `GameSession`, `newSession` (`next: '2015Q1'`, `mapIndicator: 'rentBurden'`, `selectedDistrict: null`, `seed: 0`), `toSave` (no Sim_State, series sorted by tool, field, area), `fromSave` (one `runRange` to the quarter before `next`, or to 2025Q4 for `'complete'`, none for 2015Q1; version notice when `engineVersion` differs from `ENGINE_VERSION`)
    - _Requirements: 12.1, 12.6, 13.8, 7.14_

  - [ ]* 7.3 Create the shared game generators `tests/game/arbitraries.ts`
    - A `GameSession` reached from `newSession` by a random sequence of `computeNext`, `fastForward`, Value_Adjustments, Real_Track_Adjustments, district selections and Map_Indicator changes on the engine fixtures, horizon at most 8 quarters
    - _Requirements: 7.14, 12.12_

  - [ ]* 7.4 Write Property 7 in `tests/game/next-quarter.property.test.ts`
    - **Property 7: Next quarter advances exactly one quarter**
    - **Validates: Requirements 7.1, 7.3**

  - [ ]* 7.5 Write Property 8 in `tests/game/fast-forward.property.test.ts`
    - Major_Events placed with `fc.subarray` of the 44 quarters; injected failure by a difference that breaks the upper limit at a chosen later quarter or by a Parameter_Table override that makes one Scenario fail
    - **Property 8: Fast-forward stop conditions**
    - **Validates: Requirements 7.5, 7.7, 7.8, 9.8**

  - [ ]* 7.6 Write Property 10 in `tests/game/rejections.property.test.ts`
    - Values on both sides of the `checkLimit` bounds, values above the Annual_Budget, malformed text, Fixed_Quarter targets and rejected Real_Track_Adjustments through `applyAdjustment`
    - **Property 10: Rejected adjustments change nothing**
    - **Validates: Requirements 9.2, 9.3, 9.5, 9.7, 9.11, 9.15**

  - [x] 7.7 Write rejection example tests `tests/game/rejections.test.ts`
    - An edited value below the lower limit, above the upper limit and over the budget, each checking the reported side, limit value or amount over (> 0), and that diffs and Timeline_Entries stay unchanged
    - _Requirements: 19.2, 9.2, 9.3, 9.5_

- [x] 8. Game core: display conversions and view building
  - [x] 8.1 Implement `src/game/core/conversions.ts`
    - `priceToIncome(history, code, q)`: `medianTotalPrice ÷ householdIncome`, rounded half up to 2 decimals; `null` for a missing or `null` price or a missing, `null` or zero income; every non-null value `estimated: true` with the income method id and, when estimated, the price method id
    - `populationChange(population, base)` with base the 2015Q1 `history.json` population, not rounded
    - **On real data this needs `medianTotalPrice` from data-pipeline tasks 16 to 21; Phase A uses the fixture `history.json`**
    - _Requirements: 3.5, 3.6, 3.14, 18.4_

  - [x] 8.2 Write Price_To_Income unit tests `tests/game/conversions.test.ts`
    - A hand-computed value, a missing Median_Total_Price, a zero `householdIncome`, the estimate flag and method ids
    - _Requirements: 19.8, 3.5, 3.6, 3.14_

  - [ ]* 8.3 Write Property 17 in `tests/game/price-to-income.property.test.ts`
    - **Property 17: Price_To_Income conversion**
    - **Validates: Requirements 3.5, 3.6, 3.14**

  - [x] 8.4 Implement `src/game/core/range-sources.ts`
    - `scenarioOfMin` (first of low, high, central equal to the minimum), `scenarioOfMax` (first of high, low, central), `assumptionsFor(params, scenario)` over `scenarioTable` and `SCENARIO_EFFECT_IDS` in order, citation from `range.lowSource` or `range.highSource` for a ranged value, otherwise `source`; empty citation or URL becomes `null`; no Scenario name in the result
    - _Requirements: 20.2, 20.3, 20.5, 5.3_

  - [x] 8.5 Write Range_Source tests `tests/game/range-sources.test.ts`
    - A value whose minimum comes from `low` and one whose minimum comes from `high`: the listed assumptions for minimum and maximum equal the values, citations and URLs of `scenarioTable`; a value with equal Result_Range values gives `same: true` with `lowest` and `highest` `null` (the displayed text of 20.4 is tested in 16.9)
    - _Requirements: 19.14, 20.2, 20.4_

  - [ ]* 8.6 Write Property 24 in `tests/game/range-sources.property.test.ts`
    - **Property 24: Range source Scenarios and assumptions**
    - **Validates: Requirements 20.2, 20.5**

  - [x] 8.7 Implement `src/game/core/construction.ts`
    - `constructionEntries(displayed, names)`: `socialHousing` Lag entries with `value !== 0` of the central Displayed_Quarter state; `lag`, `progress`, `afterEnd`; sorted by effect quarter then romanized name; one row per (district, committed quarter)
    - `completionItems(states)`: non-zero entries with effect quarter at or before the Displayed_Quarter, identified by (area, committed), under their effect quarter
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_

  - [x] 8.8 Write construction progress unit tests `tests/game/construction.test.ts`
    - Progress at n = 0, at n = Lag − 1, and an effect quarter after 2025Q4 (`afterEnd`); positive and negative differences
    - _Requirements: 19.8, 10.4, 10.7_

  - [ ]* 8.9 Write Property 25 in `tests/game/construction-partition.property.test.ts`
    - **Property 25: Construction rows and Completion_Items partition the non-zero entries**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.9**

  - [ ]* 8.10 Write Property 26 in `tests/game/construction-progress.property.test.ts`
    - **Property 26: Construction progress**
    - **Validates: Requirements 10.4, 10.7**

  - [x] 8.11 Implement `src/game/core/timeline.ts`
    - `timelineItems(session)`: headings from 2015Q1 to the Planning_Quarter (2025Q4 when complete) only for quarters with items; per quarter Event_Cards of a Computed_Quarter in `events.json` order, then Completion_Items by district name, then Timeline_Entries in applied order; only Major_Event items carry `major: true`; Event_Card fields copied unchanged
    - _Requirements: 7.9, 11.1, 11.2, 11.3, 11.4, 11.5, 11.10, 15.8_

  - [x] 8.12 Implement `buildGameView` in `src/game/core/views.ts`
    - Pure; `DISPLAY_DECIMALS` and `ESTIMATE_INPUTS` tables of the design; Map_View model (indicator, "Real data, 2015Q1" mode before any quarter with 2015Q1 history and Derived_Baseline values, per-district central value or `null`, range, estimate flag, class index left for the UI), District_Panel 9 rows in the order of 6.1 with comparison labels, Policy_Panel (2 domains, 5 tools via `toolStatus`, Active_Tool fields with real and player values, Parameter refs, limits, city-year total, remaining Budget_Ceiling, drafts, Apply and Set_To_Real flags, construction rows, carried problem), Turn_Bar (planning, displayed, turn number, complete, busy, demo label), Timeline_View, Range_Source_View with `same` decided by `roundTo` on min, central and max
    - Commute_Time rows flagged `modelEstimate` (Open Question 10); no Scenario id anywhere in the view
    - `lowUseHousingRate` Map_Indicator (added 2026-11-18): value read from `history.json` only (no range, same in all Scenarios); `null` record gives value `null` (never 0) and `dataPeriod` of a non-null record is passed in `MapDistrictView`; 2 decimals; unit percent of dwellings (data-pipeline Requirement 26.11)
    - _Requirements: 3.8, 3.12, 3.13, 3.14, 5.1, 5.3, 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.8, 6.10, 7.3, 7.4, 7.7, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.13, 9.8, 18.4, 20.2_

  - [ ]* 8.13 Write Property 27 in `tests/game/timeline.property.test.ts`
    - **Property 27: Timeline_View order and content**
    - **Validates: Requirements 7.9, 11.1, 11.2, 11.4, 11.5, 15.8**

  - [x] 8.14 Write the Engine-parity example test `tests/game/views-engine.test.ts`
    - On the fixture data: the values `buildGameView` passes for one district per city and at least two Computed_Quarters equal the `runRange` Result_Ranges (Population_Change through its conversion)
    - _Requirements: 18.5, 5.1_

  - [ ]* 8.15 Write Property 23 in `tests/game/views-engine.property.test.ts`
    - **Property 23: Displayed values equal the Engine output**
    - **Validates: Requirements 5.1, 18.5**

  - [x] 8.16 Write the Scenario-label scan test `tests/game/views-no-scenario.test.ts`
    - Deep-scan the `GameView` of fixture sessions (including an open Range_Source_View and a rejected edit): no display-text field holds `central`, `low` or `high` as a Scenario label
    - _Requirements: 19.13, 5.3, 20.3_

  - [ ]* 8.17 Write Property 22 in `tests/game/views-no-scenario.property.test.ts`
    - **Property 22: No Scenario names in view data**
    - **Validates: Requirements 5.3, 20.3**

  - [ ]* 8.18 Write Property 28 in `tests/game/active-tools.property.test.ts`
    - Registry copies with subsets of the real rules plus stub rules; the Policy_Panel view lists all 5 tools in the order of 8.1
    - **Property 28: Active tool detection**
    - **Validates: Requirements 8.2, 8.1**

- [x] 9. Game_Controller and the runtime demo source
  - [x] 9.1 Implement `GameController` in `src/game/controller.ts`
    - Ports `SaveStorePort` and `Scheduler`; `subscribe`, `view()`, `actions: UiActions`
    - Busy guard on `nextQuarter`, `fastForward`, `applyField`, `setToReal` (7.10, 7.11); `busy = true; publish; scheduler.defer(compute)`; busy cleared only in the view that carries the new values (6.12)
    - Save writes after each computed quarter (through `afterQuarter`), applied adjustment, Map_Indicator change and Selected_District change, and only after "New game", "Continue" or "Load demo"; storage warning until the next successful write (12.2, 12.9)
    - Edit drafts keyed by `FieldKey` with generation counter; phase 2 deferred and stored only for the current generation; `applyField` and `setToReal` go through `applyAdjustment` (9.1, 9.5, 9.12, 9.13)
    - Start menu options from `readStored()` (12.4, 12.5); stored-problem handling with "Export stored text" (12.7, 12.8); confirmations for "New game", "Load demo" and "Import" with decline and Escape leaving session and storage unchanged (12.10, 12.11, 13.12, 14.11, 17.14)
    - Import: decode, `fromSave`, replace and write only on success; errors with path and reason or failing quarter (13.6, 13.10, 13.11); version notice (13.8)
    - Export save code (13.1), copy-failure flag (13.13), event cards after a Major_Event stop until dismissed or the next turn action (7.6), live announcements: one polite per Computation_Run with the Displayed_Quarter and `runEventIds` titles, one assertive per Engine_Error (17.7, 17.8)
    - `selectTimelineEntry`: sets Selected_District for a district field and a one-shot `focusRequest`; never changes diffs or timeline (11.6, 11.7)
    - No clock and no random source (7.14)
    - _Requirements: 6.12, 7.2, 7.6, 7.10, 7.11, 7.14, 9.1, 9.5, 9.12, 9.13, 11.6, 11.7, 12.2, 12.4, 12.5, 12.7, 12.8, 12.9, 12.10, 12.11, 13.6, 13.8, 13.10, 13.11, 13.12, 13.13, 14.9, 14.11, 14.12, 17.7, 17.8, 17.14_

  - [x] 9.2 Implement `readDemo` and the demo description in `src/game/demo.ts`
    - `DemoSource`; `readDemo(ctx, code, summaryText)` decodes the Save_Code and parses the `DemoSummary`, returning `ok: false` with a reason for an empty or invalid code. The Save_Code and summary are passed in, so this module does not import the generated file (main.ts does, task 17.2)
    - `DemoDescriptionView`: every Timeline_Entry (tool, field, Area, quarter, value or real track), the two effect lines in the order of 14.26 (Fallback_Step 0 or 1) or 14.27 (step 2), both for 2021Q1 after one Next quarter; loaded demo sessions have `demo: true`
    - _Requirements: 14.9, 14.10, 14.12, 14.26, 14.27_

  - [x] 9.3 Write Game_Controller example tests `tests/game/controller.test.ts`
    - With a recording Save_Store port and a synchronous scheduler on fixtures: Next_Quarter_Action advances one quarter; Fast_Forward_Action stops after 4 quarters, at a Major_Event quarter, at 2025Q4, at an Engine_Error and before a carried-value break, each checking Displayed_Quarter and Planning_Quarter; a Policy_Adjustment for a Fixed_Quarter is rejected; a Real_Track_Adjustment writes the real value of every later quarter and adds one Timeline_Entry; the same Save loaded twice gives deep-equal views
    - Also: busy guard ignores activations; declined confirmation keeps game and storage; a failed write sets the storage warning until the next successful write
    - _Requirements: 19.1, 7.1, 7.5, 7.7, 7.8, 7.11, 9.7, 9.8, 9.14, 7.14, 12.9, 12.11_

  - [ ]* 9.4 Write Property 9 in `tests/game/time-moves.property.test.ts`
    - **Property 9: Only turn actions move time**
    - **Validates: Requirements 7.2, 4.9**

  - [ ]* 9.5 Write Property 13 in `tests/game/apply-enabled.property.test.ts`
    - Interleave edits with deferred check completions through a manual scheduler
    - **Property 13: Apply is enabled only by a finished, passing check**
    - **Validates: Requirements 9.12, 9.13**

  - [ ]* 9.6 Write Property 16 in `tests/game/saves-written.property.test.ts`
    - **Property 16: Every state change is saved**
    - **Validates: Requirements 12.2**

  - [ ]* 9.7 Write Property 6 in `tests/game/reload.property.test.ts`
    - Load `decodeSaveCode(encodeSave(toSave(session)))` with `fromSave` and compare `GameView`s; load the same Save twice
    - **Property 6: Reload round trip and determinism**
    - **Validates: Requirements 7.14, 11.9, 12.6, 12.12**

  - [ ]* 9.8 Write unit tests for `readDemo` `tests/game/demo.test.ts`
    - An empty code gives `ok: false` with a reason; a fixture Demo_Save gives the description lines in the order of 14.26 and of 14.27
    - _Requirements: 14.10, 14.12, 14.26, 14.27_

- [x] 10. Demo_Script (built and tested on fixtures; the committed Demo_Save is generated in task 19)
  - [x] 10.1 Create `data/config/demo-adjustments.json` with placeholder values
    - `schemaVersion`, `status: "TODO: set with the real params.json (Open Question 15)"`, `ghostThreshold: 1`, `rentBurdenThreshold: 0.1`, `base` and `enlarged` lists in the design shape
    - **TODO: the lists and thresholds are set in task 19.1, once the real `params.json` exists. Do not copy the fixture draft of `requirements.md` as final values.**
    - _Requirements: 14.5, 14.24_

  - [x] 10.2 Implement `scripts/demo/checks.ts`
    - Pure checks of 14.3, 14.4, 14.13, 14.14, 14.15 (per year 2015 and 2016 from the central 2020Q4 ledgers: `0 < SH(demo) − SH(real) ≤ RS(real) − RS(demo)`), 14.16, 14.17 and the list check of 14.24; each failure names the condition with its computed value and threshold
    - _Requirements: 14.3, 14.4, 14.13, 14.14, 14.15, 14.16, 14.17, 14.24_

  - [x] 10.3 Implement `runDemo(inputs)` in `scripts/demo/run-demo.ts`
    - Pure, reads nothing from disk; uses `newSession(data, RULE_REGISTRY, true)`, `computeNext` and `applyAdjustment` (the controller rules of 9.6 and 9.14)
    - Measures the Demo_Lookahead_State (one `computeNext` at 2021Q1, all three Scenarios) against the Zero_Delta_Run (`runRange` on the real track to 2021Q1); Demo_Ghost_Difference per Scenario, Demo_Rent_Burden_Difference per district (central)
    - Pure `decideFallback` for steps 0, 1, 2 and the Selected_District rule of 14.26 and 14.27 (lowest District_Code on a tie); `mapIndicator: 'rentBurden'`
    - Uses only `inputs.paramsFileTable` and the merged Engine table from `convert`; sets or changes no Parameter (14.18)
    - On success returns the Save, `DemoSummary`, the rendered file text and a report line per Fallback_Step tried; on failure the list name and the failing adjustment or quarter (14.6) or the last step and each failed condition (14.23)
    - _Requirements: 14.5, 14.6, 14.18, 14.20, 14.21, 14.22, 14.23, 14.25, 14.26, 14.27_

  - [ ]* 10.4 Write Property 29 in `tests/scripts/demo/fallback.property.test.ts`
    - **Property 29: Demo fallback decision**
    - **Validates: Requirements 14.20, 14.21, 14.22, 14.23, 14.26, 14.27**

  - [ ]* 10.5 Write fixture tests for `checks.ts` and `runDemo` `tests/scripts/demo/run-demo.test.ts`
    - Each check of 10.2 with a passing and a failing fixture; a rejected adjustment and a carried-check stop make `runDemo` fail naming the list and the adjustment or quarter; no step met gives the last step and each failed condition with value and threshold
    - _Requirements: 14.6, 14.23, 14.24_

  - [x] 10.6 Implement `scripts/demo/inputs.ts`, `scripts/demo/output.ts` and `scripts/build-demo.ts`
    - `inputs.ts` reads the 6 files from `public/data/` and `demo-adjustments.json` with Node `fs` and validates them with the Data_Loader validators; a missing or invalid `params.json` exits with code 1 and "The real public/data/params.json is required." (14.19)
    - `output.ts` renders `src/save/demo-save.generated.ts` (header comment "GENERATED by `npm run demo` … Do not edit by hand.", `DEMO_SAVE_CODE`, `DEMO_SUMMARY_TEXT`) and the stdout report
    - `build-demo.ts` prints the report; writes the file only on success; on failure prints the failure, writes nothing and exits with code 1 (14.6, 14.23)
    - _Requirements: 14.5, 14.6, 14.19, 14.23, 14.25_

  - [ ]* 10.7 Write tests for `inputs.ts` and `output.ts` `tests/scripts/demo/build-demo.test.ts`
    - Missing and invalid `params.json` in a temporary folder give the 14.19 failure and no output file; `output.ts` renders a fixture result deterministically
    - _Requirements: 14.19, 14.25_

- [x] 11. Checkpoint - Phase A complete
  - Run `npx vitest --run` and `npm run typecheck`; both exit 0 with no skipped, todo or `.only` test. Ensure all tests pass, ask the user if questions arise.

- [x] 12. Design approval gate (Phase B). **Blocks every task that creates a file in `src/ui/` or `src/styles/` (tasks 13 to 18).**
  - [x] 12.1 Prepare the Design_Proposal artifact
    - A reviewable HTML or SVG artifact outside `src/ui/` and `src/styles/` (for example `docs/design-proposal/game-ui-proposal.html`); create no file in `src/ui/` or `src/styles/`
    - Full Game_Screen mock at 360, 768, 1280 and 1920 CSS pixels (1.1)
    - Every design token with name and value (colours, spacings, font families, sizes, weights, line heights, radii, shadows, motion durations) and the contrast ratio of each text and background pair (1.2, 17.3, 17.5, 17.6)
    - Mocks of: map styling with Indicator_Class fills, the four outline states of 4.8, the "no value" pattern, the estimate marker, district labels; the Low_Use_Housing_Rate map with grey "No data" districts and the `dataPeriod` label of a value; the legend of each Map_Indicator with proposed final Indicator_Class bounds (design "Open items" 4, checked against the 2015Q1–2025Q4 fixture or real values); Range_Display with a range and "same in all scenarios"; the Range_Source_View; the Policy_Panel normal, disabled and rejected states; the "Coming soon" state; the construction progress bar; the Ghost_Layer placeholder; the reduced-motion equivalent of every transition (1.3)
    - Placement of the Disclosure_Text inside the initial viewport at every width (15.1) and the layout that keeps the Turn_Bar controls in the viewport (16.4)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 15.1, 16.4_

  - [x] 12.2 Present the Design_Proposal and record the user's decision
    - Present the artifact to the user and wait for an explicit decision; do not proceed on silence
    - On approval, record in `KIRO-LOG.md` the date as `YYYY-MM-DD`, the artifact file name and the user's statement of approval (1.5)
    - On rejection or change requests, record no approval, revise the artifact and present it again (1.7)
    - Also ask the user to confirm the open items that touch UI text: the 500-entry Timeline cap message (G8) and the limit "reason" display (design "Open items" 1 and 2)
    - _Requirements: 1.4, 1.5, 1.6, 1.7_

- [x] 13. Token_File and the style test (Phase C, after task 12)
  - [x] 13.1 Create `src/styles/tokens.css`
    - Every colour, spacing, font, radius, shadow and motion duration of the approved Design_Proposal as CSS custom properties
    - Ends with `@media (prefers-reduced-motion: reduce)` setting every `--motion-*` token to `0ms` (design decision G11)
    - _Requirements: 1.8, 17.9, 17.10_

  - [x] 13.2 Write the static style test `tests/static/style.test.ts`
    - Scan every `.css` in `src/styles/` except `tokens.css` and every `.ts` under `src/ui/` for hex colours of 3, 4, 6 or 8 digits, `rgb(`, `rgba(`, `hsl(`, `hsla(` and time values in `ms` or `s` outside comments; fail with file name and line number of each match
    - _Requirements: 1.9, 19.7_

- [x] 14. UI_Strings_Module
  - [x] 14.1 Create `src/ui/strings.ts`
    - Every Game_Screen string in English: Turn_Bar, map, legend, District_Panel labels, Policy_Panel labels and messages (9.2 to 9.4, 9.7, 9.8, 9.11, 8.6, 8.8, 8.9, 8.11, Open Question 11 budget note), construction labels, Timeline_View texts, dialogs, the Disclosure_Text, "About this range" text, Range_Source_View texts, start menu, storage and import messages, the Demo_Save description sentence, Engine_Error messages built from `code` and `details`, the policy effect texts of 8.12 with equal numbers of benefit and cost statements per Active_Tool, and a display name for every id of `SCENARIO_EFFECT_IDS`
    - Components in tasks 15 to 17 read strings from this module and do not add strings; a missing string is added here in a separate change
    - Apply the `neutrality.md` review check and record in `KIRO-LOG.md` the date, the string keys reviewed and the result (15.7)
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7, 5.4, 8.12, 20.4, 20.6, 20.7_

  - [x] 14.2 Write the string tests `tests/ui/strings.test.ts`
    - Banned-term test: every string with its key checked by `checkBannedTerms` of `scripts/pipeline/banned-terms.ts` with `banned-terms.txt` and `banned-terms-exempt.txt`; fail with key and term (15.4)
    - No string contains "Strong response", "Weak response" or "Central" (19.13)
    - Equal numbers of benefit and cost statements per Active_Tool (8.12); a display name for every id of `SCENARIO_EFFECT_IDS`
    - _Requirements: 15.4, 19.7, 19.13, 8.12_

- [x] 15. Pure UI functions (tested in Node)
  - [x] 15.1 Implement `src/ui/format/number.ts`, `range.ts` and `difference.ts`
    - `formatNumber` with `Intl.NumberFormat('en-US')`, fixed decimals, U+2212 minus, never "−0"
    - `formatRange` returning `range` ("<central> <unit> (possible range <min>–<max> <unit>)") or `same` ("<value> <unit>, same in all scenarios") when the three formatted strings are equal
    - `formatDifference` with "+" or "−" and unit, "0 <unit>" for a zero formatted difference; percent rows in percentage points
    - _Requirements: 5.2, 5.7, 5.8, 6.4, 6.10_

  - [x] 15.2 Write formatter unit tests `tests/ui/format.test.ts`
    - Three different values, three values equal after formatting, values that differ only before formatting; difference signs and zero
    - _Requirements: 19.13, 5.2, 5.7, 5.8, 6.4_

  - [ ]* 15.3 Write Property 19 in `tests/ui/format-range.property.test.ts`
    - Include the check that `RangeSourceView.same` from `buildGameView` equals the formatter's decision for the same range and decimals
    - **Property 19: Range_Display formatting**
    - **Validates: Requirements 5.2, 5.7, 5.8, 6.10, 20.4**

  - [ ]* 15.4 Write Property 20 in `tests/ui/format-difference.property.test.ts`
    - **Property 20: Difference formatting**
    - **Validates: Requirements 6.4**

  - [x] 15.5 Implement `districtAccessibleName` in `src/ui/a11y/accessible-name.ts`
    - The three forms of 4.2 and the ", estimated" suffix of 4.3; strings from `strings.ts`, numbers from `format/`
    - `lowUseHousingRate`: "<name>, <city>: low-use housing rate no data" for a `null` value (never 0) and the `dataPeriod` in the name of a non-null value
    - _Requirements: 3.11, 3.15, 4.2, 4.3_

  - [x] 15.6 Write accessible-name unit tests `tests/ui/accessible-name.test.ts`
    - An estimated value, a "same in all scenarios" value and "no value"
    - _Requirements: 19.8, 4.2, 4.3_

  - [ ]* 15.7 Write Property 21 in `tests/ui/accessible-name.property.test.ts`
    - **Property 21: Accessible names**
    - **Validates: Requirements 4.2, 4.3, 3.11**

  - [x] 15.8 Implement `src/ui/map/indicator-classes.ts`
    - `INDICATOR_CLASSES` with the bounds approved in task 12 (3 to 6 ascending inner bounds per Map_Indicator, unit, legend decimals) and `classIndexOf(value, bounds)` (number of bounds ≤ value)
    - Entry for `lowUseHousingRate` (percent of dwellings, 2 decimals); a `null` value gets no class and uses the "no value" pattern
    - _Requirements: 3.8, 3.9, 3.10_

  - [x] 15.9 Write Indicator_Class unit tests `tests/ui/indicator-classes.test.ts`
    - A value exactly on each bound belongs to the class above; values below the first and above the last bound
    - _Requirements: 19.8, 3.9_

  - [ ]* 15.10 Write Property 18 in `tests/ui/indicator-classes.property.test.ts`
    - **Property 18: Indicator_Class contiguity**
    - **Validates: Requirements 3.8, 3.9**

- [x] 16. UI components (`src/ui/`)
  - [x] 16.1 Implement the component base and accessibility helpers
    - `Component<V>` and `ComponentFactory<V>` (create once, `update(view)` in place by key, design decision G12)
    - `src/ui/a11y/`: dialog manager (one `<dialog>` with `showModal()`, `aria-labelledby`, focus to the first focusable element, Tab wrap, Escape via `cancel`, focus return to the opener or the Next_Quarter_Action), live region with polite and assertive elements writing only on a new announcement id
    - _Requirements: 17.1, 17.7, 17.8, 17.12, 17.13, 17.14, 17.15_

  - [x] 16.2 Implement the Turn_Bar in `src/ui/turn-bar/`
    - Disclosure_Text as DOM text in the header; Planning_Quarter, Displayed_Quarter or "No quarter computed yet", turn number, "Simulation complete: 2015Q1 to 2025Q4"; "Next quarter" and "Fast-forward one year" buttons (Enter and Space), disabled with a text busy state; "Demo game" label; storage warning; version notice; save controls (export, import)
    - _Requirements: 7.3, 7.4, 7.7, 7.10, 7.12, 12.9, 13.8, 14.9, 15.1, 15.2, 16.4_

  - [x] 16.3 Implement the map controls in `src/ui/map/` (**changed 2026-11-18**)
    - **The SVG map is replaced by the City_View of the city-3d spec** (`.kiro/specs/city-3d/`), implemented by Claude Code in `src/ui/city/`: district shapes, outline states, labels, estimate markers, ghosts, resize handling and district keyboard focus (city-3d Requirements 3 to 6). Kiro does not build the SVG map and does not use `d3-geo` in `src/ui/`.
    - **Still done here, as DOM outside the canvas:** the indicator switch (5 radio inputs including Low_Use_Housing_Rate; "No data" text for a `null` value; `dataPeriod` label of a value), the legend with bounds, unit and the "no value" swatch, the indicator text with the quarter or "Real data, 2015Q1", and the Price_To_Income label of 3.7. Build them as one self-contained block that a parent can place anywhere (city-3d Requirement 9).
    - `districtAccessibleName` (task 15) stays: the City_View uses it for its live-region announcement (city-3d Requirement 5.4).
    - _Requirements: 3.3, 3.4, 3.7, 3.10, 3.11, 3.12, 3.18_

  - [x] 16.4 Implement the District_List and District_Panel in `src/ui/panels/`
    - District_List grouped by city, alphabetical within city, selectable by pointer, Enter and Space
    - District_Panel: prompt "Select a district on the map or in the list.", "Real data, 2015Q1" mode, 9 rows with Range_Display, "Real" or "Derived baseline" comparison, difference, "no value", estimate methods, source names or "source not listed", Ghost count with "1 ghost = <Ghost_Size> residents", "Why?" and "About this range" controls (disclosure with `aria-expanded`, Escape hides and refocuses)
    - _Requirements: 4.6, 4.7, 5.2, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 3.7, 3.13_

  - [x] 16.5 Implement the Policy_Panel and construction rows in `src/ui/panels/`
    - "Housing" and "Transit" headings; Coming_Soon_Tool rows with "Coming soon" and real values; Active_Tool fields with real value, player value, unit cost, Lag, limits, Parameter citations or "No source recorded", remaining Budget_Ceiling, input field with unit, Apply_Control, Set_To_Real_Control, live budget figures, rejection messages, effect texts
    - "Select a district to edit this field.", "No commuter pass product existed in this quarter", "No real value recorded"
    - Construction rows with "<n> of <Lag> quarters", progress bar, "more/fewer units than real", "completes after 2025Q4", empty text of 10.8
    - Inputs are never rewritten while focused; handle `focusRequest` from timeline selection
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 9.1, 9.2, 9.3, 9.4, 9.7, 9.8, 9.9, 9.11, 10.1, 10.4, 10.5, 10.6, 10.7, 10.8, 11.6, 16.9_

  - [x] 16.6 Implement the Timeline_View in `src/ui/timeline/`
    - Quarter headings, Event_Cards with date, title, description and source links from their fields, Wikipedia CC BY-SA attribution, Completion_Items, Timeline_Entries with display names and before and after values ("real track (<value>)"), "Major event" label and icon, selectable entries, empty text "No events or policy changes yet."
    - External links with `target="_blank" rel="noopener noreferrer"`
    - _Requirements: 7.9, 11.1, 11.2, 11.3, 11.5, 11.6, 11.10, 15.8, 15.9, 18.13_

  - [x] 16.7 Implement the Range_Source_View in `src/ui/explain/`
    - Pure `rangeSourceText(view)` in `src/ui/explain/range-source-text.ts` building the Range_Display, "Lowest result" and "Highest result" sections with Parameter display names, values, units, citations and URLs or "No source recorded", the same-value text of 20.4, the text of 5.4, and the disabled "Cause breakdown (coming soon)" section exposed as disabled
    - The dialog component renders it through the dialog manager
    - _Requirements: 20.1, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 5.3_

  - [x] 16.8 Implement the dialogs in `src/ui/dialogs/`
    - Confirmation, import (paste field, error next to the field), export save code and export stored text (read-only field, "Copy" via `navigator.clipboard.writeText`, on rejection select the text and call `reportCopyFailed`), Event_Card dialog for Major_Event stops, demo description with "These adjustments are examples, not recommendations."
    - _Requirements: 7.6, 12.7, 12.8, 12.10, 13.1, 13.6, 13.12, 13.13, 14.10, 14.11, 17.12, 17.14_

  - [x] 16.9 Write Range_Source_View text tests `tests/ui/range-source-text.test.ts`
    - A value with a range lists both sections with equal detail and no Scenario name; a value with equal Result_Range values gives "This value is the same under every parameter assumption in the model."; missing citation or URL gives "No source recorded"
    - _Requirements: 19.14, 20.3, 20.4, 20.5, 20.8_

  - [x] 16.10 Write the component styles in `src/styles/`
    - One CSS file per region using only custom properties from `tokens.css`; four outline states, focus indicator, target sizes of 16.6, no horizontal page scroll, layouts per viewport as approved, sticky Turn_Bar, transitions with `--motion-*` tokens only, nothing that flashes
    - _Requirements: 1.8, 4.8, 16.1, 16.2, 16.3, 16.4, 16.6, 16.8, 17.2, 17.3, 17.4, 17.9, 17.11_

- [ ] 17. Wiring
  - [x] 17.1 Implement the root `src/ui/app.ts`
    - Mounts the components once; renders `ScreenView` kinds: loading with "<n> of 6 files loaded", load error with one line per failing file and a "Retry" control (pointer and keyboard), start menu ("Continue", "New game", "Load demo" or the 12.5 subset, stored problem with "Export stored text"), Game_Screen regions in reading order
    - No map or panel values and disabled turn controls while a load error shows
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 12.4, 12.5, 12.7, 16.2, 16.3, 17.2_

  - [x] 17.2 Implement `src/main.ts` and `index.html` (**done by Claude Code 2026-11-23**, because main.ts is also where the 3D City_View and the Citizen_Encounters are mounted; `src/save/demo-save.generated.ts` is the placeholder of this task, and the start menu shows "The demo save has not been generated yet." until task 19.2; the controller gained `storySession()` for the story layer)
    - `main.ts` is the only file reading `import.meta.env`; mounts the App, calls `loadDataFiles(fetch, import.meta.env.BASE_URL, …)`, creates the `SaveStore` (with a `localStorage` adapter or `null` when access throws) only after `ok: true`, builds the `GameController` with `setTimeout(fn, 0)` as scheduler and `readDemo` on the imported `src/save/demo-save.generated.ts`, subscribes the App, and Retry calls the loader again
    - Until task 19.2 runs, commit `src/save/demo-save.generated.ts` as a placeholder exporting empty `DEMO_SAVE_CODE` and `DEMO_SUMMARY_TEXT` with a header stating it is a placeholder; `readDemo` then returns "The demo save has not been generated yet." (**deviation from design decision G10 while Open Question 15 is open; confirm with the user**)
    - `index.html` with the root element, `lang="en"`, viewport meta and the entry script
    - _Requirements: 2.1, 2.6, 2.9, 12.9, 14.12, 18.8, 18.12_

- [x] 18. Checkpoint - Phase C complete
  - Run `npx vitest --run`, `npm run typecheck` and `npm run build`; all exit 0 with no skipped, todo or `.only` test. Ensure all tests pass, ask the user if questions arise. Ask the user to run `npm run dev` to look at the screen; the agent does not start it.

- [x] 19. Real-data integration and the committed Demo_Save (Phase D). **Blocked until the real `params.json`, `commute-matrix.json` and `events.json` exist in `public/data/` and `history.json` has `medianTotalPrice` (data-pipeline tasks 16 to 21).**
  - [x] 19.1 Set the Demo_Base_List, the Demo_Enlarged_List and both thresholds
    - **TODO (Open Question 15):** write the values into `data/config/demo-adjustments.json` from a recompute with the real `params.json`, changing no Parameter (14.18); the lists satisfy 14.13 to 14.17 and 14.24; set the Demo_Ghost_Threshold (default 1) and the Demo_Rent_Burden_Threshold (default 0.1 percentage points); remove the TODO status
    - Present the lists and thresholds to the user before committing
    - _Requirements: 14.13, 14.14, 14.15, 14.16, 14.17, 14.18, 14.20, 14.21, 14.22, 14.24_

  - [x] 19.2 Generate and commit the Demo_Save
    - Run `npm run demo`; on success commit the generated `src/save/demo-save.generated.ts` (replacing the placeholder of 17.2) and the stdout report summary; on failure report the named step and conditions to the user and stop
    - _Requirements: 14.1, 14.2, 14.5, 14.6, 14.23, 14.25_

  - [x] 19.3 Write the Demo_Save output and recompute tests `tests/scripts/demo/demo-save.real.test.ts`
    - `runDemo` on the real files gives file text equal, character for character, to the committed `src/save/demo-save.generated.ts` (14.7); recomputing the Demo_Save to 2020Q4 and the Demo_Lookahead_State in all three Scenarios returns no Engine_Error (14.8); the Demo_Save passes Requirement 13.5 validation (14.2)
    - _Requirements: 14.7, 14.8, 14.2, 19.7_

  - [x] 19.4 Write the Demo_Save condition tests `tests/scripts/demo/demo-conditions.real.test.ts`
    - The Fallback_Step condition of the committed summary holds; 14.17, 14.26 and 14.27 hold; the Parameter_Table used equals the committed `params.json` `parameters` deep-equal and the merged table adds only `commuterPass.price.*` entries (14.28); checks 14.13, 14.14, 14.15, 14.16 and 14.24 on the committed Demo_Save and lists (14.29); 14.1, 14.3 and 14.4
    - _Requirements: 14.28, 14.29, 14.1, 14.3, 14.4, 19.7_

  - [x] 19.5 Write real-file Data_Loader and view tests `tests/game/real-data.test.ts`
    - `loadDataFiles` over the 6 real files (read through a file-backed `FetchPort`) returns `ok: true`
    - Price_To_Income on the real `history.json` (**needs `medianTotalPrice` from data-pipeline tasks 16 to 21**): a hand-computed value for one district and quarter, and the estimate flag
    - View values equal `runRange` for one district per city and two quarters on real data (18.5)
    - _Requirements: 2.3, 2.4, 3.5, 3.14, 18.5_

- [~] 20. Checkpoint - Phase D complete
  - Run `npx vitest --run` and `npm run typecheck`; both exit 0 with no skipped, todo or `.only` test. Ensure all tests pass, ask the user if questions arise.

- [ ] 21. Manual checks
  - [~] 21.1 Manual cross-browser, keyboard and screen-reader checks
    - Ask the user to run `npm run build` and `npm run preview` (the agent does not start the preview server)
    - Check Requirements 3.1, 3.2, 16 and 17 by hand at 360, 768, 1280 and 1920 CSS pixels in current Chrome, Firefox and Safari, with keyboard only and with a screen reader; include 16.8 (200 percent zoom at 1280) and the timing of 7.13 on the production build
    - Record in `KIRO-LOG.md` for each check the date, viewport width, browser and version, screen reader and version, criterion, pass or fail, and a description of each failure
    - If a Fast_Forward_Action exceeds 4,000 ms, report it; the module Web Worker fallback of the design is not part of this plan
    - _Requirements: 19.11, 3.1, 3.2, 7.13, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.8, 16.9, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.9, 17.10, 17.11, 17.12, 17.13, 17.15_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Test tasks that a numbered requirement makes mandatory (Requirements 1.9, 14.7, 14.8, 14.28, 14.29, 15.4, 18.2, 18.5 and 19.1 to 19.14) are not marked optional; this includes Properties 2 and 4 (Requirements 19.3 and 19.4). The other properties are optional.
- Each property test runs at least 100 cases and carries the tag `// Feature: game-ui, Property <n>: <title>`. Property tests are split into one file per property so tasks in the same wave never write the same file; this replaces the grouped file table of the design's Testing Strategy.
- Requirement 19.12 forbids skipped tests, so the real-file tests of task 19 are added only when their inputs exist, not earlier with `.skip`.
- `src/data/validate.ts` is changed by task 3.2 and by event-library task 1.3; whichever runs second merges the `ValidationError.file` union.
- Open items to confirm with the user: the 500-entry Timeline cap (G8, tasks 2.1, 6.4), the limit "reason" display (task 6.4), the placeholder demo module until task 19.2 (task 17.2), and the final Indicator_Class bounds (tasks 12.1, 15.8).
- Checkpoints run `npx vitest --run` and `npm run typecheck`. The agent never runs `npm run dev`, `npm run preview` or a watch mode.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "3.2", "3.3", "4.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.4", "3.5", "4.2", "6.2", "6.3"] },
    { "id": 2, "tasks": ["3.6", "3.7", "4.3", "4.9", "6.4"] },
    { "id": 3, "tasks": ["3.8", "4.4", "4.5", "4.6", "4.7", "4.8", "4.10", "6.5", "6.6", "7.1"] },
    { "id": 4, "tasks": ["7.2", "8.1", "8.4", "8.7"] },
    { "id": 5, "tasks": ["7.3", "7.7", "8.2", "8.3", "8.5", "8.6", "8.8", "8.9", "8.10", "8.11"] },
    { "id": 6, "tasks": ["6.7", "6.8", "7.4", "7.5", "7.6", "8.12"] },
    { "id": 7, "tasks": ["8.13", "8.14", "8.15", "8.16", "8.17", "8.18", "9.1", "9.2"] },
    { "id": 8, "tasks": ["9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "10.1", "10.2"] },
    { "id": 9, "tasks": ["10.3"] },
    { "id": 10, "tasks": ["10.4", "10.5", "10.6"] },
    { "id": 11, "tasks": ["10.7"] },
    { "id": 12, "tasks": ["12.1"] },
    { "id": 13, "tasks": ["12.2"] },
    { "id": 14, "tasks": ["13.1", "14.1", "15.1", "15.8", "16.1"] },
    { "id": 15, "tasks": ["13.2", "14.2", "15.2", "15.3", "15.4", "15.5", "15.9", "15.10", "16.2", "16.5", "16.6", "16.7"] },
    { "id": 16, "tasks": ["15.6", "15.7", "16.3", "16.4", "16.8", "16.9"] },
    { "id": 17, "tasks": ["16.10", "17.1"] },
    { "id": 18, "tasks": ["17.2"] },
    { "id": 19, "tasks": ["19.1"] },
    { "id": 20, "tasks": ["19.2"] },
    { "id": 21, "tasks": ["19.3", "19.4", "19.5"] },
    { "id": 22, "tasks": ["21.1"] }
  ]
}
```
