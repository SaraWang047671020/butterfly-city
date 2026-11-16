# Requirements Document

## Introduction

The event library is the file `public/data/events.json`: a list of real events from 2015Q1 to 2025Q4 that the web app shows on the policy timeline, in turn updates and in "Why?" views, and that fast-forward uses to decide where to stop.

The event list and its sources are taken from Section 1 of `data/research/RESEARCH-NOTES.md` (Sections 1a to 1e, 35 rows). This spec does not add events of its own. Where the notes mark a row `check` or `secondary`, the card is only marked `verified: true` after its date has been compared with an original source.

Two rules from `simulation.md` shape every card:

- **The effect of every event is already in the real baseline.** An event never adds to or subtracts from an indicator. A card therefore carries no impact magnitude, no list of affected indicators and no modifier. It carries what happened, when, and where that is documented.
- **MVP events have no modifier.** Interest-rate events are narrative only because no source for a rate-rise modifier exists (research notes, Decision 3). The simulation-engine modifier mechanism (its Requirement 11) stays unused.

The descriptions follow `neutrality.md`: facts only, no verdicts, no party or politician names.

### Out of scope

- Future-mode (random) events and Live-mode (daily news) events.
- Event modifiers, measured impact magnitudes and affected-indicator lists (see above).
- Events not listed in Section 1 of the research notes.
- The UI that shows the cards, and the fast-forward logic that reads `major`. This spec only defines the data.
- Changing `history.json`, `policy-track.json` or `params.json`.

## Glossary

- **Event_File**: `public/data/events.json`.
- **Event_Card**: one entry of the Event_File.
- **Research_Notes**: `data/research/RESEARCH-NOTES.md`. Its Section 1 is the Event_Source_List.
- **Event_Source_List**: the 35 rows of Sections 1a to 1e of the Research_Notes.
- **Curated_Table**: the committed hand-written table from which the Event_File is built, in `data/config/`.
- **Event_Builder**: the Node script in `scripts/` that reads the Curated_Table, validates it and writes the Event_File.
- **Event_Validator**: the part of the Event_Builder that checks the Curated_Table and the Event_File against the schema and the rules below. The web app in `src/data/` uses the same schema types.
- **Quarter_Key**: a string `YYYYQn` from `2015Q1` to `2025Q4`.
- **Date_Precision**: how exactly the real date is known: `day` (`YYYY-MM-DD`), `month` (`YYYY-MM`) or `year` (`YYYY`).
- **Role**: `baseline` or `narrative`. A `baseline` card describes a change that is itself part of the real baseline data or the real policy track (a rail opening, or the start of a program that has a series in `policy-track.json`). A `narrative` card describes an event shown only as explanation. Neither role changes any number.
- **Major_Event**: a card with `major: true`. Fast-forward stops at the quarter in which it first applies.
- **Verified**: `verified: true` means the card's date has been compared with an original source and matches, as defined in Requirement 5.
- **Original_Source**: the file or page issued by the agency that made or recorded the event (for example the Central Bank discount-rate file `data/raw/macro/cbc-webF1-discount-rate.csv`, a Central Bank press release, a Ministry of Finance notice, a CDC announcement or a Central Weather Administration report).
- **Engine_Event_Shape**: the fields the simulation engine reads from an event: an id, a first and a last Quarter_Key (simulation-engine Requirement 11).

## Requirements

### Requirement 1: Event file schema

**User Story:** As the developer, I want one fixed card shape, so that the app and the engine read every event in the same way.

#### Acceptance Criteria

1. THE Event_File SHALL be a JSON object with `schemaVersion` equal to `1` and `events`, an array of Event_Cards.
2. THE Event_Builder SHALL give every Event_Card exactly these fields: `id`, `date`, `datePrecision`, `firstQuarter`, `lastQuarter`, `type`, `title`, `description`, `role`, `major`, `verified`, `sources` and `verificationNote`.
3. THE `id` of an Event_Card SHALL be unique in the Event_File, written in lower-case kebab-case, and at most 60 characters.
4. THE `date` SHALL be an ISO date whose format matches `datePrecision` (`YYYY-MM-DD`, `YYYY-MM` or `YYYY`), and SHALL be a real calendar date from 2015-01-01 to 2025-12-31.
5. THE `firstQuarter` and `lastQuarter` SHALL be Quarter_Keys, `firstQuarter` SHALL be the quarter that contains `date`, and `lastQuarter` SHALL be equal to or later than `firstQuarter`.
6. WHEN an event has a documented end date (the COVID-19 Level 3 alert of 2021), THE `lastQuarter` SHALL be the quarter that contains the end date; OTHERWISE `lastQuarter` SHALL equal `firstQuarter`.
7. THE `type` SHALL be one of `interest-rate`, `credit-control`, `tax`, `housing-law`, `housing-program`, `transit`, `public-health` or `disaster`.
8. THE `role` SHALL be `baseline` or `narrative`; `major` and `verified` SHALL be booleans.
9. THE Event_File SHALL contain no field named `modifier`, `magnitude`, `impact` or `affectedIndicators`, and no numeric field that states an effect on an indicator.
10. THE Event_Cards SHALL be sorted by `date`, then by `id`.
11. IF a card has `datePrecision` `month` or `year`, THEN `firstQuarter` SHALL be the quarter of the first day of that month or year, and `verificationNote` SHALL state that the day is not known.

### Requirement 2: Event list and source of the list

**User Story:** As the developer, I want the event list to match the research notes exactly, so that no unreviewed event enters the game.

#### Acceptance Criteria

1. THE Event_File SHALL contain one Event_Card for each of the 35 rows of the Event_Source_List: 11 interest-rate rows (1a), 7 credit-control waves (1b), 4 tax and housing-law rows (1c), 6 central program rows (1d) and 7 shock and rail-opening rows (1e).
2. THE Event_File SHALL contain no Event_Card that is not a row of the Event_Source_List.
3. THE Event_Validator SHALL fail with a message naming the missing or extra row when the card ids and the Event_Source_List ids, kept in the Curated_Table, differ.
4. THE card dates SHALL equal the Event_Source_List dates, except where Requirement 5 changes a date after comparison with an Original_Source; in that case `verificationNote` SHALL state the date in the notes, the date found and the Original_Source.
5. THE card `type` SHALL follow the section of the row: 1a `interest-rate`, 1b `credit-control`, 1c `tax` (income tax rows) or `housing-law` (Equalization of Land Rights Act amendments and holding tax 2.0 rows), 1d `housing-program` (sublease, rent subsidy, New Youth Housing Loan, bank lending tightening) or `transit` (commuter passes and TPASS), 1e `transit` (rail openings), `public-health` (COVID-19) or `disaster` (earthquake).

### Requirement 3: Role, and no effect on indicators

**User Story:** As the developer, I want the data to make it impossible for an event to move a number, so that the zero-delta identity holds.

#### Acceptance Criteria

1. THE Event_Builder SHALL set `role` to `baseline` for the cards whose "Suggested role" in the Research_Notes is `baseline` or a player tool (the four rail openings of 1e, the sublease pilot, the 2018 commuter pass, the 2022 rent subsidy expansion, the 2023 TPASS and the 2024-07-01 holding tax 2.0), and to `narrative` for every other card.
2. THE Event_File SHALL contain no Event_Card whose data can be read as a modifier of a Policy_Tool (Requirement 1.9).
3. WHEN the Event_File is loaded as the engine event list with every Policy_Tool at its real value, THE simulation engine SHALL return Sim_States equal to those of a run with an empty event list (property of simulation-engine Requirement 11.8; tested here with the real Event_File).
4. THE Event_File SHALL pass the simulation-engine event checks for the Engine_Event_Shape: known Quarter_Keys, and `firstQuarter` not later than `lastQuarter`.

### Requirement 4: Neutral English text

**User Story:** As a reader from any political position, I want the cards to say only what happened, so that I can trust them.

#### Acceptance Criteria

1. THE `title` SHALL be 1 to 80 characters and the `description` SHALL be 1 to 300 characters, both in English.
2. THE `description` SHALL state what happened, on which date, and which agency or law it concerns, and nothing else.
3. THE `title` and `description` SHALL NOT state or imply an effect on prices, rents, commute times or any other indicator, and SHALL NOT contain judgmental words (including "failed", "disastrous", "brilliant", "finally", "soaring", "crash", "crackdown", "relief").
4. THE `title` and `description` SHALL NOT name a political party, a politician or an administration, except where a name is part of an official policy title.
5. THE descriptions SHALL be written from the Original_Source or the source links of the notes, in the project's own words; no sentence SHALL be copied from a source page.
6. THE Event_Validator SHALL fail when a text field contains a word of the banned-word list kept in the Curated_Table's validator configuration, and the banned-word list SHALL contain at least the words of criterion 3.
7. WHEN a card is written, THE author SHALL apply the `neutrality.md` review check and SHALL record that the check was done in the pull request or in `KIRO-LOG.md`.

### Requirement 5: Verification of dates

**User Story:** As the developer, I want `verified: true` to mean the date was checked against an original source, so that the library is honest about what is confirmed.

#### Acceptance Criteria

1. THE `verified` field SHALL be `true` only when the card's date and `datePrecision` have been compared with an Original_Source and match, and `verificationNote` names that Original_Source, its URL or local file path, and the date of the comparison.
2. WHERE a row in the Research_Notes has status `verified` with a link, THE Event_Builder SHALL set `verified` to `true` when `sources` contains that link and `verificationNote` states that the notes row was marked verified.
3. WHERE a row has status `check` or `secondary`, THE card SHALL have `verified: false` until the comparison of criterion 1 is done. A card that stays `verified: false` SHALL still be included, and its `verificationNote` SHALL state what is still to be compared and against which source.
4. FOR the 11 interest-rate cards, THE Event_Validator SHALL read `data/raw/macro/cbc-webF1-discount-rate.csv`, SHALL mark a card `verified` only when the file has a row with the same date, and SHALL check that the discount rate stated in the card equals the rate in that row and that the direction of the change (cut or hike) matches the previous row. The check SHALL be a script step with a Vitest unit test for the parsing and the comparison.
5. IF the discount-rate file has no row for a card date, THEN THE card SHALL keep `verified: false` and `verificationNote` SHALL say so. IF the rate or the direction in the card differs from the file, THEN THE Event_Validator SHALL fail with the card id, the date and both values. WHERE the Research_Notes row differs from the file (the notes give 1.125% for 2020-03-20 and a 0.25 change for 2022-03-18, the file gives 1.25% and 1.375%, each a change of 0.125), THE card SHALL use the file value and `verificationNote` SHALL record the notes value.
6. IF the credit-control waves 1 to 4, the two income-tax rows, the rail openings, the COVID-19 rows or the Hualien earthquake cannot be compared with an Original_Source during the build of this spec, THEN THE card SHALL keep `verified: false` and the final report SHALL list it.
7. THE Event_Validator SHALL fail when a card has `verified: true` and an empty `verificationNote`.
8. WHEN a comparison finds a date different from the notes, THE card SHALL use the date found in the Original_Source and `verificationNote` SHALL record the difference (Requirement 2.4). The wave 1 date (2020-12-08 in the notes; some reports give 2020-12-03) SHALL be decided from the Central Bank press release.

### Requirement 6: Sources

**User Story:** As a learner, I want every card to link to where the fact came from, so that I can check it.

#### Acceptance Criteria

1. THE `sources` field SHALL be an array of at least one entry, each with `label`, `publisher` and `url`; a card without a source SHALL NOT be included.
2. THE source links of a card SHALL be the links given in its Research_Notes row.
3. WHERE a row of the notes gives no link (status `check`), THE card SHALL use the Original_Source found during verification as its source link; IF no such source can be found, THEN the card SHALL NOT be included and the final report SHALL name the row.
4. THE `url` SHALL be an `https` URL.
5. THE source links SHALL NOT include Wikipedia text; WHERE a Wikipedia page is linked, THE entry SHALL also carry attribution (CC BY-SA) in its `label`.
6. THE Event_Validator SHALL fail on a malformed URL, but SHALL NOT fetch any URL at build time.
7. THE data in the Event_File SHALL contain no API key, token or password.
8. THE Event_Builder SHALL write `data/EVENT-SOURCES.md`, listing for each source the agency, dataset or page name, URL, year and license (`not stated` where none is given). `data/SOURCES.md` is generated by `npm run data` and is not edited by the Event_Builder.

### Requirement 7: Major events

**User Story:** As a player, I want fast-forward to stop at the big moments, so that I notice them.

#### Acceptance Criteria

1. THE Event_Builder SHALL set `major: true` on exactly these cards: the first COVID-19 cases (2020-01), the COVID-19 Level 3 alert (2021-05-15), the 2020-03-20 rate cut, the 2022-03-18 rate hike, credit-control wave 1 (2020-12) and wave 7 (2024-09-19), House and Land Consolidated Income Tax 2.0 (2021-07-01), the New Youth Housing Loan (2023-08-01), TPASS (2023-07-01) and the Hualien earthquake (2024-04-03).
2. THE Event_Builder SHALL set `major: false` on every other card.
3. THE list of `major` ids SHALL be kept in the Curated_Table, so that changing it needs no code change.
4. THE Event_Validator SHALL fail when `major` is `true` on a card with `verified: false` and a day-level date that was not compared, unless the card's `verificationNote` states why it is accepted.
5. WHERE two Major_Events share a quarter, THE fast-forward consumer SHALL be able to read both from the file; the file itself SHALL NOT merge them.

### Requirement 8: Build, validation and tests

**User Story:** As the developer, I want a repeatable build with tests, so that the file stays correct.

#### Acceptance Criteria

1. THE Event_Builder SHALL read the Curated_Table, run the Event_Validator and write the Event_File with stable key order and two-space indentation, so that two runs on the same inputs give byte-identical files in PowerShell and in Git Bash.
2. IF the Event_Validator finds any error, THEN THE Event_Builder SHALL print every error with the card id and the field, exit with a non-zero code and leave the existing Event_File unchanged.
3. THE Event_Builder SHALL be TypeScript with erasable syntax only, run directly by Node, and SHALL use only Node file operations (no POSIX-only commands).
4. THE Event_Builder SHALL be reachable through an npm script (name set in design), and its schema types SHALL live in `src/types/` for use by both the script and `src/data/`.
5. THE tests SHALL include: a schema test on the real Event_File (all of Requirement 1); a test that the card ids equal the Event_Source_List ids; a test for each rule that makes the validator fail (banned word, `verified: true` without a note, missing source, bad quarter, duplicate id); the discount-rate comparison test (Requirement 5.4); and a round-trip test that the loaded file passes the simulation-engine event checks.
6. THE tests SHALL be run once with `npx vitest --run`, together with `npm run typecheck`, and both SHALL exit with code 0, with no test skipped, todo or `.only`.
7. THE final report SHALL list the number of cards, the number with `verified: true` and `verified: false` (with ids), the `major` cards, and every row left out under Requirement 6.3.

## Open Questions

1. **Engine glossary.** The simulation-engine glossary still defines an Event as having "affected indicators and a cited magnitude". This spec drops both. The engine behaviour is not changed (an event without them is allowed), but the glossary wording should be updated. [Default: update the wording in a separate small edit.]
2. **Year-only and month-only dates.** Three rows have no day: the 2017 sublease pilot (year), the 2020-01 first COVID-19 cases and the 2024-08 bank lending tightening (month). [Default: keep them with the matching Date_Precision and `verified: false` unless an Original_Source gives the day.]
3. **Source for `check` rows.** Using an Original_Source found during verification goes slightly beyond "do not look for sources yourself". [Default: allowed only for verification of a date in the notes, and only the agency's own page.]


