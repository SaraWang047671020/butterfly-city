# Implementation Plan: Event Library

## Overview

Build `public/data/events.json` (35 cards from Section 1 of `data/research/RESEARCH-NOTES.md`) with a new `npm run events` command. Order: shared schema types and the output validator in `src/`; the script helpers (quarter, discount-rate parser, text checks, table loader, derivation); the curated table and expected-row list, written from the research notes; the builder and `data/EVENT-SOURCES.md`; then the tests on the real file and the final report.

All code follows `design.md`. TypeScript strict, erasable syntax only, no new dependency. Scripts run directly with Node. Property tests use fast-check 4.10.2 with at least 100 runs and the comment `// Feature: event-library, Property <n>: <title>`. Tests run once with `npx vitest --run`, never in watch mode.

Content rules for every card (requirements 2, 4, 6): the event and its links come only from the research notes; descriptions are new English text in the project's own words, factual and neutral, with no effect on any indicator stated; an Original_Source may be added only to confirm a date of a `check` or `secondary` row, and only an agency's own page or file.

## Tasks

- [ ] 1. Shared schema and output validator
  - [ ] 1.1 Create `src/types/events-file.ts`
    - `EVENT_TYPES`, `EVENT_ROLES`, `EventType`, `EventRole`, `DatePrecision`, `SourceLink`, `EventCard`, `EventsFile`, and `EVENT_CARD_KEYS` (the 13 keys in output order)
    - Types and constants only, every property `readonly`; import `QuarterKey` from `src/types/data-files.ts`
    - _Requirements: 1.1, 1.2, 1.7, 1.8_

  - [ ] 1.2 Implement `src/data/event-dates.ts`
    - `precisionOf(date)`, `isValidDate(date)` (hand-parsed, calendar and leap-year checks, no `Date` objects), `dateToQuarter(date)` (year precision uses month 1)
    - _Requirements: 1.4, 1.5, 1.11_

  - [ ] 1.3 Implement `validateEventsFile(x)` in `src/data/validate-events.ts`
    - Add `'events.json'` to the `ValidationError.file` union in `src/data/validate.ts`
    - Checks from the design: exact top-level and card key sets, field types, id pattern, length and uniqueness, date format vs. precision and range, `firstQuarter` equals `dateToQuarter(date)`, quarter range and order, closed `type` and `role` sets, at least one source with `https` URL parsed by `new URL()`, note required when `verified`, "The day is not known" required for non-day precision, sort by `date` then `id`
    - Returns all errors with JSON paths; never throws
    - _Requirements: 1.1–1.11, 3.2, 3.4, 5.7, 6.1, 6.4, 6.6_

  - [ ]* 1.4 Unit tests in `tests/data/validate-events.test.ts`
    - One minimal bad input per rule, including each forbidden key (`modifier`, `magnitude`, `impact`, `affectedIndicators`)
    - _Requirements: 1.9, 8.5_

  - [ ]* 1.5 Property tests for dates and keys
    - **Property 1: No effect fields**: any extra key added to a valid card is rejected
    - **Property 2: Quarter consistency**: for any valid day 2015–2025, the quarter equals `ceil(month / 3)`; for any end date not before the start, `lastQuarter >= firstQuarter`
    - **Validates: Requirements 1.5, 1.6, 1.9, 3.2**

- [ ] 2. Script helpers in `scripts/events/`
  - [ ] 2.1 Implement `discount-rate.ts`
    - `parseDiscountRateCsv(text)`: skip row 1, read columns by position, convert `YYYY/M/D` to ISO, sort ascending; throw `ParseError` on a malformed row
    - `checkRateCard(row, rates)` returning `confirmed`, `no-row` or `mismatch` (rate differs, direction differs from the previous row, or no previous row)
    - _Requirements: 5.4, 5.5_

  - [ ]* 2.2 Unit tests in `tests/scripts/events/discount-rate.test.ts`
    - Parse the real header shape and unpadded dates; `confirmed`; `no-row`; rate mismatch; direction mismatch; first-row case
    - Include the two rows where the notes differ from the file (2020-03-20 at 1.25%, 2022-03-18 at 1.375%)
    - _Requirements: 5.4, 5.5, 8.5_

  - [ ] 2.3 Implement `text-checks.ts` and `data/config/event-banned-terms.txt`
    - Title 1–80 and description 1–300 characters; English-only character check (CJK fails)
    - Banned terms through `checkBannedTerms()` with `banned-terms.txt` plus `event-banned-terms.txt`, and `banned-terms-exempt.txt`
    - `event-banned-terms.txt` holds at least `soaring`, `crash`, `crackdown`, `relief`, `plunge`, `surge`, `slump`, `boom`, `bubble`, with the same header comments as `banned-terms.txt`
    - _Requirements: 4.1, 4.3, 4.4, 4.6_

  - [ ]* 2.4 Unit tests in `tests/scripts/events/text-checks.test.ts`
    - Banned word, party-name term, exempt phrase, over-length title and description, CJK character
    - _Requirements: 4.3, 4.6, 8.5_

  - [ ] 2.5 Implement `table.ts`
    - Types `EventsTable`, `TableRow`, `Verification`, `SourceRow` (with `role` column) from the design
    - Loader and table checks: duplicate id; id set and per-section order equal to `event-source-rows.json`; `role` equals the expected row; `date` differs from `notesDate` only with a `compared` record whose `foundDate` equals `date`; `dayUnknown` set for every non-day date; every `majorIds` entry exists; at least one source per row
    - All errors collected with card id and field
    - _Requirements: 2.2, 2.3, 2.4, 3.1, 6.1, 7.3_

  - [ ] 2.6 Implement `derive.ts`
    - `deriveCard(row, ctx)`: `datePrecision`, `firstQuarter`, `lastQuarter` (from `endDate`), `major` from `majorIds`, and `verified` plus `verificationNote` from the derivation table in the design (fixed templates only)
    - A `mismatch` from `checkRateCard` is a build error
    - Fixed key order; sort by `date` then `id`
    - _Requirements: 1.6, 1.10, 5.1, 5.2, 5.3, 5.5, 7.1, 7.2_

  - [ ]* 2.7 Unit tests in `tests/scripts/events/table.test.ts` and `derive.test.ts`
    - Table: each failing rule from 2.5
    - Derive: one case per verification kind with the expected `verified` and note; `major`; key order; sorting
    - **Property 3: Verified implies evidence**: for any generated table row, `verified === true` only for a confirmed rate check, `notes-verified` or `compared` with matching date, and the note is then non-empty
    - **Validates: Requirements 5.1, 5.7**

- [ ] 3. Checkpoint: helpers done
  - Run `npx vitest --run` and `npm run typecheck`; both exit 0. Ask the user if questions arise.

- [ ] 4. Write the curated data from the research notes
  - [ ] 4.1 Create `data/config/event-source-rows.json`
    - One entry per data row of Sections 1a–1e (35 rows: 11, 7, 4, 6, 7), each with `id`, `section`, `notesDate` and `role` (requirement 3.1: `baseline` for the four rail openings, the sublease pilot, the 2018 commuter pass, the 2022 rent subsidy expansion, TPASS and holding tax 2.0; `narrative` for all others)
    - Copy the notes dates exactly, including year-only (`2017`) and month-only (`2020-01`, `2024-08`) dates
    - _Requirements: 2.1, 3.1_

  - [ ] 4.2 Verify dates against Original_Sources
    - Interest-rate rows: no manual step; the builder checks them against `cbc-webF1-discount-rate.csv`
    - Open `https://data.gov.tw/dataset/6022` and confirm it is the Central Bank discount-rate dataset
    - For each `check` or `secondary` row (credit-control waves 1–4, both House and Land Consolidated Income Tax rows, sublease pilot, bank lending tightening, the four rail openings, both COVID-19 rows, Hualien earthquake): try to find the date on the agency's own page (CBC press release, MOF, NLMA, Taipei or New Taipei metro operator, CDC, CWA)
    - Create `data/config/events.json` with one row per expected row holding `id`, `date`, `endDate` where needed, `type`, `role`, `sources` and `verification`; record each result as a `compared` record (label, URL, comparison date, date found) or as `pending` with what is still to be compared; decide the wave 1 date (2020-12-08 or 2020-12-03) from the CBC press release
    - A `check` row with no link in the notes and no Original_Source found is left out and listed in the report
    - Use only agency pages for this step; do not add events or replace the notes' links
    - _Requirements: 2.4, 5.1, 5.3, 5.6, 5.8, 6.2, 6.3_

  - [ ] 4.3 Complete `data/config/events.json` (the curated table)
    - Add `title`, `description` and `majorIds` (the 10 ids of requirement 7.1) to the rows created in 4.2 (35 rows minus any left out)
    - `type` per requirement 2.5; `endDate` only for the COVID-19 Level 3 alert (2021-07-27)
    - Rate rows: `cbc-discount-rate` with `change` and `rateAfter` from the Central Bank file; `notesRateAfter` for 2020-03-20 (1.125) and 2022-03-18 (the notes give a 0.25 change); describe these two with the file values
    - Sources: the notes' links for each row; the dataset 6022 page for the rate rows; Original_Sources from 4.2 where the notes give no link
    - Titles and descriptions: written from scratch, what happened, date and agency or law only; no effect on prices, rents or commutes; no parties or politicians; official policy titles in English
    - For the month-precision first COVID-19 card (a `major` card), state in the record why it is accepted as a stop point (requirement 7.4)
    - Apply the `neutrality.md` review check to every card and record it in `KIRO-LOG.md`
    - _Requirements: 2.1, 2.5, 4.1–4.5, 4.7, 6.1–6.5, 7.1, 7.4_

- [ ] 5. Builder and outputs
  - [ ] 5.1 Implement `scripts/events/build.ts` and `scripts/build-events.ts`
    - Steps: load table and rows file, table checks, read the CSV (missing file is an error), derive cards, run `validateEventsFile` and text checks, then one `writeAll` call for `public/data/events.json` and `data/EVENT-SOURCES.md`
    - Serialize with `serializeJson`; print every error with card id and field and exit 1 on failure, leaving files unchanged
    - On success print the report: card count, `verified: true` and `verified: false` ids, `major` ids, rows left out
    - `WriteFs` and file readers injected for tests
    - _Requirements: 6.6, 6.7, 8.1, 8.2, 8.3, 8.7_

  - [ ] 5.2 Generate `data/EVENT-SOURCES.md`
    - Table per source: publisher, label, URL, years of the cards using it, license (`not stated` unless known; Open Government Data License 1.0 for data.gov.tw datasets that state it)
    - Header text states that event descriptions are written in the project's own words and that no source text is copied
    - Run the banned-term check on the rendered text
    - _Requirements: 4.5, 6.5, 6.8_

  - [ ] 5.3 Add `"events": "node scripts/build-events.ts"` to `package.json`
    - _Requirements: 8.3, 8.4_

  - [ ]* 5.4 Unit tests in `tests/scripts/events/build.test.ts`
    - Whole build on in-memory input writes both files once; any error writes nothing
    - **Property 4: Deterministic build**: two runs on the same inputs give byte-identical output
    - **Validates: Requirements 8.1, 8.2**

- [ ] 6. Build the real file and test it
  - [ ] 6.1 Run `npm run events` and commit `public/data/events.json` and `data/EVENT-SOURCES.md`
    - Fix any validator error in the table, not by loosening the checks
    - _Requirements: 8.1, 8.7_

  - [ ] 6.2 Tests on the real file in `tests/data/events-file.test.ts`
    - `validateEventsFile` returns no errors; card ids equal `event-source-rows.json` (minus listed omissions); the 10 `major` ids exist; every card has a source; every `verified: true` card has a note; a mutated copy with `impact` is rejected
    - Engine shape check: every `firstQuarter` and `lastQuarter` is one of the 44 quarter keys and first is not after last
    - **Property 5: List equality**: the count of data rows in Section 1 of `RESEARCH-NOTES.md` (table lines starting with `| ` and a digit, between `## 1.` and `## 2.`) is 35 and equals the rows file
    - **Validates: Requirements 2.1, 2.2, 2.3, 3.4, 8.5**

  - [ ] 6.3 Record the engine round-trip test as a follow-up
    - Add a line to the simulation-engine spec's open items: once `run` exists, add `tests/simulation/events-roundtrip.test.ts` (real cards as engine events give the same Sim_States as an empty list, all tools at real values)
    - Update the simulation-engine glossary entry for Event to drop "affected indicators and a cited magnitude"
    - _Requirements: 3.3_

- [ ] 7. Final checkpoint
  - Run `npx vitest --run` and `npm run typecheck`; both exit 0, no test skipped, todo or `.only`
  - Report to the user: card counts, verified and unverified ids, `major` ids, rows left out, and the two rate rows where the notes differ from the Central Bank file
  - _Requirements: 8.6, 8.7_

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP. Task 6.2 (tests on the real file, including Property 5) is required.
- Task 4.2 is the only task that looks things up on the web, and only to confirm dates on agency pages. It adds no events and replaces no links from the research notes.
- The Central Bank file is the reference for the 11 rate cards. The notes differ from it on 2020-03-20 and 2022-03-18; the cards use the file values and say so in `verificationNote`.
- The engine round-trip test (requirement 3.3) cannot run until the simulation engine's `run` exists; task 6.3 records it as a follow-up.
- Never run `npm run dev` or watch-mode test commands; use `npx vitest --run`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.3", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.4", "2.5"] },
    { "id": 2, "tasks": ["1.3", "2.6", "4.2"] },
    { "id": 3, "tasks": ["1.4", "1.5", "2.7", "4.3", "5.1"] },
    { "id": 4, "tasks": ["3", "5.2", "5.3"] },
    { "id": 5, "tasks": ["5.4", "6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3"] },
    { "id": 7, "tasks": ["7"] }
  ]
}
```
