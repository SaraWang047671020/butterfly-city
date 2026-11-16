# Implementation Plan: Simulation Engine

## Overview

The engine is built bottom-up in TypeScript (erasable syntax only, `strict`, `noUncheckedIndexedAccess`) in `src/simulation/`. Order: shared types, constants, errors and helpers; parameters and the Derived_Baseline; test fixtures and generators; the three tool rules; the Lag_Pipeline and the budget (with `BudgetPlan` in the ledger); events, migration, ghosts and `explain.finish`; the seven indicator rules and the Rule_Registry; stage-0 validation; `engine.ts` (`step`, `run`, `runRange`); the invariant property tests; the example, extensibility and purity tests; and last the backtest script and report, which call `runRange`.

All code follows `design.md`. Conflict decisions accepted by the user: C1 option A (the backtest passes `options.budgetMode = 'record'`, every other caller uses the default `'enforce'`), C2 literal per-quarter migration Cause (persons moved in minus persons moved out, no carry-over, start-of-quarter population is the Baseline population), C3 as described (Annual_Budget equality for fully computed years, `committed ≤ Annual_Budget` for the last partly computed year).

Signatures to implement exactly as in the design:

- `step(state, policies, events, params, baseline, realTrack, commute, options?)`
- `run(policies, events, params, baseline, realTrack, commute, target, options?)`
- `runRange(...same as run...)`
- `checkBudget(proposed, ledger, params)` and `checkLimit(tool, field, area, quarter, ledger, params)`, where the ledger carries the `BudgetPlan` (real settings, real charges, Annual_Budgets, ceilings)

Every property test uses fast-check 4.10.2 with `fc.assert(fc.property(...), { numRuns: 100 })` (at least 100), carries the comment `// Feature: simulation-engine, Property <n>: <title>`, and names the requirements it validates. Tests run once with `npx vitest --run`, never in watch mode. Engine tests use in-memory fixtures and read no file outside `src/` and `tests/` (Requirement 17.6).

## Tasks

- [ ] 1. Set up foundations: types, constants, errors and helpers
  - [x] 1.1 Confirm the existing setup
    - Already present, no change needed: `tsconfig.json` `include` contains `"src"` (and `scripts`, `tests`) with `erasableSyntaxOnly`, `noUncheckedIndexedAccess` and `strict`; `package.json` pins `fast-check` `4.10.2`, `vitest` `5.1.0` and has `typecheck` and `test` scripts
    - Not present yet: the `backtest` script, added in task 15.5
    - _Requirements: 17.1, 17.11_

  - [ ] 1.2 Create the engine types in `src/types/simulation.ts`
    - Inputs: `Citation`, `ParameterRange`, `ScalarParameter`, `ScheduleParameter`, `ParameterTable`, `EngineBaseline`, `ToolSetting`, `PolicySetting`, `PolicyTimeline`, `CommuteMatrix`, `SimEvent`, `EngineOptions` (`registry?`, `seed?`, `budgetMode?: 'enforce' | 'record'`), `ToolId`, `IndicatorId`, `AreaKey`
    - Outputs: `ValueKind`, `Cause`, `CauseBreakdown`, `LagEntry`, `BudgetPlan`, `BudgetLedger`, `SimState`, `ResultRange`, `QuarterRanges`
    - Results and errors: `EngineErrorCode` (all 20 codes of the design catalogue), `EngineError` (with `details` and sorted `issues`), `StepResult`, `RunResult`, `RangeResult`, `BudgetCheck`, `LimitInfo`
    - Rule interfaces, so rule files and `registry.ts` import them without a cycle: `ParameterSpec`, `ParameterRole`, `ParameterCheck`, `ToolRule`, `ToolEffects`, `IndicatorRule`, `CauseDraft`, `Contribution`, `QuarterWork`, `RuleRegistry`
    - Every property `readonly` and every array a `readonly` array at every nesting level; union string types only (no `enum`); import `QuarterKey`, `DistrictCode`, `CityName` from `src/types/data-files.ts`
    - _Requirements: 1.1, 1.2, 1.9, 2.5, 13.1, 16.1, 19.1_

  - [ ] 1.3 Implement `src/simulation/constants.ts` and `src/simulation/errors.ts`
    - Constants: `FIRST_QUARTER` (2015Q1), `LAST_QUARTER` (2025Q4), `QUARTER_COUNT` 44, `DISTRICT_COUNT` 41, `MAX_LAG` 43, social housing Lag bounds 12 and 20, `SHARE_SUM_TOLERANCE` 1e-9, `CAUSE_TOLERANCE` factor 1e-9, `ENGINE_VERSION`, city order (Taipei, then New Taipei)
    - `errors.ts`: one constructor per `EngineErrorCode` building an `EngineError` with an English message that names every offending value and the `details` fields from the design's error catalogue; `parametersInvalid(issues)` sorts issues by parameter id, then problem; `ok` and `err` helpers; nothing in this module throws
    - _Requirements: 1.3, 1.4, 1.5, 14.6, 15.3_

  - [ ] 1.4 Implement `src/simulation/quarter.ts` and `src/simulation/numeric.ts`
    - `parseQuarter` (`/^(\d{4})Q([1-4])$/`), `quarterIndex` (2015Q1 is 0, works for any integer), `quarterAt`, `nextQuarter` (2015Q4 to 2016Q1), `quarterYear`
    - `roundHalfUp` (`Math.round`, then `-0` becomes `0`), `clamp` (returns `x` itself when inside the range), `apportion` (largest remainder, ties to the lower index), `splitBySchedule` (whole-TWD charges, last charge is `total` minus the others)
    - _Requirements: 1.1, 1.3, 4.8, 8.2, 9.3, 12.4_

  - [ ]* 1.5 Write unit tests for quarter and numeric helpers
    - `tests/simulation/quarter.test.ts`, `tests/simulation/numeric.test.ts`: malformed keys, year rollover, `roundHalfUp(2.5) === 3`, `roundHalfUp(-2.5) === -2`, `roundHalfUp(-0.4)` is `0` not `-0`, `clamp` returns the same number inside the range, `apportion` sums and tie order, `splitBySchedule` sums exactly and keeps negative totals negative
    - _Requirements: 1.3, 4.8, 8.2, 12.4_

  - [ ] 1.6 Write the readonly type test `tests/simulation/readonly.typecheck.ts`
    - `// @ts-expect-error` for an assignment to a field and a `push` to an array of every input type at each nesting level (`ParameterTable`, `EngineBaseline`, `PolicyTimeline`, `CommuteMatrix`, `SimEvent`, `SimState`); `npm run typecheck` fails if one of them compiles
    - _Requirements: 1.9_

- [ ] 2. Implement parameters and the Derived_Baseline
  - [ ] 2.1 Implement `src/simulation/params.ts`
    - `scalar(params, id)` and `schedule(params, id)` accessors used only after validation; id expansion for `<city>`, `<code>`, `<quarter>`, `<year>`
    - `ParameterSpec` checks (`finite`, `non-negative`, `positive`, `share`, `integer` with min and max, `schedule`) as pure functions returning issue lists; also blank `unit` or `source`, `range` with `low > high`, `value` outside the range, blank range sources, an unknown `optional` flag handled as "absent is fine"
    - `checkSpecs(params, specs)` collecting every issue; `scenarioTable(params, 'central' | 'low' | 'high')` returns a new table in which only `effect`-role parameters with a `range` take `low` or `high` and every other role keeps `value`; the input table is never changed
    - _Requirements: 7.1, 14.1, 14.3, 14.4, 14.5, 14.6, 14.7, 19.2_

  - [ ] 2.2 Implement `src/simulation/derived.ts`
    - Household count `P / housing.householdSize.<city>`, renter households `H × housing.renterRate.<city>`, renter share per district (sums to 1 per city), `k_d = S ÷ (I_d ÷ 12) × 100`, Derived_Baseline rent burden `clamp(rent × S ÷ (I ÷ 12) × 100, 0, 100)`, mean commute time `Σ_j commute.jobShare.<j> × matrix[d][j]`
    - Return `derived-input-invalid` for a missing or non-positive divisor
    - _Requirements: 2.1, 2.5, 2.6, 6.3, 6.11_

  - [ ]* 2.3 Write unit tests for `params.ts` and `derived.ts`
    - `tests/simulation/params.test.ts`, `tests/simulation/derived.test.ts`: each check kind accepts the boundary values and rejects the outside values, `scenarioTable` leaves lag and cost parameters at `value`, hand-computed rent burden, burden clamped at 100, renter shares sum to 1 per city, mean commute time from job shares, zero income gives `derived-input-invalid`
    - _Requirements: 2.5, 6.3, 6.11, 14.3, 14.4, 14.5, 19.2_

- [ ] 3. Build test fixtures and generators
  - [ ] 3.1 Create typed fixtures in `tests/simulation/fixtures/`
    - The 41 District_Codes with cities; a synthetic Baseline builder (1 to 44 quarters from 2015Q1) with `population`, `householdIncome`, `rent`, `mrtEntries`, `socialHousingStock` and a Source_Id registry; a complete valid Parameter_Table covering every required id of the design's parameter table (including the expanded `<city>`, `<code>`, `<quarter>` and `<year>` ids, the 0 and 2 limit factors, and `budget.ceiling` rows); a real-track builder; a valid 41×41 Commute_Matrix with zero diagonal; sample Events with modifiers
    - No file I/O; all values in memory
    - _Requirements: 17.3, 17.6_

  - [ ] 3.2 Implement fast-check generators in `tests/simulation/arbitraries.ts`
    - `arbBaseline` (population 0 to 500,000, income 300,000 to 3,000,000, rent 100 to 2,000, MRT entries 0 to 20,000,000 with some 0, stock 0 to 20,000, 1 to 8 quarters), `arbParams` (a ranged parameter is drawn in `[low, high]`, others use `value`; Lags in their allowed ranges including 0 and 12 and 20; Cost_Schedules with 1 to 8 offsets; ghost shares with `shareBoth ≤ min(other two)`), `arbCommuteMatrix`, `arbRealTrack` (pass price 0 and positive), `arbPlayerTimeline` (all-zero, equal-to-real, largest accepted, in-limit and "reallocation" modes), `arbEvents` (0 to 10 Events, 0 to 3 modifiers inside their ranges), `arbDefect` (one injected defect from Property 19 or 20)
    - _Requirements: 17.3, 17.4, 17.5_

  - [ ] 3.3 Write property test for scenario tables
    - `tests/simulation/properties/scenario-table.property.test.ts`
    - **Property 23: Scenario tables vary only ranged effect parameters**
    - **Validates: Requirements 7.1, 19.2, 19.5**

- [ ] 4. Implement the three tool rules
  - [ ] 4.1 Implement `src/simulation/rules/social-housing.ts`
    - District level, stock effect, field `unitsStarted` (integer, limit scope city-year); `parameters()`, `checkSetting`, `difference` (exactly 0 when equal), `charge` (real and difference, rounded once to whole TWD, before the schedule), `effects` (`socialHousingStock` `+X_d`, `rent` `rentPerUnit × X_d`, `rentBurden` rent delta × `k_d`; links to `socialHousing.rentPerUnit` and `socialHousing.lag`); modifiable indicators `rent` and `rentBurden`
    - Only the numeric literals allowed by Requirement 2.6
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.8, 4.10, 2.6_

  - [ ] 4.2 Implement `src/simulation/rules/commuter-pass.ts`
    - City level, flow effect, field `subsidy` (upper limit is the pass price), track-only field `passesSold`; inactive when the real price is 0 (only subsidy 0 accepted, difference, Cause and charge 0); `real-net-price-zero` check; `ρ = −Δ ÷ N` from the difference only
    - Effects: `mrtEntries` `Baseline MRT × elasticity × ρ` (0 when Baseline entries are 0 or absent), `commuteCostDelta` for each district of the city (origin scope); links to the lag, elasticity and price parameters; modifiable indicator `mrtEntries`
    - Charge in the setting quarter: adjusted passes `max(0, passesSold × (1 + elasticity × ρ))`; `real = roundHalfUp(real.subsidy × passesSold × 3 × unitCost)`, `difference = roundHalfUp(Δ × A × 3 × unitCost)`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9, 5.10, 18.2_

  - [ ] 4.3 Implement `src/simulation/rules/rent-subsidy.ts`
    - City level, flow effect, fields `households` (integer) and `amount`; difference `player.h × player.a − real.h × real.a`; allocation by renter share; `rentBurden` delta `−a_d ÷ (H_d × I_d ÷ 12) × 100`; `rent` pass-through delta `passThrough × a_d ÷ (Hr_d × S)` (exactly 0 without `rentSubsidy.passThrough`) plus its rent-burden follow-on in the same Cause; charges `× 3 × unitCost`; optional `rentSubsidy.costSchedule`
    - `households-exceed-renters` and `derived-input-invalid` checks
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11_

  - [ ] 4.4 Write example tests for the tool rules
    - `tests/simulation/rules/social-housing.test.ts` (+100 units in 2015Q1, Lag 12, `rentPerUnit = -0.002`: stock +100 and rent −0.2 in 2018Q1, nothing in 2017Q4), `commuter-pass.test.ts` (price 1,280, real subsidy 0, player subsidy 80, elasticity −0.3, Baseline entries 1,000,000, Lag 0: `1,000,000 × −0.3 × (−80 ÷ 1,280) = 18,750`; inactive before the price exists; `real-net-price-zero`), `rent-subsidy.test.ts` (allocation, burden and pass-through on two districts; `households-exceed-renters`)
    - Expected values written as hand-computed literals; counts exact, other values within 1e-9
    - _Requirements: 17.8, 4.6, 5.3, 5.4, 5.10, 6.4, 6.6, 6.9_

  - [ ]* 4.5 Write property test for tool formulas
    - `tests/simulation/properties/tool-formulas.property.test.ts`, with reference formulas written independently in the test
    - **Property 14: Tool effects follow their formulas**
    - **Validates: Requirements 4.6, 5.3, 5.9, 6.3, 6.4, 6.6, 6.7**

- [ ] 5. Implement the Lag_Pipeline and the budget
  - [ ] 5.1 Implement `src/simulation/lag.ts`
    - `commit(pipeline, entries)` (one entry per tool, area and committed quarter when `L ≥ 1`, including zero differences; none when `L = 0`), `mature(pipeline, t)` returning `{ matured, rest }`; stock tools add matured values to the carried stock difference, flow tools take the matured value as the active difference of `t`
    - Pipeline sorted by effect quarter, tool registry index, area code and committed quarter; entries never merged or changed; entries with an effect quarter after 2025Q4 stay
    - _Requirements: 2.2, 4.3, 4.4, 4.5, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 5.2 Write unit tests for `lag.ts`
    - `tests/simulation/lag.test.ts`: Lag 0 has no entry, zero differences are recorded for `L ≥ 1`, several commits keep separate entries, an effect quarter after 2025Q4 stays in the pipeline, the pipeline order does not depend on insertion order
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

  - [ ] 5.3 Implement the plan, ledger and per-quarter charges in `src/simulation/budget.ts`
    - `planBudget(realTrack, params, tools)` builds the immutable `BudgetPlan` once: real settings, `realCharges` per tool and quarter after the Cost_Schedule (charges after 2025Q4 recorded in 2025Q4), `annualBudget` per year from every quarter present in the Real_Policy_Track (independent of the target, conflict C3), `ceilings` from `budget.ceiling.<tool>.<year>` or the Annual_Budget
    - The ledger carries the plan, `through`, `committed` (44 integer slots per tool, real plus difference charges), `year` and `remaining`; the per-quarter charge code is shared by `step` and `checkBudget`; checks run for every year an increment touched in ascending order, ceiling (`ceiling-exceeded`) before Annual_Budget (`budget-exceeded`), both skipped when `budgetMode` is `'record'` (conflict C1) while the ledger is still updated; Q1 `remaining` has no carry-over
    - All money values integer TWD; a negative difference gives negative charges
    - _Requirements: 4.8, 5.6, 6.8, 7.7, 8.1, 8.2, 8.6, 8.7, 8.9, 8.11, 18.5, 18.6_

  - [ ] 5.4 Implement `checkBudget` and `checkLimit` in `src/simulation/budget.ts`
    - `checkBudget(proposed, ledger, params)`: no side effects; uses the code of task 5.3 and reads the real values from `ledger.plan`; returns `ok` with year, Annual_Budget, committed and remaining, or `annual-budget` / `tool-ceiling` rejection with the earliest year over, or `wrong-quarter`
    - `checkLimit(tool, field, area, quarter, ledger, params)`: returns `lower`, `upper`, their parameter ids and sources, `scope`, `ceiling` and `remainingCeiling`; formulas `lower = min ?? lowerFactor × v` and `upper = upperLimit(field) ?? max ?? max(upperFactor × v, upperMin ?? 0)`; commuter pass upper limit is the pass price (0 when the price is 0); social housing scope is the city-year total, upper limit on the running total, lower limit only for complete years (design Decision D6); a value outside a limit is never clipped
    - _Requirements: 8.3, 8.4, 8.5, 18.1, 18.2, 18.3, 18.4, 18.6, 18.7_

  - [ ]* 5.5 Write unit tests for `budget.ts`
    - `tests/simulation/budget.test.ts`: Q1 rollover without carry-over (8.7), a schedule charge after 2025Q4 recorded in 2025Q4, negative differences give negative charges, ceiling checked before Annual_Budget, `budgetMode: 'record'` skips both errors but updates the ledger, `checkBudget` equals the step's decision, `checkLimit` values for each tool field and the pass price limit, social housing lower limit only for complete years, the Annual_Budget does not change with the number of computed quarters
    - _Requirements: 4.8, 8.4, 8.5, 8.7, 18.1, 18.3, 18.7_

- [ ] 6. Implement events, migration, ghosts and explanations
  - [ ] 6.1 Implement `src/simulation/events.ts`
    - For each tool, modifiable indicator, district and quarter: apply the covering Events' modifiers in event-list order (`v_j = v_{j−1} × m`), Event Cause `v_j − v_{j−1}`, listed only above the tolerance of 13.3; never scale the social housing stock or the migration commute cost; never read affected indicators, magnitude or type
    - _Requirements: 11.1, 11.2, 11.4, 11.6, 11.7_

  - [ ] 6.2 Implement `src/simulation/migration.ts`
    - Out-movement `floor(share × P)` when `B − B0 > threshold` (P is the Baseline population, conflict C2), exits `floor(exitShare × out)`, weights `exp(x − max x)` with `x = −weightTime × M[o][j] − weightBurden × B_j − weightCost × cost_oj` and `cost_oj = max(0, commuteCostPerMinute × M[o][j] − K_o)`, `apportion` per origin over the other 40 districts, results summed in ascending code order from one start-of-quarter snapshot; returns `in`, `out`, `net` (moved in minus moved out), `displaced` and `exits`
    - _Requirements: 2.4, 5.5, 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8_

  - [ ] 6.3 Implement `src/simulation/ghosts.ts`
    - One function for `sR`, `sC`, `sO`, `R`, `C`, `O` and the count `floor((R + C − O + D) ÷ G)` (0 for zero population), used for both the Derived_Baseline count and the simulated count; the four group Causes (rent-burden, commute-time, overlap, displacement) with parameter links
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6, 3.3_

  - [ ] 6.4 Implement `src/simulation/explain.ts`
    - `finish(draft)` sums contributions left to right in Cause order to `pre`, then bounds per `ValueKind` (bounded `clamp(0, 100)`, non-negative `max(0)`, count `max(roundHalfUp(pre), 0)`) and sets the Bound_Adjustment to `value − pre` (exactly 0 when `pre` is valid); Cause order Baseline, one Cause per registry tool (always present), Event Causes, migration, Bound_Adjustment; Ghost count order Baseline, four groups, Bound_Adjustment
    - Sorted `parameterIds` and `sourceIds`; `ranges` hold low and high with sources of every ranged parameter a Cause used
    - _Requirements: 2.1, 12.3, 12.4, 12.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 14.8, 14.9_

  - [ ] 6.5 Write the example test for the Migration_Rule
    - `tests/simulation/migration.test.ts`: one origin above the threshold, three destinations, exact largest-remainder allocation, the exit count, the commute cost term changing the allocation, no migration at the threshold (hand-computed literals)
    - _Requirements: 17.8, 9.1, 9.2, 9.3, 9.4, 5.5_

  - [ ] 6.6 Write property test for migration order independence
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
    - **Validates: Requirements 10.1, 10.3, 10.5, 10.6**

  - [ ]* 6.9 Write property test for event modifiers
    - `tests/simulation/properties/event-modifiers.property.test.ts`
    - **Property 17: Event modifiers decompose exactly**
    - **Validates: Requirements 11.2, 11.4, 11.6**

  - [ ]* 6.10 Write unit tests for `explain.ts`
    - `tests/simulation/explain.test.ts`: Bound_Adjustment negative at the upper bound, positive at the lower bound, the rounding difference for counts, exactly 0 when inside the range, `ranges` content
    - _Requirements: 12.3, 12.4, 12.5, 13.6, 14.8_

- [ ] 7. Implement indicator rules and the Rule_Registry
  - [ ] 7.1 Implement `rules/social-housing-stock.ts`, `rules/rent.ts` and `rules/mrt-entries.ts`
    - Each returns a `CauseDraft` with the Baseline start value and its Source_Id links; kinds count, non-negative, count; stage `pre-migration`; one Cause per registry tool; rent below 0 limited to 0 and MRT entries below 0 limited to 0 through `finish`
    - _Requirements: 2.1, 2.5, 4.7, 5.7, 5.8, 5.9, 12.2, 12.6_

  - [ ] 7.2 Implement `rules/mean-commute-time.ts` and `rules/rent-burden.ts`
    - Mean commute time from `derived.ts` (every tool Cause 0 in this spec); rent burden start from the Derived_Baseline (clamped, Baseline Cause links `housing.dwellingSize` and the rent and income Source_Ids), tool Causes from social housing and rent subsidy; kind bounded
    - _Requirements: 2.1, 2.5, 6.4, 6.5, 12.1, 13.4_

  - [ ] 7.3 Implement `rules/population.ts` and `rules/ghost-count.ts`
    - Population: Baseline start, migration Cause equal to persons moved in minus persons moved out of that quarter (conflict C2, no carry-over), linked to the migration parameters; stage `post-migration`
    - Ghost count: delegates to `ghosts.ts`, uses the group Causes of task 6.3; stage `post-migration`
    - _Requirements: 9.5, 9.8, 10.1, 10.6, 12.2_

  - [ ] 7.4 Implement `src/simulation/registry.ts`
    - Frozen `RULE_REGISTRY`: tools socialHousing, commuterPass, rentSubsidy; indicators socialHousingStock, rent, mrtEntries, meanCommuteTime, rentBurden (pre-migration), population, ghostCount (post-migration)
    - _Requirements: 16.1, 16.2, 16.3, 16.5_

  - [ ] 7.5 Write example tests for the indicator rules
    - One file per rule in `tests/simulation/rules/`: `social-housing-stock.test.ts`, `rent.test.ts`, `mrt-entries.test.ts`, `mean-commute-time.test.ts`, `rent-burden.test.ts`, `population.test.ts`, `ghost-count.test.ts`; each asserts at least one value against a hand-computed literal (rent floor at 0, MRT entries 0 without a station, rent burden from rent, dwelling size and income, mean commute time from job shares, population migration Cause equals in minus out, Ghost count for zero population)
    - _Requirements: 17.8, 2.5, 5.9, 9.8, 10.5_

- [ ] 8. Implement validation
  - [ ] 8.1 Implement stage-0 steps 1 to 4 in `src/simulation/validate.ts`
    - Target Quarter_Key form and range and `step` on 2025Q4; duplicate Rule_Registry ids; every required parameter of every registry rule, the Migration_Rule, ghosts, limits and budget collected into one `parameters-invalid` issue list sorted by id then problem (Lag 0 to 43, social housing Lag 12 to 20, unit cost above 0, Ghost_Size, schedule sums, limit factor sides, absolute limits that exclude real values, job shares summing to 1); Commute_Matrix size, code order, negative, non-finite and diagonal checks
    - _Requirements: 1.3, 1.4, 2.8, 7.8, 7.9, 8.8, 9.9, 9.10, 10.4, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 15.4, 15.5, 15.6, 16.6, 18.8_

  - [ ] 8.2 Implement stage-0 steps 5 to 8 in `src/simulation/validate.ts`
    - Baseline coverage and values (earliest quarter, then lowest District_Code); Real_Policy_Track and Player_Policy_Timeline entries for every rule field (`track-missing`, `rule-reference-missing`); Events and their references (`event-invalid`, `event-reference-unknown`); policy type checks of both tracks, tool `checkSetting` calls, then the Policy_Limits of the player timeline only (`limit-exceeded`, never clipped, real track not checked); every Parameter id and Source_Id a rule or Event names exists
    - _Requirements: 2.7, 4.2, 5.2, 5.4, 5.10, 6.9, 6.10, 6.11, 11.3, 11.5, 13.8, 15.1, 15.2, 16.7, 18.4_

  - [ ]* 8.3 Write unit tests for `validate.ts`
    - `tests/simulation/validate.test.ts`: `no-later-quarter`, duplicate registry id, missing rule reference, unknown event references, inactive commuter pass rejecting a non-zero subsidy, fixed first-defect order, `parameters-invalid` issue order for a permuted table
    - _Requirements: 1.4, 5.10, 11.3, 15.2, 16.6, 16.7_

- [ ] 9. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`; both must exit with code 0. Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement and wire the engine
  - [ ] 10.1 Implement `computeQuarter` in `src/simulation/engine.ts`
    - Stages in order: commit, charges and budget checks, mature (with `stock-negative`), tool effects, events, pre-migration indicators in registry order, migration, post-migration indicators, finite check (`non-finite`), build and deep-freeze a fresh Sim_State; iterate only over the registry, districts in ascending code and the event list; `ENGINE_VERSION` exported
    - _Requirements: 1.6, 1.8, 2.1, 2.3, 2.4, 4.4, 4.9, 8.6, 11.2, 12.9, 12.10, 13.1, 16.3, 16.5_

  - [ ] 10.2 Implement `step`, `run` and `runRange` in `src/simulation/engine.ts`
    - `run(policies, events, params, baseline, realTrack, commute, target, options?)`: validate once, compute 2015Q1 to target, return all states or the first error with its quarter; `step(state, policies, events, params, baseline, realTrack, commute, options?)`: validate the inputs up to the next quarter and compute one quarter; `runRange(...)`: central, low and high on separate `scenarioTable`s with no shared mutable state, a Result_Range from `Math.min` and `Math.max`, central Cause_Breakdowns, first error with the Scenario name; `options.registry` defaults to `RULE_REGISTRY`, `options.budgetMode` to `'enforce'`
    - No exception for any input matching the declared types
    - _Requirements: 1.1, 1.2, 1.5, 1.10, 1.11, 3.7, 15.3, 19.1, 19.3, 19.4, 19.7_

  - [ ] 10.3 Write engine example tests
    - `tests/simulation/engine.test.ts`: `stock-negative` with District_Code and first quarter (4.9), `non-finite` from an overflowing coefficient (12.10), `budget-exceeded` details (8.6), `ceiling-exceeded` details (18.6), `limit-exceeded` details (18.4), `step` on a state of 2025Q4, `runRange` error carries the Scenario name
    - _Requirements: 1.4, 4.9, 8.6, 12.10, 18.4, 18.6, 19.1_

- [ ] 11. Write the required invariant property tests
  - [ ] 11.1 Write property test for zero-delta identity
    - `tests/simulation/properties/zero-delta.property.test.ts`
    - **Property 1: Zero-delta identity**
    - **Validates: Requirements 2.3, 2.4, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8, 8.9, 13.10**

  - [ ] 11.2 Write property test for determinism
    - `tests/simulation/properties/determinism.property.test.ts`; second call on a `structuredClone` of every argument, for `run` and `runRange`
    - **Property 2: Determinism**
    - **Validates: Requirements 1.11, 17.7, 19.7**

  - [ ] 11.3 Write property test for no input mutation
    - `tests/simulation/properties/no-mutation.property.test.ts`; valid inputs and inputs with one `arbDefect`; covers `step`, `run`, `runRange`, `checkBudget` and `checkLimit`; no call throws
    - **Property 3: No input mutation**
    - **Validates: Requirements 1.10, 8.3, 15.3, 18.7**

  - [ ] 11.4 Write property test for the budget
    - `tests/simulation/properties/budget.property.test.ts`; accepts `budget-exceeded` and `ceiling-exceeded` as valid outcomes; asserts that at least 20 of the 100 cases were accepted runs; compares `checkBudget` with the step decision
    - **Property 4: Budget never overspent**
    - **Validates: Requirements 8.4, 8.5, 8.6, 8.10, 8.11, 18.6**

  - [ ] 11.5 Write property test for tool limits and ceilings
    - `tests/simulation/properties/limits.property.test.ts`; asserts that at least 20 of the 100 cases were accepted runs; `checkLimit` against the reference formula; a value one step outside a limit is rejected, never clipped
    - **Property 5: Tool limits and ceilings**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.7, 18.9**

  - [ ] 11.6 Write property test for bounded indicators
    - `tests/simulation/properties/bounded.property.test.ts`
    - **Property 6: Bounded indicators stay in 0–100**
    - **Validates: Requirements 12.1, 12.8**

  - [ ] 11.7 Write property test for counts and finiteness
    - `tests/simulation/properties/counts.property.test.ts`
    - **Property 7: Counts are non-negative integers and all numbers are finite**
    - **Validates: Requirements 10.3, 12.2, 12.6, 12.8, 12.9, 13.9**

  - [ ] 11.8 Write property test for Cause_Breakdown sums
    - `tests/simulation/properties/cause-sums.property.test.ts`
    - **Property 8: Cause breakdowns are complete and sum to the value**
    - **Validates: Requirements 2.1, 12.3, 12.4, 12.5, 12.7, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.11**

  - [ ] 11.9 Write property test for population conservation
    - `tests/simulation/properties/migration-conservation.property.test.ts`
    - **Property 10: Migration conserves population**
    - **Validates: Requirements 9.4, 9.5, 9.8**

  - [ ] 11.10 Write property test for event neutrality
    - `tests/simulation/properties/events-neutral.property.test.ts`; includes changing display-only Event fields and removing an Event without a modifier
    - **Property 18: Events never move indicators on their own**
    - **Validates: Requirements 11.1, 11.7, 11.8**

  - [ ] 11.11 Write property test for the Result_Range
    - `tests/simulation/properties/range-contains-central.property.test.ts`; includes the zero-delta case where `min === central === max`
    - **Property 24: The Result_Range contains the central result**
    - **Validates: Requirements 19.1, 19.3, 19.4, 19.5, 19.6**

- [ ] 12. Write the further property tests
  - [ ]* 12.1 Write property test for Cause links
    - `tests/simulation/properties/cause-links.property.test.ts`
    - **Property 9: Every Cause links to known parameters and sources**
    - **Validates: Requirements 5.8, 13.7, 14.8, 14.9**

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
    - `tests/simulation/properties/parameter-validation.property.test.ts`
    - **Property 20: Parameter validation lists every issue in a fixed order**
    - **Validates: Requirements 2.8, 7.8, 7.9, 8.8, 9.9, 10.4, 14.2, 14.3, 14.4, 14.5, 14.6, 18.8**

  - [ ]* 12.6 Write property test for input order and unused parameters
    - `tests/simulation/properties/input-order.property.test.ts`
    - **Property 21: Input order and unused parameters do not change results**
    - **Validates: Requirements 14.7, 16.5**

  - [ ]* 12.7 Write property test for run prefix and step agreement
    - `tests/simulation/properties/run-prefix.property.test.ts`
    - **Property 22: Run prefix and step agreement**
    - **Validates: Requirements 1.1, 1.2, 3.7**

- [ ] 13. Write example, extensibility and static tests
  - [ ] 13.1 Write the 44-quarter zero-delta example test
    - `tests/simulation/zero-delta-44.test.ts`: fixed synthetic 44-quarter Baseline; `run` to 2025Q4 returns 44 Sim_States whose values are `===` the Baseline and Derived_Baseline values
    - _Requirements: 3.1, 3.8_

  - [ ] 13.2 Write the stub-tool extensibility test
    - `tests/simulation/extensibility.test.ts`: a stub tool with one city field and one effect parameter is passed through `options.registry` without editing `engine.ts`, `lag.ts`, `budget.ts`, `migration.ts` or `explain.ts`; its Cause appears in the `rent` breakdowns with the expected value, and the zero-delta identity still holds with it
    - _Requirements: 16.3, 16.4_

  - [ ] 13.3 Write the static purity scan
    - `tests/simulation/purity.test.ts`: reads the files of `src/simulation/` and fails on imports from `src/ui`, `src/game`, `src/save` or `src/data`; on `document`, `window`, `fetch`, `localStorage`, `Date`, `performance`, `Math.random`; on a top-level `let` or `var`; on numeric literals in `rules/` other than 0, 1, 3, 4, 12 and 100; and on a `rules/` file that does not export exactly one rule
    - _Requirements: 1.6, 1.7, 1.8, 2.6, 14.1, 16.1_

- [ ] 14. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`; both must exit with code 0 with no test skipped, todo or `.only`. Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Implement the backtest
  - [ ] 15.1 Create `data/config/backtest-cases.json` and `scripts/backtest/cases.ts`
    - TPASS case: `id`, `tool`, `change` (`field`, `cities`, `firstQuarter` 2023Q3, `before` 1,280, `after` 1,200), `indicator` `mrtEntries`, `areas`, `evaluationQuarters`, `observed` (value from `history.json` by the Requirement 20.2 formula, `source`, `method`, `period`, `comparisonPeriod`, `confounders` including post-COVID-19 ridership recovery), `tolerances` (`ratioLow` 0.5, `ratioHigh` 2), `parametersChangedAfterOutcome: []`
    - If `public/data/history.json` is absent, stop and ask the user for the observed value instead of inventing one
    - `cases.ts` reads and validates the file; an invalid case becomes "not computed"
    - _Requirements: 20.1, 20.2, 20.4, 20.6_

  - [ ] 15.2 Implement `scripts/backtest/adapt.ts`
    - Convert `history.json`, `policy-track.json`, `params.json` and the commute matrix into `EngineBaseline`, `PolicyTimeline`, `ParameterTable` and `CommuteMatrix`; write `commuterPassPrice` into `commuterPass.price.<city>.<quarter>` parameters; a missing file is reported as `missing input: <file>`
    - _Requirements: 20.3, 20.7, 20.9_

  - [ ] 15.3 Implement `scripts/backtest/compute.ts`
    - Counterfactual Real_Policy_Track holds the changed field at its value before the change (pass price 1,280, subsidy 0) and is passed as the real track; the actual real track is passed as the Player_Policy_Timeline (subsidy 80); call `runRange` with `options.budgetMode = 'record'` (conflict C1) and an empty event list; simulated effect is the sum of the commuter pass Cause contributions in the `mrtEntries` breakdowns over the compared districts and quarters, as minimum, central and maximum; direction, magnitude ratio and range checks; absolute and relative error
    - _Requirements: 20.3, 20.4_

  - [ ] 15.4 Implement `scripts/backtest/report.ts`
    - Render `docs/BACKTEST.md` deterministically: one section per case with change, quarters, simulated Result_Range, observed effect with source, method and confounders, absolute and relative error, ratio, each check as "met" or "not met", the "validation" or "calibration" label with changed parameters, `ENGINE_VERSION` and a SHA-256 of `params.json` (Node `crypto`) as the Parameter_Table version; neutral wording, fixed decimals, LF line endings; a case that cannot be computed is written as "not computed" with its reason
    - _Requirements: 20.5, 20.6, 20.7, 20.9_

  - [ ] 15.5 Implement `scripts/backtest.ts`, add the npm script and generate the report
    - Add `"backtest": "node scripts/backtest.ts"` to `package.json`; wire cases, adapt, compute and report; print `case <id>: not computed: <reason>` on failure; exit 0 when every case was computed (including "not met"), non-zero after writing the report when any case is "not computed"
    - Run `npm run backtest` once to write `docs/BACKTEST.md` (until `params.json` and the matrix exist the TPASS case is "not computed: missing input")
    - _Requirements: 20.7, 20.9_

  - [ ]* 15.6 Write unit tests for the backtest modules
    - `tests/scripts/backtest/report.test.ts` (byte-identical output, LF endings, "not computed" section) and `tests/scripts/backtest/compute.test.ts` (counterfactual track, `budgetMode: 'record'` call, the three checks) on fixture inputs
    - _Requirements: 20.3, 20.4, 20.5, 20.7_

  - [ ] 15.7 Write the backtest staleness test
    - `tests/simulation/backtest-report.test.ts`: recomputes every case and compares the numbers with `docs/BACKTEST.md`; when inputs are missing it compares the "not computed: missing input" text, so it passes without being skipped and still detects a stale report; excluded from Requirement 17.6
    - _Requirements: 20.8_

- [ ] 16. Final checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`, report both exit codes; both must be 0 with no test skipped, todo or `.only`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Required (not optional): the tests Requirement 17 demands, namely Properties 1 to 8, 10, 11, 18, 23 and 24, one example test per rule file and for the Migration_Rule, the 44-quarter example, the stub-tool test, the purity scan, the readonly type test, the engine example tests and the backtest staleness test.
- Task 1.1 is already done: `tsconfig.json` includes `src` and `fast-check` 4.10.2 is pinned. The `backtest` script does not exist yet and is added in task 15.5.
- Each property test implements exactly one design property, uses `numRuns: 100` or more and carries the comment `// Feature: simulation-engine, Property <n>: <title>`; fast-check prints the shrunk counterexample, seed and path on failure (Requirement 17.9).
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
    { "id": 9, "tasks": ["10.3", "11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8", "11.9", "11.10", "11.11", "12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "13.1", "13.2", "13.3", "15.3"] },
    { "id": 10, "tasks": ["15.4"] },
    { "id": 11, "tasks": ["15.5"] },
    { "id": 12, "tasks": ["15.6", "15.7"] }
  ]
}
```
