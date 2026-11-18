# Implementation Plan: story-layer

## Overview

Loads, fills and displays the citizen stories and the model limitations page. Text content is written by the product owner and is never edited by these tasks. **Dependency:** every task runs after the game-ui spec is complete (its Data_Loader, Game_Controller, dialogs, UI_Strings_Module and approved Design_Proposal exist). Tasks 5 and 6 create files in `src/ui/` and need the approved design (game-ui Requirement 1). Run only the single test file named in a task; the PostTaskExec hook runs the suite.

## Tasks

- [ ] 1. Story file loading
  - Add the copy of `data/config/citizens.json` and `data/config/model-limits.json` to `public/data/` in `scripts/build-data.ts`.
  - Create `src/data/story-loader.ts` with the file types, `loadStoryFiles`, `validateModelFacts` and `validateIncomeSpread` (design, Data section).
  - Document the four Story_Files in `data/SOURCES.md`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.7, 2.10_

- [ ] 2. Generated data files (data pipeline and backtest)
  - Create `scripts/lib/model-facts.ts` with `updateModelFacts`, `serializeModelFacts` and the missing-value stop.
  - Call it from the survey-check step in `scripts/pipeline/commute/step.ts` (`commuteModelled`, `commuteSurvey`) and from `scripts/backtest.ts` (`backtestResult`: pick `met` or `notMet` per check from `templates.backtestResult` of `model-limits.json`, fill, join).
  - Create `scripts/pipeline/income/spread.ts` and call it from `scripts/build-data.ts`: write `public/data/income-spread.json` (41 sigmas, source FIA income year 2023 dataset 103066, method text). Do not add it to `params.json`.
  - Add the `income-spread.json` entry to `data/SOURCES.md`.
  - Run `npm run data` and `npm run backtest` once the user confirms they can be run, and commit `public/data/model-facts.json` and `public/data/income-spread.json`; if the raw files are missing, stop and list what is needed.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9_

- [ ] 3. Template filler and registry
  - Create `src/narrative/fill.ts` (`FillError`, `placeholdersOf`, `fillTemplate`), `src/narrative/registry.ts` (25 Placeholder names with producers) and `src/narrative/select.ts` (`StoryState`, `storyLines`, `endingLines`).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 8.1_

- [ ] 4. Persona numbers and story facts
  - Create `src/simulation/persona.ts` (`normalQuantile`, `personaRentBurden`); reuse an existing normal quantile or CDF helper if the repository has one.
  - Create `src/game/story-facts.ts` with `buildStoryFacts`: rent from the run, commute from `commute-matrix.json`, income from `householdIncome` and `income-spread.json`, thresholds as mapped in the design, number formatting of game-ui.
  - If the Game_Controller has no read model for the home-district rent of a run, stop and ask the user before adding one.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 8.1_

- [ ] 5. Story panel and persona picker
  - Create `src/ui/story/story-panel.ts` and the Persona store (`butterflycity.story.v1`).
  - Add its strings to the UI_Strings_Module; add its styles with tokens only.
  - Request approval of the panel and picker visuals as a change under game-ui Requirement 1.10 before writing the files.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 8.5, 8.6_

- [ ] 6. Model limitations dialog
  - Create `src/ui/story/limits-dialog.ts` on the game-ui dialog component, with the opening control and its strings.
  - Request approval of the dialog visuals together with task 5.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.5, 8.6_

- [ ] 7. Required tests
  - Create `tests/narrative/placeholders.test.ts`: every Template of both files fills from a complete fixture and the committed `model-facts.json`; a missing value fails with the Template_Id and the Placeholder. It also checks that the committed `income-spread.json` has 41 finite positive sigmas (the one schema check allowed beyond the two required tests).
  - Create `tests/narrative/banned-terms.test.ts`: raw and filled text, and the `templates.backtestResult` sentences, checked with `checkBannedTerms` and `parseTermList` from `scripts/pipeline/banned-terms.ts` and the two list files.
  - Run each file once; on failure try at most 2 fixes, then report file, test, expected and received.
  - _Requirements: 2.10, 3.5, 7.1, 7.2, 7.3, 7.4, 8.3, 8.4_

- [ ] 8. Wiring and neutrality record
  - Wire the Story_Panel, picker and Limits_Dialog into `src/main.ts` and the Game_Screen; confirm that a Story_File error leaves the game running.
  - Record the neutrality review of the new UI strings in `KIRO-LOG.md` (game-ui Requirement 15.7).
  - Run `npm run typecheck` once.
  - _Requirements: 1.4, 7.5, 8.2_

## Notes

- All tasks depend on the game-ui spec being complete.
- The chosen Persona is not part of the Save_Code; it is stored under its own `localStorage` key (task 5).
- The `ending` Templates are shown in the Story_Panel after 2025Q4 (task 5).
- Never run `npm run dev` or a watch mode; use `npx vitest --run` on a single file.
- No dependency is added by this spec.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2", "3"] },
    { "id": 1, "tasks": ["4", "7"] },
    { "id": 2, "tasks": ["5", "6"] },
    { "id": 3, "tasks": ["8"] }
  ]
}
```
