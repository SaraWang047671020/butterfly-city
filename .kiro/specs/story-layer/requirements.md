# Requirements Document

## Introduction

This spec defines how the Butterfly City game loads, fills and shows two sets of text that the product owner writes: the citizen stories (`data/config/citizens.json`) and the model limitations page (`data/config/model-limits.json`). It covers loading, filling placeholders with computed values, and display. It never writes or rewrites the text content.

**Dependency.** This spec runs after the game-ui spec (`.kiro/specs/game-ui/`). It reuses the Game_Screen, the Data_Loader, the Game_Controller, the UI_Strings_Module, the dialog rules and the Banned_Term_List from game-ui and does not redefine them. References of the form "game-ui Requirement N" point to `.kiro/specs/game-ui/requirements.md`.

### Content files read on 2026-11-19

- `data/config/citizens.json` exists: 6 fictional Personas and 5 template groups (`rent`, `commute`, `comparison`, `stateChange`, `ending`) with 22 distinct placeholders: `name`, `rentBurden`, `rentRiskThreshold`, `rentGhostThreshold`, `homeDistrict`, `workDistrict`, `commuteMinutes`, `commuteRiskThreshold`, `commuteGhostThreshold`, `commuteHoursMonth`, `rentBurdenReal`, `rentBurdenDiff`, `rentBurdenLow`, `rentBurdenHigh`, `ghostSize`, `realQuarter`, `quartersAtRisk`, `quartersAtRiskReal`, `commuteAvg`, `commuteAvgReal`, `quartersGhost`, `quartersGhostReal`.
- `data/config/model-limits.json` exists: a page header and sections of items. It has 3 distinct placeholders: `commuteModelled`, `commuteSurvey` (item `survey-check`) and `backtestResult` (item `backtest`).
- `citizens.json` also has a `thresholds` block (`rentRisk`, value 30 percent of income, display only) and each Persona has `dwellingSize` and `incomePercentile`. `model-limits.json` also has a `templates.backtestResult` block (sentences `met` and `notMet` for the checks `direction`, `ratio` and `range`, and a `join` string); it is read by the backtest script, not shown as a Template.
- The pipeline survey check (`scripts/pipeline/commute/survey-check.ts`) holds the survey figure (57 minutes) and computes the modelled mean. `docs/BACKTEST.md` holds the TPASS backtest result. Neither value reaches `public/data/` today, and the web app does not parse Markdown. This spec adds a small generated file for them (Requirement 2).
- The income spread sigma of each district (`scripts/pipeline/params/ghost.ts`: `(ln Q3 - ln Q1) / (2 x 0.6745)`, FIA quartiles, income year 2023, dataset 103066) is not exported today. This spec adds a generated file `income-spread.json` for it (Requirement 2). It is not part of `params.json`: the Engine does not use it, and the parameter id-set check would flag it as extra.
- The `householdIncome` indicator of `history.json` is the income the ghost rule uses as the centre of its log-normal income distribution (`ghost.ts`: the mean of `householdIncome` over 2023Q1 to Q4). The ghost rule treats it as the district median.
- The game-ui spec has no requirement for citizens or for the model limitations page (its "Out of scope" section excludes personas).
- `game-ui` Requirement 20 is the Range_Source_View, not a text file. `data/config/why-text.json` is not covered by game-ui and is out of scope here.

### Out of scope

- Writing, editing or translating any text in `citizens.json` or `model-limits.json`.
- Changes to Engine rules or to `params.json`. Persona numbers are a read-only calculation from existing run output and data files (Requirement 4).
- The ending comparison screen, the "Why?" cause breakdown, Ghost silhouettes, Future mode and Live mode.
- Changes to the Save schema of game-ui Requirement 12.

## Glossary

- **App**, **Game_Screen**, **Game_Controller**, **Data_Loader**, **Engine**, **UI_Strings_Module**, **Banned_Term_List**, **Exempt_List**, **Test_Suite**, **Quarter_Key**, **Displayed_Quarter**, **Result_Range**, **Range_Display**, **Disclosure_Text**, **Completed_Marker**: as defined in game-ui.
- **Story_Layer**: the code of this spec: the Story_Files loader in `src/data/`, the Template_Filler in `src/narrative/`, the Story_Facts builder in `src/game/` and the Story_Panel and Limits_Dialog in `src/ui/`.
- **Story_Files**: `citizens.json`, `model-limits.json`, `model-facts.json` and `income-spread.json` as served from the `data/` folder of the App.
- **Income_Spread**: the generated file `income-spread.json`: the sigma of the district income distribution for each of the 41 districts, with its source and method text.
- **Persona_Numbers**: the rent burden and commute minutes of one Persona in one quarter, calculated as in Requirement 4.
- **Persona**: one entry of `citizens.json` `personas`.
- **Template**: one text with placeholders: a string under `citizens.json` `templates` (Template_Id such as `rent.atRisk`) or the `text` of one `model-limits.json` item (Template_Id such as `limits.backtest`).
- **Template_Id**: the dotted path that names a Template in error messages.
- **Placeholder**: a name in braces inside a Template, for example `{rentBurden}`.
- **Template_Filler**: the pure function in `src/narrative/` that replaces every Placeholder of a Template with a value.
- **Story_Values**: a map from Placeholder name to an already formatted string.
- **Story_Facts**: the numbers and names the Game_Controller supplies for one Persona and one Displayed_Quarter, from the Engine results of the player run and the Real_Policy_Track run.
- **Model_Facts**: the generated file `model-facts.json` with the values `commuteModelled`, `commuteSurvey` and `backtestResult`.
- **Story_Panel**: the part of the Game_Screen that shows the followed Persona's update.
- **Limits_Dialog**: the dialog that shows the model limitations page.
- **Fill_Error**: the error that names the Template_Id and the Placeholder for which no value exists.

## Requirements

### Requirement 1: Story file loading

**User Story:** As a player, I want the story texts loaded from the committed content files, so that the game shows exactly the text the product owner wrote.

#### Acceptance Criteria

1. THE Data_Loader SHALL fetch the four Story_Files from the `data/` folder under the base path `/butterfly-city/`, and SHALL be the only module that fetches them.
2. WHEN the data build (`npm run data`) runs, THE data pipeline SHALL copy `data/config/citizens.json` and `data/config/model-limits.json` unchanged into `public/data/`.
3. WHEN a Story_File has been fetched, THE Data_Loader SHALL validate its structure: `schemaVersion` equal to 1, `personas` with 6 entries each having the fields `id`, `name`, `homeCode`, `workCode`, `dwellingSize` (finite, greater than 0), `incomePercentile` (finite, greater than 0 and less than 100), `intro` and `picker`, `thresholds.rentRisk.value` a finite number greater than 0, and every Template a non-empty string.
4. IF a Story_File cannot be fetched, parsed or validated, THEN THE Story_Panel or the Limits_Dialog that needs the file SHALL show one line that names the file and its first error, and THE Game_Screen SHALL keep the Data_Files, the Map_View and the Policy_Panel working.
5. WHEN a Story_File is loaded, THE Story_Layer SHALL show its text exactly as written, with no change of wording, order or punctuation other than Placeholder filling.
6. IF a Persona `homeCode` or `workCode` is not null and is not a District_Code of `districts.json`, THEN THE Data_Loader SHALL report the Persona id and the code as a validation error.

### Requirement 2: Generated data files

**User Story:** As a teacher, I want the numbers on the limitations page and in the citizen stories to come from the real build and backtest results, so that no number is typed by hand.

#### Acceptance Criteria

1. WHEN `npm run data` runs, THE data pipeline SHALL write `commuteModelled` (minutes, from the survey check of the commute matrix) and `commuteSurvey` (minutes, the survey figure of `scripts/pipeline/commute/survey-check.ts`) into `public/data/model-facts.json`.
2. WHEN `npm run backtest` runs, THE backtest script SHALL write `backtestResult` into `public/data/model-facts.json`: for each of the three checks of the main result of `docs/BACKTEST.md` (`direction`, `ratio`, `range`), the `met` or `notMet` sentence of `templates.backtestResult` in `data/config/model-limits.json` that matches the computed outcome, with `{ratio}` (simulated central value divided by observed value), `{toleranceLow}` and `{toleranceHigh}` filled from the computed values, and the three sentences joined with the template's `join` string.
3. WHEN either script writes `model-facts.json`, THE script SHALL replace only the values it computes and SHALL keep the other values of the file.
4. THE web app SHALL read `model-facts.json` and SHALL parse no Markdown file at runtime.
5. IF a computed value needed for Model_Facts does not exist when a script writes the file, THEN THE script SHALL stop with a message that names the missing value and writes no partial value.
6. FOR ALL valid Model_Facts objects, serializing then parsing SHALL produce an equal object (round-trip property).
7. THE Data_Loader SHALL validate that `commuteModelled` and `commuteSurvey` are finite numbers greater than 0 and that `backtestResult` is a non-empty string.
8. WHEN `npm run data` runs, THE data pipeline SHALL write `public/data/income-spread.json` with one sigma for each of the 41 districts, calculated as `(ln Q3 - ln Q1) / (2 x 0.6745)` from the FIA quartiles of the district total row (income year 2023, dataset 103066), together with the source citation, the income year, the dataset number and the method text.
9. THE data pipeline SHALL NOT add the sigma values to `params.json`.
10. THE Data_Loader SHALL validate that `income-spread.json` has a sigma for every District_Code of `districts.json` and that each sigma is a finite number greater than 0.

### Requirement 3: Template filling

**User Story:** As the product owner, I want every placeholder filled from a known value or the build stopped, so that no player sees a raw `{placeholder}`.

#### Acceptance Criteria

1. WHEN the Template_Filler is called with a Template, its Template_Id and Story_Values, THE Template_Filler SHALL return the Template with every Placeholder replaced by the Story_Values entry of the same name.
2. IF a Placeholder of a Template has no entry in Story_Values, THEN THE Template_Filler SHALL throw a Fill_Error that names the Template_Id and the Placeholder.
3. THE Template_Filler SHALL replace a Placeholder that occurs more than once in a Template by the same value each time.
4. THE Story_Layer SHALL hold one registry that lists every Placeholder name of `citizens.json` and `model-limits.json` with the producer of its value (Story_Facts or Model_Facts).
5. IF a Template contains a Placeholder name that is not in the registry, THEN THE Test_Suite SHALL fail with the Template_Id and the Placeholder name.
6. WHEN a Fill_Error occurs while the Game_Screen is running, THE Story_Panel or the Limits_Dialog SHALL show the line "no value" for the affected Template (the wording of game-ui Requirement 3.11), SHALL not show a partly filled sentence, and SHALL keep the rest of the Game_Screen working.
7. THE Template_Filler SHALL format no number and SHALL read no file; the Story_Values it receives are already formatted strings.

### Requirement 4: Story facts for one Persona

**User Story:** As a player, I want the followed citizen's numbers to come from the simulation, so that the story matches the map and the panels.

#### Acceptance Criteria

1. WHEN the Displayed_Quarter changes or the followed Persona changes, THE Game_Controller SHALL build the Persona_Numbers of that Persona for the player run and for the Real_Policy_Track run as follows: rent = the rent of the Persona's `homeCode` district in that run and quarter × the Persona's `dwellingSize`; commute minutes = the `commute-matrix.json` value from the `homeCode` district to the `workCode` district; income = the `householdIncome` of the `homeCode` district in the quarter × exp(sigma × z), where sigma is the Income_Spread value of that district and z is the standard normal quantile of the Persona's `incomePercentile` divided by 100.
2. THE Game_Controller SHALL take `rentGhostThreshold` from `ghost.rentThreshold.value`, `commuteGhostThreshold` from `ghost.commuteThreshold.value`, `commuteRiskThreshold` from `ghost.commuteThreshold.range.low` and `ghostSize` from the Parameter table (`params.json`), and `rentRiskThreshold` from `thresholds.rentRisk.value` of `citizens.json` (a display line that the Engine does not use).
3. THE Game_Controller SHALL select the state of the rent Template group and of the commute Template group (`below`, `atRisk`, `ghost`, and `none` for a Persona whose `workCode` is null) by comparing the Persona's central rent burden and commute minutes with those thresholds.
4. THE Game_Controller SHALL select the `comparison` Template (`same`, `lower`, `higher`) by comparing the player run with the Real_Policy_Track run, and SHALL select `range` only WHEN the minimum and maximum of the Result_Range differ after formatting (game-ui Requirement 5.7).
5. THE Game_Controller SHALL select a `stateChange` Template only WHEN the Persona's ghost state in the Displayed_Quarter differs from that of the previous quarter, or `becameGhostReal` WHEN the Real_Policy_Track run first reaches the ghost state in a quarter at or before the Displayed_Quarter.
6. WHERE the Completed_Marker is set, THE Game_Controller SHALL build the `ending` Story_Values from the 44 quarters of the player run and of the Real_Policy_Track run.
7. THE Story_Layer SHALL format Story_Values with the number formatting of game-ui Requirement 6.10.
8. IF a value needed for a Placeholder does not exist, THEN THE Game_Controller SHALL leave that entry out of Story_Values and SHALL NOT substitute zero or a default.

### Requirement 5: Citizen story display

**User Story:** As a player, I want to pick one citizen and read a short update each quarter, so that I see who the averages hide.

#### Acceptance Criteria

1. WHEN a new game starts and no Persona is stored, THE Game_Screen SHALL show a picker of the 6 Personas with each Persona's `picker` line, and SHALL show the Story_Panel for the chosen Persona.
2. THE Game_Screen SHALL keep the chosen Persona id in a separate `localStorage` key with its own schema version, so that the Save and the Save_Code of game-ui Requirement 12 stay unchanged.
3. IF the stored Persona id is not one of the 6 Persona ids, THEN THE Game_Screen SHALL show the picker again.
4. WHILE a quarter has been computed, THE Story_Panel SHALL show the Persona's `intro`, then the filled rent Template, commute Template and `comparison` Template, then a `stateChange` Template WHEN Requirement 4.5 selects one.
5. WHILE the Completed_Marker is set, THE Story_Panel SHALL also show the filled `ending` Templates.
6. WHEN the Displayed_Quarter changes, THE Story_Panel SHALL show the new text and SHALL make one polite live-region announcement of the update, as in game-ui Requirement 17.7.
7. THE Story_Panel SHALL carry the rent state, the commute state and the ghost state also as text (game-ui Requirement 17.4), and SHALL use no animation that runs longer than 0 ms WHILE `prefers-reduced-motion: reduce` applies (game-ui Requirement 17.9).
8. THE Story_Panel SHALL be reachable at every viewport size of game-ui Requirement 16.2, with the interactive controls sized as in game-ui Requirement 16.6.
9. THE UI_Strings_Module SHALL hold the picker label, the panel title and every other text of the Story_Panel that is not taken from `citizens.json` (game-ui Requirement 15.3).

### Requirement 6: Model limitations page

**User Story:** As a teacher, I want one page that lists what the model simplifies and what data is missing, so that students can judge the results themselves.

#### Acceptance Criteria

1. THE Game_Screen SHALL offer a control that opens the Limits_Dialog, reachable by pointer and by keyboard from every state of the Game_Screen.
2. WHEN the Limits_Dialog opens, THE Limits_Dialog SHALL show the `page.title`, `page.intro`, `page.disclosure` and `page.sourcesLink` of `model-limits.json`, then every section with its title and every item with its title and filled text, in file order.
3. THE Limits_Dialog SHALL meet the dialog rules of game-ui Requirements 17.12 to 17.15 (focus in, focus trap, Escape, focus return).
4. THE Limits_Dialog SHALL fill `commuteModelled`, `commuteSurvey` and `backtestResult` from Model_Facts, with minutes formatted as whole numbers.
5. THE Limits_Dialog SHALL show no number that is not either text of `model-limits.json` or a filled Placeholder.
6. THE UI_Strings_Module SHALL hold the control label and every other text of the Limits_Dialog that is not taken from `model-limits.json`.

### Requirement 7: Neutral text

**User Story:** As a reader from any political position, I want the story and limitation texts to hold to the neutrality rules, so that I can trust them.

#### Acceptance Criteria

1. THE Test_Suite SHALL check every Template of `citizens.json` and `model-limits.json` against the Banned_Term_List and the Exempt_List with the same matching function the data pipeline uses, `checkBannedTerms` and `parseTermList` of `scripts/pipeline/banned-terms.ts`.
2. THE Test_Suite SHALL check every `intro`, `picker`, `page` text and item `title` of the two files, and every `templates.backtestResult` sentence of `model-limits.json`, with the same function.
3. THE Test_Suite SHALL check the filled text of every Template, filled with a complete fixture of Story_Values and Model_Facts, with the same function.
4. IF a banned term is found, THEN THE Test_Suite SHALL fail with the file, the Template_Id or field and the term.
5. WHEN the Story_Layer adds or changes UI strings, THE Developer SHALL apply the review check of game-ui Requirement 15.7.

### Requirement 8: Module boundaries and required tests

**User Story:** As the developer, I want the story code to stay in its modules and to have two tests that stop a bad content change, so that the build protects the text.

#### Acceptance Criteria

1. THE Story_Layer SHALL keep the Template_Filler and the template selection in `src/narrative/`, the fetching in `src/data/`, the Persona_Numbers formula in `src/simulation/`, the Story_Facts builder in `src/game/`, the rendering in `src/ui/`, and the Model_Facts and Income_Spread writers in `scripts/`, and SHALL NOT import `scripts/` from `src/`.
2. THE Story_Layer SHALL add no dependency and SHALL read no Story_File outside the Data_Loader.
3. THE Test_Suite SHALL include a placeholder test that fills every Template of `citizens.json` and `model-limits.json` (items only, not the `templates.backtestResult` block) with a complete fixture and SHALL fail with the Template_Id and the Placeholder of each Placeholder for which the fixture, the registry or the committed `model-facts.json` has no value; the same test SHALL also check that the committed `income-spread.json` has 41 finite positive sigmas (Requirement 2.10).
4. THE Test_Suite SHALL include the banned-term test of Requirement 7.
5. THE Story_Layer SHALL pass the static style test of game-ui Requirement 1.9 for every file it adds to `src/ui/` and `src/styles/`.
6. THE Story_Layer SHALL create no file in `src/ui/` or `src/styles/` before the game-ui Design_Proposal is approved (game-ui Requirement 1.6) and SHALL add its Story_Panel, picker and Limits_Dialog to that Design_Proposal as a change request under game-ui Requirement 1.10.
