# Implementation Plan: Simulation Engine

## Overview

The engine is built bottom-up in TypeScript (erasable syntax only, `strict`, `noUncheckedIndexedAccess`) in `src/simulation/`. Order: shared types, constants, errors and helpers; parameters and the Derived_Baseline; test fixtures and generators; the three tool rules; the Lag_Pipeline and the budget (with `BudgetPlan` in the ledger); events, migration, ghosts and `explain.finish`; the seven indicator rules and the Rule_Registry; stage-0 validation; `engine.ts` (`step`, `run`, `runRange`); the invariant property tests; the example, extensibility and purity tests; and last the backtest script and report, which call `runRange`.

All code follows `design.md`. The Ghost rent-burden group is built per source (housed households, social housing spillover, rent subsidy recipients) from `ghostGroups` returned by the tool rules; the rent subsidy burden uses the renter households as denominator; social housing has a direct path through `socialHousing.rentRatio`. The helping-direction property (Property 29) and the hand-worked Ghost direction tests (Requirements 17.13, 17.14) are required tasks. The design has 29 properties.

Conflict decisions accepted by the user: C1 option A (the backtest passes `options.budgetMode = 'record'`, every other caller uses the default `'enforce'`), C2 literal per-quarter migration Cause (persons moved in minus persons moved out, no carry-over, start-of-quarter population is the Baseline population), C3 as described (Annual_Budget equality for fully computed years, `committed ≤ Annual_Budget` for the last partly computed year).

Signatures to implement exactly as in the design:

- `step(state, policies, events, params, baseline, realTrack, commute, options?)`
- `run(policies, events, params, baseline, realTrack, commute, target, options?)`
- `runRange(...same as run...)`
- `checkBudget(proposed, ledger, params)` and `checkLimit(tool, field, area, quarter, ledger, params)`, where the ledger carries the `BudgetPlan` (real settings, real charges, Annual_Budgets, ceilings)

Every property test uses fast-check 4.10.2 with `fc.assert(fc.property(...), { numRuns: 100 })` (at least 100), carries the comment `// Feature: simulation-engine, Property <n>: <title>`, and names the requirements it validates. Tests run once with `npx vitest --run`, never in watch mode. Engine tests use in-memory fixtures and read no file outside `src/` and `tests/` (Requirement 17.6).

## Tasks

- [x] 1. Set up foundations: types, constants, errors and helpers
  - [x] 1.1 Confirm the existing setup
    - Already present, no change needed: `tsconfig.json` `include` contains `"src"` (and `scripts`, `tests`) with `erasableSyntaxOnly`, `noUncheckedIndexedAccess` and `strict`; `package.json` pins `fast-check` `4.10.2`, `vitest` `5.1.0` and has `typecheck` and `test` scripts
    - Not present yet: the `backtest` script, added in task 15.5
    - _Requirements: 17.1, 17.11_

  - [x] 1.2 Create the engine types in `src/types/simulation.ts`
    - Inputs: `Citation`, `ParameterRange`, `ScalarParameter`, `ScheduleParameter`, `ParameterTable`, `EngineBaseline`, `ToolSetting`, `PolicySetting`, `PolicyTimeline`, `CommuteMatrix`, `SimEvent`, `EngineOptions` (`registry?`, `seed?`, `budgetMode?: 'enforce' | 'record'`), `ToolId`, `IndicatorId`, `AreaKey`
    - Outputs: `ValueKind`, `Cause` (with `parameters: readonly CauseParameter[]`, each holding `parameterId`, `status`, `estimated?` and `range?`; there is no separate `ranges` field), `CauseParameter`, `CauseBreakdown`, `LagEntry`, `BudgetPlan`, `BudgetLedger`, `SimState`, `ResultRange`, `QuarterRanges`
    - Parameter metadata: `ParameterStatus` (`'verified' | 'check' | 'secondary' | 'gap'`), `Estimated` (`method`), and on `ScalarParameter` and `ScheduleParameter` the fields `status`, `estimated?` and `assumption?`; `ParameterRole` includes `'reference'`
    - Results and errors: `EngineErrorCode` (all 20 codes of the design catalogue), `EngineError` (with `details` and sorted `issues`), the `ParameterProblem` union (`missing`, `non-finite`, `unit-empty`, `source-empty`, `range-invalid`, `value-outside-range`, `out-of-bounds`, `schedule-invalid`, `limit-invalid`, `group-invalid`, `status-missing`, `status-unknown`, `estimated-missing`, `estimated-method-empty`, `assumption-missing`, `lag-derivation-missing`, `range-not-allowed`), `StepResult`, `RunResult`, `RangeResult`, `BudgetCheck`, `LimitInfo`
    - Rule interfaces, so rule files and `registry.ts` import them without a cycle: `ParameterSpec`, `ParameterRole`, `ParameterCheck`, `ToolRule`, `ToolEffects`, `IndicatorRule`, `CauseDraft`, `Contribution`, `QuarterWork`, `RuleRegistry`
    - Ghost groups: `GhostGroupContribution` (`source: 'housed' | 'spillover' | 'subsidy'`, `persons`, `burdenChangePp`, `personPp`, `links`), `ToolEffects.ghostGroups?: Record<DistrictCode, readonly GhostGroupContribution[]>`; `ParameterCheck` gains `{ kind: 'unit-share' }`; `CauseDraft.groups` entries carry `groupId` (`ghost-rent-housed`, `ghost-rent-spillover`, `ghost-rent-subsidy`, `ghost-commute`, `ghost-overlap`, `ghost-displaced`) and `Cause.id` allows these ids
    - Every property `readonly` and every array a `readonly` array at every nesting level; union string types only (no `enum`); import `QuarterKey`, `DistrictCode`, `CityName` from `src/types/data-files.ts`
    - _Requirements: 1.1, 1.2, 1.9, 2.5, 4.16, 6.14, 10.6, 13.1, 14.10, 14.11, 16.1, 19.1_

  - [x] 1.3 Implement `src/simulation/constants.ts` and `src/simulation/errors.ts`
    - Constants: `FIRST_QUARTER` (2015Q1), `LAST_QUARTER` (2025Q4), `QUARTER_COUNT` 44, `DISTRICT_COUNT` 41, `MAX_LAG` 43 (the only Lag bound, also for social housing; no 12 to 20 constant), `SHARE_SUM_TOLERANCE` 1e-9, `CAUSE_TOLERANCE` factor 1e-9, `ENGINE_VERSION`, city order (Taipei, then New Taipei)
    - `errors.ts`: one constructor per `EngineErrorCode` building an `EngineError` with an English message that names every offending value and the `details` fields from the design's error catalogue; `parametersInvalid(issues)` sorts issues by parameter id, then problem (`ParameterProblem` codes, including the metadata codes); `ok` and `err` helpers; nothing in this module throws
    - `householdsExceedRenters` takes a `where` detail (`'rent-subsidy'` with a city, or `'social-housing'` with a District_Code) plus quarter, households and renters; no new error code
    - _Requirements: 1.3, 1.4, 1.5, 4.17, 6.9, 14.6, 15.3_

  - [x] 1.4 Implement `src/simulation/quarter.ts` and `src/simulation/numeric.ts`
    - `parseQuarter` (`/^(\d{4})Q([1-4])$/`), `quarterIndex` (2015Q1 is 0, works for any integer), `quarterAt`, `nextQuarter` (2015Q4 to 2016Q1), `quarterYear`
    - `roundHalfUp` (`Math.round`, then `-0` becomes `0`), `clamp` (returns `x` itself when inside the range), `apportion` (largest remainder, ties to the lower index), `splitBySchedule` (whole-TWD charges, last charge is `total` minus the others)
    - _Requirements: 1.1, 1.3, 4.8, 8.2, 9.3, 12.4_

  - [ ]* 1.5 Write unit tests for quarter and numeric helpers
    - `tests/simulation/quarter.test.ts`, `tests/simulation/numeric.test.ts`: malformed keys, year rollover, `roundHalfUp(2.5) === 3`, `roundHalfUp(-2.5) === -2`, `roundHalfUp(-0.4)` is `0` not `-0`, `clamp` returns the same number inside the range, `apportion` sums and tie order, `splitBySchedule` sums exactly and keeps negative totals negative
    - _Requirements: 1.3, 4.8, 8.2, 12.4_

  - [x] 1.6 Write the readonly type test `tests/simulation/readonly.typecheck.ts`
    - `// @ts-expect-error` for an assignment to a field and a `push` to an array of every input type at each nesting level (`ParameterTable`, `EngineBaseline`, `PolicyTimeline`, `CommuteMatrix`, `SimEvent`, `SimState`); `npm run typecheck` fails if one of them compiles
    - _Requirements: 1.9_

- [x] 2. Implement parameters and the Derived_Baseline
  - [x] 2.1 Implement `src/simulation/params.ts`
    - `scalar(params, id)` and `schedule(params, id)` accessors used only after validation; id expansion for `<city>`, `<code>`, `<quarter>`, `<year>`
    - `ParameterSpec` checks (`finite`, `non-negative`, `positive`, `share`, `unit-share` (finite, greater than 0, at most 1, a `range` inside 0 to 1, failure code `out-of-bounds`), `integer` with min and max, `schedule`) as pure functions returning issue lists; also blank `unit` or `source`, `range` with `low > high`, `value` outside the range, blank range sources, an unknown `optional` flag handled as "absent is fine"; role `reference` (read by no rule)
    - Metadata checks (design "Parameter metadata checks"): `status-missing`, `status-unknown`, `estimated-missing` (status `secondary` or `gap` without `estimated`), `estimated-method-empty`, `assumption-missing` (status `gap` with a value and no `assumption`; an absent optional `gap` parameter is accepted), `lag-derivation-missing` (`socialHousing.lag` note must contain `NLMA`), `range-not-allowed` (`ghost.rentThreshold` with a `range`); `ghost.atRiskThreshold` is optional and never validated or read. No 12 to 20 check on the social housing Lag
    - `checkSpecs(params, specs)` collecting every issue; `scenarioTable(params, 'central' | 'low' | 'high')` returns a new table in which only `effect`-role parameters with a `range` take `low` or `high` (six: `socialHousing.rentPerUnit`, `socialHousing.rentRatio`, `commuterPass.elasticity`, `rentSubsidy.passThrough`, `ghost.commuteThreshold`, `ghost.shareCommuteWithin`) and every other role keeps `value`, including the ranged `socialHousing.unitCost` and the unranged `ghost.sensitivityRent`; the input table is never changed
    - `socialHousing.rentRatio` is a required `unit-share` effect parameter (`low` 0.5 is the strongest effect); `ghost.sensitivityRent` is a required effect parameter (share 0 to 1, no `range`, status `gap` so it needs `estimated` and an `assumption`)
    - _Requirements: 4.14, 7.1, 10.2, 14.1, 14.3, 14.4, 14.5, 14.6, 14.7, 14.10, 14.11, 14.12, 19.2_

  - [x] 2.2 Implement `src/simulation/derived.ts`
    - Household count `P / housing.householdSize.<city>`, renter households `H × housing.renterRate.<city>`, renter share per district (sums to 1 per city), `k_d = S ÷ (I_d ÷ 12) × 100`, Derived_Baseline rent burden `clamp(rent × S ÷ (I ÷ 12) × 100, 0, 100)`, mean commute time `Σ_j commute.jobShare.<j> × matrix[d][j]`
    - Also provide, per district and quarter, the renter households `Hr_d = H_d × renterRate`, the renter persons `Hr_d × householdSize_city`, the monthly income `m_d = I_d ÷ 12` and `k_d`, so the two housing tool rules and the Ghost rule share one definition of each; the rent-group base `R0 = P0 × ghost.shareRent` is computed in `ghosts.ts`
    - Return `derived-input-invalid` for a missing or non-positive divisor
    - Derived functions that depend on ranged effect parameters (the Derived_Baseline Ghost count, via `ghosts.ts`) take the Scenario's own parameter table, so they can differ between Scenarios (Requirement 19.8); rent burden and mean commute time use no effect parameter
    - _Requirements: 2.1, 2.5, 2.6, 6.3, 6.11, 19.8_

  - [ ]* 2.3 Write unit tests for `params.ts` and `derived.ts`
    - `tests/simulation/params.test.ts`, `tests/simulation/derived.test.ts`: each check kind accepts the boundary values and rejects the outside values, `scenarioTable` leaves lag and cost parameters at `value`, hand-computed rent burden, burden clamped at 100, renter shares sum to 1 per city, renter households, renter persons, `m_d` and `k_d` (P=100,000, household size 2.5, renter rate 0.4 give `Hr` 16,000; income 720,000 and S=30 give `m` 60,000 and `k` 0.05), mean commute time from job shares, zero income gives `derived-input-invalid`; `unit-share` accepts 1 and 0.5, rejects 0, values above 1, non-finite values and a `range` outside 0 to 1; `socialHousing.rentRatio` range 0.5/0.8/0.9 accepted; `scenarioTable` moves exactly the six ranged effect parameters and keeps `ghost.sensitivityRent` at `value`; each metadata problem code (`status-missing`, `status-unknown`, `estimated-missing`, `estimated-method-empty`, `assumption-missing`, `lag-derivation-missing`, `range-not-allowed`); an absent optional `gap` parameter is accepted; `scenarioTable` keeps `socialHousing.unitCost` and `ghost.rentThreshold` at `value` and moves `ghost.commuteThreshold` to 45 and 60
    - _Requirements: 2.5, 4.14, 6.3, 6.4, 6.11, 14.3, 14.4, 14.5, 14.10, 14.11, 14.12, 19.2_

- [x] 3. Build test fixtures and generators
  - [x] 3.1 Create typed fixtures in `tests/simulation/fixtures/`
    - The 41 District_Codes with cities; a synthetic Baseline builder (1 to 44 quarters from 2015Q1) with `population`, `householdIncome`, `rent`, `mrtEntries`, `socialHousingStock` and a Source_Id registry; a complete valid Parameter_Table covering every required id of the design's parameter table (including the expanded `<city>`, `<code>`, `<quarter>` and `<year>` ids, the 0 and 2 limit factors, and `budget.ceiling` rows); every parameter carries a `status`, with `estimated` and a method note for `secondary` and `gap`, and an `assumption` for a `gap` value; `socialHousing.lag` carries an `estimated` note naming the NLMA derivation; `socialHousing.rentRatio` (0.5/0.8/0.9, status `secondary`, `estimated`, `assumption` that the Taipei and New Taipei social housing rent rules are still to be checked), ghost parameters (`ghost.rentThreshold` 50 without range, optional `ghost.atRiskThreshold` 30, `ghost.commuteThreshold` 45/60/60, `ghost.shareCommuteWithin` ranged, `ghost.shareRent`, `ghost.shareBoth` within the validation bound, `ghost.sensitivityRent` (status `gap`, `estimated`, `assumption`, no range), `ghost.sensitivityCommute`, `ghost.size`), the national rent subsidy `reference` parameters, `commuterPass.elasticity` −0.5/−0.3/−0.2 and `socialHousing.unitCost` with a `range`; a real-track builder; a valid 41×41 Commute_Matrix with zero diagonal
    - Events: a real-style event list (known ids and quarters, no modifier, and no modifier parameter in the table) and a synthetic-only builder that adds `test.modifier.<n>` parameters and Events with modifiers; real data never carries a modifier (Requirement 11.9)
    - No file I/O; all values in memory
    - _Requirements: 11.9, 14.10, 14.11, 14.12, 17.3, 17.6_

  - [x] 3.2 Implement fast-check generators in `tests/simulation/arbitraries.ts`
    - `arbBaseline` (population 0 to 500,000, income 300,000 to 3,000,000, rent 100 to 2,000, MRT entries 0 to 20,000,000 with some 0, stock 0 to 20,000, 1 to 8 quarters), `arbParams` (a ranged parameter is drawn in `[low, high]`, others use `value`; Lags 0 to 43 for every tool including the social housing Lag (below, inside and above 12 to 20, with the NLMA note); every parameter gets a `status` from the four values, `secondary` and `gap` get `estimated`, `gap` values get `assumption`; ranged ghost parameters `ghost.commuteThreshold` (45 to 60) and `ghost.shareCommuteWithin`, `ghost.shareBoth ≤ min(shareRent, 1 − shareCommuteWithin.high)`; `ghost.sensitivityRent` is 0 in some cases and above 0 in others; `socialHousing.rentRatio` is drawn from its `range` inside (0, 1]; Cost_Schedules with 1 to 8 offsets), `arbCommuteMatrix`, `arbRealTrack` (pass price 0 and positive), `arbPlayerTimeline` (all-zero, equal-to-real, largest accepted, in-limit and "reallocation" modes, plus a "helping-direction" mode that moves exactly one tool field of one district or city and quarter in the direction that helps renters and keeps every other value equal to the Real_Policy_Track), `arbEvents` with two modes: real-style (0 to 10 Events, no modifier, no modifier parameter) and synthetic (0 to 10 Events with 0 to 3 modifiers each, whose `test.modifier.<n>` parameters are added to the generated table inside their ranges); the modes are never mixed, `arbDefect` (one injected defect from Property 19, 20 or 26, including status, estimate, assumption and missing NLMA note defects)
    - _Requirements: 11.9, 14.10, 14.12, 17.3, 17.4, 17.5_

  - [x] 3.3 Write property test for scenario tables
    - `tests/simulation/properties/scenario-table.property.test.ts`
    - **Property 23: Scenario tables vary only ranged effect parameters**
    - Exactly six parameters vary: `socialHousing.rentPerUnit`, `socialHousing.rentRatio`, `commuterPass.elasticity`, `rentSubsidy.passThrough`, `ghost.commuteThreshold`, `ghost.shareCommuteWithin`; the ranged `socialHousing.unitCost`, the unranged `ghost.sensitivityRent` and the fixed `ghost.rentThreshold` and `ghost.atRiskThreshold` stay at `value`
    - **Validates: Requirements 7.1, 19.2, 19.5, 4.12**

- [x] 4. Implement the three tool rules
  - [x] 4.1 Implement `src/simulation/rules/social-housing.ts`
    - District level, stock effect, field `unitsStarted` (integer, limit scope city-year); `parameters()` (including the `unit-share` spec for `socialHousing.rentRatio`), `checkSetting`, `difference` (exactly 0 when equal), `charge` (real and difference, rounded once to whole TWD, before the schedule), `effects`; modifiable indicators `rent` and `rentBurden`
    - Direct path: the matured stock difference `X_d` houses `X_d` renter households (negative `X_d` returns them to the market); with `ρ = socialHousing.rentRatio` and `M_d = R_d + rentPerUnit × X_d`, a Housed_Household pays `ρ × M_d` and its burden is `ρ × M_d × k_d` percent
    - Effects: `socialHousingStock` `+X_d`; `rent` spillover only `rentPerUnit × X_d` (exactly 0 in the central Scenario); `rentBurden` one tool Cause with a direct term `X_d × (ρ × M_d − R_d) × k_d ÷ Hr_d` and a spillover term `(rentPerUnit × X_d) × k_d`; links to `socialHousing.rentRatio`, `socialHousing.rentPerUnit`, `socialHousing.lag`, `housing.dwellingSize` and the household income Source_Id
    - `ghostGroups` per district, two entries: `housed` (`persons = X_d × householdSize_city`, `burdenChangePp = (ρ × M_d − R_d) × k_d`) and `spillover` (`persons` = renter persons, `burdenChangePp = (rentPerUnit × X_d) × k_d`), each with `personPp = persons × burdenChangePp` (exactly 0 when `X_d` is 0); event modifiers scale `rent` and `rentBurden` deltas but not `ghostGroups`
    - A positive `X_d` above the district's renter households returns `households-exceed-renters` with `where: 'social-housing'`, the District_Code, quarter and both numbers (the check reuses the code of task 1.3)
    - The Causes of this tool also link `socialHousing.unitCost` (with its `range`, not varied between Scenarios) so status and range reach the "Why?" view; `rentPerUnit` is a ranged effect parameter (−2.5% / 0 / +6.5%)
    - Only the numeric literals allowed by Requirement 2.6
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.8, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15, 4.16, 4.17, 2.6_

  - [x] 4.2 Implement `src/simulation/rules/commuter-pass.ts`
    - City level, flow effect, field `subsidy` (upper limit is the pass price), track-only field `passesSold`; inactive when the real price is 0 (only subsidy 0 accepted, difference, Cause and charge 0); `real-net-price-zero` check; `ρ = −Δ ÷ N` from the difference only
    - Returns no `ghostGroups` (no channel to the Ghost count in this spec)
    - Effects: `mrtEntries` `Baseline MRT × elasticity × ρ` (0 when Baseline entries are 0 or absent), `commuteCostDelta` for each district of the city (origin scope); links to the lag, elasticity and price parameters; modifiable indicator `mrtEntries`; `commuterPass.elasticity` is a ranged effect parameter (`low` −0.5, `value` −0.3, `high` −0.2)
    - Charge in the setting quarter: adjusted passes `max(0, passesSold × (1 + elasticity × ρ))`; `real = roundHalfUp(real.subsidy × passesSold × 3 × unitCost)`, `difference = roundHalfUp(Δ × A × 3 × unitCost)`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9, 5.10, 18.2_

  - [x] 4.3 Implement `src/simulation/rules/rent-subsidy.ts`
    - City level, flow effect, fields `households` (integer) and `amount`; difference `player.h × player.a − real.h × real.a`; allocation by renter share; direct `rentBurden` delta `−a_d ÷ (Hr_d × m_d) × 100` (denominator is the renter households `Hr_d`, not all households); `rent` pass-through delta `passThrough × a_d ÷ (Hr_d × S)` (exactly 0 without `rentSubsidy.passThrough`) plus its follow-on `passThrough × a_d ÷ (Hr_d × m_d) × 100`, both terms in the same Cause, net `−(1 − passThrough) × a_d ÷ (Hr_d × m_d) × 100`; charges `× 3 × unitCost`; optional `rentSubsidy.costSchedule`; `rentSubsidy.passThrough` is an optional ranged effect parameter (0.16 / 0.50 / 0.78); the national rent subsidy figures are `reference` parameters that this rule never reads
    - `ghostGroups`, one `subsidy` entry per district in totals form: `personPp = −(1 − passThrough) × a_d ÷ m_d × 100 × householdSize_city`, `persons = householdSize_city × s_d × player.households`, `burdenChangePp = personPp ÷ persons` (0 when `persons` is 0); market renters outside the recipient group get no entry; exactly 0 at zero differences
    - `households-exceed-renters` (`where: 'rent-subsidy'`) and `derived-input-invalid` checks
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.14_

  - [x] 4.4 Write example tests for the tool rules
    - `tests/simulation/rules/social-housing.test.ts` (+100 units in 2015Q1, Lag 12, `rentPerUnit = -0.002`: stock +100 and rent −0.2 in 2018Q1, nothing in 2017Q4), `commuter-pass.test.ts` (price 1,280, real subsidy 0, player subsidy 80, elasticity −0.3, Baseline entries 1,000,000, Lag 0: `1,000,000 × −0.3 × (−80 ÷ 1,280) = 18,750`; inactive before the price exists; `real-net-price-zero`), `rent-subsidy.test.ts` (allocation, burden and pass-through on two districts; `households-exceed-renters`)
    - Social housing also checks the direct path with hand-computed numbers (market rent 600, S=30, income 720,000, `ρ` 0.8, `X=200`, `Hr=16,000`: housed burden 24 percent, per-household change −6 pp, district burden change −0.075 pp) and `households-exceed-renters` with `where: 'social-housing'`
    - Rent subsidy uses a renter rate of 0.4 (below 0.5) and `passThrough` 0.5 with `a = 4,800,000`: direct −0.5 pp, rent +5 TWD per m², follow-on +0.25 pp, net −0.25 pp (the burden falls)
    - Expected values written as hand-computed literals; counts exact, other values within 1e-9
    - _Requirements: 17.8, 4.6, 4.15, 4.17, 5.3, 5.4, 5.10, 6.4, 6.6, 6.9, 6.14_

  - [ ]* 4.5 Write property test for tool formulas
    - `tests/simulation/properties/tool-formulas.property.test.ts`, with reference formulas written independently in the test
    - **Property 14: Tool effects follow their formulas**
    - Reference formulas include the housed-household burden `ρ × M × S ÷ (I ÷ 12) × 100`, the social housing burden delta with direct and spillover terms, the corrected subsidy net burden `−(1 − passThrough) × a ÷ (Hr × I ÷ 12) × 100`, and `households-exceed-renters` for a social housing stock difference above the renter households
    - **Validates: Requirements 4.6, 4.13, 4.15, 4.17, 5.3, 5.9, 6.3, 6.4, 6.6, 6.7**

- [x] 5. Implement the Lag_Pipeline and the budget
  - [x] 5.1 Implement `src/simulation/lag.ts`
    - `commit(pipeline, entries)` (one entry per tool, area and committed quarter when `L ≥ 1`, including zero differences; none when `L = 0`), `mature(pipeline, t)` returning `{ matured, rest }`; stock tools add matured values to the carried stock difference, flow tools take the matured value as the active difference of `t`
    - Pipeline sorted by effect quarter, tool registry index, area code and committed quarter; entries never merged or changed; entries with an effect quarter after 2025Q4 stay
    - _Requirements: 2.2, 4.3, 4.4, 4.5, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 5.2 Write unit tests for `lag.ts`
    - `tests/simulation/lag.test.ts`: Lag 0 has no entry, zero differences are recorded for `L ≥ 1`, several commits keep separate entries, an effect quarter after 2025Q4 stays in the pipeline, the pipeline order does not depend on insertion order
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

  - [x] 5.3 Implement the plan, ledger and per-quarter charges in `src/simulation/budget.ts`
    - `planBudget(realTrack, params, tools)` builds the immutable `BudgetPlan` once: real settings, `realCharges` per tool and quarter after the Cost_Schedule (charges after 2025Q4 recorded in 2025Q4), `annualBudget` per year from every quarter present in the Real_Policy_Track (independent of the target, conflict C3), `ceilings` from `budget.ceiling.<tool>.<year>` or the Annual_Budget
    - The ledger carries the plan, `through`, `committed` (44 integer slots per tool, real plus difference charges), `year` and `remaining`; the per-quarter charge code is shared by `step` and `checkBudget`; checks run for every year an increment touched in ascending order, ceiling (`ceiling-exceeded`) before Annual_Budget (`budget-exceeded`), both skipped when `budgetMode` is `'record'` (conflict C1) while the ledger is still updated; Q1 `remaining` has no carry-over
    - All money values integer TWD; a negative difference gives negative charges
    - _Requirements: 4.8, 5.6, 6.8, 7.7, 8.1, 8.2, 8.6, 8.7, 8.9, 8.11, 18.5, 18.6_

  - [x] 5.4 Implement `checkBudget` and `checkLimit` in `src/simulation/budget.ts`
    - `checkBudget(proposed, ledger, params)`: no side effects; uses the code of task 5.3 and reads the real values from `ledger.plan`; returns `ok` with year, Annual_Budget, committed and remaining, or `annual-budget` / `tool-ceiling` rejection with the earliest year over, or `wrong-quarter`
    - `checkLimit(tool, field, area, quarter, ledger, params)`: returns `lower`, `upper`, their parameter ids and sources, `scope`, `ceiling` and `remainingCeiling`; formulas `lower = min ?? lowerFactor × v` and `upper = upperLimit(field) ?? max ?? max(upperFactor × v, upperMin ?? 0)`; commuter pass upper limit is the pass price (0 when the price is 0); social housing scope is the city-year total, upper limit on the running total, lower limit only for complete years (design Decision D6); a value outside a limit is never clipped
    - _Requirements: 8.3, 8.4, 8.5, 18.1, 18.2, 18.3, 18.4, 18.6, 18.7_

  - [ ]* 5.5 Write unit tests for `budget.ts`
    - `tests/simulation/budget.test.ts`: Q1 rollover without carry-over (8.7), a schedule charge after 2025Q4 recorded in 2025Q4, negative differences give negative charges, ceiling checked before Annual_Budget, `budgetMode: 'record'` skips both errors but updates the ledger, `checkBudget` equals the step's decision, `checkLimit` values for each tool field and the pass price limit, social housing lower limit only for complete years, the Annual_Budget does not change with the number of computed quarters
    - _Requirements: 4.8, 8.4, 8.5, 8.7, 18.1, 18.3, 18.7_

- [x] 6. Implement events, migration, ghosts and explanations
  - [x] 6.1 Implement `src/simulation/events.ts`
    - For each tool, modifiable indicator, district and quarter: apply the covering Events' modifiers in event-list order (`v_j = v_{j−1} × m`), Event Cause `v_j − v_{j−1}`, listed only above the tolerance of 13.3; never scale the social housing stock or the migration commute cost; never read affected indicators, magnitude or type
    - Real data has no Event modifier and `params.json` has no Event-modifier parameter (interest-rate events are narrative only), so with real data this stage changes nothing and adds no Event Cause; the modifier mechanism stays and is exercised only by synthetic test events (Requirement 11.9)
    - _Requirements: 11.1, 11.2, 11.4, 11.6, 11.7, 11.9_

  - [x] 6.2 Implement `src/simulation/migration.ts`
    - Out-movement `floor(share × P)` when `B − B0 > threshold` (P is the Baseline population, conflict C2), exits `floor(exitShare × out)`, weights `exp(x − max x)` with `x = −weightTime × M[o][j] − weightBurden × B_j − weightCost × cost_oj` and `cost_oj = max(0, commuteCostPerMinute × M[o][j] − K_o)`, `apportion` per origin over the other 40 districts, results summed in ascending code order from one start-of-quarter snapshot; returns `in`, `out`, `net` (moved in minus moved out), `displaced` and `exits`
    - _Requirements: 2.4, 5.5, 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8_

  - [x] 6.3 Implement `src/simulation/ghosts.ts`
    - One function for `sR`, `sC`, `sO`, `R`, `C`, `O` and the count `floor((R + C − O + D) ÷ G)` (0 for zero population), used for both the Derived_Baseline count (empty group list, `D = 0`) and the simulated count
    - Rent group per source: `R = clamp(R0 + σ × Σ_g personPp_g, 0, P)` with `σ = ghost.sensitivityRent` and the `ghostGroups` collected from the registry tools (never read by tool id); the district-average rent burden no longer drives `R`
    - Six group Causes in order: `ghost-rent-housed`, `ghost-rent-spillover`, `ghost-rent-subsidy` (each `σ × Σ personPp ÷ G` for its source, present even when 0), `ghost-commute`, `ghost-overlap`, `ghost-displaced`, with parameter links; the Bound_Adjustment covers the floor, the clamp of `R` and the zero-population rule
    - Base shares: `bR = ghost.shareRent`, `bC = 1 − ghost.shareCommuteWithin`, `bO = ghost.shareBoth`; every call takes the running Scenario's parameter table, so the Derived_Baseline Ghost count differs between Scenarios through `ghost.commuteThreshold` and `ghost.shareCommuteWithin`; `ghost.rentThreshold` (50, fixed) is read only as a cited definition and `ghost.atRiskThreshold` is never read
    - _Requirements: 4.16, 6.14, 10.1, 10.2, 10.3, 10.5, 10.6, 10.7, 10.8, 19.8, 3.3_

  - [x] 6.4 Implement `src/simulation/explain.ts`
    - `finish(draft)` sums contributions left to right in Cause order to `pre`, then bounds per `ValueKind` (bounded `clamp(0, 100)`, non-negative `max(0)`, count `max(roundHalfUp(pre), 0)`) and sets the Bound_Adjustment to `value − pre` (exactly 0 when `pre` is valid); Cause order Baseline, one Cause per registry tool (always present), Event Causes, migration, Bound_Adjustment; Ghost count order Baseline, six group Causes (`ghost-rent-housed`, `ghost-rent-spillover`, `ghost-rent-subsidy`, `ghost-commute`, `ghost-overlap`, `ghost-displaced`, each present even when 0), Bound_Adjustment
    - Sorted `parameterIds` and `sourceIds`; `parameters` holds one `CauseParameter` per parameter id used (sorted by id) with its `status`, its `estimated` marker and, where the table has a `range`, the `low` and `high` values and their sources
    - _Requirements: 2.1, 12.3, 12.4, 12.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 14.8, 14.9, 14.11_

  - [x] 6.5 Write the example test for the Migration_Rule
    - `tests/simulation/migration.test.ts`: one origin above the threshold, three destinations, exact largest-remainder allocation, the exit count, the commute cost term changing the allocation, no migration at the threshold (hand-computed literals)
    - _Requirements: 17.8, 9.1, 9.2, 9.3, 9.4, 5.5_

  - [x] 6.6 Write property test for migration order independence
    - `tests/simulation/properties/migration-order.property.test.ts`; permutes the presentation order of districts
    - **Property 11: Migration is independent of processing order**
    - **Validates: Requirements 9.6**

  - [ ]* 6.7 Write property test for migration rule behaviour
    - `tests/simulation/properties/migration-rule.property.test.ts`
    - **Property 12: Migration rule behaviour**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.7**

  - [ ]* 6.8 Write property test for Ghost counts
    - `tests/simulation/properties/ghosts.property.test.ts`
    - **Property 16: Ghost counts follow their formula**
    - Per-group formula `R = clamp(R0 + σ × Σ personPp, 0, P)` with σ both 0 and above 0, empty or all-zero group list gives `R = R0` exactly, and the Cause set (Baseline, three rent-group Causes, commute, overlap, displacement, Bound_Adjustment)
    - **Validates: Requirements 4.16, 6.14, 10.1, 10.3, 10.5, 10.6**

  - [ ]* 6.9 Write property test for event modifiers
    - `tests/simulation/properties/event-modifiers.property.test.ts`; uses synthetic Events and `test.modifier.<n>` parameters only
    - **Property 17: Event modifiers decompose exactly**
    - **Validates: Requirements 11.2, 11.4, 11.6**

  - [ ]* 6.10 Write unit tests for `explain.ts`
    - `tests/simulation/explain.test.ts`: Bound_Adjustment negative at the upper bound, positive at the lower bound, the rounding difference for counts, exactly 0 when inside the range, `parameters` content (status, `estimated` and `range` with sources copied from the table)
    - _Requirements: 12.3, 12.4, 12.5, 13.6, 14.8, 14.11_

- [x] 7. Implement indicator rules and the Rule_Registry
  - [x] 7.1 Implement `rules/social-housing-stock.ts`, `rules/rent.ts` and `rules/mrt-entries.ts`
    - Each returns a `CauseDraft` with the Baseline start value and its Source_Id links; kinds count, non-negative, count; stage `pre-migration`; one Cause per registry tool; rent below 0 limited to 0 and MRT entries below 0 limited to 0 through `finish`
    - _Requirements: 2.1, 2.5, 4.7, 5.7, 5.8, 5.9, 12.2, 12.6_

  - [x] 7.2 Implement `rules/mean-commute-time.ts` and `rules/rent-burden.ts`
    - Mean commute time from `derived.ts` (every tool Cause 0 in this spec); rent burden start from the Derived_Baseline (clamped, Baseline Cause links `housing.dwellingSize` and the rent and income Source_Ids), tool Causes from social housing (direct plus spillover term, links to `socialHousing.rentRatio`, `socialHousing.rentPerUnit`, `housing.dwellingSize` and the income Source_Id) and rent subsidy (direct plus pass-through follow-on over renter households); kind bounded
    - _Requirements: 2.1, 2.5, 4.15, 6.4, 6.5, 12.1, 13.4_

  - [x] 7.3 Implement `rules/population.ts` and `rules/ghost-count.ts`
    - Population: Baseline start, migration Cause equal to persons moved in minus persons moved out of that quarter (conflict C2, no carry-over), linked to the migration parameters; stage `post-migration`
    - Ghost count: collects the `ghostGroups` of every registry tool from the quarter's effects and passes them to `ghosts.ts`, uses the six group Causes of task 6.3 and the running Scenario's table for its Derived_Baseline count; stage `post-migration`
    - _Requirements: 4.16, 6.14, 9.5, 9.8, 10.1, 10.6, 12.2, 19.8_

  - [x] 7.4 Implement `src/simulation/registry.ts`
    - Frozen `RULE_REGISTRY`: tools socialHousing, commuterPass, rentSubsidy; indicators socialHousingStock, rent, mrtEntries, meanCommuteTime, rentBurden (pre-migration), population, ghostCount (post-migration)
    - _Requirements: 16.1, 16.2, 16.3, 16.5_

  - [x] 7.5 Write example tests for the indicator rules
    - One file per rule in `tests/simulation/rules/`: `social-housing-stock.test.ts`, `rent.test.ts`, `mrt-entries.test.ts`, `mean-commute-time.test.ts`, `rent-burden.test.ts`, `population.test.ts`, `ghost-count.test.ts`; each asserts at least one value against a hand-computed literal (rent floor at 0, MRT entries 0 without a station, rent burden from rent, dwelling size and income, mean commute time from job shares, population migration Cause equals in minus out, Ghost count for zero population)
    - `ghost-count.test.ts` checks the Ghost breakdown has Baseline, the six group Causes in order and the Bound_Adjustment (eight Causes), with the rent-group Causes present and 0 at zero differences
    - `ghost-count.test.ts` also holds the Requirement 17.12 example: with small hand-worked shares and equal inputs, the zero-delta Ghost count of the `low` Scenario (threshold 45) is at least that of the `high` Scenario (threshold 60)
    - _Requirements: 17.8, 17.12, 2.5, 5.9, 9.8, 10.5, 10.8_

- [x] 8. Implement validation
  - [x] 8.1 Implement stage-0 steps 1 to 4 in `src/simulation/validate.ts`
    - Target Quarter_Key form and range and `step` on 2025Q4; duplicate Rule_Registry ids; every required parameter of every registry rule, the Migration_Rule, ghosts, limits and budget collected into one `parameters-invalid` issue list sorted by id then problem (Lag 0 to 43 for every tool including social housing with no 12 to 20 limit, the `socialHousing.lag` NLMA note, unit cost above 0, Ghost_Size, `socialHousing.rentRatio` (`unit-share`, `range` inside 0 to 1), `ghost.sensitivityRent` (share 0 to 1, status `gap` with `assumption`), schedule sums, limit factor sides, absolute limits that exclude real values, job shares summing to 1, `ghost.shareBoth ≤ min(shareRent, 1 − shareCommuteWithin.high)`, and the metadata checks of task 2.1: status, `estimated`, `assumption`, `range-not-allowed`); Commute_Matrix size, code order, negative, non-finite and diagonal checks
    - _Requirements: 1.3, 1.4, 2.8, 7.8, 7.9, 8.8, 9.9, 9.10, 10.2, 10.4, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.10, 14.11, 14.12, 15.4, 15.5, 15.6, 16.6, 18.8_

  - [x] 8.2 Implement stage-0 steps 5 to 8 in `src/simulation/validate.ts`
    - Baseline coverage and values (earliest quarter, then lowest District_Code); Real_Policy_Track and Player_Policy_Timeline entries for every rule field (`track-missing`, `rule-reference-missing`); Events and their references (`event-invalid`, `event-reference-unknown`); policy type checks of both tracks, tool `checkSetting` calls (subsidized households above renter households with `where: 'rent-subsidy'`; the social housing renter-household check needs computed stock and runs inside the quarter, task 10.1), then the Policy_Limits of the player timeline only (`limit-exceeded`, never clipped, real track not checked); every Parameter id and Source_Id a rule or Event names exists
    - _Requirements: 2.7, 4.2, 5.2, 5.4, 5.10, 6.9, 6.10, 6.11, 11.3, 11.5, 13.8, 15.1, 15.2, 16.7, 18.4_

  - [ ]* 8.3 Write unit tests for `validate.ts`
    - `tests/simulation/validate.test.ts`: `no-later-quarter`, duplicate registry id, missing rule reference, unknown event references, inactive commuter pass rejecting a non-zero subsidy, fixed first-defect order, `parameters-invalid` issue order for a permuted table, `ghost.shareBoth` above its bound
    - _Requirements: 1.4, 5.10, 10.4, 11.3, 15.2, 16.6, 16.7_

- [x] 9. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`; both must exit with code 0. Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement and wire the engine
  - [x] 10.1 Implement `computeQuarter` in `src/simulation/engine.ts`
    - Stages in order: commit, charges and budget checks, mature (with `stock-negative`), tool effects, events, pre-migration indicators in registry order, migration, post-migration indicators (the `ghostGroups` of all registry tools, after events, are passed to the Ghost rule; `households-exceed-renters` with `where: 'social-housing'` is checked after maturing), finite check (`non-finite`), build and deep-freeze a fresh Sim_State; iterate only over the registry, districts in ascending code and the event list; `ENGINE_VERSION` exported
    - _Requirements: 1.6, 1.8, 2.1, 2.3, 2.4, 4.4, 4.9, 8.6, 11.2, 12.9, 12.10, 13.1, 16.3, 16.5_

  - [x] 10.2 Implement `step`, `run` and `runRange` in `src/simulation/engine.ts`
    - `run(policies, events, params, baseline, realTrack, commute, target, options?)`: validate once, compute 2015Q1 to target, return all states or the first error with its quarter; `step(state, policies, events, params, baseline, realTrack, commute, options?)`: validate the inputs up to the next quarter and compute one quarter; `runRange(...)`: central, low and high on separate `scenarioTable`s with no shared mutable state, a Result_Range from `Math.min` and `Math.max`, central Cause_Breakdowns, first error with the Scenario name; each Scenario computes its Derived_Baseline Ghost count from its own table (Requirement 19.8); `options.registry` defaults to `RULE_REGISTRY`, `options.budgetMode` to `'enforce'`
    - No exception for any input matching the declared types
    - _Requirements: 1.1, 1.2, 1.5, 1.10, 1.11, 3.7, 15.3, 19.1, 19.3, 19.4, 19.7_

  - [x] 10.3 Write engine example tests
    - `tests/simulation/engine.test.ts`: `stock-negative` with District_Code and first quarter (4.9), `non-finite` from an overflowing coefficient (12.10), `budget-exceeded` details (8.6), `ceiling-exceeded` details (18.6), `limit-exceeded` details (18.4), `step` on a state of 2025Q4, `runRange` error carries the Scenario name
    - Requirement 17.12 examples: a table without `status` returns `parameters-invalid` with `status-missing`; a `gap` parameter with a value and no `assumption` returns `assumption-missing`; a social housing Lag of 11 and of 21 is accepted; a table without Event-modifier parameters with a real-style event list gives zero Event Causes
    - `runRange` on a zero-delta run: `min === central === max` for every indicator except the Ghost count, whose Scenario values equal the Derived_Baseline Ghost count of that Scenario's own table
    - _Requirements: 1.4, 4.9, 8.6, 12.10, 17.12, 18.4, 18.6, 19.1, 19.8_

- [x] 11. Write the required invariant property tests
  - [x] 11.1 Write property test for zero-delta identity
    - `tests/simulation/properties/zero-delta.property.test.ts`
    - **Property 1: Zero-delta identity**
    - **Validates: Requirements 2.3, 2.4, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8, 8.9, 13.10**

  - [x] 11.2 Write property test for determinism
    - `tests/simulation/properties/determinism.property.test.ts`; second call on a `structuredClone` of every argument, for `run` and `runRange`
    - **Property 2: Determinism**
    - **Validates: Requirements 1.11, 17.7, 19.7**

  - [x] 11.3 Write property test for no input mutation
    - `tests/simulation/properties/no-mutation.property.test.ts`; valid inputs and inputs with one `arbDefect`; covers `step`, `run`, `runRange`, `checkBudget` and `checkLimit`; no call throws
    - **Property 3: No input mutation**
    - **Validates: Requirements 1.10, 8.3, 15.3, 18.7**

  - [x] 11.4 Write property test for the budget
    - `tests/simulation/properties/budget.property.test.ts`; accepts `budget-exceeded` and `ceiling-exceeded` as valid outcomes; asserts that at least 20 of the 100 cases were accepted runs; compares `checkBudget` with the step decision
    - **Property 4: Budget never overspent**
    - **Validates: Requirements 8.4, 8.5, 8.6, 8.10, 8.11, 18.6**

  - [x] 11.5 Write property test for tool limits and ceilings
    - `tests/simulation/properties/limits.property.test.ts`; asserts that at least 20 of the 100 cases were accepted runs; `checkLimit` against the reference formula; a value one step outside a limit is rejected, never clipped
    - **Property 5: Tool limits and ceilings**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.7, 18.9**

  - [x] 11.6 Write property test for bounded indicators
    - `tests/simulation/properties/bounded.property.test.ts`
    - **Property 6: Bounded indicators stay in 0–100**
    - **Validates: Requirements 12.1, 12.8**

  - [x] 11.7 Write property test for counts and finiteness
    - `tests/simulation/properties/counts.property.test.ts`
    - **Property 7: Counts are non-negative integers and all numbers are finite**
    - **Validates: Requirements 10.3, 12.2, 12.6, 12.8, 12.9, 13.9**

  - [x] 11.8 Write property test for Cause_Breakdown sums
    - `tests/simulation/properties/cause-sums.property.test.ts`
    - **Property 8: Cause breakdowns are complete and sum to the value**
    - The Ghost count breakdown is checked as Baseline, the three rent-group Causes, commute, overlap, displacement and one Bound_Adjustment; every other indicator keeps Baseline, one Cause per registry tool, Event Causes above tolerance, migration and Bound_Adjustment
    - **Validates: Requirements 2.1, 12.3, 12.4, 12.5, 12.7, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.11**

  - [x] 11.9 Write property test for population conservation
    - `tests/simulation/properties/migration-conservation.property.test.ts`
    - **Property 10: Migration conserves population**
    - **Validates: Requirements 9.4, 9.5, 9.8**

  - [x] 11.10 Write property test for event neutrality
    - `tests/simulation/properties/events-neutral.property.test.ts`; uses synthetic Events with modifiers; includes changing display-only Event fields and removing an Event without a modifier
    - **Property 18: Events never move indicators on their own**
    - **Validates: Requirements 11.1, 11.7, 11.8**

  - [x] 11.11 Write property test for the Result_Range
    - `tests/simulation/properties/range-contains-central.property.test.ts`; includes the zero-delta case where `min === central === max` for every indicator except the Ghost count (whose Scenario value is the Derived_Baseline Ghost count of that Scenario's own table and whose range may have `min < max`)
    - **Property 24: The Result_Range contains the central result**
    - **Validates: Requirements 19.1, 19.3, 19.4, 19.5, 19.6, 19.8**

  - [x] 11.12 Write property test for the social housing Lag range
    - `tests/simulation/properties/social-housing-lag.property.test.ts`; integer Lags 0 to 43 with the NLMA note are accepted (12 to 20 treated like any other), integers outside 0 to 43 and non-integers return `parameters-invalid` naming `socialHousing.lag`
    - **Property 25: Social housing Lag accepts the whole 0–43 range**
    - **Validates: Requirements 7.2, 7.8, 17.12**

  - [x] 11.13 Write property test for parameter status and estimate rules
    - `tests/simulation/properties/parameter-status.property.test.ts`; missing or unknown `status`, `secondary` or `gap` without `estimated` or with a blank method, `gap` value without `assumption`, `socialHousing.lag` without the NLMA note; a table that meets every rule, with an absent optional `gap` parameter, gives no such issue
    - **Property 26: Parameter status and estimate rules**
    - **Validates: Requirements 7.9, 14.10, 14.11, 14.12, 17.12**

  - [x] 11.14 Write property test for real-style events
    - `tests/simulation/properties/events-real-style.property.test.ts`; 0 to 10 real-style Events (no modifier) with a table that has no Event-modifier parameter: Sim_States deep-equal to the empty event list run, and no Event Cause in any breakdown
    - **Property 27: Real-style events add no Event Cause**
    - **Validates: Requirements 11.1, 11.6, 11.7, 11.9, 17.12**

  - [x] 11.15 Write property test for the Scenario Ghost count
    - `tests/simulation/properties/ghost-scenarios.property.test.ts`; at zero deltas each Scenario's Ghost count is `===` the Derived_Baseline Ghost count of its own table and the non-Baseline Ghost Causes are 0; the `low` Scenario (threshold 45) `C` and Ghost count are at least the `high` Scenario (threshold 60) values
    - **Property 28: Ghost count follows the Scenario threshold**
    - **Validates: Requirements 10.8, 19.2, 19.8, 17.12**

  - [x] 11.16 Write property test for the helping direction
    - `tests/simulation/properties/helping-direction.property.test.ts`; central Scenario; for each tool in turn, move exactly one tool field in the helping direction with the "helping-direction" mode of `arbPlayerTimeline` (social housing: more units started in a district-quarter; rent subsidy: more households or a higher amount in a city-quarter with `passThrough ≤ 1`; commuter pass: a higher subsidy) and keep every other tool equal to the Real_Policy_Track
    - The Ghost count of every district and quarter is not greater than that of the zero-delta run with the same other inputs; for the commuter pass it is equal (mean commute time has no tool Cause); may pass `options.budgetMode = 'record'`; Policy_Limits stay enforced; cases rejected by a Policy_Limit or another precondition error are discarded; assert that at least 20 of the 100 cases were accepted runs
    - **Property 29: Helping direction never raises the Ghost count (central Scenario)**
    - **Validates: Requirements 4.18, 6.14, 17.2, 17.13**

- [x] 12. Write the further property tests
  - [x]* 12.1 Write property test for Cause links
    - `tests/simulation/properties/cause-links.property.test.ts`
    - **Property 9: Every Cause links to known parameters and sources**
    - Checks that each Cause's `parameters` entries carry the table's `status`, `estimated` and `range` with sources
    - **Validates: Requirements 5.8, 13.7, 14.8, 14.9, 14.11**

  - [ ]* 12.2 Write property test for Lag timing
    - `tests/simulation/properties/lag.property.test.ts`
    - **Property 13: Lag timing**
    - **Validates: Requirements 2.2, 4.3, 4.4, 4.5, 7.3, 7.4, 7.5, 7.6, 7.7**

  - [ ]* 12.3 Write property test for ledger charges
    - `tests/simulation/properties/charges.property.test.ts`; includes `splitBySchedule` integer sums
    - **Property 15: Charges follow the reference cost model**
    - **Validates: Requirements 4.8, 5.6, 6.8, 7.7, 8.1, 8.2**

  - [ ]* 12.4 Write property test for invalid inputs
    - `tests/simulation/properties/invalid-inputs.property.test.ts`
    - **Property 19: Invalid inputs return the first matching Engine_Error without throwing**
    - **Validates: Requirements 1.3, 1.5, 2.7, 4.2, 5.2, 5.10, 6.10, 9.10, 11.3, 11.5, 15.1, 15.2, 15.3**

  - [ ]* 12.5 Write property test for parameter validation
    - `tests/simulation/properties/parameter-validation.property.test.ts`; defects include a Lag outside 0 to 43 and a missing NLMA note on `socialHousing.lag`, but not a Lag outside 12 to 20
    - **Property 20: Parameter validation lists every issue in a fixed order**
    - **Validates: Requirements 2.8, 7.8, 7.9, 8.8, 9.9, 10.2, 10.4, 14.2, 14.3, 14.4, 14.5, 14.6, 18.8**

  - [ ]* 12.6 Write property test for input order and unused parameters
    - `tests/simulation/properties/input-order.property.test.ts`
    - **Property 21: Input order and unused parameters do not change results**
    - **Validates: Requirements 14.7, 16.5**

  - [ ]* 12.7 Write property test for run prefix and step agreement
    - `tests/simulation/properties/run-prefix.property.test.ts`
    - **Property 22: Run prefix and step agreement**
    - **Validates: Requirements 1.1, 1.2, 3.7**

- [x] 13. Write example, extensibility and static tests
  - [x] 13.1 Write the 44-quarter zero-delta example test
    - `tests/simulation/zero-delta-44.test.ts`: fixed synthetic 44-quarter Baseline; `run` to 2025Q4 returns 44 Sim_States whose values are `===` the Baseline and Derived_Baseline values
    - _Requirements: 3.1, 3.8_

  - [x] 13.4 Write the hand-worked Ghost direction example tests
    - `tests/simulation/ghost-directions.test.ts`, central Scenario, one district, Lag 0, no migration; shared inputs: `P=100,000`, household size 2.5 (`H=40,000`), renter rate 0.4 (`Hr=16,000`), rent 600, `S=30`, income 720,000 (`m=60,000`, `k=0.05`), Derived_Baseline burden 30 percent, `shareRent` 0.1, `shareCommuteWithin` 0.8, `shareBoth` 0.04, `sensitivityRent` 0.01, `G=1,000`, `rentRatio` 0.8, `rentPerUnit` 0, `passThrough` 0.5; zero-delta Ghost count 26
    - (a) +200 units: housed burden 24 percent, per-household change −6 pp, `personPp` −3,000, district burden 29.925 percent, `R=9,970`, `O=3,994`, Ghost count 25 (strictly lower than 26); Causes housed −0.03, spillover 0, overlap +0.006, Bound_Adjustment −0.976
    - (b) rent subsidy with `a = 4,800,000` and renter rate 0.4 (below 0.5): direct −0.5 pp, rent +5, follow-on +0.25, net −0.25 pp (the burden falls), `personPp` −10,000, `R=9,900`, `O=3,980`, Ghost count 25 (not higher than 26)
    - (c) −200 units: `personPp` +3,000, `R=10,030`, `O=4,006`, Ghost count 26 (not lower than 26)
    - _Requirements: 4.15, 4.16, 4.18, 6.4, 6.14, 10.6, 17.8, 17.14_

  - [x] 13.2 Write the stub-tool extensibility test
    - `tests/simulation/extensibility.test.ts`: a stub tool with one city field and one effect parameter is passed through `options.registry` without editing `engine.ts`, `lag.ts`, `budget.ts`, `migration.ts` or `explain.ts`; its Cause appears in the `rent` breakdowns with the expected value, and the zero-delta identity still holds with it
    - _Requirements: 16.3, 16.4_

  - [x] 13.3 Write the static purity scan
    - `tests/simulation/purity.test.ts`: reads the files of `src/simulation/` and fails on imports from `src/ui`, `src/game`, `src/save` or `src/data`; on `document`, `window`, `fetch`, `localStorage`, `Date`, `performance`, `Math.random`; on a top-level `let` or `var`; on numeric literals in `rules/` other than 0, 1, 3, 4, 12 and 100; and on a `rules/` file that does not export exactly one rule
    - _Requirements: 1.6, 1.7, 1.8, 2.6, 14.1, 16.1_

- [x] 14. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`; both must exit with code 0 with no test skipped, todo or `.only`. Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement the backtest
  - [x] 15.1 Create `data/config/backtest-cases.json` and `scripts/backtest/cases.ts`
    - TPASS case: `id`, `tool`, `change` (`field`, `cities`, `firstQuarter` 2023Q3, `before` 1,280, `after` 1,200), `indicator` `mrtEntries`, `areas`, `evaluationQuarters` (2023Q3, 2023Q4), `observed` as a calculation spec and not a number (`source: 'history.json'`, `indicator: 'mrtEntries'`, `cities`, `comparisonYear` 2019, `postQuarters` Q3 and Q4, `preQuarters` Q1 and Q2 of the change year 2023, `method`, `confounders` including incomplete post-COVID-19 ridership recovery and the Ankeng LRT opening on 2023-02-10, and `secondaryContext` holding the news figures Taipei Metro +22 percent and New Taipei Metro +24 percent with their sources), `tolerances` (`ratioLow` 0.5, `ratioHigh` 2), `parametersChangedAfterOutcome: []`
    - If `public/data/history.json` is absent, stop and ask the user for the observed value instead of inventing one
    - `cases.ts` reads and validates the file; a case whose comparison year is 2022 (or inside 2020 to 2022), or that lacks tolerances, confounders or the calculation spec, becomes "not computed"; the news figures are never used in a check
    - _Requirements: 20.1, 20.2, 20.4, 20.6, 20.10_
    - Note: observed source changed by data-pipeline task 29.

  - [x] 15.2 Implement `scripts/backtest/adapt.ts`
    - Convert `history.json`, `policy-track.json`, `params.json` and the commute matrix into `EngineBaseline`, `PolicyTimeline`, `ParameterTable` and `CommuteMatrix`; write `commuterPassPrice` into `commuterPass.price.<city>.<quarter>` parameters; a missing file is reported as `missing input: <file>`
    - _Requirements: 20.3, 20.7, 20.9_

  - [x] 15.3 Implement `scripts/backtest/compute.ts`
    - Counterfactual Real_Policy_Track holds the changed field at its value before the change (pass price 1,280, subsidy 0) and is passed as the real track; the actual real track is passed as the Player_Policy_Timeline (subsidy 80); call `runRange` with `options.budgetMode = 'record'` (conflict C1) and an empty event list; simulated effect is the sum of the commuter pass Cause contributions in the `mrtEntries` breakdowns over the compared districts and quarters, as minimum, central and maximum; direction, magnitude ratio and range checks; absolute and relative error
    - Observed effect computed here, before the engine call, from `history.json` `mrtEntries` over all districts of Taipei and New Taipei: `(Q3+Q4 of 2023 − Q3+Q4 of 2019) − (Q1+Q2 of 2023 − Q1+Q2 of 2019)`; nothing entered by hand, 2022 never used; a `null` or missing compared value makes the case "not computed" naming the district and quarter; the `secondaryContext` news figures are never read here
    - _Requirements: 20.2, 20.3, 20.4, 20.10_

  - [x] 15.4 Implement `scripts/backtest/report.ts`
    - Render `docs/BACKTEST.md` deterministically: one section per case with change, quarters, simulated Result_Range, observed effect with its four quarter sums, comparison year, source, method and confounders, absolute and relative error, ratio, each check as "met" or "not met", the "validation" or "calibration" label with changed parameters, `ENGINE_VERSION` and a SHA-256 of `params.json` (Node `crypto`) as the Parameter_Table version; neutral wording, fixed decimals, LF line endings; a case that cannot be computed is written as "not computed" with its reason; the news figures (+22 percent, +24 percent) are printed only under a "Secondary context, not used in any check" heading
    - _Requirements: 20.5, 20.6, 20.7, 20.9, 20.10_

  - [x] 15.5 Implement `scripts/backtest.ts`, add the npm script and generate the report
    - Add `"backtest": "node scripts/backtest.ts"` to `package.json`; wire cases, adapt, compute and report; print `case <id>: not computed: <reason>` on failure; exit 0 when every case was computed (including "not met"), non-zero after writing the report when any case is "not computed"
    - Run `npm run backtest` once to write `docs/BACKTEST.md` (until `params.json` and the matrix exist the TPASS case is "not computed: missing input")
    - _Requirements: 20.7, 20.9_

  - [ ]* 15.6 Write unit tests for the backtest modules
    - `tests/scripts/backtest/report.test.ts` (byte-identical output, LF endings, "not computed" section) and `tests/scripts/backtest/compute.test.ts` (counterfactual track, `budgetMode: 'record'` call, the three checks) on fixture inputs; the observed-effect formula on a fixture `history.json` with hand-worked numbers, `cases.ts` rejecting comparison year 2022, a `null` compared value giving "not computed", and a changed `secondaryContext` figure changing no computed number
    - _Requirements: 20.2, 20.3, 20.4, 20.5, 20.7, 20.10_

  - [x] 15.7 Write the backtest staleness test
    - `tests/simulation/backtest-report.test.ts`: recomputes every case and compares the numbers with `docs/BACKTEST.md`; when inputs are missing it compares the "not computed: missing input" text, so it passes without being skipped and still detects a stale report; excluded from Requirement 17.6
    - _Requirements: 20.8_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`, report both exit codes; both must be 0 with no test skipped, todo or `.only`. Ensure all tests pass, ask the user if questions arise.

- [x] 17. Add direction-based Scenario selection (`migration.commuteCostPerMinute`)
  - [x] 17.1 Implement Scenario_Directions in `src/simulation/params.ts` and `src/simulation/rules/population.ts`
    - Add `ScenarioDirection` (`'low-is-strongest' | 'high-is-strongest'`), `ScenarioEffectParameter { id; direction }` and `SCENARIO_EFFECT_PARAMETERS` with seven entries: the six existing ids as `low-is-strongest` and `migration.commuteCostPerMinute` as `high-is-strongest`; keep `SCENARIO_EFFECT_IDS` as the ids derived from that list
    - `scenarioTable(params, scenario, effects = SCENARIO_EFFECT_PARAMETERS)`: `central` keeps `value`; for a listed scalar parameter with a `range`, `low` takes `range.low` (or `range.high` for `high-is-strongest`) and `high` takes the other end; a listed parameter without a `range` and every unlisted parameter keep `value`; the input table is never changed
    - Change the `ParameterSpec` role of `migration.commuteCostPerMinute` in `population.ts` from `derivation` to `effect` (check stays `non-negative`, `range` allowed)
    - _Requirements: 5.12, 9.8, 14.4, 19.2, 19.5, 19.10_

  - [x] 17.2 Update the Scenario tests
    - `tests/simulation/properties/scenario-table.property.test.ts` (**Property 23: Scenario tables vary only ranged effect parameters**): seven varying ids with their directions; `migration.commuteCostPerMinute` takes `range.high` in `low` and `range.low` in `high`; the other six keep `range.low` in `low` and `range.high` in `high` (same values as the previous `scenarioTable`); every other parameter keeps `value`; the input table is unchanged
    - Add a `range` (`low` 0, `value`, `high` ≥ `value`) for `migration.commuteCostPerMinute` to `tests/simulation/fixtures/params.ts` and to `arbParams` in `tests/simulation/arbitraries.ts` with `0 ≤ low ≤ value ≤ high`; add an example test that the fixture table gives `high` in the `low` Scenario and `low` (= 0) in the `high` Scenario; confirm `ghost-scenarios`, `ghost-count`, `migration` and `zero-delta` tests still pass unchanged
    - **Validates: Requirements 19.2, 19.5, 19.10, 19.11, 19.12, 5.12**
    - _Requirements: 5.12, 14.4, 19.2, 19.5, 19.10, 19.11, 19.12_

  - [x] 17.3 Checkpoint - Ensure all tests pass
    - Run `npx vitest --run` and `npm run typecheck`; both must exit with code 0 with no test skipped, todo or `.only`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Required (not optional): the tests Requirement 17 demands, namely Properties 1 to 8, 10, 11, 18, 23 to 29 (the design has 29 properties; 25 to 28 are the Requirement 17.12 tests, 29 is the Requirement 17.13 helping-direction test), one example test per rule file and for the Migration_Rule, the hand-worked Ghost direction tests (`ghost-directions.test.ts`), the 44-quarter example, the stub-tool test, the purity scan, the readonly type test, the engine example tests and the backtest staleness test.
- Task 1.1 is already done: `tsconfig.json` includes `src` and `fast-check` 4.10.2 is pinned. The `backtest` script does not exist yet and is added in task 15.5.
- Each property test implements exactly one design property, uses `numRuns: 100` or more and carries the comment `// Feature: simulation-engine, Property <n>: <title>`; fast-check prints the shrunk counterexample, seed and path on failure (Requirement 17.9).
- Data-facing note: the content of `params.json` (ghost parameters, `reference` parameters, `status`, `estimated` and `assumption` fields, no Event-modifier parameters, the NLMA-derived social housing Lag) and the commute matrix are produced outside this spec. No task here writes them, and all tests use the in-memory fixtures of task 3.1. Only the backtest reads the real files.
- Only `backtest-report.test.ts` and the backtest script read `public/data/`, `params.json` and `docs/BACKTEST.md`.
- Never run `npm run dev` or watch-mode test commands; use `npx vitest --run`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.2", "1.4"] },
    { "id": 1, "tasks": ["1.3", "1.5", "1.6", "15.1"] },
    { "id": 2, "tasks": ["2.1", "3.1", "5.1", "15.2"] },
    { "id": 3, "tasks": ["2.2", "3.2", "5.2", "5.3", "6.1", "6.2", "6.3", "6.4"] },
    { "id": 4, "tasks": ["2.3", "3.3", "4.1", "4.2", "4.3", "5.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "7.1", "7.2", "7.3"] },
    { "id": 5, "tasks": ["4.4", "4.5", "5.5", "7.4", "7.5"] },
    { "id": 6, "tasks": ["8.1", "10.1"] },
    { "id": 7, "tasks": ["8.2"] },
    { "id": 8, "tasks": ["8.3", "10.2"] },
    { "id": 9, "tasks": ["10.3", "11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8", "11.9", "11.10", "11.11", "11.12", "11.13", "11.14", "11.15", "11.16", "12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "13.1", "13.2", "13.3", "13.4", "15.3"] },
    { "id": 10, "tasks": ["15.4"] },
    { "id": 11, "tasks": ["15.5"] },
    { "id": 12, "tasks": ["15.6", "15.7"] },
    { "id": 13, "tasks": ["17.1"] },
    { "id": 14, "tasks": ["17.2"] }
  ]
}
```
