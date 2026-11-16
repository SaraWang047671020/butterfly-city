# Requirements Document

## Introduction

The simulation engine is the pure core of Butterfly City, in `src/simulation/`. It computes, for each of the 41 districts and each of the 44 quarters from 2015Q1 to 2025Q4, the player's city as:

> player's city = real baseline + lagged effect of the difference between the player's policies and the real policies + inter-district linkage (migration)

Inputs, all passed as arguments:

- the real quarterly baseline from `history.json` (built by the data-pipeline spec);
- the parameter table from `params.json`;
- the real policy track for the supported tools;
- the player's policy settings per quarter (the policy timeline);
- the event list;
- the 41×41 commute-time matrix.

Outputs: every indicator for every district and quarter, and a cause breakdown of each value for the "Why?" view.

This spec covers only 3 of the 8 policy tools: **social housing construction**, **commuter pass subsidy** and **rent subsidy**. The other 5 tools are added later. The engine is structured so that a new tool is added as a new rule file and a registry entry.

The engine follows `simulation.md`: pure functions, no DOM, no network, no storage, no clock, no unseeded randomness, no module-level mutable state, readonly inputs, all parameters from the parameter table, and the 8 invariants tested with fast-check.

### Out of scope

- The other 5 policy tools (sublease and rental management, holding tax, MRT extension, TOD floor-area bonus, parks and green space), including holding-tax revenue flowing back into the budget.
- Future mode and Live mode. Seeded randomness is accepted as an input but no rule in this spec uses it.
- Building `params.json`, the real policy track file and the commute-time matrix. This spec defines their in-memory types and the engine's checks of them; producing the files is a separate data task (see Open Questions).
- Loading and validating JSON files (`src/data/`), turn flow and fast-forward (`src/game/`), saves (`src/save/`), narrative text (`src/narrative/`) and all UI.

## Glossary

- **Engine**: the set of pure functions in `src/simulation/`, entered through `engine.ts`.
- **Step_Function**: the Engine function `step(state, policies, events, params) -> nextState` that advances a Sim_State by one quarter.
- **Run_Function**: the Engine function that applies the Step_Function from 2015Q1 up to a given Quarter_Key and returns every Sim_State along the way.
- **Sim_State**: the immutable state of the simulated city at the end of one quarter: the Quarter_Key, every Output_Indicator value per district, the Lag_Pipeline contents, the Budget_Ledger and the Cause_Breakdowns.
- **District_Code**: the official 8-digit administrative code of a district, as used in `history.json`.
- **Quarter_Key**: a string `YYYYQn` from `2015Q1` to `2025Q4`.
- **Baseline**: the real per-district, per-quarter indicator values read from `history.json` and passed to the Engine as an argument.
- **Source_Id**: the id of a data source in the source registry of `history.json` (the Baseline source registry).
- **Derived_Baseline**: an indicator value that the Engine computes from Baseline values only (for example rent burden from rent and household income), with all Policy_Deltas equal to zero.
- **Output_Indicator**: an indicator the Engine reports per district and quarter. Each Output_Indicator has an id, a unit and a kind (count, bounded 0–100, or unbounded non-negative).
- **Bounded_Indicator**: an Output_Indicator whose unit is a percentage or a 0–100 index.
- **Count_Indicator**: an Output_Indicator that counts persons, households, housing units or ghosts.
- **Policy_Tool**: one of the player-adjustable tools. In this spec: Social_Housing_Tool, Commuter_Pass_Tool and Rent_Subsidy_Tool.
- **Social_Housing_Tool**: the number of social housing units the player starts building per district per quarter.
- **Commuter_Pass_Tool**: the subsidy, in TWD per pass per month, the player pays toward a monthly commuter pass, per city per quarter.
- **Rent_Subsidy_Tool**: the number of renter households receiving a rent subsidy and the subsidy amount in TWD per household per month, per city per quarter.
- **Stock_Effect_Tool**: a Policy_Tool whose Policy_Difference changes a stock that persists. In this spec: the Social_Housing_Tool. The Policy_Delta of a Policy_Difference committed in quarter q applies in quarter q + Lag and every later quarter.
- **Flow_Effect_Tool**: a Policy_Tool whose Policy_Setting is a per-quarter level. In this spec: the Commuter_Pass_Tool and the Rent_Subsidy_Tool. The Policy_Difference committed in quarter q produces the Policy_Delta of quarter q + Lag; each later quarter t takes its Policy_Delta from the Policy_Difference committed in quarter t − Lag.
- **Policy_Setting**: the values of all Policy_Tools for one quarter.
- **Policy_Maximum**: the largest value the Parameter_Table allows for a Policy_Tool field (for example social housing units started per district per quarter).
- **Real_Policy_Track**: the Policy_Settings that actually happened in each quarter from 2015Q1 to 2025Q4, passed to the Engine as an argument.
- **Player_Policy_Timeline**: the player's Policy_Settings for each quarter.
- **Policy_Difference**: for one Policy_Tool, district or city, and quarter, the player's value minus the Real_Policy_Track value.
- **Policy_Delta**: the change in an Output_Indicator caused by Policy_Differences, before migration.
- **Lag_Pipeline**: the part of Sim_State that holds Policy_Differences committed in earlier quarters whose effects have not yet started.
- **Lag**: the number of quarters between committing a Policy_Difference and the start of its effect, taken from the Parameter_Table.
- **Cost_Schedule**: a Parameter_Table entry for a Policy_Tool that lists quarter offsets (integers from 0 to 43) and the share of the total cost charged at each offset, with shares summing to 1.
- **Migration_Rule**: the Engine rule that moves population between districts using the Commute_Matrix.
- **Commute_Matrix**: the 41×41 matrix of commute times in minutes between district pairs, passed to the Engine as an argument.
- **Event**: an entry from the event list with a real date, type, affected indicators and a cited magnitude.
- **Parameter_Table**: the typed contents of `params.json`. Each Parameter has `value`, `unit`, `source` (citation and URL) and an optional `range` with `low` and `high` and their sources.
- **Annual_Budget**: for one calendar year, the real total spending on the supported Policy_Tools in that year, from the Real_Policy_Track and the Parameter_Table unit costs.
- **Budget_Ledger**: the part of Sim_State that records committed spending per Policy_Tool per quarter and the remaining Annual_Budget of the current year.
- **Ghost**: a simulated unit of residents, one per Ghost_Size residents, who cross a cited rent-burden or commute-time threshold or are displaced by migration.
- **Ghost_Size**: the number of residents one Ghost represents, a Parameter (default 1,000).
- **Cause**: one contributor to an Output_Indicator value: the Baseline, one Policy_Tool's Policy_Delta, one Event's interaction with a Policy_Delta, migration, or a bound adjustment.
- **Cause_Breakdown**: the list of Causes and their signed contributions for one Output_Indicator, district and quarter. Each Cause links to the Parameter ids or Source_Ids it depends on.
- **Bound_Adjustment**: the Cause that records the reported value minus the computed value, covering both limiting a value to its allowed range and rounding a Count_Indicator to an integer.
- **Engine_Error**: a typed error result returned by the Engine instead of a Sim_State when inputs break a stated precondition.
- **Rule_Registry**: the list in `src/simulation/` that names every Policy_Tool rule and every Output_Indicator the Engine computes.

## Requirements

### Requirement 1: Pure engine interface

**User Story:** As the developer, I want the engine to be a set of pure functions, so that the same inputs always give the same city and the engine can be tested without a browser.

#### Acceptance Criteria

1. THE Engine SHALL expose a Step_Function that takes a Sim_State, a Player_Policy_Timeline, an event list, a Parameter_Table, the Baseline, the Real_Policy_Track and the Commute_Matrix as arguments, and returns either a Sim_State whose Quarter_Key is exactly one quarter after the Quarter_Key of the input Sim_State (2015Q4 is followed by 2016Q1) or an Engine_Error.
2. THE Engine SHALL expose a Run_Function that takes the same inputs as the Step_Function plus a target Quarter_Key, and returns either a list of Sim_States in chronological order containing exactly one Sim_State for each quarter from 2015Q1 to the target Quarter_Key inclusive (1 Sim_State for target 2015Q1, 44 Sim_States for target 2025Q4), or the first Engine_Error together with the Quarter_Key at which that Engine_Error occurred and no Sim_States.
3. IF the target Quarter_Key passed to the Run_Function does not match the form `YYYYQn` with n from 1 to 4, or lies before 2015Q1 or after 2025Q4, THEN THE Run_Function SHALL return an Engine_Error that names the received Quarter_Key and the allowed range 2015Q1 to 2025Q4, without computing any Sim_State.
4. IF the Step_Function is called with a Sim_State whose Quarter_Key is 2025Q4, THEN THE Step_Function SHALL return an Engine_Error indicating that no later quarter exists.
5. IF any input breaks a precondition stated in this specification, THEN THE Step_Function and the Run_Function SHALL return an Engine_Error value that identifies the broken precondition, and SHALL NOT throw an exception or return a partial Sim_State.
6. THE Engine SHALL obtain every input through function arguments, and no module in `src/simulation/` SHALL read any value from a source other than its function arguments and its own constant declarations.
7. THE modules in `src/simulation/` SHALL import nothing from `src/ui/`, `src/game/`, `src/save/` or `src/data/`.
8. THE modules in `src/simulation/` SHALL contain no reference to the DOM, `fetch`, `localStorage`, `Date`, `performance.now` or `Math.random`, and no module-level variable that is reassigned or mutated after module load.
9. THE Engine SHALL declare every property of every input parameter type as `readonly` and every array or nested array in those types as a `readonly` array, at every nesting level.
10. WHEN the Step_Function or the Run_Function returns, whether with a Sim_State, a list of Sim_States or an Engine_Error, THE Engine SHALL leave every argument deep-equal to its value before the call.
11. WHEN the Step_Function or the Run_Function is called twice with deep-equal arguments, THE Engine SHALL return deep-equal results on both calls, including deep-equal Engine_Errors.

### Requirement 2: Core formula

**User Story:** As a player, I want my city to start from the real city and change only because of my choices, so that the comparison with reality is fair.

#### Acceptance Criteria

1. THE Engine SHALL compute each Output_Indicator value for a district and quarter as the starting value, plus the sum of the Policy_Deltas whose Lag has elapsed, plus the migration contribution, plus the Bound_Adjustment. The starting value is the Baseline value if the Output_Indicator is present in the Baseline, and the Derived_Baseline value otherwise.
2. THE Engine SHALL treat the Lag of a Policy_Difference committed in quarter q with Lag L as elapsed in quarter q + L and as not elapsed in every quarter before q + L. For a Stock_Effect_Tool, the Policy_Delta from that Policy_Difference SHALL apply in quarter q + L and every later quarter up to 2025Q4. For a Flow_Effect_Tool, that Policy_Difference SHALL produce the Policy_Delta of quarter q + L, and each later quarter t SHALL take its Policy_Delta from the Policy_Difference committed in quarter t − L. A Lag of 0 means the effect starts in quarter q.
3. THE Engine SHALL compute every Policy_Delta from Policy_Differences only, so that a Policy_Difference of zero for a Policy_Tool in every district (or city) and every quarter up to the current quarter produces a Policy_Delta of exactly zero (not merely within a floating-point tolerance) for that Policy_Tool.
4. THE Engine SHALL compute the migration contribution of a district from the differences between the simulated and Derived_Baseline values of rent burden and mean commute time, in that district and in each of the other 40 districts in the Commute_Matrix. A district whose own and other 40 districts' Policy_Deltas are exactly zero for every Output_Indicator in the quarter SHALL receive a migration contribution of exactly zero.
5. THE Engine SHALL report at least these Output_Indicators per district and quarter, each with its id, unit and kind: population in persons (count), rent in TWD per m² per month (unbounded non-negative), rent burden in percent of household income (bounded 0–100), social housing stock in units (count), MRT entries per quarter (count), mean commute time in minutes (unbounded non-negative), and Ghost count (count).
6. THE Engine SHALL take the reference dwelling size used to convert rent per m² into monthly rent, the household income used for rent burden, and every coefficient in the formula from the Baseline or the Parameter_Table. Rule logic SHALL contain no numeric literal other than 0 and 1 as identity values, 0 and 100 as the bounds of Bounded_Indicators and the percent conversion factor, and the unit conversions 3 months per quarter, 4 quarters per year and 12 months per year.
7. IF the Baseline lacks a value needed for a district and quarter, or a needed Baseline value is `null`, non-finite or negative, THEN THE Engine SHALL return an Engine_Error naming the indicator id, the District_Code and the Quarter_Key, and SHALL return no Sim_State for that quarter or any later quarter.
8. IF a Lag in the Parameter_Table fails the checks of Requirement 7.8 or 7.9, THEN THE Engine SHALL return the Engine_Error defined there and SHALL return no Sim_State.

### Requirement 3: Zero-delta identity

**User Story:** As the developer, I want the engine to reproduce reality exactly when the player changes nothing, so that every simulated difference is caused by the player.

#### Acceptance Criteria

1. WHEN the Run_Function is called up to 2025Q4 with a Baseline covering 2015Q1 to 2025Q4 and a Player_Policy_Timeline that equals the Real_Policy_Track for every Policy_Tool and every quarter from 2015Q1 to 2025Q4, THE Engine SHALL return 44 Sim_States, one for each quarter from 2015Q1 to 2025Q4, and SHALL NOT return an Engine_Error.
2. WHEN the Player_Policy_Timeline equals the Real_Policy_Track for every Policy_Tool and every quarter, THE Engine SHALL produce, for each of the 41 districts, each computed quarter and each Output_Indicator that has a value in the Baseline for that district and quarter, a value exactly equal (`===`) to that Baseline value, with no rounding or tolerance.
3. WHEN the Player_Policy_Timeline equals the Real_Policy_Track for every Policy_Tool and every quarter, THE Engine SHALL produce, for each district, each computed quarter and each Output_Indicator that is not in the Baseline (including Ghost counts), a value exactly equal (`===`) to the Derived_Baseline value for that district and quarter.
4. WHEN the Player_Policy_Timeline equals the Real_Policy_Track for every Policy_Tool and every quarter, THE Engine SHALL produce, for each district, quarter and Output_Indicator, a Cause_Breakdown in which every Cause other than the Baseline (each Policy_Tool's Policy_Delta, each Event interaction, migration, the Ghost group Causes of Requirement 10.6 and Bound_Adjustment) contributes a value that compares `=== 0`, so 0 and -0 both pass.
5. WHEN the Player_Policy_Timeline equals the Real_Policy_Track for every Policy_Tool and every quarter, THE Engine SHALL produce Cause_Breakdowns in which the Baseline Cause contribution is exactly equal (`===`) to the reported Output_Indicator value.
6. WHEN the Player_Policy_Timeline equals the Real_Policy_Track for every Policy_Tool and every quarter, THE Engine SHALL produce, in every Sim_State, a Lag_Pipeline in which every held Policy_Difference equals 0, and a Budget_Ledger in which the committed spending per Policy_Tool per quarter equals the spending implied by the Real_Policy_Track, the Parameter_Table unit costs and the Cost_Schedule.
7. WHEN the Run_Function is called with a Player_Policy_Timeline equal to the Real_Policy_Track and a target Quarter_Key between 2015Q1 and the last quarter of the Baseline, THE Engine SHALL return Sim_States that are identical, quarter by quarter, to the first Sim_States of the run up to the last quarter of the Baseline. The number of Sim_States SHALL equal the number of quarters from 2015Q1 to the target quarter.
8. FOR ALL event lists of 0 to 10 Events, Parameter_Tables whose values lie within their declared `range` (low to high inclusive), random seeds, and synthetic Baselines covering all 41 District_Codes and 1 to 8 consecutive quarters starting at 2015Q1 with finite non-negative values in which every Bounded_Indicator value lies between 0 and 100 inclusive, WHEN the Run_Function is called up to the last generated quarter with a Player_Policy_Timeline equal to the Real_Policy_Track, THE Engine SHALL return one Sim_State per generated quarter and no Engine_Error, and SHALL satisfy criteria 2 to 7. This SHALL be checked by a fast-check property-based test with at least 100 generated cases. Criterion 1 SHALL be checked by an example-based test on a synthetic 44-quarter Baseline.

### Requirement 4: Social housing construction tool

**User Story:** As a player, I want to build more or fewer social housing units than were really built, so that I can see how housing supply changes rent and who is left behind.

#### Acceptance Criteria

1. THE Social_Housing_Tool SHALL accept, for each of the 41 District_Codes and each Quarter_Key from 2015Q1 to 2025Q4, a number of units started as an integer from 0 to the Social_Housing_Tool Policy_Maximum in the Parameter_Table inclusive.
2. IF a Player_Policy_Timeline contains a Social_Housing_Tool value that is not an integer, is negative, is greater than the Social_Housing_Tool Policy_Maximum, or refers to a District_Code not in the Baseline, THEN THE Engine SHALL return an Engine_Error naming the Policy_Tool, the District_Code and the Quarter_Key, and SHALL return no Sim_State for that call.
3. WHEN the Step_Function processes a quarter, THE Engine SHALL record in the Lag_Pipeline, for each district, the Policy_Difference equal to the player's units started minus the Real_Policy_Track units started for that district and quarter, including Policy_Differences that are negative or zero.
4. WHEN the construction Lag from the Parameter_Table, a whole number of quarters, has elapsed since the quarter in which a Policy_Difference was recorded, THE Engine SHALL add that Policy_Difference to the district's social housing stock Output_Indicator in that quarter and in every later quarter up to 2025Q4, and SHALL remove it from the Lag_Pipeline.
5. WHILE a recorded Policy_Difference's construction Lag has not elapsed by 2025Q4, THE Engine SHALL keep that Policy_Difference in the Lag_Pipeline and SHALL leave the social housing stock Output_Indicator unchanged by it.
6. WHEN a district's social housing stock differs from the Baseline stock in a quarter, THE Engine SHALL change the district's rent Output_Indicator in that quarter by the stock difference in units multiplied by the rent-per-unit coefficient from the Parameter_Table, and SHALL record that change as the Social_Housing_Tool Cause in the rent Cause_Breakdown for that district and quarter, linked to the rent-per-unit coefficient Parameter id.
7. IF applying the rent change in criterion 6 would make a district's rent Output_Indicator negative, THEN THE Engine SHALL set the rent Output_Indicator to 0 and SHALL record the bounded value minus the computed value as a Bound_Adjustment Cause in that Cause_Breakdown, as defined in Requirement 12.3.
8. WHEN the Step_Function records a Policy_Difference in units started in quarter q, THE Engine SHALL compute a total cost equal to the Policy_Difference multiplied by the unit construction cost from the Parameter_Table, rounded once to whole TWD as in Requirement 8.2, and SHALL split that total into whole-TWD charges at the quarters q + offset given by the Social_Housing_Tool Cost_Schedule, with the last charge absorbing any rounding remainder so that the charges sum exactly to the total. A negative Policy_Difference SHALL produce negative charges. Each charge SHALL be recorded in the Social_Housing_Tool entry of the Budget_Ledger for its own quarter, and a charge whose quarter is after 2025Q4 SHALL be recorded in 2025Q4.
9. IF a player change would make the social housing stock of a district negative in any quarter, THEN THE Engine SHALL return an Engine_Error naming the District_Code and the first Quarter_Key in which the stock is negative, and SHALL return no Sim_State for that call.
10. WHEN every Social_Housing_Tool Policy_Difference is zero for all districts and quarters, THE Engine SHALL produce social housing stock and rent Output_Indicator values equal to the Baseline values for every district and quarter, and a Social_Housing_Tool Budget_Ledger entry equal to the Real_Policy_Track charges in every quarter.

### Requirement 5: Commuter pass subsidy tool

**User Story:** As a player, I want to change the commuter pass subsidy, so that I can see how cheaper transit changes ridership, commute choices and where people live.

#### Acceptance Criteria

1. THE Commuter_Pass_Tool SHALL accept, per city and per quarter from 2015Q1 to 2025Q4, a subsidy in TWD per pass per month as a finite number from 0 up to and including the pass price for that city and quarter in the Parameter_Table, which is the Commuter_Pass_Tool Policy_Maximum.
2. IF a Player_Policy_Timeline Commuter_Pass_Tool value is negative, non-finite, missing, or greater than the pass price for that city and quarter in the Parameter_Table, THEN THE Engine SHALL return an Engine_Error that identifies the city, the Quarter_Key and the rejected value, and SHALL return no Sim_State for that run.
3. WHEN the Engine computes quarter t and t − Lag is a quarter from 2015Q1 onward, where Lag is the Commuter_Pass_Tool Lag from the Parameter_Table, THE Engine SHALL, as a Flow_Effect_Tool (Requirement 2.2), change the MRT entries Output_Indicator of each district in that city in quarter t by the Baseline MRT entries of that district and quarter t, multiplied by the ridership elasticity from the Parameter_Table, multiplied by the relative change in the net pass price of quarter t − Lag. The relative change equals (player net pass price − real net pass price) ÷ real net pass price, and the net pass price equals the pass price minus the subsidy.
4. IF the real net pass price for a city and quarter is 0, THEN THE Engine SHALL return an Engine_Error that identifies the city and Quarter_Key, and SHALL return no Sim_State for that run.
5. WHEN the Engine computes quarter t and t − Lag is a quarter from 2015Q1 onward, THE Engine SHALL, in quarter t, lower the monthly commute cost used by the Migration_Rule by the Commuter_Pass_Tool Policy_Difference of quarter t − Lag in TWD, for every district pair whose origin district is in that city. A negative Policy_Difference raises that cost by the same amount.
6. WHEN a quarter is stepped, THE Engine SHALL charge to the Budget_Ledger, in the same quarter as the Player_Policy_Timeline subsidy value, a Commuter_Pass_Tool cost equal to the Policy_Difference × the adjusted number of passes sold × 3 months. The adjusted number of passes sold equals the Real_Policy_Track passes sold for that city and quarter × (1 + ridership elasticity × relative change in the net pass price of that quarter as defined in criterion 3), with a minimum of 0.
7. IF applying a Commuter_Pass_Tool Policy_Delta would make a district's MRT entries Output_Indicator negative, THEN THE Engine SHALL report the value as 0 and record the bounded value minus the computed value as a Bound_Adjustment Cause in that district's and quarter's Cause_Breakdown.
8. WHEN a Commuter_Pass_Tool Policy_Delta changes the MRT entries Output_Indicator of a district in a quarter, THE Engine SHALL add a Cause for the Commuter_Pass_Tool to that district's and quarter's MRT entries Cause_Breakdown. The Cause SHALL hold the signed contribution and link to the Parameter ids of the Lag, ridership elasticity and pass price.
9. IF a district has no active station in a quarter, meaning its Baseline MRT entries for that quarter are 0 or absent, THEN THE Engine SHALL report the MRT entries Output_Indicator of that district and quarter as 0 and SHALL record the Commuter_Pass_Tool Cause in its MRT entries Cause_Breakdown with a contribution of 0.

### Requirement 6: Rent subsidy tool

**User Story:** As a player, I want to change how many renter households get a rent subsidy and how much, so that I can see who it helps and how much it costs.

#### Acceptance Criteria

1. THE Rent_Subsidy_Tool SHALL accept, per city (Taipei City and New Taipei City) and per quarter from 2015Q1 to 2025Q4, a number of subsidized households as a finite non-negative integer and a subsidy amount in TWD per household per month as a finite non-negative number no greater than the Rent_Subsidy_Tool amount Policy_Maximum in the Parameter_Table.
2. WHEN the player sets a Rent_Subsidy_Tool value for a city and quarter, THE Engine SHALL compute the Policy_Difference in total monthly subsidy for that city and quarter, equal to (player households × player amount) minus (Real_Policy_Track households × Real_Policy_Track amount), in TWD per month, and SHALL record it in the Lag_Pipeline as defined in Requirement 7.4.
3. WHEN the Engine computes quarter t and t − Lag is a quarter from 2015Q1 onward, where Lag is the Rent_Subsidy_Tool Lag from the Parameter_Table, THE Engine SHALL, as a Flow_Effect_Tool (Requirement 2.2), allocate the city's Policy_Difference in total monthly subsidy of quarter t − Lag to each district of that city in proportion to the district's renter household share from the Parameter_Table or Baseline, where the shares of the districts of one city sum to 1.
4. WHEN the Engine computes quarter t and t − Lag is a quarter from 2015Q1 onward, THE Engine SHALL change the rent burden Output_Indicator of each district in that city in quarter t by minus (the district's allocated subsidy difference ÷ (the district's household count × the district's monthly household income)) × 100 percentage points, and SHALL record that change as the Rent_Subsidy_Tool Cause in the district's rent burden Cause_Breakdown with links to the Lag, renter household share and household income Parameter ids or Source_Ids.
5. IF a Rent_Subsidy_Tool Policy_Delta would make a district's rent burden below 0 or above 100 percent, THEN THE Engine SHALL limit the rent burden to that range and record the bounded value minus the computed value as a Bound_Adjustment in the district's rent burden Cause_Breakdown.
6. WHERE the Parameter_Table gives a rent pass-through rate for rent subsidies, WHEN the Engine computes quarter t and t − Lag is a quarter from 2015Q1 onward, THE Engine SHALL change the rent Output_Indicator of each district in that city in quarter t by the pass-through rate × (the district's allocated subsidy difference ÷ (the district's renter household count × the reference dwelling size in m²)) TWD per m² per month, and SHALL record that change as the Rent_Subsidy_Tool Cause in the district's rent Cause_Breakdown.
7. WHERE the Parameter_Table gives no rent pass-through rate for rent subsidies, THE Engine SHALL apply a Rent_Subsidy_Tool contribution of exactly 0 to the rent Output_Indicator of every district.
8. THE Engine SHALL charge the cost of a Rent_Subsidy_Tool Policy_Difference, equal to the Policy_Difference in total monthly subsidy multiplied by 3 months (negative when the player spends less than the Real_Policy_Track), to the Budget_Ledger under the Rent_Subsidy_Tool in the quarter of the Policy_Setting, independent of the Lag.
9. IF the number of subsidized households in a city for a quarter exceeds the number of renter households in that city for that quarter from the Baseline or Parameter_Table, THEN THE Engine SHALL return an Engine_Error naming the city, the Quarter_Key and both numbers, and SHALL return no Sim_State for that quarter.
10. IF a Rent_Subsidy_Tool value is negative, not finite, above its Policy_Maximum, or (for the number of subsidized households) not an integer, THEN THE Engine SHALL return an Engine_Error naming the city, the Quarter_Key and the invalid field, and SHALL return no Sim_State for that quarter.
11. IF the monthly household income, household count, renter household count or renter household share needed for a district in criteria 3 to 6 is missing, `null`, or (for income and counts used as divisors) less than or equal to 0, THEN THE Engine SHALL return an Engine_Error naming the indicator or Parameter id, the District_Code and the Quarter_Key.

### Requirement 7: Time lags

**User Story:** As a player, I want policy effects to arrive after realistic delays, so that I learn that some choices take years to matter.

#### Acceptance Criteria

1. THE Engine SHALL take the Lag of every supported Policy_Tool (Social_Housing_Tool, Commuter_Pass_Tool and Rent_Subsidy_Tool) from the `value` field of that tool's Lag Parameter in the Parameter_Table, never from the Parameter's `range`, and each Lag Parameter SHALL have a non-empty `source` citation.
2. THE Engine SHALL accept for the Social_Housing_Tool only a construction Lag value from 12 to 20 quarters inclusive (3 to 5 years), as given by the Parameter_Table.
3. WHEN a non-zero Policy_Difference is committed in quarter q with a Lag of L quarters, THE Engine SHALL apply no Policy_Delta from that Policy_Difference in any quarter before q + L. From quarter q + L the Engine SHALL apply its Policy_Delta as defined in Requirement 2.2: in quarter q + L and every later quarter up to 2025Q4 for a Stock_Effect_Tool, and in quarter q + L for a Flow_Effect_Tool. A Lag of 0 means the Policy_Delta applies from quarter q itself.
4. WHEN a non-zero Policy_Difference with a Lag of L ≥ 1 is committed in quarter q, THE Engine SHALL add an entry to the Lag_Pipeline recording the Policy_Tool, the district or city, quarter q, the Policy_Difference value and the effect quarter q + L. The Engine SHALL remove that entry from the Lag_Pipeline in the Sim_State of quarter q + L, the quarter its Policy_Delta first applies.
5. WHEN Policy_Differences for the same Policy_Tool and district or city are committed in more than one quarter, THE Engine SHALL treat each one as a separate Lag_Pipeline entry with its own effect quarter. A later Policy_Difference SHALL NOT change the effect quarter or the value of an earlier entry.
6. WHEN the effect quarter q + L of a Policy_Difference is after 2025Q4, THE Engine SHALL keep the Policy_Difference in the Lag_Pipeline of every Sim_State through 2025Q4, SHALL apply no Policy_Delta from it in any quarter, and SHALL still charge its cost to the Budget_Ledger as defined in criterion 7.
7. WHEN spending for a Policy_Tool is committed in quarter q, THE Engine SHALL record the full amount in the Budget_Ledger for quarter q, whatever the Lag of that Policy_Tool, except where the Parameter_Table gives a Cost_Schedule for that Policy_Tool. Where a Cost_Schedule applies, THE Engine SHALL record each scheduled charge in its own quarter as defined in Requirement 4.8, and that charge SHALL count against the Annual_Budget of the calendar year of that quarter.
8. IF the Parameter_Table has no Lag Parameter for a supported Policy_Tool, or a Lag value is not an integer from 0 to 43 quarters inclusive, or a Lag Parameter has an empty or missing `source`, THEN THE Engine SHALL return an Engine_Error naming the Parameter id and SHALL return no Sim_State.
9. IF the Social_Housing_Tool Lag value is an integer from 0 to 43 but outside 12 to 20 quarters, THEN THE Engine SHALL return an Engine_Error naming the Parameter id and stating the allowed range of 12 to 20 quarters, and SHALL return no Sim_State.

### Requirement 8: Budget

**User Story:** As a player, I want a fixed yearly budget that I can reallocate but never exceed, so that every choice has a real trade-off.

#### Acceptance Criteria

1. THE Engine SHALL compute the Annual_Budget of each calendar year from 2015 to 2025 as the sum of the charges that the Real_Policy_Track produces for the 3 supported Policy_Tools in that year's 4 quarters, using the Parameter_Table unit costs and counting each Cost_Schedule charge in the quarter where it falls (Requirement 7.7).
2. THE Engine SHALL compute the spending of one Policy_Tool in one quarter as its Policy_Setting values multiplied by the Parameter_Table unit costs, rounded once to the nearest whole TWD with halves rounded up, and SHALL count each resulting charge against the calendar year of the quarter in which the charge is recorded.
3. THE Engine SHALL expose a budget check function in `budget.ts` that takes a proposed Policy_Setting for one Quarter_Key, the Budget_Ledger and the Parameter_Table. The function SHALL have no side effects and SHALL return the same result for the same inputs.
4. WHEN the budget check function is given a proposed Policy_Setting whose charges, added to the committed spending already recorded for each calendar year the charges fall in, keep every such year at or below its Annual_Budget, THE Engine SHALL return an acceptance that contains, for the calendar year of the proposed Quarter_Key, the year, the Annual_Budget, the committed spending including the proposed Policy_Setting, and the remaining Annual_Budget.
5. IF the budget check function is given a proposed Policy_Setting whose charges, added to the committed spending already recorded for a calendar year the charges fall in, exceed that year's Annual_Budget by 1 TWD or more, THEN THE Engine SHALL return a rejection that contains the earliest such year, its Annual_Budget, its committed spending including the proposed Policy_Setting, and the amount over budget in whole TWD.
6. IF a Policy_Setting passed to the Step_Function would make the committed spending of any calendar year greater than that year's Annual_Budget, THEN THE Engine SHALL return an Engine_Error that contains the year, the Annual_Budget, the committed spending and the amount over budget, and SHALL leave the input Sim_State unchanged.
7. WHEN the Step_Function advances a Sim_State into a Q1 Quarter_Key, THE Engine SHALL set the remaining Annual_Budget in the Budget_Ledger to the Annual_Budget of the new calendar year minus the Cost_Schedule charges already recorded into that year, and SHALL NOT carry unspent budget from the previous year into it.
8. IF the Parameter_Table has no unit cost for a supported Policy_Tool, or a unit cost is not a finite number greater than 0, THEN THE Engine SHALL return an Engine_Error that names the missing or invalid Parameter id, without computing any Annual_Budget.
9. WHEN the Player_Policy_Timeline equals the Real_Policy_Track, THE Engine SHALL record committed spending equal to the Annual_Budget for every year from 2015 to the last computed year, within a tolerance of 1 TWD.
10. FOR ALL Player_Policy_Timelines and event lists, THE Engine SHALL return Sim_States in which the committed spending of every calendar year, including Cost_Schedule charges recorded into that year, is less than or equal to that year's Annual_Budget (property-based test).
11. THE Engine SHALL represent every money value in the Budget_Ledger, the Annual_Budget and the budget check results as an integer number of TWD, so that budget comparisons are exact integer comparisons.

### Requirement 9: Inter-district migration

**User Story:** As a player, I want people to move between districts when rent or commuting changes, so that I see how a policy in one district affects its neighbours.

#### Acceptance Criteria

1. WHEN the Step_Function advances a Sim_State by one quarter and a district's simulated rent burden for that quarter, after that quarter's Policy_Deltas are applied, exceeds its Derived_Baseline rent burden by strictly more than the migration threshold Parameter (in percentage points), THE Migration_Rule SHALL move out of that district a number of persons equal to the migration share Parameter (a value from 0 to 1) multiplied by the district's population at the start of the quarter, rounded down to a whole number.
2. WHEN a district's simulated rent burden exceeds its Derived_Baseline rent burden by no more than the migration threshold Parameter, or is below it, THE Migration_Rule SHALL move zero persons out of that district in that quarter.
3. THE Migration_Rule SHALL distribute the persons moved out of an origin district only across the other 40 districts. It SHALL use weights that strictly decrease as the Commute_Matrix commute time from the origin increases and strictly decrease as the destination's simulated rent burden increases. It SHALL use only Parameters from the Parameter_Table, and it SHALL give every destination a whole, non-negative number of persons.
4. THE Migration_Rule SHALL make the persons moved out of all origin districts in a quarter equal the persons moved into all destination districts plus the persons who exit the metro area. The exit count SHALL be the metro-exit share Parameter (a value from 0 to 1) multiplied by the persons moved out, rounded down to a whole number.
5. FOR ALL Player_Policy_Timelines and event lists, THE Engine SHALL produce for every quarter a total population across the 41 districts equal to the Baseline total population plus the cumulative policy-caused net change. Migration SHALL contribute exactly zero to that total, except for the metro-area exit defined in criterion 4 (property-based test).
6. THE Migration_Rule SHALL compute every district's out-movement and allocation in a quarter from the same start-of-quarter populations and rent burdens. Two runs with the same inputs SHALL then produce identical per-district migration counts regardless of the order in which districts are processed (property-based test).
7. THE Engine SHALL record, for each district and quarter, the number of persons the Migration_Rule moved out of that district as displaced, for use by the Ghost rule. That number SHALL equal the out-movement from criterion 1, or zero under criterion 2.
8. WHEN the Migration_Rule changes a district's population in a quarter, THE Engine SHALL record in the migration Cause of that district's population Cause_Breakdown a signed contribution equal to persons moved in minus persons moved out, linked to the migration threshold, migration share, weight and metro-exit share Parameter ids.
9. IF the migration threshold Parameter is negative or non-finite, or the migration share, metro-exit share or any migration weight Parameter is outside its allowed range or non-finite, THEN THE Engine SHALL return an Engine_Error that lists every invalid Parameter id as defined in Requirement 14.6, and SHALL return no Sim_State.
10. IF the Commute_Matrix is not 41×41, has a District_Code order different from the Baseline, has a negative or non-finite entry, or has a non-zero diagonal entry, THEN THE Engine SHALL return, before computing any quarter, an Engine_Error naming the origin and destination District_Codes of the first invalid entry (or the actual row and column counts if the dimensions are wrong) and the reason it is invalid, and SHALL return no Sim_State.

### Requirement 10: Ghosts

**User Story:** As a player, I want ghosts to show the people hidden by averages, so that I can see who is left behind in each district.

#### Acceptance Criteria

1. WHEN the Step_Function computes a quarter, THE Engine SHALL compute the Ghost count of each district for that quarter as (R + C − O + D) / Ghost_Size rounded down to an integer, where R is the number of the district's residents above the rent-burden threshold, C is the number above the commute-time threshold, O is the number of residents counted in both R and C, and D is the number of residents moved out of the district by the Migration_Rule in that quarter.
2. THE Engine SHALL take the rent-burden threshold (percent of household income), the commute-time threshold (minutes), the share of residents above each threshold, the share of residents above both thresholds, and Ghost_Size (an integer of at least 1, default 1,000) from the Parameter_Table, each with a non-empty `source`.
3. THE Engine SHALL compute R, C, O and D only from the same quarter's Engine outputs (district population, rent burden, commute time and Migration_Rule outflow) and the Parameter_Table, and the Ghost count of every district and quarter SHALL be a non-negative integer that is identical across repeated runs with identical inputs.
4. IF Ghost_Size is missing, not an integer or less than 1, or any threshold or share Parameter used by criterion 2 is missing or has a share outside 0 to 1, THEN THE Engine SHALL return an Engine_Error that names the Parameter id and SHALL return no Sim_State.
5. IF a district's population in a quarter is zero, THEN THE Engine SHALL set that district's Ghost count for that quarter to 0.
6. WHEN the Engine computes a Ghost count, THE Engine SHALL record a Cause_Breakdown for it that contains a Baseline Cause equal to the Derived_Baseline Ghost count; separate Causes for the rent-burden group, the commute-time group, the overlap correction and migration displacement, each equal to that group's change from its Derived_Baseline value divided by Ghost_Size and linked to the Parameter ids it uses; and a Bound_Adjustment equal to the reported Ghost count minus the sum of the other Causes, which covers rounding down (criterion 1) and the zero-population rule (criterion 5), so that the signed contributions sum to the Ghost count.

### Requirement 11: Events

**User Story:** As a player, I want real events to change how my policies play out, so that the same policy can matter more in some years than in others.

#### Acceptance Criteria

1. THE Engine SHALL treat the effect of every real Event as already contained in the Baseline, and SHALL add no Event Cause and no Event contribution to any Output_Indicator value whose Policy_Delta for that district and quarter is zero.
2. WHERE an Event in the event list has a modifier for a Policy_Tool in the Parameter_Table, WHEN the Engine computes that Policy_Tool's Policy_Delta for a quarter from the Event's first Quarter_Key to its last Quarter_Key inclusive, THE Engine SHALL multiply the Policy_Delta that takes effect in that quarter (after its Lag) by the modifier and record a Cause for that Event whose signed contribution equals the modified Policy_Delta minus the unmodified Policy_Delta, linked to the Event id and the modifier's Parameter id.
3. IF an Event names an indicator id, Policy_Tool or Quarter_Key that the Engine does not know, THEN THE Engine SHALL return an Engine_Error naming the Event id and the unknown value, and SHALL return no Sim_State for that run.
4. WHEN two or more Events with modifiers for the same Policy_Tool cover the same quarter, THE Engine SHALL apply their modifiers one after another in event-list order, record one Cause per Event equal to the change that Event's modifier made at its step, and make the unmodified Policy_Delta plus all of those Event Causes equal the final modified Policy_Delta to within 1e-9 relative tolerance.
5. IF an Event modifier value is not a finite number, is less than 0, or lies outside its Parameter `range` when a `range` is given, or IF an Event's first Quarter_Key is later than its last Quarter_Key, THEN THE Engine SHALL return an Engine_Error naming the Event id and the invalid value, and SHALL return no Sim_State for that run.
6. IF an Event has no modifier for a Policy_Tool, THEN THE Engine SHALL leave that Policy_Tool's Policy_Delta unchanged in every quarter the Event covers.

### Requirement 12: Bounded and non-negative indicators

**User Story:** As the developer, I want every indicator to stay in its valid range, so that the UI never shows impossible numbers.

#### Acceptance Criteria

1. THE Engine SHALL keep every Bounded_Indicator value in the closed range from 0 to 100 inclusive, for every one of the 41 districts and every Quarter_Key from 2015Q1 to the last quarter computed.
2. THE Engine SHALL keep every Count_Indicator value a non-negative integer (0 or greater, with no fractional part) for every one of the 41 districts and every Quarter_Key from 2015Q1 to the last quarter computed.
3. WHEN a computed Bounded_Indicator value is below 0 or above 100, or a computed Count_Indicator value or unbounded non-negative Output_Indicator value is below 0, THE Engine SHALL set the value to the nearest allowed bound and record a Bound_Adjustment Cause in that value's Cause_Breakdown, with a signed contribution equal to the bounded value minus the computed value.
4. WHEN a computed Count_Indicator value other than the Ghost count lies within its allowed range but has a fractional part, THE Engine SHALL round the value to the nearest integer, rounding exact halves (x.5) up, and add the signed rounding difference (rounded value minus computed value) to that value's Bound_Adjustment contribution. The Ghost count SHALL instead be rounded down as defined in Requirement 10.1 and 10.6.
5. WHEN a computed Output_Indicator value already lies within its allowed range and needs no rounding, THE Engine SHALL leave the value unchanged and SHALL NOT record a non-zero Bound_Adjustment Cause for it.
6. THE Engine SHALL keep every unbounded non-negative Output_Indicator value greater than or equal to 0 for every one of the 41 districts and every Quarter_Key from 2015Q1 to the last quarter computed.
7. THE Engine SHALL produce Cause_Breakdowns in which the sum of all Cause contributions, including any Bound_Adjustment, equals the reported Output_Indicator value within the tolerance of Requirement 13.3.
8. FOR ALL Player_Policy_Timelines, event lists and Parameter_Tables whose values lie within their declared ranges, THE Engine SHALL satisfy criteria 1, 2, 6 and 7 for every Sim_State returned by the Run_Function up to the last quarter of the generated Baseline, checked by a fast-check property-based test with at least 100 generated cases.
9. THE Engine SHALL produce only finite numbers (no NaN, positive infinity or negative infinity) in every Output_Indicator value, Budget_Ledger entry and Cause contribution.
10. IF any computed Output_Indicator value, Budget_Ledger entry or Cause contribution is NaN, positive infinity or negative infinity, THEN THE Engine SHALL return an Engine_Error identifying the affected quantity, District_Code (where applicable) and Quarter_Key instead of a Sim_State, and SHALL NOT return any partially bounded Sim_State for that quarter.

### Requirement 13: Cause breakdown

**User Story:** As a teacher, I want every number to break down into its causes, so that students can see why a district changed.

#### Acceptance Criteria

1. WHEN the Step_Function produces a Sim_State, THE Engine SHALL include in that Sim_State, computed in `explain.ts`, exactly one Cause_Breakdown for each combination of Output_Indicator listed in the Rule_Registry, each of the 41 District_Codes, and the Sim_State's Quarter_Key.
2. THE Engine SHALL include in every Cause_Breakdown other than the Ghost count Cause_Breakdown exactly one Baseline Cause, exactly one Cause for each Policy_Tool listed in the Rule_Registry (included even when its contribution is 0), exactly one Cause for each Event whose contribution has an absolute value greater than the tolerance of criterion 3 for that Output_Indicator, district and quarter, exactly one migration Cause, and exactly one Bound_Adjustment Cause. The Ghost count Cause_Breakdown SHALL contain the Causes defined in Requirement 10.6.
3. THE Engine SHALL make the contributions of all Causes in a Cause_Breakdown sum to the reported Output_Indicator value, with an absolute difference no greater than 1e-9 × max(1, |reported value|).
4. THE Engine SHALL set the Baseline Cause contribution equal to the Baseline value for that Output_Indicator, district and quarter, or to the Derived_Baseline value when the Output_Indicator has no Baseline value in `history.json`.
5. THE Engine SHALL make the contributions of all non-Baseline Causes sum to the reported Output_Indicator value minus the Baseline Cause contribution, within the tolerance of criterion 3.
6. THE Engine SHALL set the Bound_Adjustment Cause contribution equal to the reported Output_Indicator value minus the computed value before limiting and rounding (Requirement 12.3 and 12.4). The contribution SHALL be 0 when the computed value is inside the range and needs no rounding, negative when the value is limited at the upper bound, positive when the value is limited at the lower bound, and the signed rounding difference when only rounding applies.
7. THE Engine SHALL link each Cause other than the Bound_Adjustment Cause to at least one Parameter id or Source_Id that the Cause's contribution depends on. Each linked Parameter id SHALL exist in the Parameter_Table, and each linked Source_Id SHALL exist in the Baseline source registry.
8. IF a Rule_Registry rule or Event references a Parameter id that is missing from the Parameter_Table, or a Source_Id that is missing from the Baseline source registry, THEN THE Engine SHALL return an Engine_Error naming the missing id and the referencing rule or Event, and SHALL return no Sim_State for that call.
9. THE Engine SHALL make every Cause contribution a finite number (not NaN and not ±Infinity).
10. IF the Player_Policy_Timeline equals the Real_Policy_Track for every quarter, THEN THE Engine SHALL make every Policy_Tool Cause and every Event Cause contribute exactly 0, as required by Requirement 3.4, for every Output_Indicator, district and quarter.
11. FOR ALL Player_Policy_Timelines and event lists, THE Engine SHALL satisfy criteria 2, 3, 5, 6 and 9 for every Output_Indicator, district and computed quarter (property-based test with fast-check).

### Requirement 14: Parameter table

**User Story:** As a teacher, I want every coefficient to come from a cited source, so that students can check the assumptions.

#### Acceptance Criteria

1. THE Engine SHALL read every coefficient, threshold, Lag, unit cost, Cost_Schedule, Policy_Maximum, share and Ghost_Size used by a supported Policy_Tool rule, the Migration_Rule, the Ghost rule or the Annual_Budget calculation from the Parameter_Table, and SHALL contain no numeric literal standing in for such a value in `src/simulation/`. The only numeric literals allowed in rule logic are those listed in Requirement 2.6.
2. WHEN the Step_Function or the Run_Function is called, THE Engine SHALL validate every Parameter required by the supported Policy_Tools and rules before computing any Sim_State.
3. IF a required Parameter is missing, has a non-finite `value`, has an empty or whitespace-only `unit`, or has a `source` whose citation or URL is empty or whitespace-only, THEN THE Engine SHALL return an Engine_Error naming the Parameter id and the problem, and SHALL return no Sim_State.
4. IF a required Parameter has a `range` in which `low` or `high` is non-finite, `low` is greater than `high`, `value` is less than `low` or greater than `high`, or the source of `low` or `high` has an empty citation or URL, THEN THE Engine SHALL return an Engine_Error naming the Parameter id and the problem, and SHALL return no Sim_State; a `range` with `low` equal to `high`, or a `value` equal to `low` or `high`, SHALL be accepted.
5. IF a required Lag Parameter is not an integer from 0 to 43 inclusive, a required unit cost is not greater than 0, Ghost_Size is not an integer of at least 1, a required share Parameter is outside 0 to 1 inclusive, or a Cost_Schedule has an offset that is not an integer from 0 to 43 or shares that are outside 0 to 1 or do not sum to 1 within 1e-9, THEN THE Engine SHALL return an Engine_Error naming the Parameter id and the violated bound, and SHALL return no Sim_State.
6. IF more than one required Parameter fails validation, THEN THE Engine SHALL return a single Engine_Error that lists every failing Parameter id with its problem, and the same inputs SHALL always produce the same list in the same order.
7. IF the Parameter_Table contains Parameters that no supported Policy_Tool or rule requires, THEN THE Engine SHALL ignore them and SHALL NOT return an Engine_Error for them.
8. WHERE a Parameter has a `range`, THE Engine SHALL use the Parameter's `value` as the central value in every computation and SHALL include the `low` and `high` values and their sources in every Cause that uses the Parameter.
9. THE Engine SHALL list, in each Cause, the id of every Parameter used to compute that Cause's contribution.

### Requirement 15: Input preconditions

**User Story:** As the developer, I want the engine to reject invalid inputs with a clear error, so that a bad save code or data file never produces a silent wrong city.

#### Acceptance Criteria

1. IF a Policy_Setting in the Player_Policy_Timeline or the Real_Policy_Track has a negative value, a non-integer value for a count (Social_Housing_Tool units or Rent_Subsidy_Tool households), a non-finite number (NaN, Infinity or -Infinity), or a value above the Policy_Maximum for that Policy_Tool field in the Parameter_Table, THEN THE Engine SHALL return an Engine_Error that names the Policy_Tool, the District_Code or "city" for city-level tools, the Quarter_Key and the offending value, and SHALL return no Sim_State. The tool-specific checks are in Requirements 4.2, 5.2, 6.9 and 6.10.
2. IF the Baseline, the Real_Policy_Track or the Player_Policy_Timeline lacks an entry for any of the 41 District_Codes in any quarter from 2015Q1 up to and including the requested Quarter_Key, THEN THE Engine SHALL return an Engine_Error that names the input (Baseline, Real_Policy_Track or Player_Policy_Timeline) and the first missing District_Code and Quarter_Key, where "first" means the earliest Quarter_Key and, within that quarter, the lowest District_Code in ascending numeric order.
3. THE Engine SHALL return every Engine_Error as a return value, SHALL throw no exception for any input that matches the declared TypeScript input types, and SHALL leave every input argument unchanged when it returns an Engine_Error.
4. IF the requested Quarter_Key is invalid as defined in Requirement 1.3, THEN THE Engine SHALL return the Engine_Error defined in Requirement 1.3.
5. IF the Commute_Matrix fails any check of Requirement 9.10, THEN THE Engine SHALL return the Engine_Error defined in Requirement 9.10.
6. IF the Parameter_Table fails any check of Requirement 7.8, 7.9, 8.8, 9.9, 10.4 or 14.2 to 14.5, THEN THE Engine SHALL return a single Engine_Error as defined in Requirement 14.6.

### Requirement 16: Extensibility for later tools

**User Story:** As the developer, I want to add the remaining 5 tools later without rewriting the engine, so that the MVP can grow safely.

#### Acceptance Criteria

1. THE Engine SHALL place each Policy_Tool rule and each indicator rule in its own file in `src/simulation/rules/`, with exactly one rule per file, and SHALL register each rule in the Rule_Registry under a unique id.
2. THE Rule_Registry SHALL contain exactly 3 Policy_Tool rule entries in this spec, one each for the Social_Housing_Tool, the Commuter_Pass_Tool and the Rent_Subsidy_Tool, plus one entry for each Output_Indicator the Engine computes.
3. THE Step_Function SHALL apply rules only by iterating the Rule_Registry, so that adding a Policy_Tool requires only a new rule file, a Rule_Registry entry, new Parameter entries and new Policy_Setting fields, and no change to `engine.ts`, `lag.ts`, `budget.ts`, `migration.ts` or `explain.ts`.
4. WHEN a test registers an additional stub Policy_Tool rule with its Parameter entries and Policy_Setting field, without modifying `engine.ts`, `lag.ts`, `budget.ts`, `migration.ts` or `explain.ts`, THE Run_Function SHALL return Sim_States in which the stub tool's Policy_Delta appears as a Cause in the Cause_Breakdown of each Output_Indicator the stub rule affects.
5. THE Engine SHALL apply rules in the fixed order of the Rule_Registry, so that for identical inputs whose object keys or records (Baseline records, Parameter_Table entries, Policy_Setting fields) are supplied in any permuted order, the Run_Function returns Sim_States with identical Output_Indicator values and identical Cause_Breakdown contents and order. Event-list order is excluded, because Requirement 11.4 applies modifiers in event-list order.
6. IF the Rule_Registry contains two entries with the same id, THEN THE Engine SHALL return an Engine_Error identifying the duplicated id and SHALL return no Sim_State.
7. IF a registered rule references a Parameter id that is absent from the Parameter_Table, or a Policy_Setting field that is absent from the Player_Policy_Timeline or the Real_Policy_Track, THEN THE Engine SHALL return an Engine_Error identifying the rule id and the missing Parameter id or field, and SHALL return no Sim_State.

### Requirement 17: Property-based and unit tests

**User Story:** As the developer, I want the invariants checked over many generated inputs, so that edge cases are found before players find them.

#### Acceptance Criteria

1. THE Engine SHALL have one fast-check property-based test in `tests/simulation/` for each of these invariants, each configured to run at least 100 generated cases: zero-delta identity (Requirement 3.8), budget never overspent (Requirement 8.10), Bounded_Indicators within 0–100 inclusive (Requirement 12.8 for criterion 12.1), determinism (Requirement 1.11), and Cause_Breakdown sums (Requirement 13.11).
2. THE Engine SHALL also have one fast-check property-based test for each of these invariants, each configured to run at least 100 generated cases: population conservation in migration (Requirement 9.5), non-negative integer counts (Requirement 12.8 for criterion 12.2) and no input mutation (Requirement 1.10), as required by `simulation.md`, and migration order independence (Requirement 9.6).
3. THE property-based tests SHALL generate Player_Policy_Timelines, event lists of 0 to 10 Events, Parameter_Tables and synthetic Baselines that cover all 41 District_Codes and 1 to 8 consecutive quarters starting at 2015Q1, together with a 41×41 Commute_Matrix of finite non-negative minutes with a zero diagonal, and SHALL call the Run_Function up to the last generated quarter.
4. THE Parameter_Table generator SHALL draw each Parameter that has a `range` from `low` to `high` inclusive, and SHALL use `value` for each Parameter that has no `range`.
5. THE Player_Policy_Timeline generator SHALL include, with non-zero probability, quarters where every Policy_Tool value is zero, quarters where every Policy_Tool value equals the Real_Policy_Track value, and quarters where a Policy_Tool value is the largest value the Engine accepts without returning an Engine_Error.
6. WHILE the `public/data/` directory is absent, THE property-based tests and example-based tests SHALL run without reading any file outside `src/` and `tests/` and SHALL pass.
7. THE determinism test SHALL run the Run_Function twice on deep-equal generated inputs, the second time on a `structuredClone` copy of the inputs, and SHALL check that the two returned Sim_State lists are deep-equal, including every Cause_Breakdown.
8. THE Engine SHALL have at least one example-based Vitest test for each rule file named in the Rule_Registry and for the Migration_Rule, plus the 44-quarter zero-delta example test of Requirement 3.8. Each rule test SHALL assert at least one Output_Indicator value against an expected number written as a literal in the test and worked out by hand from the test's inputs. Expected Count_Indicator values SHALL match exactly, and expected non-integer values SHALL match within an absolute difference of 1e-9.
9. IF a property-based test fails, THEN THE test run SHALL report the failed test's name, print the shrunk counterexample, and print the fast-check seed and path needed to replay that counterexample.
10. WHEN the developer runs `npx vitest --run` and `npm run typecheck`, both commands SHALL exit with code 0, with no Engine test marked as skipped, todo or `.only`, and the outcome SHALL be confirmed by running both commands and reporting their exit codes.

## Open Questions

These need a decision before or during design. The requirements above use the default in brackets.

1. **Spec language.** `product.md` says all `.kiro` spec documents are in English, and the data-pipeline spec is in English. This document is therefore in English, although the request was to match the conversation language. [Default: English.] Say so if you want it in Traditional Chinese.
2. **Missing inputs.** `params.json`, the Real_Policy_Track for the 3 tools and the 41×41 Commute_Matrix do not exist yet. The data-pipeline spec defers the matrix and the real policy track. Options: (a) add a small data spec for them before this engine; (b) build the engine against typed fixtures now and fill the real files later. [Default: (b).]
3. **Commute time indicator.** Mean commute time per district needs the Commute_Matrix and a home-to-work distribution, which no source provides yet. Options: keep it as an Output_Indicator derived from the matrix and a cited job-location share, or drop it from this spec and base commute ghosts on the matrix alone. [Default: keep, Requirement 2.5.]
4. **Annual_Budget scope.** `product.md` defines the budget as real spending on all 8 tools. With 3 tools, the budget here is real spending on those 3 only (Requirement 8.1). Adding tools later raises the budget. [Default: 3 tools only.]
5. **Social housing cost schedule.** Charge the whole construction cost in the start quarter, or spread it over the construction period. [Default: a Cost_Schedule from the Parameter_Table, Requirements 4.8 and 7.7. A schedule with one offset of 0 and share 1 charges everything in the start quarter.]
6. **Rent subsidy pass-through.** Whether rent subsidies raise market rent is contested. Requirements 6.6 and 6.7 make this an optional Parameter with a range, per `neutrality.md`. Confirm, or exclude pass-through from the MVP.
7. **Event role.** Requirement 11 treats real events as already inside the Baseline and lets them only scale the player's Policy_Deltas. The alternative is no event effect in Historical mode at all. [Default: modifiers.]
8. **Commuter pass subsidy and TPASS.** TPASS (2023) is a central-government event, not a player tool. The Real_Policy_Track for the city-level subsidy must decide whether TPASS's local share counts as the real city subsidy.
9. **Budget rejection behaviour.** Requirement 8.6 rejects an over-budget Policy_Setting with an Engine_Error. The UI could instead prevent the input. Both can apply; the engine check stays as the guarantee.
10. **Exact equality.** Requirements 3.2 and 3.3 require `===` equality with the Baseline. This rules out formulas that add and subtract the same float (for example `baseline + x - x`). Confirm exact equality rather than a tolerance.
11. **fast-check dependency.** fast-check is not installed. `tech.md` names it as the testing library, but adding it still needs your approval.
12. **Social housing maximum.** Requirement 4.1 takes the largest number of units started per district per quarter from a Policy_Maximum Parameter instead of a literal. A proposed default is 100,000, which needs a cited basis or a note that it is a game limit. The Rent_Subsidy_Tool amount needs a similar Policy_Maximum (Requirement 6.1).
13. **Lag 0.** Requirements 2.2 and 7.3 define a Lag of 0 as an effect in the same quarter, with no Lag_Pipeline entry (Requirement 7.4). Confirm that a cited Lag of 0 is allowed for the Commuter_Pass_Tool and the Rent_Subsidy_Tool, or require at least 1 quarter.
14. **Stock and flow effects.** The social housing effect persists once built (Stock_Effect_Tool), while the commuter pass and rent subsidy effects apply only in quarter q + Lag and are then replaced by the next quarter's setting (Flow_Effect_Tool, Requirement 2.2). Confirm this reading of "from q + L onward" for the two subsidy tools.
15. **Commute cost scope.** Requirement 5.5 lowers the commute cost only for district pairs whose origin district is in the subsidising city. Alternatives: pairs whose destination is in that city, or pairs with either end in it. [Default: origin.]
16. **Charges after 2025Q4.** A Cost_Schedule charge that falls after 2025Q4 is recorded in 2025Q4 and counts against the 2025 Annual_Budget (Requirement 4.8). The alternative is to drop it, which would let late construction escape the budget. [Default: record in 2025Q4.]
17. **Unit cost of 0.** Requirements 8.8 and 14.5 require every unit cost to be greater than 0. Confirm that no supported tool has a legitimate zero unit cost.
18. **Short property-test runs.** Property-based tests use synthetic Baselines of 1 to 8 quarters (Requirement 17.3), so the full 44-quarter identity (Requirement 3.1) is checked by one example-based test instead. Confirm that is enough, or ask for a slower property test over 44 quarters.
