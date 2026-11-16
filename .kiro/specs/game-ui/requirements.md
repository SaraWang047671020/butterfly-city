# Requirements Document

## Introduction

This spec defines the Butterfly City game screen for Historical mode (2015Q1 to 2025Q4). The screen has three parts:

1. **Map**: an SVG map of the 41 districts of Taipei City and New Taipei City, drawn from `districts.json` with `d3-geo`. The player can switch the indicator shown on the map, select a district to see its data for the displayed quarter, and the map keeps an empty layer for ghosts.
2. **Turns and saves**: one turn per quarter, a "Next quarter" button and a "Fast-forward one year" button that stops at major events, a save in `localStorage`, export and import of a save code, the policy timeline, and a demo save that has been played into 2021.
3. **Policy panel**: the 5 policy tools. Each tool shows its cost, lag, lower and upper limit and sources. The budget is recomputed while the player edits, and an adjustment that breaks the budget or a limit cannot be applied. Social housing under construction shows its progress.

Each simulated result is shown as a central value with a possible range: the minimum and maximum over the three Scenarios. The screen does not name the Scenarios. A "Why?" control next to each simulated value shows which Parameter assumptions give the minimum and the maximum. The screen works at viewport widths from 360 to 1920 CSS pixels.

### Current state of the code this spec builds on

Read on 2026-11-17:

- `src/simulation/` contains the tool rules for social housing, commuter pass and rent subsidy, the indicator rules, `budget.ts` (`checkBudget`, `checkLimit`), `lag.ts`, `ghosts.ts`, `explain.ts`, `params.ts` (`scenarioTable`, `SCENARIO_EFFECT_IDS`), `registry.ts` (`RULE_REGISTRY`) and `engine.ts` (`step`, `run`, `runRange`).
- The Rule_Registry holds 3 tool rules: `socialHousing`, `commuterPass`, `rentSubsidy`. `POLICY_TOOL_IDS` in `src/types/data-files.ts` lists 5 tools; `sublease` and `holdingTax` are not in the Rule_Registry.
- `public/data/` holds `districts.json`, `history.json` and `policy-track.json`. `events.json` (event-library spec, not built yet), `params.json` and the 41×41 commute-time matrix do not exist yet. The social housing Lag (`socialHousing.lag`) is therefore not yet fixed; the engine test fixtures use 12 quarters, and the steering gives 3 to 5 years (12 to 20 quarters).
- `history.json` has 12 indicators. `priceToIncomeRatio` exists at city level only, computed by the data pipeline as the median total transaction price (`總價元`) of qualifying sales in the city and quarter ÷ `cityDisposableIncome` (method `price-to-income-computed`, every record `estimated: true`). At district level `history.json` has `salePrice` (TWD per m²) and `householdIncome` (TWD per household per year, every record `estimated: true`, method `income-district-combination`).
- **Planned field.** `history.json` has no district median total transaction price yet. This spec depends on a district-level indicator `medianTotalPrice` (TWD per transaction; median `總價元` of the qualifying sales of the district and quarter, with the same sale filter and `總價元 > 0` as the city ratio). The field is planned in data-pipeline Requirement 19 and data-pipeline tasks 16 to 21, which are not yet executed. Requirement 3.5 is written against `medianTotalPrice`; until the field exists, the Data_Loader reports it as missing under Requirement 2.5.
- The engine does not simulate sale prices.
- `package.json` has no Vite and no `d3-geo`. The user approved adding `vite`, `d3-geo` and `@types/d3-geo` on 2026-11-16 (Requirement 18.9).

### Out of scope

- The full cause breakdown of the "Why?" view (`src/ui/explain/`): the decomposition of a value into Baseline, policy and event Causes. This spec covers only the Range_Source_View of the "Why?" control (Requirement 20). A cause-breakdown section, if shown, stays disabled and labelled "coming soon" (Requirement 20.6).
- Citizen personas and their updates (`src/narrative/`), the ending comparison, and the international reference cases.
- Ghost silhouettes and risk-escalation visuals. This spec reserves the Ghost_Layer and shows Ghost counts as numbers.
- Future mode and Live mode.
- Changes to the engine formulas, the data files or the event library. The district `medianTotalPrice` field is planned in data-pipeline Requirement 19 (data-pipeline tasks 16 to 21); this spec depends on it and does not implement it.
- Holding-tax revenue flowing back into the budget.

## Glossary

- **App**: the static web application built with Vite and served from the base path `/butterflycity/`.
- **Game_Screen**: the screen that shows the Map_View, the Turn_Bar and the Policy_Panel together.
- **Map_View**: the SVG map of the 41 districts in `src/ui/map/`.
- **District_Panel**: the part of the Game_Screen that shows the data of the Selected_District.
- **District_List**: the list of all 41 districts on the Game_Screen, a second way to set the Selected_District (Requirement 4.6).
- **Turn_Bar**: the part of the Game_Screen with the quarter display, the Next_Quarter_Action, the Fast_Forward_Action and the save controls.
- **Policy_Panel**: the part of the Game_Screen in `src/ui/panels/` that shows and edits the 5 Policy_Tools.
- **Apply_Control**: the control in the Policy_Panel that applies an edited Tool_Field value as a Policy_Adjustment.
- **Set_To_Real_Control**: the "Set to real value" control of one Tool_Field and Area (Requirements 8.10 and 9.14).
- **Timeline_View**: the part of the Game_Screen that lists the Timeline_Entries, the Completion_Items and the Event_Cards by quarter.
- **Game_Controller**: the module in `src/game/` that holds the game session, calls the Engine and gives the UI read-only view data. It holds no simulation formula.
- **Save_Store**: the module in `src/save/` that reads and writes saves in `localStorage` and encodes and decodes Save_Codes.
- **Data_Loader**: the module in `src/data/` that fetches and validates the files in `public/data/`. It is the only module that fetches files.
- **Data_Files**: the 6 files the Data_Loader fetches: `districts.json`, `history.json`, `policy-track.json`, `events.json`, `params.json` and the commute-time matrix file (its file name is fixed in the design).
- **Engine**: the pure simulation functions in `src/simulation/` defined by the simulation-engine spec, including `runRange`, `checkBudget`, `checkLimit`, `scenarioTable` and `RULE_REGISTRY`.
- **Rule_Registry**: `RULE_REGISTRY` in `src/simulation/registry.ts`.
- **Policy_Tool**: one of the 5 tools in `POLICY_TOOL_IDS`: `socialHousing`, `sublease`, `rentSubsidy`, `holdingTax`, `commuterPass`.
- **Social_Housing_Tool**: the Policy_Tool `socialHousing`: the number of social housing units started per district per quarter, as defined in the simulation-engine spec.
- **Rent_Subsidy_Tool**: the Policy_Tool `rentSubsidy`: the number of subsidised renter households and the subsidy amount per household per month, per city per quarter.
- **Commuter_Pass_Tool**: the Policy_Tool `commuterPass`: the subsidy in TWD per pass per month toward a monthly commuter pass, per city per quarter.
- **Active_Tool**: a Policy_Tool whose id is a tool id in the Rule_Registry.
- **Coming_Soon_Tool**: a Policy_Tool whose id is not a tool id in the Rule_Registry.
- **Tool_Field**: a player-editable field of an Active_Tool as declared in its rule's `fields` (for example `socialHousing.unitsStarted`, `rentSubsidy.households`, `rentSubsidy.amount`, `commuterPass.subsidy`).
- **Count_Field**: a Tool_Field that counts units or households: `socialHousing.unitsStarted` and `rentSubsidy.households`.
- **Area**: the scope of one Tool_Field value: a District_Code or a city.
- **Quarter_Key**: a string `YYYYQn` from `2015Q1` to `2025Q4`.
- **Planning_Quarter**: the Quarter_Key that the next Next_Quarter_Action computes. At the start of a new game it is `2015Q1`. After 2025Q4 has been computed there is none.
- **Displayed_Quarter**: the latest computed Quarter_Key. Before any quarter is computed there is none.
- **Computed_Quarters**: the Quarter_Keys from `2015Q1` up to the Displayed_Quarter.
- **Fixed_Quarter**: a Quarter_Key at or before the Displayed_Quarter.
- **Next_Quarter_Action**: the "Next quarter" button and its keyboard equivalent.
- **Fast_Forward_Action**: the "Fast-forward one year" button and its keyboard equivalent.
- **Computation_Run**: the quarters computed in response to one Next_Quarter_Action or one Fast_Forward_Action.
- **Real_Policy_Track**: the real Policy_Settings of every quarter from `policy-track.json`, as defined in the simulation-engine spec.
- **Player_Policy_Timeline**: the player's Policy_Settings for every quarter, as defined in the simulation-engine spec.
- **Policy_Difference**: for one Policy_Tool, Area and quarter, the player's value minus the Real_Policy_Track value, as defined in the simulation-engine spec.
- **Policy_Adjustment**: one change by the player of one Tool_Field for one Area taking effect from the Planning_Quarter: either a Value_Adjustment or a Real_Track_Adjustment.
- **Value_Adjustment**: a Policy_Adjustment that sets one absolute value for every quarter from the Planning_Quarter to 2025Q4 (Requirement 9.6).
- **Real_Track_Adjustment**: a Policy_Adjustment made with the Set_To_Real_Control that sets each quarter from the Planning_Quarter to 2025Q4 to its own Real_Policy_Track value (Requirement 9.14).
- **Timeline_Entry**: the record of one applied Policy_Adjustment: Planning_Quarter, tool, field, Area, the value before and the value after, and whether the adjustment is a Real_Track_Adjustment.
- **Event_Card**: one entry of `events.json` as defined in the event-library spec.
- **Major_Event**: an Event_Card with `major: true`.
- **Scenario**: `central`, `low` or `high` as defined in the simulation-engine spec. These names are internal identifiers. The Game_Screen displays no Scenario name and no label for a single Scenario (Requirement 5.3).
- **Result_Range**: the minimum, central value and maximum of one value over the three Scenarios, as returned by `runRange`.
- **Range_Display**: the text form of a simulated value: "<central> <unit> (possible range <minimum>–<maximum> <unit>)", or the single value with "same in all scenarios" (Requirement 5.2 and 5.7).
- **Parameter_Assumption**: one Parameter of `SCENARIO_EFFECT_IDS` in the table that `scenarioTable` returns for one Scenario: its name, value, unit, citation and URL.
- **Range_Source_View**: the view opened by the "Why?" control of a simulated value that lists the Parameter_Assumptions behind the minimum and the maximum (Requirement 20).
- **Map_Indicator**: one of the indicators the Map_View can show: Rent_Burden, Price_To_Income, Commute_Time and Population_Change.
- **Rent_Burden**: the Engine Output_Indicator `rentBurden`, in percent of household income.
- **Median_Total_Price**: the district indicator `medianTotalPrice` of `history.json`, in TWD per transaction (see "Current state").
- **Price_To_Income**: the district house price-to-income ratio in years of income (definition in Requirement 3.5).
- **Commute_Time**: the Engine Output_Indicator `meanCommuteTime`, in minutes.
- **Population_Change**: the change of the Engine Output_Indicator `population` of a district since 2015Q1, in percent.
- **Indicator_Class**: one value interval of a Map_Indicator with one fill, used by the Map_View and its legend (Requirement 3.9).
- **Selected_District**: the district whose data the District_Panel shows.
- **Ghost_Layer**: an SVG group in the Map_View reserved for ghost visuals.
- **Construction_Entry**: a Lag_Pipeline entry of the Social_Housing_Tool with a non-zero Policy_Difference in the Sim_State of the Displayed_Quarter.
- **Completion_Item**: the Timeline_View item that records a Construction_Entry taking effect (Requirement 10.9).
- **Save**: the persistent record of a game session (Requirement 12.1).
- **Completed_Marker**: the field of a Save that records that 2025Q4 has been computed, in place of a Planning_Quarter.
- **Demo_Flag**: the boolean field of a Save that is `true` for a game started from the Demo_Save.
- **Save_Code**: a portable text string that encodes one Save.
- **Demo_Save**: the committed Save whose Planning_Quarter is 2021Q1 and whose Displayed_Quarter is 2020Q4 (Requirement 14.1).
- **Demo_Script**: the script in `scripts/` that produces the Demo_Save and the Demo_Summary (Requirement 14.5).
- **Demo_Base_List**: the committed list of Policy_Adjustments that the Demo_Script tries first (Fallback_Step 0, Requirement 14.20).
- **Demo_Enlarged_List**: the committed list of Policy_Adjustments that the Demo_Script tries when the Demo_Base_List does not reach the Ghost goal: the same adjustments as the Demo_Base_List with larger sizes (Fallback_Step 1, Requirements 14.21 and 14.24).
- **Fallback_Step**: the step of Requirements 14.20 to 14.22 at which the Demo_Script reaches the demo goal: 0 (Demo_Base_List, Ghost count shown as the main effect), 1 (Demo_Enlarged_List, Ghost count shown as the main effect) or 2 (Demo_Enlarged_List, Rent_Burden shown as the main effect and the Ghost count as the secondary effect).
- **Demo_Comparison_Quarter**: 2021Q1, the Planning_Quarter of the Demo_Save and the quarter at which the demo goal is checked.
- **Demo_Lookahead_State**: for each Scenario, the Sim_State of the Demo_Comparison_Quarter that the Engine computes from the Demo_Save when the first Next_Quarter_Action after loading is taken with no Policy_Adjustment in between. Because the Player_Policy_Timeline of the Demo_Save already holds the 2021Q1 values (Requirement 9.6), this Sim_State is fixed by the Demo_Save and the Data_Files (Requirement 7.14).
- **Zero_Delta_Run**: the Engine run of the quarters 2015Q1 to the Demo_Comparison_Quarter with the Player_Policy_Timeline equal to the Real_Policy_Track. By the zero-delta identity of the simulation-engine spec (simulation-engine Requirement 3), its values equal the Baseline and the Derived_Baseline.
- **Demo_Ghost_Difference**: the total Ghost count over the 41 districts in the central Demo_Lookahead_State minus the same total in the central Sim_State of the Demo_Comparison_Quarter of the Zero_Delta_Run.
- **Demo_Ghost_Threshold**: the minimum absolute Demo_Ghost_Difference that counts as a visible Ghost difference. Default: 1 Ghost (total over the 41 districts, central Scenario). The final value is set when the demo is recomputed with the real `params.json` (Open Question 15).
- **Demo_Rent_Burden_Difference**: for one district, the central Rent_Burden of the Demo_Lookahead_State minus the central Rent_Burden of the Demo_Comparison_Quarter in the Zero_Delta_Run, in percentage points.
- **Demo_Rent_Burden_Threshold**: the minimum absolute Demo_Rent_Burden_Difference, in at least one district, that counts as a visible Rent_Burden difference. Default: 0.1 percentage points, the smallest difference that the District_Panel shows as non-zero at one decimal (Requirements 6.4 and 6.10). The final value is set with the recompute (Open Question 15).
- **Demo_Summary**: the committed output of the Demo_Script next to the Demo_Save Save_Code that records the Fallback_Step reached, the Demo_Ghost_Difference and the Demo_Rent_Burden_Difference of the district named in Requirement 14.26 or 14.27 (Requirement 14.25).
- **Social_Housing_Charge** and **Rent_Subsidy_Charge**: the spending of the Social_Housing_Tool or the Rent_Subsidy_Tool committed in the Engine budget ledger for one calendar year, after the cost schedule.
- **Disclosure_Text**: the sentence "Initial data and events come from real open data. Policy outcomes are simulated, not predicted."
- **Design_Proposal**: the visual design document that the user approves before production UI code is written (Requirement 1).
- **Token_File**: `src/styles/tokens.css`.
- **UI_Strings_Module**: the one module in `src/ui/` that holds every UI string (Requirement 15.3).
- **Banned_Term_List**: `data/config/banned-terms.txt`.
- **Exempt_List**: `data/config/banned-terms-exempt.txt`.
- **Test_Suite**: the Vitest tests in `tests/`, run with `npx vitest --run`.
- **Developer**: the person who implements this spec, including an agent acting for the user.
- **Engine terms**: Sim_State, Output_Indicator, Baseline, Derived_Baseline, Lag, Lag_Pipeline, Annual_Budget, Budget_Ceiling, Policy_Setting, Ghost_Size, Engine_Error and Parameter are used as defined in the simulation-engine spec.

## Requirements

### Requirement 1: Design approval gate

**User Story:** As the product owner, I want to approve the visual design before UI code is written, so that the interface meets the quality bar in `product.md`.

#### Acceptance Criteria

1. THE Design_Proposal SHALL include a mock of the full Game_Screen layout at each of the viewport widths 360, 768, 1280 and 1920 CSS pixels.
2. THE Design_Proposal SHALL list every design token with its name and value: colours, spacings, font families, font sizes, font weights, line heights, radii, shadows and motion durations, and SHALL state the contrast ratio of each text and background colour pair.
3. THE Design_Proposal SHALL include a mock of each of the following: the map styling with the Indicator_Class fills, the four outline states of Requirement 4.8, the "no value" pattern, the estimate marker and the district labels; the legend of each Map_Indicator; the Range_Display of a value with a range and of a "same in all scenarios" value; the Range_Source_View; the Policy_Panel in its normal, disabled and rejected states; the "Coming soon" state; the construction progress bar; the Ghost_Layer placeholder; and the reduced-motion equivalent of every transition and animation.
4. THE Developer SHALL present the Design_Proposal to the user as a reviewable SVG or HTML artifact before any file in `src/ui/` or `src/styles/` is created.
5. WHEN the user approves the Design_Proposal, THE Developer SHALL record in `KIRO-LOG.md` the approval date as `YYYY-MM-DD`, the file name of the approved artifact and the user's statement of approval.
6. WHILE no approval is recorded in `KIRO-LOG.md`, THE Developer SHALL limit work to `src/game/`, `src/save/`, `src/data/` and their tests, and SHALL create no file in `src/ui/` or `src/styles/`.
7. IF the user rejects the Design_Proposal or requests changes, THEN THE Developer SHALL record no approval and SHALL present a revised artifact.
8. THE Token_File SHALL hold every colour, spacing, font, radius, shadow and motion duration of the approved Design_Proposal as CSS custom properties.
9. THE Test_Suite SHALL include a static style test that scans every `.css` file in `src/styles/` other than the Token_File and every `.ts` file in `src/ui/` and its subfolders for hex colour literals of 3, 4, 6 or 8 digits, `rgb(`, `rgba(`, `hsl(` and `hsla(` colour literals, and time values in `ms` or `s`, and that fails with the file name and line number of each match.
10. WHEN a change to an approved visual style is needed, THE Developer SHALL present the change to the user and SHALL record its approval in `KIRO-LOG.md` with the fields of criterion 5 before implementing the change.

### Requirement 2: Data loading

**User Story:** As a player, I want the game to start from the real data files and tell me clearly when a file is missing, so that I never play on wrong data.

#### Acceptance Criteria

1. WHEN the App starts, THE Data_Loader SHALL fetch exactly the 6 Data_Files from the `data/` folder under the base path `/butterflycity/`.
2. WHEN a Data_File has been fetched, THE Data_Loader SHALL validate it with the validators of `src/data/` (for example `validateDistrictsFile`, `validateHistoryFile`, `validatePolicyTrackFile`) or, for `events.json`, the event-library schema.
3. WHEN all 6 Data_Files pass validation, THE Data_Loader SHALL check that `districts.json`, `history.json` and the commute-time matrix file contain the same set of 41 District_Codes.
4. WHEN all 6 Data_Files pass validation and the check of criterion 3, THE Data_Loader SHALL convert the Data_Files into the Engine input types.
5. IF a Data_File returns a non-success HTTP status, returns no complete response within 15 seconds, cannot be parsed as JSON, fails validation, lacks an indicator this spec reads (including `medianTotalPrice` and `householdIncome` of `history.json`) or fails the check of criterion 3, THEN THE App SHALL show one line per failing Data_File that names the file and its first error.
6. WHILE a load error of criterion 5 is shown, THE App SHALL show no map values and no panel values, SHALL disable the Next_Quarter_Action and the Fast_Forward_Action, and SHALL write nothing to `localStorage`.
7. WHILE a load error of criterion 5 is shown, THE App SHALL offer a "Retry" control, operable by pointer and by keyboard, that fetches all 6 Data_Files again without reloading the page.
8. WHILE the Data_Files are being fetched, THE App SHALL show a loading state with the text "<n> of 6 files loaded", where n is the number of Data_Files fetched so far.
9. THE Game_Controller and the modules in `src/ui/` SHALL obtain data files only through the Data_Loader.

### Requirement 3: Map

**User Story:** As a player, I want a map of the 41 districts coloured by an indicator I choose, so that I can see where people carry the heaviest burden.

#### Acceptance Criteria

1. THE Map_View SHALL draw one SVG shape per district of `districts.json` (41 shapes) with a `d3-geo` projection fitted so that all 41 shapes lie inside the Map_View at every viewport width from 360 to 1920 CSS pixels.
2. WHEN the size of the Map_View changes, THE Map_View SHALL redraw the shapes within 500 ms after the last size change and SHALL keep the Map_Indicator, the Selected_District and the Displayed_Quarter.
3. THE Map_View SHALL offer a control that switches the Map_Indicator between Rent_Burden, Price_To_Income, Commute_Time and Population_Change, and SHALL show Rent_Burden at the start of a new game and the Map_Indicator of the Save when a Save is loaded.
4. WHEN the player selects a different Map_Indicator, THE Map_View SHALL update the shape fills, the legend and the indicator text of criterion 18 within 300 ms.
5. THE Game_Controller SHALL compute the Price_To_Income of a district and quarter in `src/game/` as the Median_Total_Price of that district and quarter ÷ the `householdIncome` of that district and quarter from `history.json`, rounded to 2 decimals, which is the city-level method of the data-pipeline spec applied to one district.
6. IF the Median_Total_Price of a district and quarter is missing, or its `householdIncome` is missing or zero, THEN THE Game_Controller SHALL give the Price_To_Income of that district and quarter as "no value".
7. THE Map_View and the District_Panel SHALL label Price_To_Income "House prices are not changed by policies in this version."
8. THE Map_View SHALL fill each district by the Indicator_Class of the central value of the selected Map_Indicator in the Displayed_Quarter.
9. THE Map_View SHALL use for each Map_Indicator between 4 and 7 contiguous Indicator_Classes, with the lowest class open below and the highest class open above, whose numeric bounds stay the same for all 44 quarters and do not depend on the Player_Policy_Timeline.
10. THE Map_View SHALL show a legend that lists every Indicator_Class of the selected Map_Indicator with its numeric bounds and unit, and a sample of the "no value" pattern.
11. IF a district has no value for the selected Map_Indicator in the Displayed_Quarter, THEN THE Map_View SHALL draw the district with the "no value" pattern and SHALL state "no value" in the district's accessible name.
12. WHILE no quarter has been computed, THE Map_View SHALL show the 2015Q1 values of `history.json` and the Derived_Baseline values supplied by the Game_Controller, and SHALL label the map "Real data, 2015Q1".
13. WHERE a displayed value comes from a record with `estimated: true`, THE Map_View SHALL mark the district with a non-colour estimate marker, SHALL state "estimated" in the district's accessible name, and THE District_Panel SHALL show the estimate method.
14. THE Game_Controller SHALL mark every Price_To_Income value that is not "no value" as estimated, because every district `householdIncome` record is `estimated: true`, and SHALL pass the estimate methods of its `householdIncome` and Median_Total_Price records to the UI.
15. THE Map_View SHALL give each district shape the accessible name defined in Requirement 4.2 and 4.3.
16. THE Map_View SHALL show the romanized English district name from `districts.json` as a map label inside each district shape.
17. IF the bounding box of a district label is wider or taller than the bounding box of its district shape at the current size, THEN THE Map_View SHALL omit that label and the district name SHALL remain in the accessible name, the District_List and the District_Panel.
18. THE Map_View SHALL show as text next to the map the Displayed_Quarter (or "Real data, 2015Q1" under criterion 12) and the name and unit of the selected Map_Indicator, and SHALL update the text WHEN the Displayed_Quarter or the Map_Indicator changes.
19. THE Map_View SHALL contain a Ghost_Layer: an SVG group above the district shapes, marked `aria-hidden="true"`, that does not receive pointer events and that contains no ghost element in this spec.

### Requirement 4: District selection and accessibility of the map

**User Story:** As a keyboard or screen-reader user, I want to reach and select every district, so that the map does not depend on a mouse or on colour.

#### Acceptance Criteria

1. WHEN the player presses Tab or Shift+Tab inside the Map_View, THE Map_View SHALL move the keyboard focus through the district shapes in ascending or descending District_Code order, reaching each shape once per pass.
2. THE Map_View SHALL give each district shape an accessible name of the form "<name>, <city>: <indicator> <central value> <unit>, possible range <minimum> to <maximum>", or "<name>, <city>: <indicator> <value> <unit>, same in all scenarios" when the Result_Range values are equal after formatting under Requirement 6.10, or "<name>, <city>: <indicator> no value" for a district under Requirement 3.11.
3. WHERE the value of a district is estimated, THE Map_View SHALL append ", estimated" to the accessible name of criterion 2.
4. WHEN a district shape is clicked or tapped, THE Map_View SHALL make that district the Selected_District and THE District_Panel SHALL show its data.
5. WHEN a district shape has the keyboard focus and Enter or Space is pressed, THE Map_View SHALL make that district the Selected_District, THE District_Panel SHALL show its data, and THE Game_Screen SHALL keep the page scroll position unchanged.
6. THE Game_Screen SHALL offer a District_List of all 41 districts, grouped by city and sorted alphabetically by romanized name within each city, in which selecting an entry by pointer, Enter or Space makes that district the Selected_District.
7. WHILE no Selected_District is set, THE District_Panel SHALL show the prompt of Requirement 6.9.
8. THE Map_View SHALL draw four outline states for a district shape (unselected, focused, selected, focused and selected) that differ in outline width or outline pattern so that each state is distinguishable in greyscale.
9. WHEN the Map_Indicator, the Displayed_Quarter or the size of the Map_View changes, THE Map_View SHALL keep the Selected_District and the keyboard focus.

### Requirement 5: Result ranges

**User Story:** As a teacher, I want results shown as a central value with a possible range, so that students do not read one number as a prediction.

#### Acceptance Criteria

1. THE Game_Controller SHALL compute the displayed simulated values of each computed quarter with one Engine `runRange` call per quarter, and SHALL pass to the UI the Result_Range of each value and, for the minimum and the maximum, the Parameter_Assumptions of Requirement 20.2.
2. WHEN the Game_Screen shows a simulated value whose minimum, central value and maximum differ after formatting under Requirement 6.10, THE Game_Screen SHALL show the Range_Display "<central> <unit> (possible range <minimum>–<maximum> <unit>)".
3. THE Game_Screen SHALL show no Scenario name (`central`, `low`, `high`) and no label for a single Scenario in any displayed text, tooltip or accessible name.
4. THE Game_Screen SHALL show, next to every Range_Display, an "About this range" control that opens the text "The possible range comes from studies that disagree on some parameters. The model is run with each set of assumptions, and the range shows the lowest and highest result. It is a scenario range, not a statistical interval."
5. WHEN the player activates an "About this range" control by click, Enter or Space, THE Game_Screen SHALL toggle the text of criterion 4 between shown and hidden.
6. WHEN the player presses Escape while the text of criterion 4 is shown, THE Game_Screen SHALL hide the text and SHALL return the keyboard focus to its control.
7. IF the minimum, central value and maximum of a Result_Range are equal after formatting under Requirement 6.10, THEN THE Game_Screen SHALL show the single value with its unit and the text "same in all scenarios".
8. THE Game_Screen SHALL format the minimum, central value and maximum of one Range_Display with the same decimals and unit.

### Requirement 6: District panel

**User Story:** As a player, I want to see a district's numbers for the current quarter next to the real numbers, so that I see what my policies changed.

#### Acceptance Criteria

1. WHILE a Selected_District is set and a quarter has been computed, THE District_Panel SHALL show for the Displayed_Quarter the romanized name, the city, and 9 rows in this order, each with its unit: Rent_Burden, Price_To_Income, Commute_Time, Population_Change, rent, population, social housing stock, MRT entries and Ghost count.
2. THE District_Panel SHALL show in each simulated row the simulated value as a Range_Display (Requirement 5.2 and 5.7) and a comparison value labelled "Real" WHERE the value comes from `history.json` or "Derived baseline" WHERE the value is a Derived_Baseline value.
3. WHILE a Selected_District is set and no quarter has been computed, THE District_Panel SHALL show only the 2015Q1 real and Derived_Baseline values of the 9 rows, labelled "Real data, 2015Q1".
4. THE District_Panel SHALL show in each simulated row the difference between the central value and the comparison value with a "+" or "−" sign and its unit, SHALL show a zero difference as "0" without a sign, and SHALL give the difference of percent rows in percentage points.
5. THE District_Panel SHALL show in the Price_To_Income row the real value only, with the estimate flag of Requirement 3.14 and the label of Requirement 3.7.
6. IF a value of a row is missing, THEN THE District_Panel SHALL show "no value" in its place and SHALL show no difference for that row.
7. THE District_Panel SHALL show the Ghost count as an integer and the text "1 ghost = <Ghost_Size> residents".
8. THE District_Panel SHALL show for each row the source name of its Baseline data from the `sources` of `history.json`, or "source not listed" IF no source is recorded for that row.
9. WHILE no Selected_District is set, THE District_Panel SHALL show the text "Select a district on the map or in the list."
10. THE District_Panel SHALL format numbers in `en-US` format with the decimals of the indicator in `history.json` or, for Engine-only indicators, one decimal for percent and minutes and zero decimals for counts.
11. THE District_Panel SHALL show a "Why?" control next to each simulated value that opens the Range_Source_View of that value (Requirement 20).
12. WHEN a quarter is computed or the Selected_District changes, THE District_Panel SHALL show the values of the new Displayed_Quarter or district before the Next_Quarter_Action and the Fast_Forward_Action are enabled again.

### Requirement 7: Turn flow

**User Story:** As a player, I want time to move only when I press a button, so that I can take each quarter at my own pace.

#### Acceptance Criteria

1. WHEN the player activates the Next_Quarter_Action, THE Game_Controller SHALL compute exactly one quarter, the Planning_Quarter, with the Player_Policy_Timeline, SHALL make it the Displayed_Quarter and SHALL make the following quarter the Planning_Quarter.
2. THE Game_Controller SHALL change the Displayed_Quarter and the Planning_Quarter only on the Next_Quarter_Action, the Fast_Forward_Action or the loading of a Save.
3. THE Turn_Bar SHALL show as text the Planning_Quarter, the Displayed_Quarter and the turn number, which is the 1-based position of the Planning_Quarter in the quarters 2015Q1 to 2025Q4.
4. WHILE no quarter has been computed, THE Turn_Bar SHALL show "No quarter computed yet" in place of the Displayed_Quarter.
5. WHEN the player activates the Fast_Forward_Action, THE Game_Controller SHALL compute quarters one after another starting with the Planning_Quarter and SHALL stop after the first of these conditions occurs: 4 quarters have been computed; 2025Q4 has been computed; a computed quarter is the `firstQuarter` of one or more Major_Events, including the first quarter of the Computation_Run; the Engine returns an Engine_Error.
6. WHEN a Computation_Run stops after a quarter that is the `firstQuarter` of one or more Major_Events, THE Game_Screen SHALL show every Major_Event Event_Card of that quarter until the player dismisses the cards or activates the Next_Quarter_Action or the Fast_Forward_Action.
7. WHEN 2025Q4 has been computed, THE Game_Controller SHALL disable the Next_Quarter_Action and the Fast_Forward_Action, and THE Turn_Bar SHALL show "Simulation complete: 2015Q1 to 2025Q4", turn number 44 and no Planning_Quarter.
8. IF the Engine returns an Engine_Error while computing a quarter, THEN THE Game_Controller SHALL discard the failed quarter, SHALL keep the quarters computed earlier in the same Computation_Run, SHALL make the last successfully computed quarter the Displayed_Quarter and the failed quarter the Planning_Quarter, SHALL enable the controls again, and THE Game_Screen SHALL show a message with the error code and details.
9. WHEN a quarter is computed, THE Timeline_View SHALL list every Event_Card whose `firstQuarter` is that quarter with its date, title, description and source links taken from its own fields, with no added text.
10. WHILE a quarter is being computed, THE Turn_Bar SHALL disable the Next_Quarter_Action, the Fast_Forward_Action and the Apply_Controls and SHALL show a text busy state.
11. IF the player activates a control disabled under criterion 10, THEN THE Game_Controller SHALL ignore the activation.
12. THE Turn_Bar SHALL name the buttons "Next quarter" and "Fast-forward one year" and SHALL make both operable with Enter and Space.
13. WHEN the player activates the Next_Quarter_Action or the Fast_Forward_Action on the developer's test machine with a production build, THE Game_Controller SHALL show the new Displayed_Quarter within 1,000 ms per Next_Quarter_Action and within 4,000 ms per Fast_Forward_Action, for any quarter from 2015Q1 to 2025Q4.
14. THE Game_Controller SHALL derive every displayed value from the Player_Policy_Timeline and the Data_Files only, so that the same Save shows identical values every time it is loaded.

### Requirement 8: Policy panel

**User Story:** As a player, I want to see each tool's cost, delay, limits and sources before I change it, so that I understand the trade-off.

#### Acceptance Criteria

1. THE Policy_Panel SHALL list the 5 Policy_Tools under two headings in this order: "Housing" (social housing construction, sublease and rental management, rent subsidy, vacant and multiple-home holding tax) and "Transit" (commuter pass subsidy).
2. THE Policy_Panel SHALL determine at run time from the tool ids of the Rule_Registry whether a Policy_Tool is an Active_Tool or a Coming_Soon_Tool, and the source code in `src/ui/` SHALL contain no list of tool ids marked as coming soon.
3. WHERE a Policy_Tool is a Coming_Soon_Tool, THE Policy_Panel SHALL show its name, the label "Coming soon", its real value and unit for the Planning_Quarter from `policy-track.json` labelled "real value" with the flag "estimated" WHERE the record has `estimated: true`, and SHALL offer no edit control for the tool.
4. WHERE a Policy_Tool is an Active_Tool, THE Policy_Panel SHALL show for each Tool_Field and Area: the real value for the Planning_Quarter with the flag "estimated" WHERE the record has `estimated: true`, the player's value, the unit cost in TWD, the Lag in quarters, the lower and upper limit returned by `checkLimit`, and the remaining Budget_Ceiling of the tool for the calendar year of the Planning_Quarter in TWD.
5. THE Policy_Panel SHALL show for the unit cost, the Lag and each limit the citation, URL and `status` of its Parameter, and its estimate method WHERE the Parameter is marked `estimated`.
6. IF a Parameter of criterion 5 has no citation, THEN THE Policy_Panel SHALL show "No source recorded" in place of the citation.
7. WHERE a Tool_Field has city-year scope (`socialHousing.unitsStarted`), THE Policy_Panel SHALL edit the value for the Selected_District and SHALL show the city's total over the 4 quarters of the calendar year against the city-year limits.
8. WHILE a Tool_Field has city-year scope and no Selected_District is set, THE Policy_Panel SHALL show "Select a district to edit this field." and SHALL offer no edit control for that field.
9. WHILE the Commuter_Pass_Tool is inactive for a city in the Planning_Quarter (real pass price 0), THE Policy_Panel SHALL show "No commuter pass product existed in this quarter" for that city and SHALL offer no edit control for it.
10. THE Policy_Panel SHALL offer for each editable Tool_Field and Area a Set_To_Real_Control, disabled WHILE the player's values of that field and Area equal the Real_Policy_Track values in every quarter from the Planning_Quarter to 2025Q4.
11. IF `policy-track.json` has no real value for a Tool_Field, Area and Planning_Quarter, THEN THE Policy_Panel SHALL show "No real value recorded" and SHALL disable the Set_To_Real_Control of that field and Area.
12. WHERE a Policy_Tool is an Active_Tool, THE Policy_Panel SHALL describe its primary effects in fixed text with an equal number of benefit statements and cost statements, each naming the affected group, the indicator, the direction of change and the Lag, in text that passes Requirement 15.4 to 15.6.
13. WHEN the Planning_Quarter or the Selected_District changes, THE Policy_Panel SHALL show the values of criteria 3 and 4 for the new Planning_Quarter and Selected_District.

### Requirement 9: Live budget and applying adjustments

**User Story:** As a player, I want to see the budget change while I edit and be stopped before I overspend, so that every choice stays within the real budget.

#### Acceptance Criteria

1. WHEN the player edits a Tool_Field value, THE Policy_Panel SHALL show, within 200 ms of the last edit, the Annual_Budget, the committed spending and the remaining budget of the calendar year of the Planning_Quarter, computed by the Game_Controller with `checkBudget` on the Player_Policy_Timeline with the edited value applied from the Planning_Quarter on.
2. IF an edited value lies outside the limits returned by `checkLimit`, THEN THE Policy_Panel SHALL disable the Apply_Control and SHALL show whether the lower or the upper limit is broken, the limit value and unit, its Parameter citation and the reason given in its source.
3. IF `checkBudget` rejects the edited setting, THEN THE Policy_Panel SHALL disable the Apply_Control and SHALL show the year, whether the Annual_Budget or the Budget_Ceiling of the tool is exceeded, the amount of that budget, and the amount over in TWD, which is greater than 0.
4. IF the edited setting passes `checkLimit` and `checkBudget` but `runRange` returns an Engine_Error for the Planning_Quarter in any Scenario, THEN THE Policy_Panel SHALL disable the Apply_Control and SHALL show the error message followed by the text "This happens in one of the parameter assumptions of the possible range.", with no Scenario name.
5. WHEN an edited value is rejected under criterion 2, 3, 4 or 11, THE Policy_Panel SHALL keep the entered text exactly as entered, and THE Game_Controller SHALL leave the Player_Policy_Timeline and the Timeline_Entries unchanged.
6. WHEN the player applies an accepted Value_Adjustment, THE Game_Controller SHALL write the new value into the Player_Policy_Timeline for every quarter from the Planning_Quarter to 2025Q4 and SHALL add exactly one Timeline_Entry.
7. IF a Policy_Adjustment targets a Fixed_Quarter, THEN THE Game_Controller SHALL reject the Policy_Adjustment, SHALL leave the Player_Policy_Timeline unchanged, and THE Policy_Panel SHALL show "Computed quarters are fixed. Changes apply from <Planning_Quarter>."
8. IF a value carried forward under criterion 6 lies outside a limit or the budget of a later quarter, THEN THE Game_Controller SHALL stop before computing that quarter, also during a Fast_Forward_Action, and THE Policy_Panel SHALL show the affected Tool_Field, the limit or budget, the value and the Set_To_Real_Control.
9. THE Policy_Panel SHALL show each editable value in an input field with its unit next to the field, accepting text of digits with at most one decimal point and an optional leading minus sign.
10. WHERE a Tool_Field is a Count_Field, THE Policy_Panel SHALL accept only integers in its input field.
11. IF the text of an input field does not match the format of criterion 9 or 10, THEN THE Policy_Panel SHALL disable the Apply_Control, SHALL name the field and the expected format, and THE Game_Controller SHALL make no Engine call for that text.
12. WHILE the edited value differs from the player's current value and passes `checkLimit`, `checkBudget` and `runRange` in all three Scenarios, THE Policy_Panel SHALL enable the Apply_Control.
13. WHILE the checks of criterion 12 for the latest edit have not finished, THE Policy_Panel SHALL disable the Apply_Control.
14. WHEN the player activates an enabled Set_To_Real_Control and the Real_Track_Adjustment passes `checkLimit`, `checkBudget` and `runRange` in all three Scenarios for the Planning_Quarter, THE Game_Controller SHALL write the Real_Policy_Track value of each quarter from the Planning_Quarter to 2025Q4 into the Player_Policy_Timeline for that Tool_Field and Area and SHALL add exactly one Timeline_Entry marked as a Real_Track_Adjustment.
15. IF a Real_Track_Adjustment fails `checkLimit`, `checkBudget` or `runRange` for the Planning_Quarter, THEN THE Policy_Panel SHALL show the message of criterion 2, 3 or 4, and THE Game_Controller SHALL leave the Player_Policy_Timeline and the Timeline_Entries unchanged.

### Requirement 10: Construction progress

**User Story:** As a player, I want to see how far my extra social housing has progressed, so that I understand why the effect has not arrived yet.

#### Acceptance Criteria

1. THE Policy_Panel SHALL list one row per Construction_Entry with its district name, committed quarter, effect quarter, number of units relative to real, and progress.
2. THE Policy_Panel SHALL show Policy_Differences of the same district committed in different quarters as separate rows.
3. THE Policy_Panel SHALL order the rows by effect quarter ascending and then by district name alphabetically.
4. THE Policy_Panel SHALL show the progress of a Construction_Entry as n, the number of quarters from its committed quarter to the Displayed_Quarter, in the range 0 to Lag − 1, as the text "<n> of <Lag> quarters" and as a bar filled to n ÷ Lag.
5. WHERE the Policy_Difference of a Construction_Entry is positive, THE Policy_Panel SHALL label its units "<u> more units than real", where u is the Policy_Difference.
6. WHERE the Policy_Difference of a Construction_Entry is negative, THE Policy_Panel SHALL label its units "<u> fewer units than real", where u is the absolute value of the Policy_Difference.
7. WHERE the effect quarter of a Construction_Entry is after 2025Q4, THE Policy_Panel SHALL show "completes after 2025Q4" in addition to the progress of criterion 4.
8. WHILE there is no Construction_Entry, THE Policy_Panel SHALL show "No social housing construction differs from the real track."
9. WHEN a Construction_Entry leaves the Lag_Pipeline, THE Timeline_View SHALL show a Completion_Item under its effect quarter, and THE Policy_Panel SHALL remove its row.

### Requirement 11: Policy timeline

**User Story:** As a teacher, I want a timeline of every policy change and event, so that students can retrace the decisions.

#### Acceptance Criteria

1. THE Timeline_View SHALL list items under quarter headings from 2015Q1 to the Planning_Quarter (or to 2025Q4 after 2025Q4 has been computed), with a heading only for quarters that have at least one item.
2. THE Timeline_View SHALL order the items of one quarter as: Event_Cards of the quarter if it is a Computed_Quarter, then Completion_Items, then Timeline_Entries in the order they were applied.
3. THE Timeline_View SHALL show for each Timeline_Entry the display names of the tool, the field and the Area, and the value before and the value after in the number format and unit of the Policy_Panel, with the value after shown as "real track (<real value of the quarter>)" for a Real_Track_Adjustment.
4. THE Timeline_View SHALL show exactly one Timeline_Entry per Policy_Adjustment applied under Requirement 9.6 or 9.14.
5. THE Timeline_View SHALL mark each Major_Event with the text label "Major event" and an icon, and SHALL show the label and icon on no other item.
6. WHEN the player selects a Timeline_Entry by pointer, Enter or Space, THE Policy_Panel SHALL show the Tool_Field of the entry for its Area and SHALL move the keyboard focus to that field.
7. WHEN the player selects a Timeline_Entry whose quarter is a Fixed_Quarter, THE Game_Controller SHALL leave the Player_Policy_Timeline and the Timeline_Entries unchanged.
8. THE Save_Store SHALL keep the Timeline_Entries in the Save in the order they were applied.
9. WHEN a Save is loaded, THE Timeline_View SHALL show the same list of items as before the Save was written.
10. WHILE the Timeline_View has no item, THE Timeline_View SHALL show "No events or policy changes yet."

### Requirement 12: Local save

**User Story:** As a player, I want my game kept in the browser, so that I can continue the next day.

#### Acceptance Criteria

1. THE Save SHALL contain `schemaVersion` (the integer 1), the Engine version, the Planning_Quarter or the Completed_Marker, the Player_Policy_Timeline as Policy_Differences from the Real_Policy_Track, the Timeline_Entries, the Map_Indicator, the Selected_District or `null`, the Demo_Flag, and the seed; THE Save SHALL contain no Sim_State.
2. WHEN a quarter is computed (including each quarter of a Fast_Forward_Action), a Policy_Adjustment is applied, the Map_Indicator changes or the Selected_District changes, THE Save_Store SHALL write the complete Save to `localStorage` before the next player action is accepted.
3. THE Save_Store SHALL keep exactly one Save under one fixed `localStorage` key.
4. WHEN the App starts and a Save exists under the key, THE Game_Screen SHALL offer "Continue", "New game" and "Load demo", and THE Game_Controller SHALL compute no quarter until the player chooses one.
5. WHEN the App starts and no Save exists under the key, THE Game_Screen SHALL offer "New game" and "Load demo" only.
6. WHEN a Save is loaded, THE Game_Controller SHALL recompute every quarter from 2015Q1 to the quarter before the Planning_Quarter, or to 2025Q4 WHERE the Save has the Completed_Marker, with the Engine.
7. IF the stored text fails Requirement 13 validation or the recomputation returns an Engine_Error, THEN THE Game_Screen SHALL show the reason and SHALL offer "Export stored text", "New game" and "Load demo", and THE Save_Store SHALL keep the stored text unchanged until the player confirms "New game" or "Load demo".
8. WHEN the player chooses "Export stored text", THE Game_Screen SHALL show the exact stored text in a read-only text field with a "Copy" control.
9. IF `localStorage` is unavailable or a write fails, THEN THE Game_Screen SHALL show "This browser did not store the game. Export a save code to keep it." until the next successful write, and THE Game_Controller SHALL continue the game in memory.
10. WHEN the player chooses "New game" or "Load demo" while a Save exists, THE Game_Screen SHALL ask for confirmation before the Save is replaced.
11. IF the player declines the confirmation of criterion 10, THEN THE Game_Controller SHALL keep the current game and THE Save_Store SHALL keep the stored Save unchanged.
12. FOR ALL Saves written under criterion 2, reloading the page and choosing "Continue" SHALL show the same Displayed_Quarter, Planning_Quarter, displayed values, Timeline_View items, Map_Indicator and Selected_District as before the reload (round-trip property).

### Requirement 13: Save code export and import

**User Story:** As a player, I want to copy my game as a code and load it elsewhere, so that I can share it or move devices.

#### Acceptance Criteria

1. WHEN the player chooses "Export save code", THE Save_Store SHALL encode the Save as a Save_Code of at most 200,000 characters made only of the characters `A–Z`, `a–z`, `0–9`, `-`, `_` and `.`, starting with the prefix `BC1.`, and THE Game_Screen SHALL show it in a read-only text field with a "Copy" control.
2. THE Save_Store SHALL encode equal Saves into identical Save_Codes.
3. THE Save_Store SHALL decode a Save_Code into a Save.
4. FOR ALL valid Saves, decoding the encoded Save_Code SHALL produce a Save deep-equal to the original (round-trip property).
5. WHEN the player pastes text and chooses "Import", THE Save_Store SHALL treat the text as untrusted, SHALL remove leading and trailing whitespace, and SHALL validate the text in this order before any value is used: (a) the prefix `BC1.`; (b) a length of at most 200,000 characters with at least 1 character after the prefix; (c) the encoding; (d) JSON parsing; (e) `schemaVersion`; (f) the JSON structure, with no missing field and no unknown field at any level; (g) every field type; (h) every Quarter_Key in the range 2015Q1 to 2025Q4, and either a Planning_Quarter or the Completed_Marker; (i) no Timeline_Entry quarter after the Planning_Quarter; (j) every tool id and field against the Rule_Registry; (k) every District_Code and city against `districts.json`; (l) the Map_Indicator as one of the 4 Map_Indicators; (m) the Selected_District as a District_Code of `districts.json` or `null`; (n) the Demo_Flag as a boolean; (o) the seed as an integer; (p) every number as finite.
6. IF a Save_Code fails validation, THEN THE Save_Store SHALL return an error that names the path of the first failing field (for example `timeline[3].quarter`) and the reason, THE Game_Screen SHALL show the error next to the import field, and the current game and the stored Save SHALL stay unchanged.
7. IF a Save_Code has a `schemaVersion` other than 1, THEN THE Save_Store SHALL reject it with the message "This save code was made by a different version of Butterfly City."
8. IF a valid Save_Code was made with a different Engine version, THEN THE Game_Screen SHALL show a notice that names both Engine versions and states that results may differ, and THE Game_Controller SHALL continue loading the Save.
9. FOR ALL strings, and FOR ALL JSON values encoded with a valid prefix, THE Save_Store decode function SHALL return a Save or an error and SHALL throw no exception (property test).
10. WHEN an imported Save passes validation and its recomputation as in Requirement 12.6 returns no Engine_Error, THE Game_Controller SHALL replace the current game, THE Save_Store SHALL write the Save to `localStorage`, and THE Game_Screen SHALL show the Displayed_Quarter of the imported game.
11. IF the recomputation of an imported Save returns an Engine_Error, THEN THE Game_Screen SHALL show the reason and the failing quarter, and the current game and the stored Save SHALL stay unchanged.
12. WHEN the player chooses "Import" while the current game has at least one Computed_Quarter or one Timeline_Entry, THE Game_Screen SHALL ask for confirmation before the current game is replaced.
13. IF writing a Save_Code to the clipboard fails, THEN THE Game_Screen SHALL select the text in the read-only text field and SHALL show "The code could not be copied automatically. The text is selected; copy it by hand."

### Requirement 14: Demo save

**User Story:** As a teacher, I want a demo game already played into 2021, so that I can show the features in class without playing five years first.

**Demo goal.** In 2015–2016 the Demo_Save reduces the rent subsidy and increases social housing; at 2021Q1 (the Demo_Comparison_Quarter) the Ghost count differs visibly from the Zero_Delta_Run (real history). The concrete adjustment values are TODO: they are recomputed once the real `params.json` exists, and the section "Demo_Save draft adjustments" at the end of this document is a provisional, fixture-based draft. The comparison uses the Demo_Lookahead_State: the demo stops with Planning_Quarter 2021Q1 (criterion 1), and the player sees 2021Q1 after one Next_Quarter_Action.

#### Acceptance Criteria

1. THE App SHALL include exactly one Demo_Save as a committed Save_Code with Planning_Quarter 2021Q1 and Displayed_Quarter 2020Q4.
2. THE Demo_Save SHALL pass the validation of Requirement 13.5.
3. THE Demo_Save SHALL contain at least one Timeline_Entry for each Active_Tool.
4. THE Demo_Save SHALL contain at least one Construction_Entry with an effect quarter of 2021Q1 or later.
5. THE Demo_Script SHALL produce the Demo_Save from the Demo_Base_List or the Demo_Enlarged_List under criteria 20 to 22, each of whose Policy_Adjustments passes `checkLimit` and `checkBudget` for its Planning_Quarter, and SHALL apply them with the Game_Controller rules of Requirements 9.6 and 9.14.
6. IF a Policy_Adjustment of the list in use fails `checkLimit` or `checkBudget`, or a quarter from 2015Q1 to the Demo_Comparison_Quarter stops under Requirement 9.8, THEN THE Demo_Script SHALL exit with a non-zero code, SHALL name the list and the failing adjustment or quarter, and SHALL write no output.
7. THE Test_Suite SHALL check that the committed Demo_Save Save_Code and the committed Demo_Summary equal the Demo_Script output character for character.
8. THE Test_Suite SHALL check that recomputing the Demo_Save from 2015Q1 to 2020Q4 and computing the Demo_Lookahead_State in all three Scenarios on the real files of `public/data/` returns no Engine_Error.
9. WHILE the Demo_Flag of the current game is `true`, THE Turn_Bar SHALL show the label "Demo game", including after "Continue" on a later start, until the player chooses "New game" or an import replaces the game.
10. WHEN the player chooses "Load demo", THE Game_Screen SHALL show, before loading, a description that lists every Policy_Adjustment of the Demo_Save with its tool, field, Area, quarter and value, and the sentence "These adjustments are examples, not recommendations."
11. WHEN the player confirms "Load demo" while a Save exists, THE Game_Screen SHALL ask for confirmation as in Requirement 12.10.
12. IF loading the Demo_Save fails, THEN THE Game_Screen SHALL show the reason, and the current game and the stored Save SHALL stay unchanged.
13. THE Demo_Save SHALL contain at least one Rent_Subsidy_Tool Value_Adjustment with a Planning_Quarter from 2015Q1 to 2016Q4 that sets a value below the Real_Policy_Track value of its Planning_Quarter.
14. THE Demo_Save SHALL have a Player_Policy_Timeline whose sum of `socialHousing.unitsStarted` over the 41 districts and the quarters 2015Q1 to 2016Q4 is greater than the same sum of the Real_Policy_Track.
15. FOR each of the calendar years 2015 and 2016, the Social_Housing_Charge of the Demo_Save run minus the real Social_Housing_Charge SHALL be greater than 0 and no greater than the real Rent_Subsidy_Charge minus the Rent_Subsidy_Charge of the Demo_Save run.
16. WHERE a Value_Adjustment of the Demo_Save with a Planning_Quarter from 2015Q1 to 2016Q4 changes a Tool_Field and Area, THE Demo_Save SHALL contain a later Real_Track_Adjustment of that Tool_Field and Area with a Planning_Quarter no later than 2017Q1.
17. THE Demo_Save run SHALL have at least one Social_Housing_Tool Construction_Entry committed from 2015Q1 to 2016Q4 that has left the Lag_Pipeline by 2020Q4 under the `socialHousing.lag` of `params.json` and has a Completion_Item.
18. THE Demo_Script SHALL compute every run of every Fallback_Step with the Parameter_Table of the committed `public/data/params.json` exactly as read, and SHALL accept no Parameter value from any other input (no Parameter, including `ghost.sensitivityRent`, `ghost.size`, the unit costs, the Lags and the rent ratios, is set or changed for the Demo_Save, because a Parameter tuned after seeing a result counts as calibration under simulation-engine Requirement 20.6 and simulation-engine Open Question 22).
19. IF `public/data/params.json` is missing or fails the validation of the Data_Loader, THEN THE Demo_Script SHALL exit with a non-zero code, SHALL state that the real `params.json` is required, and SHALL write no output.
20. WHEN the absolute Demo_Ghost_Difference of the Demo_Base_List run is at least the Demo_Ghost_Threshold, THE Demo_Script SHALL produce the Demo_Save from the Demo_Base_List with Fallback_Step 0.
21. IF the absolute Demo_Ghost_Difference of the Demo_Base_List run is below the Demo_Ghost_Threshold and the absolute Demo_Ghost_Difference of the Demo_Enlarged_List run is at least the Demo_Ghost_Threshold, THEN THE Demo_Script SHALL produce the Demo_Save from the Demo_Enlarged_List with Fallback_Step 1.
22. IF the absolute Demo_Ghost_Difference is below the Demo_Ghost_Threshold for both the Demo_Base_List run and the Demo_Enlarged_List run, and the absolute Demo_Rent_Burden_Difference of the Demo_Enlarged_List run is at least the Demo_Rent_Burden_Threshold in at least one district, THEN THE Demo_Script SHALL produce the Demo_Save from the Demo_Enlarged_List with Fallback_Step 2.
23. IF no Fallback_Step meets its condition under criteria 20 to 22, or the list of the reached Fallback_Step fails criterion 13, 14, 15, 16 or 17, THEN THE Demo_Script SHALL exit with a non-zero code, SHALL name the last Fallback_Step tried and each failed condition with its computed value and threshold, and SHALL write no output.
24. THE Demo_Enlarged_List SHALL contain the same Policy_Adjustments as the Demo_Base_List in order, quarter, tool, field, Area and kind (Value_Adjustment or Real_Track_Adjustment), with the absolute Policy_Difference of each Value_Adjustment at least as large as in the Demo_Base_List and larger for at least one Value_Adjustment.
25. WHEN the Demo_Script exits with code 0, THE Demo_Script SHALL write the Demo_Summary with the Fallback_Step reached, the Demo_Ghost_Difference as central value, minimum and maximum over the three Scenarios, the Demo_Ghost_Threshold, the district and value of the largest absolute Demo_Rent_Burden_Difference, and the Demo_Rent_Burden_Threshold, and SHALL print the same values to standard output for each Fallback_Step tried.
26. WHERE the Demo_Save has Fallback_Step 0 or 1, THE Demo_Save SHALL have the Map_Indicator Rent_Burden and as Selected_District the district with the largest absolute central Ghost count difference between the Demo_Lookahead_State and the Zero_Delta_Run (the lowest District_Code on a tie), and THE Game_Screen SHALL show in the description of criterion 10 the Demo_Ghost_Difference first and the Demo_Rent_Burden_Difference of that district second, both for 2021Q1 after one Next_Quarter_Action.
27. WHERE the Demo_Save has Fallback_Step 2, THE Demo_Save SHALL have the Map_Indicator Rent_Burden and as Selected_District the district with the largest absolute Demo_Rent_Burden_Difference (the lowest District_Code on a tie), and THE Game_Screen SHALL show in the description of criterion 10 the Demo_Rent_Burden_Difference of that district first and the Demo_Ghost_Difference second, both for 2021Q1 after one Next_Quarter_Action.
28. THE Test_Suite SHALL check, on the real files of `public/data/`, that the condition of the Fallback_Step recorded in the committed Demo_Summary holds for the committed Demo_Save (criterion 20, 21 or 22), that criteria 17, 26 and 27 hold, and that the Parameter_Table used by the Demo_Script is deep-equal to the committed `params.json` (criterion 18).
29. THE Test_Suite SHALL check criteria 13, 14, 15, 16 and 24 on the committed Demo_Save, the Demo_Base_List and the Demo_Enlarged_List.

### Requirement 15: Neutral and complete UI text

**User Story:** As a reader from any political position, I want the screen text to describe facts and trade-offs only, so that I can trust it.

#### Acceptance Criteria

1. THE Game_Screen SHALL show the Disclosure_Text word for word inside the initial viewport at every viewport width from 360 to 1920 CSS pixels, without scrolling, opening a menu or any other interaction.
2. THE Game_Screen SHALL render the Disclosure_Text as text in the DOM.
3. THE UI_Strings_Module SHALL hold, in English, every text shown on the Game_Screen, including the Demo_Save description, the policy effect text of Requirement 8.12 and the Parameter display names of the Range_Source_View, and excluding text taken from the Data_Files.
4. THE Test_Suite SHALL check every string of the UI_Strings_Module against the Banned_Term_List with the list's matching rules (Latin-script terms case-insensitive on whole words, CJK terms as substrings, matches inside a phrase of the Exempt_List ignored) and SHALL fail with the string key and the term of each match.
5. THE UI_Strings_Module SHALL contain no score, grade or rank and no wording that describes a player's choice as good or bad.
6. THE UI_Strings_Module SHALL contain no party, politician or administration name other than an official policy title listed in the Exempt_List.
7. WHEN UI strings are added or changed, THE Developer SHALL apply the `neutrality.md` review check and SHALL record in `KIRO-LOG.md` the date, the string keys reviewed and the result.
8. THE Game_Screen SHALL show Event_Card text exactly as written in `events.json` with all of its source links.
9. WHERE a source of an Event_Card is Wikipedia, THE Game_Screen SHALL show the CC BY-SA attribution with a link to the Wikipedia page.

### Requirement 16: Responsive layout

**User Story:** As a student on a phone or a teacher on a projector, I want the screen to work at my width, so that I can use every feature.

#### Acceptance Criteria

1. THE Game_Screen SHALL show no horizontal scrolling of the page at every viewport width from 360 to 1920 CSS pixels and every viewport height from 480 to 1200 CSS pixels.
2. THE Game_Screen SHALL make the Map_View, the District_Panel, the Turn_Bar, the Policy_Panel and the Timeline_View reachable at every viewport size of criterion 1, each either visible, reachable by vertical scrolling, or shown after activating at most one control.
3. THE Game_Screen SHALL make every part of criterion 2 reachable in the same way with pointer input only and with keyboard input only.
4. THE Turn_Bar SHALL keep the Next_Quarter_Action, the Fast_Forward_Action, the Planning_Quarter and the Displayed_Quarter inside the viewport at every scroll position and every viewport size of criterion 1.
5. THE Map_View SHALL show all 41 districts without panning at every viewport size of criterion 1.
6. THE interactive controls SHALL have a target size of at least 44 × 44 CSS pixels at viewport widths below 1024 CSS pixels and at least 24 × 24 CSS pixels at viewport widths from 1024 to 1920 CSS pixels.
7. WHERE an interactive element is a district shape, THE Map_View SHALL be exempt from criterion 6, because each district shape is keyboard focusable and each district is also selectable from the District_List.
8. WHILE the browser zoom is 200 percent at a viewport width of 1280 CSS pixels, THE Game_Screen SHALL meet criteria 1, 2, 3, 4 and 5 with no clipped or overlapping text.
9. WHEN the viewport is resized or rotated, THE Game_Screen SHALL keep the Selected_District, the Map_Indicator, the Displayed_Quarter, the Planning_Quarter, unapplied edits in the Policy_Panel and the keyboard focus.

### Requirement 17: Accessibility and motion

**User Story:** As a player with a disability, I want to use the whole game with a keyboard and a screen reader and without motion, so that the game is open to me.

#### Acceptance Criteria

1. THE Game_Screen SHALL make every control reachable and operable by keyboard, with no keyboard trap outside the dialogs of criterion 13.
2. THE Game_Screen SHALL move the keyboard focus in an order that follows the visual reading order.
3. THE Game_Screen SHALL show a focus indicator at least 2 CSS pixels thick with a contrast ratio of at least 3:1 against the adjacent colours.
4. THE Game_Screen SHALL carry every meaning shown by colour (Indicator_Class, focused and selected state, estimate, "no value", rejected Policy_Panel state, Major_Event) also as text, a number, a pattern or an icon, so that the meaning is readable in greyscale.
5. THE Game_Screen SHALL give body text a contrast ratio of at least 4.5:1 and large text (at least 24 CSS pixels, or at least 18.66 CSS pixels bold) a contrast ratio of at least 3:1.
6. THE Game_Screen SHALL give map outlines, legend swatches and control borders a contrast ratio of at least 3:1 against the adjacent colours.
7. WHEN a Computation_Run finishes, THE Game_Screen SHALL make one polite live-region announcement with the new Displayed_Quarter and the titles of the Major_Events whose `firstQuarter` is a quarter computed in that Computation_Run.
8. IF the Engine returns an Engine_Error, THEN THE Game_Screen SHALL make an assertive live-region announcement of the error message.
9. WHILE `prefers-reduced-motion: reduce` applies, THE Game_Screen SHALL run no transition or animation longer than 0 ms and SHALL show the static end state of each transition and animation.
10. WHEN the `prefers-reduced-motion` setting changes while the App runs, THE Game_Screen SHALL apply the new setting without a page reload.
11. THE Game_Screen SHALL contain no element that flashes more than three times in any one-second period and no flashing area larger than 25 percent of the viewport.
12. WHEN a dialog (confirmation, import, export, Event_Card, Range_Source_View) opens, THE Game_Screen SHALL move the keyboard focus to the first focusable element of the dialog and SHALL give the dialog an accessible name equal to its title.
13. WHILE a dialog is open, THE Game_Screen SHALL keep the keyboard focus inside the dialog.
14. WHEN the player presses Escape in a dialog, THE Game_Screen SHALL close the dialog and cancel its action with no change to the game or the stored Save.
15. WHEN a dialog closes, THE Game_Screen SHALL return the keyboard focus to the control that opened the dialog or, WHERE that control no longer exists, to the Next_Quarter_Action.

### Requirement 18: Module boundaries and dependencies

**User Story:** As the developer, I want the UI to stay free of simulation logic, so that the engine remains the single source of every number.

#### Acceptance Criteria

1. THE modules in `src/ui/` SHALL import from `src/simulation/` only with `import type`, SHALL import nothing from `src/save/` or `src/data/`, and SHALL obtain every value through the Game_Controller.
2. THE Test_Suite SHALL include a static boundary test over every TypeScript file in `src/` that checks criteria 1, 3, 6 and 7 and fails with the file name and the import path of each violation.
3. THE modules in `src/save/` SHALL import nothing from `src/ui/`.
4. THE modules in `src/game/` SHALL obtain every simulated value and every Parameter_Assumption from the Engine and SHALL compute only the display conversions Price_To_Income (Requirement 3.5) and Population_Change (Glossary).
5. THE Test_Suite SHALL check that the values the Game_Controller passes to the UI equal the `runRange` output for at least one district per city and at least two quarters.
6. THE modules in `src/simulation/` SHALL import nothing from `src/ui/`, `src/game/`, `src/save/` or `src/data/`.
7. THE modules in `src/` SHALL import nothing from `scripts/`.
8. THE App SHALL use no UI framework, SHALL build its DOM with plain DOM APIs and SVG, and SHALL have no runtime dependency other than `d3-geo` and packages the user has approved.
9. THE Developer SHALL add exactly the packages `vite`, `d3-geo` and `@types/d3-geo`, which the user approved on 2026-11-16, SHALL pin each to an exact version, SHALL commit `package-lock.json`, and SHALL record the approval in `KIRO-LOG.md` with the date 2026-11-16, the three package names and their pinned versions.
10. THE Developer SHALL add no DOM test package (for example `jsdom` or `happy-dom`); THE Test_Suite SHALL test UI logic through pure functions in Node, and THE Developer SHALL check the DOM by hand under Requirement 19.11.
11. WHEN a package other than those of criterion 9 is needed, THE Developer SHALL explain to the user why the package is needed and what the alternative is, and SHALL add the package only after the user's explicit approval.
12. THE App SHALL make network requests only for its own built assets and the Data_Files of Requirement 2.1.
13. THE App SHALL open an external link only WHEN the player activates the link.

### Requirement 19: Tests

**User Story:** As the developer, I want the turn logic, saves and UI rules tested, so that changes do not break a game in progress.

#### Acceptance Criteria

1. THE Test_Suite SHALL include Game_Controller tests that check: the Next_Quarter_Action advances one quarter (Requirement 7.1); the Fast_Forward_Action stops after 4 quarters, at a Major_Event quarter, at 2025Q4, at an Engine_Error and before a quarter where a carried value breaks a limit (Requirements 7.5, 7.7, 7.8 and 9.8), checking the Displayed_Quarter and the Planning_Quarter after each stop; a Policy_Adjustment for a Fixed_Quarter is rejected (Requirement 9.7); a Real_Track_Adjustment writes the Real_Policy_Track value of every later quarter and adds one Timeline_Entry (Requirement 9.14); and the same Save gives deep-equal displayed values twice (Requirement 7.14).
2. THE Test_Suite SHALL include tests for an edited value below the lower limit, above the upper limit and over the budget (Requirements 9.2 and 9.3), each checking that the Player_Policy_Timeline and the Timeline_Entries stay unchanged (Requirement 9.5).
3. THE Test_Suite SHALL include a fast-check round-trip property for Save_Codes (Requirement 13.4) with at least 100 cases.
4. THE Test_Suite SHALL include a fast-check never-throws property for the decode function (Requirement 13.9) with three generators of at least 100 cases each (arbitrary strings with a size limit that keeps the test fast, `BC1.` followed by arbitrary characters, and arbitrary JSON values encoded with a valid prefix) and one fixed example longer than 200,000 characters, each checking that invalid input is rejected.
5. THE Test_Suite SHALL include one example test per validation step of Requirement 13.5 and the tests of Requirements 13.6 and 13.7, each checking the first failing field and that the current game stays unchanged.
6. THE Test_Suite SHALL include the Coming_Soon_Tool test: with the real Rule_Registry, `sublease` and `holdingTax` are Coming_Soon_Tools and the other three are Active_Tools; with a test copy of the Rule_Registry that adds a stub `sublease` rule, `sublease` becomes an Active_Tool; with a test copy that removes a tool id, that tool becomes a Coming_Soon_Tool; both without a UI change (Requirement 8.2).
7. THE Test_Suite SHALL include the static style test of Requirement 1.9, the static boundary test of Requirement 18.2, the banned-term test of Requirement 15.4, and the Demo_Save tests of Requirements 14.7, 14.8, 14.28 and 14.29.
8. THE Test_Suite SHALL include unit tests for the accessible name builder (Requirements 4.2 and 4.3, including an estimated value, a "same in all scenarios" value and "no value"), the Indicator_Classes (Requirement 3.9, including a value exactly on each bound), the Price_To_Income conversion (Requirements 3.5, 3.6 and 3.14, against a hand-computed value, with a missing Median_Total_Price, a zero `householdIncome` and the estimate flag) and the construction progress (Requirement 10.4, at n = 0, at n = Lag − 1 and with an effect quarter after 2025Q4).
9. THE Test_Suite SHALL include Save_Store tests for `localStorage` unavailable, a failing write and invalid stored text (Requirements 12.7 and 12.9).
10. THE Test_Suite SHALL include Data_Loader tests for a missing, an unparsable and an invalid Data_File and for a `history.json` without `medianTotalPrice` (Requirement 2.5), and a test that the Data_Loader requests no URL outside the Data_Files of Requirement 2.1.
11. THE Developer SHALL check Requirements 3.1, 3.2, 16 and 17 by hand at 360, 768, 1280 and 1920 CSS pixels in current Chrome, Firefox and Safari, with keyboard only and with a screen reader, and SHALL record in `KIRO-LOG.md` for each check the date, the viewport width, the browser and version, the screen reader and version, the criterion, pass or fail, and a description of each failure.
12. WHEN the Developer runs `npx vitest --run` and `npm run typecheck`, both SHALL exit with code 0, with no test skipped, marked todo or marked `.only`.
13. THE Test_Suite SHALL include unit tests for the Range_Display formatter (Requirements 5.2, 5.7 and 5.8: three different values, three values equal after formatting, and values that differ only before formatting) and a test that no string of the UI_Strings_Module contains the texts "Strong response", "Weak response" or "Central" and that no view data the Game_Controller passes to the UI contains a Scenario id as a display text (Requirement 5.3).
14. THE Test_Suite SHALL include Range_Source_View tests that check, for a value whose minimum comes from the `low` Scenario and for a value whose minimum comes from the `high` Scenario, that the Parameter_Assumptions listed for the minimum and the maximum equal the values, citations and URLs of `scenarioTable` for those Scenarios (Requirement 20.2), and that a value with equal Result_Range values gives the text of Requirement 20.4.

### Requirement 20: Range source view

**User Story:** As a teacher, I want to see which study assumptions give the low and high end of a possible range, so that students can follow where the uncertainty comes from.

#### Acceptance Criteria

1. WHEN the player activates the "Why?" control of a simulated value by click, Enter or Space, THE Game_Screen SHALL open the Range_Source_View of that value, district and Displayed_Quarter.
2. THE Game_Controller SHALL determine for the minimum and for the maximum of the Result_Range the Scenario that produced it and SHALL give the UI, for each, the Parameter_Assumptions of `SCENARIO_EFFECT_IDS` in the table returned by `scenarioTable` for that Scenario: Parameter display name, value, unit, citation (the `range.lowSource` or `range.highSource` citation for a ranged value, otherwise the `source` citation) and URL.
3. THE Range_Source_View SHALL show the Range_Display of the value, then a section "Lowest result" with the minimum and its Parameter_Assumptions, then a section "Highest result" with the maximum and its Parameter_Assumptions, with no Scenario name.
4. IF the minimum, central value and maximum of the Result_Range are equal after formatting under Requirement 6.10, THEN THE Range_Source_View SHALL show the single value and the text "This value is the same under every parameter assumption in the model."
5. IF a Parameter_Assumption has no citation or no URL, THEN THE Range_Source_View SHALL show "No source recorded" in place of the missing citation or URL.
6. WHERE the Range_Source_View shows a section for the cause breakdown of the value, THE Range_Source_View SHALL show that section disabled, labelled "Cause breakdown (coming soon)" and exposed to assistive technology as disabled.
7. THE Range_Source_View SHALL show the text of Requirement 5.4.
8. THE Range_Source_View SHALL list each Parameter_Assumption with the same level of detail for the minimum and the maximum, in text that passes Requirement 15.4 to 15.6.

## Open Questions

Each open question has a default in brackets that the requirements above use. Resolved questions keep their number so that references stay stable.

1. **Missing inputs.** The game cannot compute a quarter until `params.json`, the commute-time matrix, `events.json` and the district `medianTotalPrice` field exist. [Default: build `src/game/` and `src/save/` against the engine test fixtures first; the full screen runs once the four inputs exist.]
2. **Resolved (2026-11-16): new dependencies.** The user approved `vite`, `d3-geo` and `@types/d3-geo`, pinned to exact versions, and no DOM test package. UI logic is tested as pure functions and the DOM is checked by hand (Requirements 18.9, 18.10 and 19.11).
3. **Resolved: district price-to-income.** Median_Total_Price ÷ district `householdIncome`, the city method applied per district, marked estimated, not changed by policies (Requirements 3.5 to 3.7 and 3.14). Needs the data-pipeline field `medianTotalPrice`, planned in data-pipeline Requirement 19 (see "Current state").
4. **Resolved: population change base.** Percent change since 2015Q1 (Glossary, Population_Change).
5. **Resolved: Scenario labels.** No Scenario name or per-Scenario label is shown. Values appear as a Range_Display, and the "Why?" control opens the Range_Source_View (Requirements 5 and 20).
6. **Resolved: adjustment persistence.** A Value_Adjustment holds its absolute value for all later quarters, and the game stops before a quarter where the held value breaks a limit or the budget (Requirements 9.6 and 9.8).
7. **Resolved: fast-forward.** 4 quarters, stopping after a Major_Event quarter is computed (Requirement 7.5).
8. **Resolved: demo quarter.** Planning_Quarter 2021Q1. The adjustment values are TODO until the real `params.json` exists; the draft below is fixture-based and provisional (Requirements 14.13 to 14.29, Open Question 15).
9. **Commuter pass scenario budgets.** The commuter pass charge uses the elasticity, so one Scenario can exceed the budget while the others do not. [Default: the adjustment is applied only when all three Scenarios succeed (Requirements 9.4 and 9.12).]
10. **Commute time before the matrix.** `meanCommuteTime` is a model estimate from the matrix and job shares, not observed data. [Default: show it labelled "model estimate"; it has no policy effect in this engine version, so its range is a single value (Requirement 5.7).]
11. **Budget scope.** The Annual_Budget covers the 3 Active_Tools only (simulation-engine Open Question 4). [Default: the Policy_Panel states "Budget covers the tools currently simulated".]
12. **Target size.** 44 × 44 CSS pixels below 1024 pixels wide and 24 × 24 elsewhere (WCAG 2.5.5 and 2.5.8, Requirement 16.6). [Default as written.]
13. **Resolved: order of the `schemaVersion` check.** `schemaVersion` is checked right after JSON parsing (Requirement 13.5, step e).
14. **Resolved (2026-11-16): returning to the real track.** "Set to real value" makes the Tool_Field follow the Real_Policy_Track quarter by quarter from the Planning_Quarter on (Real_Track_Adjustment, Requirements 8.10 and 9.14). The user confirmed this on 2026-11-16. The demo uses it to end each 2015–2016 change (Requirement 14.16).
15. **Resolved (2026-11-16): Ghost difference in the demo.** The user decided:
    - **Recompute, no Parameter change.** The demo waits for the real `params.json` and is recomputed with it. No Parameter is changed for the Demo_Save, including `ghost.sensitivityRent`, `ghost.size` (Ghost_Size), the unit costs, the Lags and the rent ratios, because a Parameter tuned after seeing a result counts as calibration. The user cited "Requirement 20.6": that rule is simulation-engine Requirement 20.6 (with simulation-engine Open Question 22). Game-ui Requirement 20.6 is a different rule (the disabled cause-breakdown section of the Range_Source_View). See Requirements 14.18 and 14.19.
    - **Goal.** In 2015–2016 the Demo_Save reduces the rent subsidy and increases social housing; at 2021Q1 the Ghost count differs visibly from the Zero_Delta_Run (Requirement 14, "Demo goal"; Requirements 14.13 to 14.17 and 14.20).
    - **Fallback order.** Fallback_Step 0: the Demo_Base_List. Fallback_Step 1: if the 2021Q1 Ghost difference is not visible, the Demo_Enlarged_List with larger adjustment sizes within the `checkLimit` bounds and the budget. Fallback_Step 2: if the difference is still not visible, the Demo_Save shows the Rent_Burden difference as the main effect and the Ghost count as the secondary effect. No step changes a Parameter. The Demo_Script exits with a non-zero code when no step meets its condition, and names the last step tried (Requirements 14.20 to 14.27).
    - **Comparison quarter.** 2021Q1. The Demo_Save keeps Planning_Quarter 2021Q1 and Displayed_Quarter 2020Q4 (Requirement 14.1, Open Question 8). The compared Sim_State is the Demo_Lookahead_State: the 2021Q1 Sim_State that one Next_Quarter_Action computes after loading, with no Policy_Adjustment in between. The alternative, moving the Demo_Save to Displayed_Quarter 2021Q1 and Planning_Quarter 2021Q2, was not chosen because it breaks Requirement 14.1 and the decision that the demo stops at 2021Q1. The lookahead state is fixed by the Demo_Save, because the Player_Policy_Timeline already holds the 2021Q1 values (Requirement 9.6) and computation is deterministic (Requirement 7.14). The demo description states that the difference is shown for 2021Q1 after one Next_Quarter_Action (Requirements 14.26 and 14.27).
    - **Remaining TODO.** (a) The concrete values of the Demo_Base_List and the Demo_Enlarged_List, set when the real `params.json` exists. (b) The Demo_Ghost_Threshold, set with the recompute. [Default: 1 Ghost, total over the 41 districts, central Scenario.] (c) The Demo_Rent_Burden_Threshold, set with the recompute. [Default: 0.1 percentage points in at least one district, central Scenario.] (d) With the fixture values of the draft below, Fallback_Steps 0 and 2 both fail at 2021Q1 (Ghost difference 0; largest Rent_Burden difference −0.0036 percentage points, Datong), so the fixture-based draft would make the Demo_Script exit with an error under Requirement 14.23. No Demo_Enlarged_List was computed with fixture values.

## Demo_Save draft adjustments (TODO: provisional, fixture-based, not final)

**TODO. Provisional draft computed with engine fixture values, not with the real `params.json`.** The tables below are kept as a reference for the recompute only. They are not the Demo_Base_List or the Demo_Enlarged_List. When the real `params.json` exists, the Demo_Base_List and the Demo_Enlarged_List are set and recomputed under Requirements 14.18 to 14.25 with no Parameter changed, and every number in this section is replaced. The values are examples, not recommendations. They show one way to reallocate the budget and what the model computes for it; they do not describe a preferred policy.

### Inputs of the computation (2026-11-16)

- Real data: `public/data/history.json`, `policy-track.json` and `districts.json` as committed. Real values below are read from `policy-track.json`.
- **Fixture values** (from `tests/simulation/fixtures/params.ts`, because `params.json` does not exist): `socialHousing.unitCost` 7,800,000 TWD per unit; `socialHousing.costSchedule` 4 equal shares in the start quarter and the 3 following quarters; `socialHousing.lag` 12 quarters (a second run used 20); `socialHousing.rentRatio` 0.8 (range 0.5 to 0.9); `socialHousing.rentPerUnit` 0 (range −0.002 to 0.005); `rentSubsidy.lag` 1 quarter; `rentSubsidy.passThrough` 0.5 (range 0.16 to 0.78); `commuterPass.elasticity` −0.3 (range −0.5 to −0.2); `housing.dwellingSize` 30 m²; household size 2.5 (Taipei) and 2.7 (New Taipei); renter rate 0.4 (Taipei) and 0.35 (New Taipei); `ghost.size` 1,000; `ghost.sensitivityRent` 0.02 (status `gap`); `ghost.shareRent` 0.15; `ghost.shareCommuteWithin` 0.7 (range 0.55 to 0.7); every limit 0 to 2 times the real value; tool ceilings far above any spending.
- **Fixture commute matrix**: the synthetic 41×41 matrix of `buildCommuteMatrix` and equal job shares, because the real matrix does not exist. Commute time has no policy effect in this engine version, so the matrix changes no difference below.
- Real commuter pass prices from `policy-track.json` (1,280 TWD from 2018Q2 in both cities) replace the fixture prices. `events.json` does not exist, so the runs use no Event_Card.
- Method: a temporary script outside the repository called `checkLimit` and `checkBudget` for every quarter, then `runRange` from 2015Q1 to 2021Q1 for the demo Player_Policy_Timeline and for the Zero_Delta_Run. No file was added to the repository.

### Adjustment list (fixture-based draft, not final)
"Real track" marks a Real_Track_Adjustment (Set_To_Real_Control); the real value of the quarter is in brackets.

| # | Quarter | Tool | Field | Area | Value before | Value after |
|---|---|---|---|---|---|---|
| 1 | 2015Q1 | rentSubsidy | amount | Taipei | 4,699 (real, estimated) | 2,699 |
| 2 | 2015Q1 | rentSubsidy | amount | New Taipei | 3,648 (real, estimated) | 1,648 |
| 3 | 2015Q1 | socialHousing | unitsStarted | Sanchong (65000020) | 75 (real) | 97 |
| 4 | 2015Q2 | socialHousing | unitsStarted | Sanchong (65000020) | 97 | real track (0) |
| 5 | 2016Q1 | socialHousing | unitsStarted | Datong (63000060) | 0 (real) | 26 |
| 6 | 2016Q1 | socialHousing | unitsStarted | Wanhua (63000070) | 273 (real) | 298 |
| 7 | 2016Q2 | socialHousing | unitsStarted | Datong (63000060) | 26 | real track (47) |
| 8 | 2016Q2 | socialHousing | unitsStarted | Wanhua (63000070) | 298 | real track (0) |
| 9 | 2017Q1 | rentSubsidy | amount | Taipei | 2,699 | real track (4,699) |
| 10 | 2017Q1 | rentSubsidy | amount | New Taipei | 1,648 | real track (3,648) |
| 11 | 2019Q1 | rentSubsidy | amount | Taipei | 4,699 (real, estimated) | 2,699 |
| 12 | 2019Q1 | rentSubsidy | amount | New Taipei | 3,648 (real, estimated) | 1,648 |
| 13 | 2019Q1 | commuterPass | subsidy | Taipei | 0 (real, estimated) | 20 |
| 14 | 2019Q1 | socialHousing | unitsStarted | Zhongshan (63000040) | 0 (real) | 14 |
| 15 | 2019Q2 | rentSubsidy | amount | Taipei | 2,699 | real track (4,699) |
| 16 | 2019Q2 | rentSubsidy | amount | New Taipei | 1,648 | real track (3,648) |
| 17 | 2019Q2 | commuterPass | subsidy | Taipei | 20 | real track (0) |
| 18 | 2019Q2 | socialHousing | unitsStarted | Zhongshan (63000040) | 14 | real track (44) |

Choice of districts: districts with a high 2015Q1 Derived_Baseline rent burden (rent × 30 m² × 12 ÷ `householdIncome`) among districts with more than 100,000 residents: Datong 14.0 percent (highest in Taipei), Zhongshan 12.2 percent (second in Taipei), Sanchong 10.7 percent (highest in New Taipei) and Wanhua 10.2 percent (Taipei, a district with real starts in 2016Q1). Taipei had no real starts in 2015, so its 2015 upper limit is 0 units and the Taipei increases are in 2016Q1. All social housing increases are in the first quarter of a year, so the 4-quarter cost schedule stays inside that year.

### (a) Rent subsidy reduction

The number of subsidised households stays at its real value in every quarter. The monthly amount per household is 2,000 TWD lower: Taipei 4,699 → 2,699 TWD (−42.6 percent), New Taipei 3,648 → 1,648 TWD (−54.8 percent). With `rentSubsidy.lag` 1, the reduction acts on the indicators from 2015Q2 to 2017Q1 and in 2019Q2.

| Year | City | Household-quarters affected (sum of the real quarterly households) | Households per quarter | Reduction in TWD |
|---|---|---|---|---|
| 2015 | Taipei | 11,644 | 3,332; 2,852; 2,749; 2,711 | 69,864,000 |
| 2015 | New Taipei | 17,563 | 4,213; 3,714; 4,839; 4,797 | 105,378,000 |
| 2015 | Both | 29,207 | | **175,242,000** |
| 2016 | Taipei | 29,103 | 6,718; 7,615; 7,461; 7,309 | 174,618,000 |
| 2016 | New Taipei | 37,983 | 10,107; 9,899; 9,033; 8,944 | 227,898,000 |
| 2016 | Both | 67,086 | | **402,516,000** |
| 2019 (Q1 only) | Taipei | 9,912 | 9,912 | 59,472,000 |
| 2019 (Q1 only) | New Taipei | 12,141 | 12,141 | 72,846,000 |
| 2019 (Q1 only) | Both | 22,053 | | **132,318,000** |

For scale: the real 2015 rent subsidy spending is 164,145,468 TWD (Taipei) and 192,209,472 TWD (New Taipei).

### (b) Social housing units gained and budget

| City | District | Units above real | Committed quarter | Effect quarter, Lag 12 | Effect quarter, Lag 20 | Spending in TWD |
|---|---|---|---|---|---|---|
| New Taipei | Sanchong | +22 | 2015Q1 | 2018Q1 | 2020Q1 | 171,600,000 (2015) |
| Taipei | Datong | +26 | 2016Q1 | 2019Q1 | 2021Q1 | 202,800,000 (2016) |
| Taipei | Wanhua | +25 | 2016Q1 | 2019Q1 | 2021Q1 | 195,000,000 (2016) |
| Taipei | Zhongshan | +14 | 2019Q1 | 2022Q1 | 2024Q1 | 109,200,000 (2019) |

- Net increase: 73 units in 2015–2016 (New Taipei 22, Taipei 51) and 14 units in 2019. City-year totals: New Taipei 2015 218 of a limit of 0 to 392; Taipei 2016 1,215 of 0 to 2,328; Taipei 2019 3,467 of 0 to 6,906.
- Budget (`checkBudget`, every quarter passed): 2015 remaining 3,642,000 TWD of an Annual_Budget of 1,463,954,940; 2016 remaining 4,716,000 of 10,850,900,943; 2019 remaining 3,313,258 of 34,912,440,660 after the commuter pass charge of 19,804,742 TWD (20 TWD × about 330,000 passes × 3 months, central elasticity). Every other year from 2015 to 2020 has 0 remaining, as in the real track.
- Construction at 2021Q1: Zhongshan row 14 is in the Lag_Pipeline (8 of 12 quarters with Lag 12), which gives Requirement 14.4 its Construction_Entry. With Lag 20, the Datong and Wanhua rows complete in 2021Q1, so only Sanchong has left the Lag_Pipeline by 2020Q4 (Requirement 14.17 still holds).
- Who bears the cost: the subsidised renter households of both cities receive 2,000 TWD less per month for 8 quarters and for 1 quarter in 2019. Who gains: 73 more households in Sanchong, Datong and Wanhua rent social housing from 2018Q1 or 2019Q1 (Lag 12), 14 more in Zhongshan from 2022Q1, and Taipei commuter pass buyers pay 20 TWD less in 2019Q1.

### (c) Total Ghost count, draft run against Zero_Delta_Run (fixture values, Lag 12)

"Central (min–max)" is the central Scenario and the lowest and highest of the three Scenarios. "Difference" is computed per Scenario (demo minus Zero_Delta_Run). "Unrounded difference" is the sum over the 41 districts of the Ghost group Causes of the demo run, before each district's count is rounded down to an integer.

| Quarter | Demo total, central (min–max) | Zero_Delta_Run total, central (min–max) | Difference, central (min to max) | Unrounded difference, central (min to max) |
|---|---|---|---|---|
| 2015Q1 | 2,782 (2,782–3,781) | 2,782 (2,782–3,781) | 0 (0 to 0) | 0.000 (0.000 to 0.000) |
| 2015Q2 | 2,786 (2,786–3,782) | 2,786 (2,786–3,782) | 0 (0 to 0) | +0.294 (+0.129 to +0.388) |
| 2015Q3 | 2,780 (2,780–3,780) | 2,780 (2,780–3,779) | 0 (0 to +1) | +0.256 (+0.112 to +0.337) |
| 2015Q4 | 2,786 (2,786–3,784) | 2,786 (2,786–3,784) | 0 (0 to 0) | +0.302 (+0.133 to +0.398) |
| 2016Q1 | 2,786 (2,786–3,785) | 2,785 (2,785–3,785) | +1 (0 to +1) | +0.291 (+0.128 to +0.385) |
| 2016Q2 | 2,785 (2,784–3,784) | 2,784 (2,784–3,784) | +1 (0 to +1) | +0.641 (+0.282 to +0.847) |
| 2016Q3 | 2,784 (2,782–3,780) | 2,782 (2,782–3,779) | +2 (0 to +2) | +0.657 (+0.289 to +0.867) |
| 2016Q4 | 2,786 (2,785–3,783) | 2,784 (2,784–3,783) | +2 (0 to +2) | +0.612 (+0.269 to +0.808) |
| 2017Q1 | 2,786 (2,784–3,783) | 2,784 (2,784–3,783) | +2 (0 to +2) | +0.598 (+0.263 to +0.789) |
| 2017Q2 | 2,782 (2,782–3,783) | 2,782 (2,782–3,783) | 0 (0 to 0) | 0.000 (0.000 to 0.000) |
| 2017Q3 | 2,779 (2,779–3,781) | 2,779 (2,779–3,781) | 0 (0 to 0) | 0.000 (0.000 to 0.000) |
| 2017Q4 | 2,779 (2,779–3,780) | 2,779 (2,779–3,780) | 0 (0 to 0) | 0.000 (0.000 to 0.000) |
| 2018Q1 | 2,779 (2,779–3,777) | 2,779 (2,779–3,777) | 0 (0 to 0) | −0.002 (−0.005 to +0.006) |
| 2018Q2 | 2,781 (2,781–3,777) | 2,781 (2,781–3,777) | 0 (0 to 0) | −0.002 (−0.005 to +0.006) |
| 2018Q3 | 2,778 (2,778–3,777) | 2,778 (2,778–3,777) | 0 (0 to 0) | −0.002 (−0.005 to +0.006) |
| 2018Q4 | 2,778 (2,778–3,781) | 2,778 (2,778–3,781) | 0 (0 to 0) | −0.002 (−0.005 to +0.006) |
| 2019Q1 | 2,778 (2,778–3,776) | 2,778 (2,778–3,776) | 0 (0 to 0) | −0.006 (−0.016 to +0.011) |
| 2019Q2 | 2,778 (2,778–3,776) | 2,778 (2,778–3,774) | 0 (0 to +2) | +0.747 (+0.342 to +0.979) |
| 2019Q3 | 2,777 (2,777–3,774) | 2,777 (2,777–3,774) | 0 (0 to 0) | −0.006 (−0.016 to +0.011) |
| 2019Q4 | 2,777 (2,777–3,774) | 2,777 (2,777–3,774) | 0 (0 to 0) | −0.006 (−0.016 to +0.011) |
| 2020Q1 | 2,775 (2,775–3,773) | 2,775 (2,775–3,773) | 0 (0 to 0) | −0.006 (−0.016 to +0.011) |
| 2020Q2 | 2,771 (2,771–3,769) | 2,771 (2,771–3,769) | 0 (0 to +1) | −0.006 (−0.016 to +0.010) |
| 2020Q3 | 2,767 (2,767–3,762) | 2,767 (2,767–3,762) | 0 (0 to 0) | −0.006 (−0.016 to +0.010) |
| 2020Q4 | 2,764 (2,764–3,759) | 2,764 (2,764–3,759) | 0 (0 to 0) | −0.006 (−0.016 to +0.010) |
| 2021Q1 | 2,758 (2,758–3,749) | 2,758 (2,758–3,749) | 0 (0 to 0) | −0.006 (−0.016 to +0.010) |

With Lag 20 the 2021Q1 values are the same (unrounded −0.006, −0.016 to +0.010); from 2018Q1 to 2020Q4 the unrounded difference is smaller because the units complete later.

Districts with a social housing difference at 2021Q1 (every other district has an unrounded difference of 0 at 2021Q1, because the subsidy reduction ended with its 2017Q1 and 2019Q2 effects):

| District | Stock above real | Rent burden change (central) | Ghost difference, central (min to max) | Unrounded Ghost difference, central (min to max) |
|---|---|---|---|---|
| Datong | +26 | −0.0036 percentage points | 0 (0 to 0) | −0.0025 (−0.0056 to +0.0013) |
| Wanhua | +25 | −0.0018 percentage points | 0 (0 to 0) | −0.0018 (−0.0048 to +0.0031) |
| Sanchong | +22 | −0.0008 percentage points | 0 (0 to 0) | −0.0015 (−0.0051 to +0.0057) |

At the 2016Q3 peak, the central difference of +2 Ghosts comes from Banqiao (+1, unrounded +0.057) and Zhonghe (+1, unrounded +0.042). The district rent burden rises by 0.013 to 0.027 percentage points in every district while the reduction acts. In 2016Q3 and 2021Q1 the Migration_Rule moves no resident out of any district in either run; no burden change comes near `migration.threshold` (5 percentage points).

### Findings of the fixture-based draft (reference for the recompute)

- **Rise, then fall.** The total rises while the rent subsidy is lower: +1 to +2 Ghosts (central) from 2016Q1 to 2017Q1, unrounded +0.26 to +0.66. After the housing completes, the central unrounded total falls by 0.002 Ghosts (2018Q1) and 0.006 Ghosts (from 2019Q1). In the rounded totals that fall is not visible: the difference is **0 Ghosts in 2020Q4 and in 2021Q1 in all three Scenarios**, out of 2,764 and 2,758 Ghosts (central). The unrounded difference is under 0.001 percent of the total.
- **Direction depends on the Scenario.** In the Scenario with the highest result, the extra units raise the Ghost count by 0.010 (unrounded), because `socialHousing.rentPerUnit` at its high value (+0.005 TWD per m² per month per unit) raises market rent for every renter in the district and `socialHousing.rentRatio` at 0.9 lowers the housed households' burden by less.
- **Size per unit.** The model gives the Ghost change of a housed group as `ghost.sensitivityRent` × persons × burden change ÷ `ghost.size`. One extra unit in Datong changes the unrounded central count by about −0.0001 Ghosts (26 units: −0.0025), so about 10,000 units in one district give one Ghost (central) and about 4,600 at the lowest result. At the fixture unit cost, 10,000 units cost about 78 billion TWD, which is more than twice the 2019 Annual_Budget of 34.9 billion TWD.
- **Size per TWD of subsidy.** A reduction of about 33 million TWD per month (2016Q3) changes the unrounded central count by +0.66 Ghosts in that quarter. The subsidy acts on every recipient household in the quarter it is paid. A social housing unit costs 7.8 million TWD once and lowers the rent of one household by 20 percent (`socialHousing.rentRatio` 0.8) in every quarter after completion.
- **Parameters that drive the result.** `ghost.sensitivityRent` (0.02, no source, simulation-engine Open Question 27) and `ghost.size` (1,000) scale every rent-group change linearly; a 2021Q1 difference of 1 Ghost with this list needs their ratio to be at least about 170 times the fixture ratio, because each district's count is rounded down. `socialHousing.unitCost` sets how many units the freed budget buys. `socialHousing.rentRatio`, `socialHousing.rentPerUnit` and `rentSubsidy.passThrough` set the size and sign of the change per unit and per TWD. The Lag sets when the housing effect starts, not its size.
- **Decision taken (Open Question 15, 2026-11-16).** The user chose to wait for `params.json` and recompute, with no Parameter changed (simulation-engine Requirement 20.6), the comparison at 2021Q1 through the Demo_Lookahead_State, and the fallback order of Requirements 14.20 to 14.22. The Parameter-ratio figure in the bullet above describes the fixture model only; under Requirement 14.18 no Parameter is changed to reach the goal.
