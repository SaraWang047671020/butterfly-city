# Requirements Document

## Introduction

This spec is phase 3 of the plan of the play-loop spec: the Character's own story. The user asked for it on 2026-11-24 after playing the game with the Character of phase 1:

> 我希望可以加入多一點政策，不只社宅房租跟通勤補助，希望可以有多一些面向，然後個人的選擇可以是玩到一半會跳出來要選擇，選擇了之後玩家會清楚看到政策對自己的影響，並能讀到自己的故事。
> ("I want more policies, not only social housing, rent and commuter subsidies, with more areas. Personal choices should pop up mid-game; after choosing, the player should clearly see what the policies did to them and be able to read their own story.")

### Decisions of the user (2026-11-24)

1. **Order of work.** Three specs, in this order: `life-story` (this spec: life events, the comparison of the two versions of the Character, the story and the endings), `housing-tools` (the two Coming_Soon_Tools: sublease and rental management, and the holding tax), `more-policies` (public transport fares, childcare, elder care; this widens the product scope of `product.md` from housing affordability to the cost of living in the two cities). Proposed by Claude Code, chosen by the user in the question of 2026-11-24.
2. **Life events follow the rhythm of a real life** (option chosen by the user): they are triggered by the Character's situation and the year (a lease ending, a job offer, a partner, a child, a parent's health), about once a year on average, and shown at the start of a quarter for the player to choose.
3. **Two versions side by side** (option chosen by the user): each quarter shows the Character in the player's city next to the same Character in real history, with a story text that says where they differ.
4. **Claude Code drafts the story text in English and Traditional Chinese; the user approves it** (option chosen by the user). Draft text is marked `"status": "draft"` until approved, as in the Character_File.

The decisions of the play-loop spec stay in force, in particular: gender changes no number of the Character (play-loop decision 1); endings may be bad but describe outcomes and the comparison with real history, never a verdict (decision 2); the law of the time is stated with its date and source, without comment (decision 6).

### The key mechanism: policies reach the Character through applications

The clearest way for a player to feel a policy is when it decides something in their own life. The Character can apply for social housing and for the rent subsidy, and later (spec `housing-tools`) for a sublease home. Whether the application succeeds depends on the supply the player's policies create, compared with the real supply:

- Social housing: the chance to be allocated a unit is the number of units let in the quarter divided by the number of applicants. More social housing completed by the player in the Character's city means a higher chance than in real history.
- Rent subsidy: the chance to be approved is the number of subsidised households divided by the eligible applicants. More subsidised households in the player's policy means a higher chance.

Both versions of the Character draw the same random number for the same application, so a different result is caused by the policy and nothing else, and the game can say so.

### Who implements

Claude Code implements this spec, not Kiro, as for play-loop (recorded in `KIRO-LOG.md`, section "Work not done by Kiro").

### Out of scope

- New Policy_Tools (specs `housing-tools` and `more-policies`). This spec provides the Personal_Ledger and the Application mechanism those specs extend.
- Owning a home (open question of play-loop, still open).
- Street-level results of policies (play-loop phase 2, `street-change`).
- Any change to Engine rules or results: the Character never changes the city (play-loop Requirement 3A.6).

## Glossary

- **Life_Event**: a situation of the Character that asks the player to choose, shown at the start of a Decide_Step (for example "Your lease ends next month").
- **Life_Event_File**: `data/config/life-events.json`: the Life_Events with their triggers, options, texts in both languages, sources and status.
- **Event_Option**: one choice of a Life_Event. It results in zero or more Life_Decisions of play-loop Requirement 3A, or in an Application.
- **Application**: a request of the Character for a public housing benefit (social housing, rent subsidy; later sublease) with an outcome on each track.
- **Application_Odds**: the chance of an Application to succeed in a quarter on one track, from the supply and the applicants of that track.
- **Shared_Draw**: the one random number in [0, 1) of an Application, used on both tracks; the Application succeeds on a track WHEN the Shared_Draw is below the Application_Odds of that track.
- **Player_Version**, **Real_Version**: the Character on the player's run and on the Real_Policy_Track run. Both have the same Life_Timeline and the same choices; they differ only in the Engine results and in the outcome of Applications.
- **Personal_Ledger**: the Character's monthly money in a quarter on one track: income, rent, transport cost, and the money left after them. Later specs add lines (for example childcare).
- **Two_Me_Panel**: the view that shows the Player_Version and the Real_Version side by side.
- **Story_Line**: one paragraph of the Character's story for a quarter, filled from a Life_Story_Template.
- **Life_Story_File**: `data/config/life-story.json`: the Life_Story_Templates, the ending templates and their selection rules, in both languages, with status.
- **My_Story**: the page that lists every Story_Line of the game so far, quarter by quarter.
- **Ending**: the last page of the story, shown after 2025Q4 or WHEN the Character leaves the two cities.
- Terms of the play-loop spec (Character, Character_File, Life_Decision, Life_Timeline, Life_State, Character_Numbers, Character_Store, Decide_Step, Quarter_Brief, City_Report, Dialog_Frame, Wage_File), of the game-ui spec and of the story-layer spec (Template, Template_Filler) are used as defined there.

## Requirements

### Requirement 1: Design approval gate

**User Story:** As the product owner, I want to approve the new screens and texts before they are built, so that the story looks and reads the way I want.

#### Acceptance Criteria

1. THE Developer SHALL present a Design_Proposal (an HTML artifact with screenshots or mock-ups at 1280 and 360 CSS pixels) of the Life_Event dialog, the Two_Me_Panel, My_Story and the Ending, in English and Traditional Chinese, before any file of these screens is created in `src/ui/`.
2. THE Developer SHALL present the drafted Life_Event_File and Life_Story_File texts to the user in both languages before they are marked approved.
3. WHEN the user approves, THE Developer SHALL record in `KIRO-LOG.md` the date, the artifact or file name and the user's statement.

### Requirement 2: Life events

**User Story:** As a player, I want my character's life to ask me for decisions as the years pass, so that I live through the decade instead of setting everything at the start.

#### Acceptance Criteria

1. THE Life_Event_File SHALL hold at least these Life_Events, each with a trigger, 2 to 4 Event_Options and texts in both languages: the lease ends (renting); the rent goes up at renewal; a job offer in another district; a partner (meeting, moving in, moving out, marrying where the law of the quarter allows it); a child; a parent needs care; social housing applications open in the Character's city; the rent subsidy application window; a long commute; a rent burden above 30 % for 4 quarters in a row (the line used by the story-layer Persona numbers).
2. A trigger SHALL be a condition on the Life_State, the Character_Numbers of the Player_Version, the quarter and the quarters since the Life_Event last occurred, and SHALL never read the Real_Version alone, so that a Life_Event happens in both versions or in neither.
3. AT MOST one Life_Event SHALL be shown per quarter. WHERE several are triggered, THE Game_Controller SHALL pick by a fixed priority order of the Life_Event_File and the Character's seed, so that the same game always gives the same Life_Event; over the 44 quarters the average SHALL be about one Life_Event per 4 quarters.
4. WHEN a Decide_Step begins and a Life_Event is triggered, THE Game_Screen SHALL show it in the Dialog_Frame before the Policy_Cards can be used, with its Event_Options, and for each option its effect on the Character_Numbers of the Planning_Quarter in both versions.
5. Every Life_Event SHALL have an Event_Option that keeps the Character's life as it is. THE dialog SHALL not offer a way to close it without choosing, except with Escape, which chooses that option and says so.
6. A chosen Event_Option SHALL add its Life_Decisions to the Life_Timeline at the Planning_Quarter and record the choice in the Character_Store; the "My life" dialog of play-loop Requirement 3A SHALL stay available for decisions the player makes without a Life_Event.
7. WHERE an Event_Option depends on the law of the quarter, it SHALL follow play-loop Requirement 3A.3.

### Requirement 3: Applications decided by policy

**User Story:** As a player, I want my policies to decide things in my own life, so that I feel their effect on a real person: me.

#### Acceptance Criteria

1. THE Character SHALL be able to apply for social housing and for the rent subsidy through an Event_Option, WHERE the eligibility rules of the quarter allow it. THE eligibility rules (income limit by household size, city, tenure) SHALL come from the regulations in force in the quarter, each with its source and effective date, in the Life_Event_File.
2. THE Application_Odds on each track SHALL be: social housing = the units let to new tenants in the quarter in the Character's city on that track ÷ the applicants in the quarter; rent subsidy = the households subsidised on that track ÷ the eligible applicants. THE applicant numbers SHALL come from published sources, each with its source, or the status `gap` with an assumption text.
3. Each Application SHALL have one Shared_Draw from the Character's seed and the Application's quarter and kind. THE Application SHALL succeed on a track WHEN the Shared_Draw is below the Application_Odds of that track.
4. A successful social housing Application SHALL move the Character into a social housing home in the city at the social housing rent of the Engine (the `socialHousing.rentRatio` of the district rent) from the next quarter, on that track only. A successful rent subsidy Application SHALL lower the Character's rent by the subsidy amount per household of that track for the subsidy period, on that track only.
5. WHEN an Application is decided, THE Game_Screen SHALL show the result on both tracks with the odds of each and the cause in one sentence (for example "In your city 1,240 social housing units were let this quarter; in real history 310. Your chance was 9 %; in real history 2 %."), and SHALL never present a result as a reward or a punishment.
6. FROM the quarter after a successful Application, the two versions MAY live in different homes; THE Life_State of each track SHALL record it, and every later Character_Number SHALL use the Life_State of its own track.

### Requirement 4: Personal_Ledger and the two versions

**User Story:** As a player, I want to see what my policies did to me compared with real history, so that I understand the effect in money and time.

#### Acceptance Criteria

1. THE Game_Controller SHALL compute for each quarter and each track a Personal_Ledger: monthly income (play-loop Requirement 3.1), rent (after a rent subsidy or at the social housing rent, Requirement 3.4), transport cost (the monthly commuter pass price after the subsidy of that track WHERE the Character commutes by public transport, from the commuter pass series of the policy track), and money left = income − rent − transport cost.
2. THE Personal_Ledger SHALL be a pure function of the Character, the Life_Timeline with the Application outcomes, the Engine results of the track and the Data_Files.
3. THE Two_Me_Panel SHALL show for the Displayed_Quarter, side by side: home and housing type, rent, rent burden, commute minutes, transport cost and money left, each with the difference between the versions in words and numbers, never by colour only.
4. Every value of the Two_Me_Panel SHALL open a "Why?" breakdown that names the Policy_Tools and the quarters that cause the difference, from the Engine explanation of game-ui (product rule: every number is explainable).
5. THE Quarter_Brief SHALL show the Two_Me_Panel in place of the Character's quarter of play-loop Requirement 6.6, and the "My life" dialog SHALL open it for any past quarter.
6. Later specs SHALL be able to add a Personal_Ledger line (for example childcare cost) with its source, without changing the lines of this spec.

### Requirement 5: The story

**User Story:** As a player, I want to read my own story, so that the numbers become a life.

#### Acceptance Criteria

1. THE Life_Story_File SHALL hold Life_Story_Templates in English and Traditional Chinese, each with a selection rule on the Life_State, the Personal_Ledger of both versions, the Life_Event of the quarter and its outcome, and the status `draft` or `approved`.
2. FOR each computed quarter, THE Game_Controller SHALL select 1 to 3 Story_Lines by a fixed rule: the Life_Event and its outcome first, then the largest difference between the versions, then the situation of the quarter; the same game SHALL always give the same Story_Lines.
3. THE Story_Lines SHALL be filled by the Template_Filler of the story-layer spec with the Character's name and pronouns, places, numbers and the difference from the Real_Version, and SHALL pass the checks of play-loop Requirement 10.
4. THE Quarter_Brief SHALL show the Story_Lines of the quarter above the Two_Me_Panel.
5. My_Story SHALL list every Story_Line of the game from 2015Q1 to the Displayed_Quarter, quarter by quarter, with the Life_Events and Applications, and SHALL be reachable from the game menu.
6. Story text SHALL describe what happens and the comparison with real history, and SHALL never judge the player, the Character or a household form (`neutrality.md`).

### Requirement 6: Endings

**User Story:** As a player, I want my story to end, so that the decade has a conclusion I can compare with real history.

#### Acceptance Criteria

1. THE Ending SHALL be shown after 2025Q4 is computed, and WHEN the player chooses an Event_Option in which the Character leaves the two cities.
2. THE Ending SHALL show the two versions side by side for the whole decade: where the Character lived, the housing type, the total rent paid, the mean rent burden, the commute time, the money left, and the Applications with their results on both tracks.
3. THE Life_Story_File SHALL hold ending templates selected by fixed rules (for example still renting with a high rent burden, in social housing, left the two cities, living with family), in both languages; bad endings SHALL be possible (play-loop decision 2) and SHALL be described, not judged.
4. THE Ending SHALL show, for the Policy_Tools the player used, the sourced shares of women and men among the people they reach (for example among social housing tenants and rent subsidy recipients), each with its source, or no share where no source exists (play-loop decision 1).
5. THE Ending SHALL offer to read My_Story and to start a new game.

### Requirement 7: Storage and determinism

**User Story:** As a player, I want my story to be kept, so that I can continue the next day and get the same story again.

#### Acceptance Criteria

1. THE Character_Store SHALL keep the Life_Event choices and the Character's seed; the Save code of game-ui Requirement 13 SHALL stay unchanged.
2. THE Life_Events, Application outcomes, Personal_Ledgers and Story_Lines SHALL be pure functions of the Character, the seed, the choices, the Save and the Data_Files.
3. THE Fast_Forward_Action of game-ui Requirement 7.5 SHALL also stop before a quarter in which a Life_Event is triggered, so that every Life_Event is asked in its own Decide_Step. A choice is final once its quarter is computed, like a Policy_Adjustment for a Fixed_Quarter.

### Requirement 8: Text, languages and accessibility

**User Story:** As a teacher, I want the story to be fair and accessible, like the rest of the game.

#### Acceptance Criteria

1. Every text of this spec SHALL exist in English and Traditional Chinese (play-loop Requirement 12) and SHALL pass the Banned_Term_List and placeholder checks.
2. Every source of the Life_Event_File and the Life_Story_File SHALL be listed in `data/SOURCES.md`.
3. THE new screens SHALL be fully operable by keyboard, SHALL use the Dialog_Frame, and SHALL show every difference in words, not by colour only.

### Requirement 9: Tests

**User Story:** As the developer, I want the new rules tested, so that the story cannot break silently.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a property test that the Life_Events, Application outcomes, Personal_Ledgers and Story_Lines are the same for the same inputs.
2. THE Test_Suite SHALL include a property test that, WHEN the player's policy equals real history in every quarter, the Player_Version and the Real_Version are equal in every quarter.
3. THE Test_Suite SHALL include a property test that more supply on a track never lowers the Application_Odds of that track, and that an Application that succeeds on the Real_Version also succeeds on a track with higher odds (Shared_Draw).
4. THE Test_Suite SHALL include a test that every Life_Event and Life_Story_Template has both languages, valid placeholders and a source or `gap` for every number it states.
5. THE Test_Suite SHALL include a test that no Life_Event trigger reads only the Real_Version (Requirement 2.2).

## Open questions (for the design)

1. **Applicant numbers.** Social housing applicants and allocations per round in Taipei and New Taipei, 2015 to 2025, and rent subsidy applicants and approvals (the central expanded rent subsidy from 2022). To be researched with sources; `gap` with an assumption where none is published.
2. **Social housing tenancy length.** Tenancy limits (for example 3 years, renewable once for some groups) decide when the Character must leave social housing; to be taken from the city regulations with dates.
3. **Lease length.** Common residential lease length in the two cities for the lease-end trigger; a sourced value or an assumption.
4. **Who commutes by public transport.** Whether the Character uses the commuter pass: an Event_Option (asked once) or a rule from the commute distance; to be decided in the design.
