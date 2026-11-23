# Requirements Document

## Introduction

This spec rebuilds how a quarter is played and adds the player's own character. It is phase 1 of a four-phase plan the user approved on 2026-11-23 after playing the deployed game:

> The panels are messy and too small, the game is not intuitive, and after setting a policy I want to feel the city change while I walk, not only through colours. (User feedback, 2026-11-23.)

The user also asked for a character the player creates (origin, occupation, gender and more), so that the player sees what the city does to the player's own life, with its own story line. The user set the goal to completeness, not the 2026-12-05 submission date (user decision 2026-11-23).

### The four phases

| Phase | Spec | Content |
|---|---|---|
| 1 | this spec (`play-loop`) | Character creation, Life_Decisions that change the Character's numbers, the three-step quarter (decide, compute, Quarter_Brief), Policy_Cards, the City_Report, the District_Card, the first-play guide, one dialog style |
| 2 | `street-change` (later) | Policy results visible on the street: construction stages, people and traffic density, metro crowding, empty shops, moving vans |
| 3 | `life-story` (later) | The Character's quarterly story text, life events that prompt Life_Decisions (lease renewal, a partner's job, a parent's health), legal eligibility rules, endings, the two-versions ending, policy outcomes by gender from sourced shares |
| 4 | `polish` (later) | Camera flight per quarter, day and season, sound, final accessibility and performance checks |

Phase 1 shows the Character's own numbers each quarter (rent burden, commute) and lets the player make the Life_Decisions that change them, but has no story text. The story line is phase 3.

### Decisions of the user (2026-11-23)

1. Gender does not change any number of the Character. A policy may still have different results for women and men; phase 3 shows these from sourced shares (for example the share of women and men among public transport users and among social housing tenants), never as a multiplier on the Character.
2. The story may have bad endings (for example leaving the two cities, or a rent burden that stays high). Endings describe outcomes and the comparison with real history, never a verdict (`neutrality.md`).
3. The Character_File offers 6 to 8 occupations, covering high, middle and low incomes and different work districts.
4. Claude Code drafts all new text (Character_File, Quarter_Brief templates, guide text); the user edits it before it is final. Draft text is marked `"status": "draft"` until the user approves it.
5. Life decisions are made slowly during the game, not all at the start. Character_Creation asks only who the Character is at the start of 2015 (name, origin, first job, where they live, appearance). Partner, children, caring for a parent, moving and changing jobs are Life_Decisions the player makes in later quarters.
6. A partner can be of any gender, including a same-sex partner. Where the law of the time treats couples differently (for example marriage of same-sex couples, possible from 2019-05-24 under the Act for Implementation of J.Y. Interpretation No. 748), the game states the legal fact of that date with its source and does not comment on it.

### Who implements

Claude Code implements this spec, not Kiro, to save Kiro credits (recorded in `KIRO-LOG.md`, section "Work not done by Kiro").

### Out of scope

- Story text, life events that prompt decisions, legal eligibility rules and endings of the Character (phase 3).
- Street-level results of policies (phase 2).
- Owning a home: the Character rents or lives with family. Buying is recorded as an open question for phase 3.
- Changes to Engine rules, `params.json` or the Policy_Tool limits and budget rules of game-ui Requirements 8 to 10. This spec changes how they are shown and entered, not what they allow.
- The two Coming_Soon_Tools stay as in game-ui Requirement 8.3.

## Glossary

- **Character**: the person the player creates at the start of a game and plays in Walk_Mode. Replaces the followed Persona of the story-layer spec as the default story subject; the six Personas stay as citizens in the city.
- **Character_File**: `data/config/characters.json`, the options of Character_Creation and of the Life_Decisions: origins, occupations, household members, dwelling sizes, appearance options and their texts.
- **Life_Decision**: one change of the Character's life the player makes in a Decide_Step: move home, change job, a partner moves in or out, marry, a child joins the household, a parent joins or leaves the household.
- **Life_Timeline**: the ordered list of Life_Decisions with the quarter each takes effect, kept in the Character_Store.
- **Life_State**: the Character's situation in one quarter (home district, tenure, occupation, work district, household members, dwelling size, earners), the result of applying the Life_Timeline up to that quarter. Content written by the product owner (drafted by Claude Code).
- **Wage_File**: the generated file `public/data/wages.json`: for each occupation of the Character_File and each year 2015 to 2025, the mean regular monthly earnings of its industry in TWD, from the DGBAS earnings survey, with source and method text.
- **Character_Creation**: the screen of a new game where the player builds the Character.
- **Character_Store**: the browser storage of the Character, separate from the Save of game-ui Requirement 12 (key `butterflycity.character.v1`), like the story store.
- **Character_Numbers**: the Character's monthly rent, rent burden and commute minutes for one quarter (Requirement 3).
- **Decide_Step**, **Compute_Step**, **Brief_Step**: the three steps of one quarter (Requirement 4).
- **Policy_Card**: one large button per Active_Tool at the bottom of the screen that opens its Policy_Dialog.
- **Policy_Dialog**: the large dialog where the player sets one Policy_Tool (Requirement 5).
- **Quick_Preview**: the plain summary of an edit in the Policy_Dialog: units, cost, completion quarter, budget left.
- **Quarter_Brief**: the report shown after a quarter is computed: the Brief_Items and the Character's quarter.
- **Brief_Item**: one line of the Quarter_Brief about one change, with a Go_There_Action.
- **Go_There_Action**: the button that puts the Avatar in Walk_Mode at the place of a Brief_Item.
- **City_Report**: the full-screen page with the detail that leaves the main screen: districts, timeline, comparison with real history, model limits.
- **District_Card**: the small card shown when a district is selected.
- **First_Play_Guide**: the short guided first quarter.
- **Dialog_Frame**: the one dialog style of the App (Requirement 9).
- Terms of the game-ui spec (Game_Controller, Game_Screen, Active_Tool, Coming_Soon_Tool, Tool_Field, Area, Planning_Quarter, Displayed_Quarter, Apply_Control, Set_To_Real_Control, Construction_Entry, Event_Card, Major_Event, Timeline_View, Save, UI_Strings_Module, Banned_Term_List, Token_File, Test_Suite, Developer, Design_Proposal), of the city-3d spec (City_View, Overview_Mode, Walk_Mode, Avatar, Metro_Travel, Illustration_Note) and of the story-layer spec (Persona, Template, Template_Filler, Story_Panel, Limits_Dialog) are used as defined there.

## Requirements

### Requirement 1: Design approval gate

**User Story:** As the product owner, I want to approve the new screens before code is written, so that the game looks and plays the way I want.

#### Acceptance Criteria

1. THE Developer SHALL present a Play_Loop_Design_Proposal (an HTML artifact) with Character_Creation, the main screen in Overview_Mode and Walk_Mode, a Policy_Dialog, the Quarter_Brief, the City_Report, the District_Card, the First_Play_Guide and the Dialog_Frame, at 360 and 1280 CSS pixels, before any file of this spec in `src/ui/` or `src/styles/` is created or changed.
2. WHEN the user approves the Play_Loop_Design_Proposal, THE Developer SHALL record the approval in `KIRO-LOG.md` in the format of game-ui Requirement 1.5.
3. IF the user asks for changes, THEN THE Developer SHALL present a revised artifact and SHALL record no approval.

### Requirement 2: Character creation

**User Story:** As a player, I want to create my own character, so that the city I govern is also the city I live in.

#### Acceptance Criteria

1. WHEN the player starts a new game, THE Game_Screen SHALL show Character_Creation before the first Decide_Step.
2. Character_Creation SHALL ask only for the Character at the start of 2015 (user decision 5): a name (1 to 20 characters), an origin, a first occupation, a work district from the occupation's list, a home district, and appearance (body, hair, clothing colour) with a pronoun set (she, he, they). Every Character starts single.
3. THE Character_File SHALL hold 3 origins (born in Taipei, born in New Taipei, moved from elsewhere in Taiwan) and 6 to 8 occupations.
4. Each occupation SHALL have an id, a display name, a one-line description, an industry code of the DGBAS earnings survey, and 2 to 4 work District_Codes.
5. THE Character_File SHALL hold a dwelling size in m² for each household size, each with a source or the status `gap` and an assumption text.
6. WHERE the origin is born in Taipei or born in New Taipei, Character_Creation SHALL offer the tenure "living with family" in a home district of the origin's city, in addition to "renting".
7. THE pronoun set and the appearance of the Character and of a partner SHALL change only the Avatar, the household figures in the city and the pronouns filled into text, and no Character_Number (user decision 1).
8. Character_Creation SHALL show, before the player confirms, the Character_Numbers of the Planning_Quarter with the sources of the wage, the rent and the dwelling size.
9. Character_Creation SHALL offer a "Random character" control and SHALL be fully operable by keyboard.
10. WHEN the player confirms, THE Character_Store SHALL save the Character, and WHEN a Save is loaded, THE Game_Screen SHALL restore the Character from the Character_Store, or show Character_Creation IF none is stored.
11. THE Save code export of game-ui Requirement 13 SHALL stay unchanged; the Character is not part of the Save.

### Requirement 3: Character numbers

**User Story:** As a player, I want my character's rent and commute to come from the same data as the city, so that what happens to me is grounded.

#### Acceptance Criteria

1. THE Game_Controller SHALL compute the Character_Numbers for a quarter from the Life_State of that quarter as: monthly income = the sum of the Wage_File earnings of the occupation of each earner for the year; monthly rent = the simulated district rent per m² of the home district × the dwelling size of the household size (0 WHILE living with family); rent burden = monthly rent ÷ monthly income × 100; commute minutes = the commute time between the home and the work district used by the story-layer Persona numbers.
2. THE Game_Controller SHALL compute the same Character_Numbers on the Real_Policy_Track run, so that each value can be compared with real history.
3. THE Character_Numbers SHALL be a pure function of the Character, the Wage_File, the Engine results and the Data_Files, so that the same Save and Character always give the same values.
4. THE data pipeline SHALL write the Wage_File from the DGBAS earnings survey with the dataset id, the URL, the retrieval date and the method, and `data/SOURCES.md` SHALL list it.
5. IF the Wage_File has no value for an occupation and year, THEN THE Game_Controller SHALL use no value, and THE Game_Screen SHALL show "No wage data for <year>" in place of the rent burden.

### Requirement 3A: Life decisions over time

**User Story:** As a player, I want to make the big decisions of my character's life as the years pass, so that my life unfolds with the city instead of being fixed at the start.

#### Acceptance Criteria

1. THE Game_Screen SHALL offer a "My life" control in every Decide_Step that opens a dialog with the Life_Decisions available in the Planning_Quarter.
2. THE Life_Decisions SHALL be: move home (to a district and tenure the player chooses); change job (to an occupation and work district of the Character_File); a partner moves in (with the partner's occupation, work district, pronoun set and appearance, and a partner of any gender, user decision 6); the partner moves out; marry; a child joins the household; a parent joins the household; a parent leaves the household.
3. WHERE a Life_Decision depends on the law of the Planning_Quarter, THE Character_File SHALL state the legal fact, its effective date and its source, and THE dialog SHALL show that fact in neutral words. Marriage of a same-sex couple SHALL be available from 2019Q2 (in force 2019-05-24) and SHALL show before that quarter the legal fact and its source in place of the action.
4. Each Life_Decision SHALL take effect in the Planning_Quarter, SHALL be added to the Life_Timeline, and SHALL not be allowed in a Fixed_Quarter.
5. BEFORE the player confirms a Life_Decision, THE dialog SHALL show the Character_Numbers of the Planning_Quarter with and without the decision.
6. THE Life_Decisions SHALL change only the Character_Numbers and the Character's place in the city, and SHALL never change any Engine input or result.
7. THE Timeline_View in the City_Report SHALL list the Life_Decisions under their quarters, after the Timeline_Entries, labelled "My life".
8. THE text of each Life_Decision SHALL describe every household form (single, with a partner of any gender, married or not, with or without children or a parent) in the same neutral register, with no judgement of any choice (`neutrality.md`).

### Requirement 4: The three-step quarter

**User Story:** As a player, I want each quarter to be one clear loop, so that I always know what to do next and what my decision did.

#### Acceptance Criteria

1. THE Game_Screen SHALL play each quarter in three steps: the Decide_Step (Policy_Cards active), the Compute_Step (the Next_Quarter_Action or Fast_Forward_Action of game-ui Requirement 7) and the Brief_Step (the Quarter_Brief).
2. THE Turn_Bar SHALL show the current step as text and the next action as its one primary button.
3. WHEN a Computation_Run ends, THE Game_Screen SHALL show the Quarter_Brief of the last computed quarter, and Event_Cards of game-ui Requirement 7.6 before it.
4. WHEN the player closes the Quarter_Brief, THE Game_Screen SHALL return to the Decide_Step of the new Planning_Quarter.
5. THE turn rules, limits, budget checks and Engine calls of game-ui Requirements 7, 9 and 10 SHALL stay unchanged.

### Requirement 5: Policy cards and the policy dialog

**User Story:** As a player, I want to set a policy in one large, clear window, so that I understand what I am buying before I apply it.

#### Acceptance Criteria

1. THE Game_Screen SHALL show one Policy_Card per Active_Tool along the bottom edge, with the tool name, an icon, the player's current value against real in plain words (for example "Real track" or "+300 units in 2 districts") and the budget left of the year.
2. WHEN the player activates a Policy_Card, THE Game_Screen SHALL open the tool's Policy_Dialog in the Dialog_Frame.
3. THE Policy_Dialog SHALL offer a slider and an input field for each editable Tool_Field and Area, both bound to the same value, with the limits of `checkLimit` as the slider ends.
4. WHERE a Tool_Field has district scope, THE Policy_Dialog SHALL offer the choice of districts as a list and as a small map, and SHALL show the value per chosen district.
5. WHILE the player edits, THE Policy_Dialog SHALL show the Quick_Preview within 200 ms: the change in plain words, the cost in TWD, the completion quarter (Planning_Quarter + Lag), and the budget left of the year from `checkBudget`.
6. THE Policy_Dialog SHALL show the full detail of game-ui Requirements 8.4 to 8.12 (unit cost, Lag, limits, sources, benefits and costs) behind a "Details and sources" disclosure, with the benefits and costs statements visible without opening it.
7. THE Apply_Control, the Set_To_Real_Control and every error message of game-ui Requirement 9 SHALL keep their behaviour and text in the Policy_Dialog.
8. THE Construction_Entries of game-ui Requirement 10 SHALL appear in the social housing Policy_Dialog and in the City_Report.

### Requirement 6: Quarter brief

**User Story:** As a player, I want to be told what changed after each quarter and where, so that I can go and see it.

#### Acceptance Criteria

1. THE Quarter_Brief SHALL show the computed quarter, up to 3 Brief_Items, the Character's quarter, and a "Continue" control.
2. THE Game_Controller SHALL choose the Brief_Items by a fixed rule: candidates are completions of Construction_Entries, Major_Events and, per district and Map_Indicator, the change since the previous quarter of the difference from real history divided by the outer change bound of the indicator; the 3 candidates with the largest absolute score are shown, completions and Major_Events first.
3. Each Brief_Item SHALL be filled from a Template of the Character_File's `brief` group with its district, indicator, value, difference from real history and unit, and SHALL pass the checks of Requirement 10.
4. WHERE a Brief_Item has a district, THE Brief_Item SHALL offer a Go_There_Action.
5. WHEN the player activates a Go_There_Action, THE City_View SHALL enter Walk_Mode with the Avatar at the place of the item (the social housing site, the nearest metro station or the district centre), and THE Quarter_Brief SHALL close.
6. THE Character's quarter SHALL show the Character_Numbers and their difference from the previous quarter and from real history.
7. WHILE no Brief_Item scores above 0, THE Quarter_Brief SHALL show "No district changed noticeably from real history this quarter."

### Requirement 7: City report and district card

**User Story:** As a player, I want the detailed numbers out of my way but one click away, so that the city stays the main thing on screen.

#### Acceptance Criteria

1. THE Game_Screen SHALL keep on the main screen only the Turn_Bar, the Policy_Cards, the city tools and the District_Card, and SHALL move the District_Panel, the Map_Indicator switch with its legend, the Timeline_View, the Story_Panel and the Limits_Dialog into the City_Report.
2. THE City_Report SHALL be a full-screen page with tabs "Districts", "Map colours", "Timeline", "People" and "Model limits", opened from the Turn_Bar and closed with Escape or its Close control, which returns focus to the opening control.
3. THE Illustration_Note and the disclosure text SHALL stay visible on the main screen.
4. WHEN a district is selected, THE Game_Screen SHALL show the District_Card near the district (and docked at the bottom below 64rem) with the district name, the value and difference from real history of the selected Map_Indicator and of rent burden, the Construction_Entries of the district, and "Open in report", "Walk here" and Close controls.
5. Every value of the District_Card SHALL be the same value the District_Panel shows for the district and quarter.

### Requirement 8: First-play guide

**User Story:** As a first-time player, I want to be walked through one quarter, so that I learn the loop by doing it.

#### Acceptance Criteria

1. WHEN a new game starts and the Character_Store has no `guideDone` flag, THE Game_Screen SHALL run the First_Play_Guide after Character_Creation.
2. THE First_Play_Guide SHALL point in order at a Policy_Card, the Apply_Control, the Next_Quarter_Action, a Go_There_Action and the City_Report, each with one sentence and "Next" and "Skip guide" controls.
3. THE First_Play_Guide SHALL never apply a policy or compute a quarter for the player.
4. WHEN the guide ends or is skipped, THE Character_Store SHALL set `guideDone`, and the guide SHALL be available again from the City_Report.

### Requirement 9: One dialog style

**User Story:** As a player, I want every window to look and behave the same, so that the game feels like one product.

#### Acceptance Criteria

1. Every dialog of the App (new game, Save export and import, Event_Cards, "Why?", Station dialog, Policy_Dialog, Quarter_Brief, Character_Creation) SHALL use the Dialog_Frame: one title, a body, one row of actions with the primary action last, a Close control, a size of at least min(40rem, 100% − 2 × the page gutter) wide, and full screen below 40rem.
2. THE Dialog_Frame SHALL be a modal `dialog` element that takes pointer events, traps focus, closes on Escape where the dialog allows closing, and returns focus to the control that opened it.
3. THE Test_Suite SHALL check with a pointer click at the centre of each action button, not only by calling `click()`, that each dialog's buttons receive the click.

### Requirement 10: Neutral text and accessibility

**User Story:** As a teacher, I want the new texts to be as fair and accessible as the rest of the game.

#### Acceptance Criteria

1. Every new UI string SHALL be in the UI_Strings_Module or the Character_File, SHALL pass the Banned_Term_List check of game-ui Requirement 15, and SHALL be recorded in `KIRO-LOG.md` with the review of game-ui Requirement 15.7.
2. THE Character_File and the Quarter_Brief Templates SHALL describe outcomes and trade-offs only, SHALL not score the player's choices, and SHALL describe every occupation, origin and household in the same neutral register.
3. Every new control SHALL be operable by keyboard, SHALL have an accessible name, and SHALL meet the target sizes and motion rules of game-ui Requirement 17.
4. THE Character_File SHALL stay at `"status": "draft"` until the user approves its text, and the approval SHALL be recorded in `KIRO-LOG.md`.

### Requirement 11: Tests

**User Story:** As the developer, I want the new rules tested, so that the loop cannot break silently.

#### Acceptance Criteria

1. THE Test_Suite SHALL check the Character_File and Wage_File validation, including every occupation having a wage for every year 2015 to 2025.
2. THE Test_Suite SHALL check the Character_Numbers against a hand calculation for one renter and one Character living with family, and that changing only the pronoun set or appearance of the Character or of a partner changes no Character_Number (property test).
2a. THE Test_Suite SHALL check that the Life_State of each quarter equals the result of applying the Life_Timeline in order, that a Life_Decision in a Fixed_Quarter is rejected, that marriage of a same-sex couple is unavailable before 2019Q2 and available from 2019Q2, and that no Life_Decision changes an Engine result.
3. THE Test_Suite SHALL check the Brief_Item rule: order, the limit of 3, and the empty case.
4. THE Test_Suite SHALL check that the Policy_Dialog slider and input field always hold the same value and that the Quick_Preview cost equals the `checkBudget` result.
5. THE Test_Suite SHALL check the module boundaries of game-ui Requirement 18 for the new modules.

## Open questions

1. Home ownership (buying with a mortgage from the sale price data): phase 3 or not at all.
2. Which legal facts besides same-sex marriage (2019-05-24) phase 1 needs, for example joint adoption by same-sex couples (amendment of 2023) if "a child joins" distinguishes adoption; each is checked against the law text before it is written into the Character_File.
3. Which sourced shares by gender phase 3 uses, after the sources are checked (candidates: MOTC daily transport mode survey, Taipei 2024: women 75.1% green transport, men 51.7% private motor vehicles; social housing tenant gender statistics of Taipei UDD and New Taipei UDD).
